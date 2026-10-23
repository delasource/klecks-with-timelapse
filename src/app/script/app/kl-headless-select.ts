import { EaselSelectMove } from '../klecks/ui/easel/tools/easel-select-move';
import { KlCanvas } from '../klecks/canvas/kl-canvas';
import { KlCanvasSelectionTransform } from '../klecks/canvas/kl-canvas-selection-transform';
import { throwIfNull } from '../bb/base/base';
import { SelectTool, TSelectShape, TBooleanOperation } from '../klecks/select-tool/select-tool';
import { SelectTransformTool, TSelectTransformWarp } from '../klecks/select-tool/select-transform-tool';
import { createSelectionSample, TSelectionSample } from '../klecks/transform/selection-sample';
import {
  getSelectionBoundsFromSample,
  getSelectionSampleBoundsMultiPolygon,
} from '../klecks/transform/get-selection-sample-bounds';
import { createTransformationComposite } from '../klecks/transform/create-transformation-composite';
import { boundsToRect } from '../bb/math/math';
import { BB } from '../bb/bb';
import { MultiPolygon } from 'polygon-clipping';
import { KlTempHistory, TTempHistoryEntry } from '../klecks/history/kl-temp-history';
import { identity, Matrix } from 'transformation-matrix';
import { StatusOverlay } from '../klecks/ui/components/status-overlay';
import { LANG } from '../language/language';
import { KlHistory } from '../klecks/history/kl-history';
import { IHeadlessSelectActions, IHeadlessSelectState } from './kl-headless-select-types';

export type TSelectTransformTempEntry = {
  type: 'select-transform';
  data: {
    transform: Matrix;
    doClone: boolean;
    targetLayerIndex: number;
    backgroundIsTransparent: boolean;
    // the lattice of a warp, if the transformation has one
    warp?: TSelectTransformWarp;
  };
};

function isSelectTransformTempEntry(entry: TTempHistoryEntry): entry is TSelectTransformTempEntry {
  return entry.type === 'select-transform' && !!entry.data;
}

export type TKlHeadlessSelectParams = {
  klCanvas: KlCanvas;
  // moves what is selected, and records it. Shared with the replay, which needs its selection sample.
  selectionTransform: KlCanvasSelectionTransform;
  getCurrentLayerCtx: () => CanvasRenderingContext2D;
  klHistory: KlHistory;
  tempHistory: KlTempHistory;
  statusOverlay: StatusOverlay;
  onUiChange: (uiState: IHeadlessSelectState) => void;
  onError: (message: string) => void;

  onUpdateProject: () => void;
  onFill: () => void;
  onErase: () => void;
};

/**
 * Headless selection manager that coordinates selection functionality without UI dependencies.
 * Integrates the core logic from both KlAppSelect and SelectUi.
 */
export class KlHeadlessSelect implements IHeadlessSelectActions {
  // from params
  private readonly klCanvas: KlCanvas;
  private readonly selectionTransform: KlCanvasSelectionTransform;
  private readonly getCurrentLayerCtx: () => CanvasRenderingContext2D;
  private readonly klHistory: KlHistory;
  private readonly tempHistory: KlTempHistory;
  private readonly statusOverlay: StatusOverlay;
  private readonly onUpdateProject: () => void;
  private readonly onFill: () => void;
  private readonly onErase: () => void;
  private readonly onUiChange: (uiState: IHeadlessSelectState) => void;
  private readonly onError: (message: string) => void;

  // core tools
  private readonly easelSelect: EaselSelectMove;
  private readonly selectTool: SelectTool;
  private readonly transformTool: SelectTransformTool;

  // state (integrated from SelectUi)
  private mode: 'select' | 'transform' = 'select';
  private selectionShape: TSelectShape = 'lasso';
  private booleanOperation: TBooleanOperation = 'new';

