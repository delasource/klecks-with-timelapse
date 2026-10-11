import { EaselSelectMove } from '../klecks/ui/easel/tools/easel-select-move';
import { KlCanvas } from '../klecks/canvas/kl-canvas';
import { KlCanvasSelectionTransform } from '../klecks/canvas/kl-canvas-selection-transform';
import { throwIfNull } from '../bb/base/base';
import { SelectTool, TSelectShape, TBooleanOperation } from '../klecks/select-tool/select-tool';
import { SelectTransformTool } from '../klecks/select-tool/select-transform-tool';
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

  private updateComposites(): void {
    const srcLayerCanvas = this.getCurrentLayerCtx().canvas;
    const srcLayerIndex = throwIfNull(this.getLayerIndex(srcLayerCanvas));

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
        backgroundIsTransparent: this.backgroundIsTransparent
      }
    } satisfies TSelectTransformTempEntry;
    if (this.tempHistory.getEntries().length <= 1) {
      // only the placeholder (or nothing): the change goes above it
      this.tempHistory.push(entry);
    } else {
      this.tempHistory.replaceTop(entry);
    }
  }

  private propagateTransformationChange(): void {
    const selection = this.transformTool.getTransformedSelection();
    this.easelSelect.setRenderedSelection(selection);
    this.updateComposites();
    this.onUpdateProject();
    // this.notifyUi();
    this.tempHistoryReplaceTop();
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
    if (this.transformTool.getDoClone()) {
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
    this.onUpdateProject();
    this.notifyUi();

    this.statusOverlay.out(LANG('select-transform-clone-applied'), true);
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

  discardTransform(): boolean {
    if (this.mode === 'transform') {
      this.transformTool.reset();
      this.transformTool.setDoClone(false);
      const currentCanvas = this.getCurrentLayerCtx().canvas;
      this.targetLayerIndex = throwIfNull(this.getLayerIndex(currentCanvas));
      this.mode = 'select';
      this.easelSelect.setMode(this.mode);
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
      isCloning: this.transformTool.getDoClone()
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
      this.transformTool.setDoClone(state.doClone);
      this.targetLayerIndex = state.targetLayerIndex;
      this.backgroundIsTransparent = state.backgroundIsTransparent;
      this.transformTool.setBackgroundIsTransparent(this.isSourceLayerBackgroundTransparent());

      const selection = this.transformTool.getTransformedSelection();
      this.easelSelect.setRenderedSelection(selection);
      this.updateComposites();
      this.onUpdateProject();
    }
  }

  destroy(): void {
    // Cleanup resources if needed
  }
}