  // transform state
  private targetLayerIndex: number = 0;
  private initialTransform: TSelectTransformTempEntry['data'] = {
    transform: identity(),
    doClone: false,
    targetLayerIndex: 0,
    backgroundIsTransparent: true
  };
  private backgroundIsTransparent: boolean = true;
  /**
   * What a warp is drawn from, for its preview: the selected area as it is on the layer (upstream's
   * selection sample — not the one of the matrix transformations, which KlCanvasSelectionTransform
   * keeps). Exists from the first warp of a transformation until the transformation ends.
   */
  private warpSample: TSelectionSample | undefined;
  // the selection the sample was taken with (undefined: none, the whole layer)
  private warpSampleSelection: MultiPolygon | undefined;
  // a corner handle keeps the proportions of what is transformed
  private isConstrained: boolean = true;
  // the handles are pulled to the edges of the drawing and to every 45°
  private isSnapping: boolean = true;

  constructor(p: TKlHeadlessSelectParams) {
    this.klCanvas = p.klCanvas;
    this.selectionTransform = p.selectionTransform;
    this.onUpdateProject = p.onUpdateProject;
    this.getCurrentLayerCtx = p.getCurrentLayerCtx;
    this.klHistory = p.klHistory;
    this.tempHistory = p.tempHistory;
    this.statusOverlay = p.statusOverlay;
    this.onFill = p.onFill;
    this.onErase = p.onErase;
    this.onUiChange = p.onUiChange;
    this.onError = p.onError;

    this.selectTool = new SelectTool({
      klCanvas: this.klCanvas
    });
    this.transformTool = new SelectTransformTool();

    this.easelSelect = new EaselSelectMove({
      selectMode: this.mode,
      onStartSelect: (p, operation) => this.selectTool.startSelect(p, operation),
      onGoSelect: p => {
        this.selectTool.goSelect(p);
        this.easelSelect.setRenderedSelection(this.selectTool.getSelection());
      },
      onEndSelect: () => {
        this.selectTool.endSelect();
        const selection = this.selectTool.getSelection();
        this.easelSelect.clearRenderedSelection();
        this.klCanvas.setSelection(selection);
        this.notifyUi();
      },
      onStartMoveSelect: p => {
        this.selectTool.startMoveSelect(p);
      },
      onGoMoveSelect: p => {
        this.selectTool.goMoveSelect(p);
        this.easelSelect.setRenderedSelection(this.selectTool.getSelection());
      },
      onEndMoveSelect: () => {
        this.selectTool.endMoveSelect();
        if (!this.selectTool.getDidMove()) {
          return;
        }
        const selection = this.selectTool.getSelection();
        this.easelSelect.clearRenderedSelection();
        this.klCanvas.setSelection(selection);
        // this.notifyUi();
      },
      onSelectAddPoly: (p, operation) => {
        this.selectTool.addPoly(p, operation);
        const selection = this.selectTool.getSelection();
        this.klCanvas.setSelection(selection);
        // this.notifyUi();
      },
      onTranslateTransform: d => {
        this.transformTool.translate(d);
        this.propagateTransformationChange();
      },
      onWarp: ffd => {
        this.transformTool.setWarpLattice(ffd);
        // The lattice on the easel is where this comes from: setting it again would end the drag.
        this.propagateTransformationChange(false);
      },
      onFreeTransform: freeTransform => {
        this.transformTool.setFreeTransform(freeTransform);
        // The handles are where this comes from: setting them again would fight the drag.
        this.propagateTransformationChange(false);
      },
      onResetSelection: () => this.internalResetSelection()
    });

    this.klHistory.addListener(() => {
      if (this.mode === 'select') {
        const selection = this.klCanvas.getSelection();
        this.selectTool.setSelection(selection);
        this.notifyUi();
      }
    });
  }

  // ----------------------------------- private helpers -----------------------------------

  // index of the layer that `canvas` is the canvas of. null if it is none (any more).
  private getLayerIndex(canvas: HTMLCanvasElement): number | null {
    return this.klCanvas.getLayers().find(layer => layer.canvas === canvas)?.index ?? null;
  }

  private isSourceLayerBackgroundTransparent(): boolean {
    const srcLayerCtx = this.getCurrentLayerCtx();
    const srcLayerIndex = this.getLayerIndex(srcLayerCtx.canvas);
    if (srcLayerIndex == null) return true; // layer not existent
    if (srcLayerIndex > 0) {
      // not background layer
      return true;
    }
    return this.backgroundIsTransparent;
  }

  private resetComposites(): void {
    const srcLayerCtx = this.getCurrentLayerCtx();
    const srcLayerIndex = this.getLayerIndex(srcLayerCtx.canvas);
    if (srcLayerIndex == null) return;
    this.klCanvas.setComposite(srcLayerIndex, undefined);
    if (this.targetLayerIndex !== srcLayerIndex) {
      this.klCanvas.setComposite(this.targetLayerIndex, undefined);
    }
  }

  private freeWarpSample(): void {
    if (this.warpSample) {
      BB.freeCanvas(this.warpSample.image);
      this.warpSample = undefined;
      this.warpSampleSelection = undefined;
      // it keeps a texture of the sample
      this.selectionTransform.getFfdRenderer().freeResources();
    }
  }

  private updateComposites(): void {
    const srcLayerCanvas = this.getCurrentLayerCtx().canvas;
    const srcLayerIndex = throwIfNull(this.getLayerIndex(srcLayerCanvas));

    const ffd = this.transformTool.getFfd();
    if (ffd && this.warpSample) {
      // A warp: upstream's preview, which draws the sample through the lattice (WebGL).
      const config = {
        klCanvasWidth: this.klCanvas.getWidth(),
        klCanvasHeight: this.klCanvas.getHeight(),
        transform: { type: 'ffd' as const, ffd },
        selection: this.warpSampleSelection,
        selectionSample: this.warpSample,
        algorithm: 'smooth' as const,
        backgroundIsTransparent: this.isSourceLayerBackgroundTransparent(),
        doClone: false,
        ffdRenderer: this.selectionTransform.getFfdRenderer(),
      };
      if (srcLayerIndex === this.targetLayerIndex) {
        this.klCanvas.setComposite(srcLayerIndex, createTransformationComposite(config, 'same'));
      } else {
        this.klCanvas.setComposite(srcLayerIndex, createTransformationComposite(config, 'src'));
        this.klCanvas.setComposite(this.targetLayerIndex, createTransformationComposite(config, 'dest'));
      }
      return;
    }

    if (srcLayerIndex === this.targetLayerIndex) {
      this.klCanvas.setComposite(srcLayerIndex, this.transformTool.createComposite(srcLayerCanvas));
    } else {
      this.klCanvas.setComposite(srcLayerIndex, this.transformTool.createSourceComposite(srcLayerCanvas));
      this.klCanvas.setComposite(this.targetLayerIndex, this.transformTool.createTargetComposite(srcLayerCanvas));
    }
  }

  private internalResetSelection(): void {
    this.selectTool.reset();
    const selection = this.selectTool.getSelection();
    this.klCanvas.setSelection(selection);
    this.notifyUi();
  }

  /**
   * The temp history of a transformation has two entries at most: a placeholder for "nothing
   * changed yet", and above it the transformation as it is now. An undo inside a transformation
   * therefore goes back to its beginning in one step (onHistory finds the placeholder on top and
   * falls back to initialTransform).
   *
   * The placeholder is needed since Klecks 0.9.10: KlTempHistory no longer steps below its first
   * entry (canDecreaseIndex), so the first entry cannot be the change itself.
   */
  private tempHistoryStart(): void {
    this.tempHistory.clear();
    this.tempHistory.push({ type: 'select-transform-start', data: null });
  }

  private tempHistoryReplaceTop(): void {
    const entry = {
      type: 'select-transform',
      data: {
        transform: this.transformTool.getTransform(),
        doClone: this.transformTool.getDoClone(),
        targetLayerIndex: this.targetLayerIndex,
        backgroundIsTransparent: this.backgroundIsTransparent,
        warp: this.transformTool.getWarp()
      }
    } satisfies TSelectTransformTempEntry;
    if (this.tempHistory.getEntries().length <= 1) {
      // only the placeholder (or nothing): the change goes above it
      this.tempHistory.push(entry);
    } else {
      this.tempHistory.replaceTop(entry);
    }
  }

  /**
   * The transformation changed: the outline, the preview and the temp history follow — and the
   * handles, unless they are what changed it.
   */
  private propagateTransformationChange(updateHandles: boolean = true): void {
    const selection = this.transformTool.getTransformedSelection();
    this.easelSelect.setRenderedSelection(selection);
    if (updateHandles) {
      this.updateHandles();
    }
    this.updateComposites();
    this.onUpdateProject();
    // this.notifyUi();
    this.tempHistoryReplaceTop();
  }

  // the handles show the rectangle around the selection where the transformation has it now —
  // or, while warping, the easel shows the lattice in their place
  private updateHandles(): void {
    this.easelSelect.setScaleSnapBase(this.transformTool.getUntransformedSize());
    this.easelSelect.setFreeTransform(this.transformTool.getFreeTransform());
    this.easelSelect.setWarp(this.transformTool.isWarping() ? this.transformTool.getFfd() : undefined);
  }

  private canTransform(): boolean {
    const layerIndex = this.getLayerIndex(this.getCurrentLayerCtx().canvas);
    if (layerIndex === null) return false;
    return !!this.selectionTransform.getSelectionArea(layerIndex);
  }

  private notifyUi(): void {
    this.onUiChange(this.getState());
  }

  private notifyError(message: string): void {
    this.onError?.(message);
  }

  private applyTransform(): void {
    const layerIndex = throwIfNull(this.getLayerIndex(this.getCurrentLayerCtx().canvas));
    const ffd = this.transformTool.getFfd();
    if (ffd) {
      const isApplied = this.selectionTransform.warpViaSelection({
        sourceLayer: layerIndex,
        targetLayer: this.targetLayerIndex,
        ffd,
        backgroundIsTransparent: this.backgroundIsTransparent
      });
      if (isApplied) {
        this.statusOverlay.out(LANG('select-transform-applied'), true);
      } else {
        this.notifyError('The warp could not be drawn (WebGL)');
      }
      return;
    }
    if (this.transformTool.getDoClone()) {
      this.selectionTransform.transformCloneViaSelection({
        sourceLayer: layerIndex,
        targetLayer: this.targetLayerIndex,
        transformation: this.transformTool.getTransform()
      });
    } else {
      this.selectionTransform.transformViaSelection({
        sourceLayer: layerIndex,
        targetLayer: this.targetLayerIndex,
        transformation: this.transformTool.getTransform(),
        backgroundIsTransparent: this.backgroundIsTransparent
      });
    }
    this.statusOverlay.out(LANG('select-transform-applied'), true);
  }

  private enterTransformMode(): void {
    this.tempHistory.setIsActive(true);
    this.tempHistoryStart();
    let selection = this.selectTool.getSelection() || [];
    if (selection.length === 0) {
      const width = this.klCanvas.getWidth();
      const height = this.klCanvas.getHeight();
      selection = [
        [
          [
            [0, 0],
            [width, 0],
            [width, height],
            [0, height],
            [0, 0]
          ]
        ]
      ];
    }

    this.freeWarpSample();
    this.transformTool.setSelection(selection);
    this.transformTool.setDoClone(false);
    this.transformTool.setSelectionSample(this.selectionTransform.getSelectionSample());
    const currentLayerCanvas = this.getCurrentLayerCtx().canvas;
    const layerIndex = throwIfNull(this.getLayerIndex(currentLayerCanvas));
    this.initialTransform.targetLayerIndex = layerIndex;
    this.initialTransform.backgroundIsTransparent = this.backgroundIsTransparent;
    this.targetLayerIndex = layerIndex;
    this.transformTool.setBackgroundIsTransparent(this.isSourceLayerBackgroundTransparent());
    this.updateComposites();
    const transformedSelection = this.transformTool.getTransformedSelection();
    this.easelSelect.setRenderedSelection(transformedSelection);
    this.updateHandles();
    this.onUpdateProject();
  }

  private enterSelectMode(): void {
    this.tempHistory.clear();
    this.tempHistory.setIsActive(false);
    const layerIndex = throwIfNull(this.getLayerIndex(this.getCurrentLayerCtx().canvas));
    if (
      this.transformTool.isTransformationChanged() ||
      this.transformTool.getDoClone() ||
      layerIndex !== this.targetLayerIndex
    ) {
      // something changed -> apply
      this.applyTransform();
    }
    this.freeWarpSample();
    this.selectionTransform.clearSelectionSample();
    this.klCanvas.setComposite(layerIndex, undefined);
    this.klCanvas.setComposite(this.targetLayerIndex, undefined);
    this.easelSelect.clearRenderedSelection(true);
    const selection = this.klCanvas.getSelection();
    this.selectTool.setSelection(selection);
    this.notifyUi();
    this.onUpdateProject();
  }

  // ----------------------------------- public API -----------------------------------

  // Mode operations
  setSelectMode(): void {
    if (this.mode !== 'select') {
      this.mode = 'select';
      this.enterSelectMode();
      this.easelSelect.setMode(this.mode);
      this.notifyUi();
    }
  }

  setTransformMode(): boolean {
    if (!this.canTransform()) {
      return false;
    }
    if (this.mode !== 'transform') {
      this.mode = 'transform';
      this.enterTransformMode();
      this.easelSelect.setMode(this.mode);
      this.notifyUi();
    }
    return true;
  }

  // Selection operations
  setSelectionShape(shape: TSelectShape): void {
    this.selectionShape = shape;
    this.selectTool.setShape(shape);
    this.easelSelect.setSelectShape(shape);
    this.notifyUi();
  }

  resetSelection(): void {
    this.internalResetSelection();
    this.notifyUi();
  }

  selectAll(): void {
    this.selectTool.selectAll();
    const selection = this.selectTool.getSelection();
    this.klCanvas.setSelection(selection);
    this.notifyUi();
  }

  invertSelection(): void {
    this.selectTool.invertSelection();
    const selection = this.selectTool.getSelection();
    this.klCanvas.setSelection(selection);
    this.notifyUi();
  }

  setBooleanOperation(operation: TBooleanOperation): void {
    this.booleanOperation = operation;
    this.easelSelect.setBooleanOperation(operation);
    this.notifyUi();
  }

  // Transform operations
  flipHorizontal(): void {
    this.transformTool.flip('x');
    this.propagateTransformationChange();
    this.notifyUi();
  }

  flipVertical(): void {
    this.transformTool.flip('y');
    this.propagateTransformationChange();
    this.notifyUi();
  }

  rotate(degrees: number): void {
    this.transformTool.rotateDeg(degrees);
    this.propagateTransformationChange();
    this.notifyUi();
  }

  clone(): void {
    // commit
    this.tempHistoryStart();
    const layerIndex = throwIfNull(this.getLayerIndex(this.getCurrentLayerCtx().canvas));
    // apply
    // should always apply. user might want to make something more opaque.
    if (this.transformTool.hasWarp()) {
      // A warp is committed as what it is; the clone that starts now samples the warped area anew.
      this.applyTransform();
      this.freeWarpSample();
    } else if (this.transformTool.getDoClone()) {
      this.selectionTransform.transformCloneViaSelection({
        sourceLayer: layerIndex,
        targetLayer: this.targetLayerIndex,
        transformation: this.transformTool.getTransform()
      });
    } else if (this.transformTool.isTransformationChanged()) {
      this.selectionTransform.transformViaSelection({
        sourceLayer: layerIndex,
        targetLayer: this.targetLayerIndex,
        transformation: this.transformTool.getTransform(),
        backgroundIsTransparent: this.backgroundIsTransparent
      });
    }
    const oldSelection = this.transformTool.getTransformedSelection();

    // start another transform
    const selection = this.klCanvas.getSelection() || oldSelection;
    this.initialTransform.backgroundIsTransparent = this.backgroundIsTransparent;
    this.transformTool.setSelection(selection);
    this.transformTool.setDoClone(true);
    this.transformTool.setSelectionSample(this.selectionTransform.getSelectionSample());
    this.updateComposites();
    this.easelSelect.setRenderedSelection(this.transformTool.getTransformedSelection());
    this.updateHandles();
    this.onUpdateProject();
    this.notifyUi();

    this.statusOverlay.out(LANG('select-transform-clone-applied'), true);
  }

  setConstrained(isConstrained: boolean): void {
    this.isConstrained = isConstrained;
    this.easelSelect.setIsConstrained(isConstrained);
    this.notifyUi();
  }

  /**
   * true: the lattice of a warp is laid over what is transformed and can be dragged (the handles
   * are gone meanwhile). false: the warp stays as it is, and the handles move it as a whole.
   * Not while cloning: a clone stamps the sample of the matrix transformations, a warp draws
   * from the layer. Returns whether it is warping now.
   */
  setWarping(isWarping: boolean): boolean {
    if (this.mode !== 'transform' || this.transformTool.isWarping() === isWarping) {
      return this.transformTool.isWarping();
    }
    if (isWarping) {
      if (this.transformTool.getDoClone()) {
        return false;
      }
      if (!this.warpSample) {
        const layerIndex = throwIfNull(this.getLayerIndex(this.getCurrentLayerCtx().canvas));
        this.warpSample = createSelectionSample(layerIndex, this.klCanvas);
        this.warpSampleSelection = this.klCanvas.getSelection();
        if (!this.warpSample) {
          return false; // nothing there to warp
        }
      }
      this.transformTool.startWarp(
        boundsToRect(getSelectionBoundsFromSample(this.warpSample)),
        this.warpSampleSelection ?? getSelectionSampleBoundsMultiPolygon(this.warpSample)
      );
    } else {
      this.transformTool.endWarp();
    }
    this.propagateTransformationChange();
    this.notifyUi();
    return this.transformTool.isWarping();
  }

  setSnapping(isSnapping: boolean): void {
    this.isSnapping = isSnapping;
    this.easelSelect.setIsSnapping(isSnapping);
    this.notifyUi();
  }

  // Layer operations
  moveToLayer(layerIndex: number): void {
    this.resetComposites();
    this.targetLayerIndex = layerIndex;
    this.updateComposites();
    this.onUpdateProject();
    this.tempHistoryReplaceTop();
    this.notifyUi();
  }

  // Background operations
  setTransparentBackground(isTransparent: boolean): void {
    this.backgroundIsTransparent = isTransparent;
    this.transformTool.setBackgroundIsTransparent(this.isSourceLayerBackgroundTransparent());
    this.updateComposites();
    this.onUpdateProject();
    this.tempHistoryReplaceTop();
    this.notifyUi();
  }

  // Tool operations
  erase(): void {
    this.onErase();
  }

  fill(): void {
    this.onFill();
  }

  // History operations
  commitTransform(): boolean {
    let result = false;
    if (this.mode === 'transform') {
      this.setSelectMode(); // this triggers mode change logic
      result = true;
    }
    return result;
  }

  /**
   * Leaves an open transformation without applying it — what an undo does that has nothing of
   * the transformation left to take back, right before it takes back a step of the history.
   *
   * It has to take away everything the transformation put up, as enterSelectMode does when a
   * transformation is applied: afterwards the mode is 'select', so nothing else will. Above all
   * the outline — the easel shows a tool's rendered selection *instead of* the drawing's for as
   * long as there is one, so one that is left behind hides every later change of the selection
   * (the undone selection stayed on the canvas as a dotted line, and no new one was shown).
   */
  discardTransform(): boolean {
    if (this.mode === 'transform') {
      this.resetComposites();
      this.tempHistory.clear();
      this.tempHistory.setIsActive(false);
      this.selectionTransform.clearSelectionSample();
      this.easelSelect.clearRenderedSelection(true);
      this.selectTool.setSelection(this.klCanvas.getSelection());
      this.transformTool.reset();
      this.transformTool.setDoClone(false);
      this.freeWarpSample();
      const currentCanvas = this.getCurrentLayerCtx().canvas;
      this.targetLayerIndex = throwIfNull(this.getLayerIndex(currentCanvas));
      this.mode = 'select';
      this.easelSelect.setMode(this.mode);
      this.onUpdateProject();
      this.notifyUi();
      return true;
    }
    return false;
  }

  getCurrentMode(): 'select' | 'transform' {
    return this.mode;
  }

  getState(): IHeadlessSelectState {
    const canTransform = () => this.canTransform();
    return {
      mode: this.mode,
      hasSelection: !!this.klCanvas.getSelection(),
      selectionShape: this.selectionShape,
      booleanOperation: this.booleanOperation,
      targetLayerIndex: this.targetLayerIndex,
      backgroundIsTransparent: this.backgroundIsTransparent,
      // Worked out when it is read, not when the state is made: the answer takes a scan of every
      // pixel of the layer (is there anything in the selection at all?), and the state is made
      // on every change of the history — after every stroke, and once per event of a replay,
      // where it cost a renderer 7 ms each at 1440 × 900 without anybody asking for the answer.
      get canTransform() {
        return canTransform();
      },
      isCloning: this.transformTool.getDoClone(),
      isConstrained: this.isConstrained,
      isSnapping: this.isSnapping,
      isWarping: this.transformTool.isWarping(),
      hasWarp: this.transformTool.hasWarp()
    };
  }

  getEaselSelect(): EaselSelectMove {
    return this.easelSelect;
  }

  getSelectTool(): SelectTool {
    return this.selectTool;
  }

  getTransformTool(): SelectTransformTool {
    return this.transformTool;
  }

  /**
   * Feed type from KlHistoryExecutor.onExecuted.
   * If regular undo step -> jump back to select tab
   * If temp undo/redo step -> update transformation state
   */
  onHistory(type: 'undo' | 'redo' | 'tempUndo' | 'tempRedo'): void {
    if (type === 'undo') {
      // commit
      this.setSelectMode(); // this triggers selectUi.onMode
    } else if (type === 'tempUndo' || type === 'tempRedo') {
      this.resetComposites();

      // recreate
      const entries = this.tempHistory.getEntries();
      const top = entries[entries.length - 1];

      let state = {
        ...this.initialTransform,
        doClone: this.transformTool.getDoClone()
      };
      if (top && isSelectTransformTempEntry(top)) {
        state = top.data;
      }
      this.transformTool.setTransform(state.transform);
      this.transformTool.setWarp(state.warp);
      this.transformTool.setDoClone(state.doClone);
      this.targetLayerIndex = state.targetLayerIndex;
      this.backgroundIsTransparent = state.backgroundIsTransparent;
      this.transformTool.setBackgroundIsTransparent(this.isSourceLayerBackgroundTransparent());

      const selection = this.transformTool.getTransformedSelection();
      this.easelSelect.setRenderedSelection(selection);
      this.updateHandles();
      this.updateComposites();
      this.onUpdateProject();
      this.notifyUi();
    }
  }

  destroy(): void {
    // Cleanup resources if needed
  }
}
