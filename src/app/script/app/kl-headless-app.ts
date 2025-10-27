import { append, copyObj, css, randomUuid } from '../bb/base/base';
import { canvasToBlob, freeCanvas } from '../bb/base/canvas';
import { el, isInputFocused } from '../bb/base/ui';
import { ColorConverter, HSV, RGB } from '../bb/color/color';
import { EventChain } from '../bb/input/event-chain/event-chain';
import { KeyListener, sameKeys } from '../bb/input/key-listener';
import { getSelectionPath2d } from '../bb/multi-polygon/get-selection-path-2d';
import { BRUSHES, TBrushClassTypes, TBrushConfigTypes } from '../klecks/brushes/brushes';
import { ERASE_COLOR } from '../klecks/brushes/erase-color';
import { EraserBrush } from '../klecks/brushes/eraser-brush';
import { KlCanvas, TKlCanvasLayer } from '../klecks/canvas/kl-canvas';
import { LineSanitizer } from '../klecks/events/line-sanitizer';
import { LineSmoothing } from '../klecks/events/line-smoothing';
import { FILTER_LIB } from '../klecks/filters/filters';
import { THistoryEntryDataComposed, TLayerId } from '../klecks/history/history.types';
import { KlChainRecorder } from '../klecks/history/kl-chain-recorder';
import { KlEventRecorder } from '../klecks/history/kl-event-recorder';
import { IEventStorageProvider } from '../klecks/history/kl-event-storage-provider';
import { KlHistory } from '../klecks/history/kl-history';
import { KlHistoryExecutor, THistoryExecutionType } from '../klecks/history/kl-history-executor';
import { KlTempHistory } from '../klecks/history/kl-temp-history';
import { projectToComposed } from '../klecks/history/push-helpers/project-to-composed';
import { drawGradient, GradientTool } from '../klecks/image-operations/gradient-tool';
import { drawShape, ShapeTool } from '../klecks/image-operations/shape-tool';
import {
    TDrawEvent,
    TExportType, TFillSampling,
    TGradient,
    TGradientType,
    TKlProject, TMixMode,
    TRgb,
    TShapeToolMode,
    TShapeToolType
} from '../klecks/kl-types';
import { klCanvasToPsdBlob } from '../klecks/storage/kl-canvas-to-psd-blob';
import { SaveToComputer } from '../klecks/storage/save-to-computer';
import { PinchZoomWatcher } from '../klecks/ui/components/pinch-zoom-watcher';
import { SaveReminder } from '../klecks/ui/components/save-reminder';
import { StatusOverlay } from '../klecks/ui/components/status-overlay';
import { UnloadWarningTrigger } from '../klecks/ui/components/unload-warning-trigger';
import { Easel } from '../klecks/ui/easel/easel';
import { EaselProjectUpdater } from '../klecks/ui/easel/easel-project-updater';
import { EaselBrush } from '../klecks/ui/easel/tools/easel-brush';
import { EaselEyedropper } from '../klecks/ui/easel/tools/easel-eyedropper';
import { EaselGradient } from '../klecks/ui/easel/tools/easel-gradient';
import { EaselHand } from '../klecks/ui/easel/tools/easel-hand';
import { EaselPaintBucket } from '../klecks/ui/easel/tools/easel-paint-bucket';
import { EaselRotate } from '../klecks/ui/easel/tools/easel-rotate';
import { EaselShape } from '../klecks/ui/easel/tools/easel-shape';
import { EaselText } from '../klecks/ui/easel/tools/easel-text';
import { EaselZoom } from '../klecks/ui/easel/tools/easel-zoom';
import { clipboardDialog } from '../klecks/ui/modals/clipboard-dialog';
import { DIALOG_COUNTER } from '../klecks/ui/modals/modal-count';
import { translateSmoothing } from '../klecks/utils/translate-smoothing';
import { LANG } from '../language/language';
import { LayerHeadlessController } from './layer-headless-controller';
import { getDefaultProjectOptions } from './default-project';
import { KlAppSelect } from './kl-app-select';

/* TODO
 * Select UI fehlt
 * UI: BrushOptions
 *   Slider Curves (siehe Klecks -UI)
 *   Slider (Range) Style besser machen
 *   Linke Seite sollte sich "top" orientieren und nicht "top mid" damit die ui nicht so springt
 * UI: Layers
 * UI: Colors
 * UI: Filter
 * Resize triggert nicht das resizen vom canvas element
 * Zoom-Indikator
 *
 */

export type TKlToolId =
    | 'hand'
    | 'brush'
    | 'select'
    | 'eyedropper'
    | 'paintBucket'
    | 'gradient'
    | 'text'
    | 'shape'
    | 'rotate'
    | 'zoom';

export type TKlBrushId = keyof typeof BRUSHES;

export type TKlHeadlessUiState = {
    isColorPickerEnabled: boolean;
    canUndo: boolean;
    canRedo: boolean;
    primaryColorRgb: RGB;
    primaryColorHsv: HSV;
    secondaryColorRgb: RGB;
    secondaryColorHsv: HSV;
    brushConfig: { [key: string]: TBrushConfigTypes; }
    currentBrushId: TKlBrushId;
    currentLayerId: TLayerId;
    tool: TKlToolId;
    shape: {
        shape: TShapeToolType;
        mode: TShapeToolMode;
        isEraser: boolean;
        opacity: number;
        lineWidth: number;
        isOutwards: boolean;
        isFixed: boolean;
        isSnap: boolean;
        isLockAlpha: boolean;
        isPanning: boolean;
    };
    gradient: {
        type: TGradientType;
        opacity: number;
        doLockAlpha: boolean;
        doSnap: boolean;
        isReversed: boolean;
        isEraser: boolean;
    };
    fill: {
        opacity: number;
        tolerance: number;
        mode: TFillSampling
        grow: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
        isEraser: boolean;
        isContiguous: boolean;
    },
    select: {
        mode: 'select' | 'transform';
        selectShape: 'rect' | 'ellipse' | 'lasso' | 'poly';
        selectOperation: 'new' | 'union' | 'difference';
        hasSelection: boolean;
    }
    layers: {
        index: number;
        name: string;
        opacity: number;
        isVisible: boolean;
        mixModeStr: TMixMode;
    }[]
}

const DEFAULT_UI_STATE: TKlHeadlessUiState = {
    isColorPickerEnabled: false,
    canRedo: false,
    canUndo: false,
    primaryColorRgb: { r: 0, g: 0, b: 0 },
    primaryColorHsv: { h: 0, s: 0, v: 0 },
    secondaryColorRgb: { r: ERASE_COLOR, g: ERASE_COLOR, b: ERASE_COLOR },
    secondaryColorHsv: { h: 0, s: 0, v: 100 },
    brushConfig: {},
    currentBrushId: 'PenBrush',
    tool: 'brush',
    currentLayerId: '0', // ?
    shape: {
        shape: 'rect',
        mode: 'stroke',
        opacity: 1,
        lineWidth: 4,
        isOutwards: false,
        isFixed: false,
        isSnap: false,
        isEraser: false,
        isLockAlpha: false,
        isPanning: false
    },
    gradient: {
        opacity: 1,
        type: 'linear',
        doLockAlpha: false,
        doSnap: false,
        isReversed: false,
        isEraser: false,
    },
    select: {
        mode: 'select',
        selectShape: 'lasso',
        selectOperation: 'new',
        hasSelection: false
    },
    fill: {
        tolerance: 0.2,
        opacity: 1,
        mode: 'all',
        grow: 0,
        isEraser: false,
        isContiguous: false,
    },
    layers: []
};

export type TKlFeatureConfiguration = {
    // TODO limit available tools and features
}

export type TKlHeadlessAppParams = {
    project?: TKlProject;
    eventStorageProvider?: IEventStorageProvider;
    saveReminderEnabled?: boolean;
    showStatusMessageCallback: (message: string) => void;
    initialViewport?: {
        canvasWidth?: number;
    };
    canvasWidth?: number;
    canvasHeight?: number;
    featureConfiguration?: TKlFeatureConfiguration;
}

const exportType: TExportType = 'png';

export type TUiEventType = 'isDrawing' | 'uiStateChanged' | 'transformChanged' | 'statusMessage';
export type TUiEventHandler = (obj: TKlHeadlessUiState | any) => void;

export class KlHeadlessApp {
    private readonly rootEl: HTMLElement;
    private readonly klCanvas: KlCanvas;
    private readonly easel: Easel<TKlToolId>;
    private readonly easelProjectUpdater: EaselProjectUpdater<TKlToolId>;
    private readonly easelBrush: EaselBrush;
    private readonly klHistory: KlHistory;
    private readonly tempHistory = new KlTempHistory();
    private readonly klHistoryExecutor: KlHistoryExecutor;
    private readonly klRecorder: KlEventRecorder | undefined;
    private readonly chainRecorder: KlChainRecorder | undefined;
    private readonly unloadWarningTrigger: UnloadWarningTrigger | undefined;
    private readonly saveReminder: SaveReminder | undefined;
    private readonly lineSanitizer: LineSanitizer;
    private readonly saveToComputer: SaveToComputer;
    private readonly klAppSelect: KlAppSelect;
    private readonly layerController: LayerHeadlessController;

    private lastSavedHistoryIndex: number = 0;
    private uiState: TKlHeadlessUiState = DEFAULT_UI_STATE;
    private uiWidth: number; // called "ui" for compat but means "root" or "canvas" dimensions
    private uiHeight: number;
    private currentLayer: TKlCanvasLayer;
    private brushes: { [key: string]: TBrushClassTypes } = {};
    private lastNonEraserBrushId: TKlBrushId = 'PenBrush';

    private uiUpdateListeners: Map<TUiEventType, TUiEventHandler[]> = new Map();


    // ----- private ------

    private updateLastSaved(): void {
        this.lastSavedHistoryIndex = this.klHistory.getTotalIndex();
        this.saveReminder?.reset();
        this.unloadWarningTrigger?.update();
    }

    private triggerUiEvent(eventType: TUiEventType, state: any) {
        const listeners = this.uiUpdateListeners.get(eventType);
        if (listeners) {
            listeners.forEach((callback) => {
                try {
                    callback(state);
                } catch (e) {
                    console.error('Error in UI event listener for event', eventType, e);
                }
            });
        }
    }

    private updateUi() {
        this.triggerUiEvent('uiStateChanged', { ...this.uiState });
    }

    private showStatusMessageCallback = (message: string) => {
        this.triggerUiEvent('statusMessage', message);
    };

    private setCurrentLayer(layer: TKlCanvasLayer) {
        this.uiState.currentLayerId = layer.id;
        this.currentLayer = layer;
        this.setBrushConfig({}); // Update layer context on the brushes

        // Sync layer controller active layer index
        const layerIndex = this.klCanvas.getLayers().findIndex(l => l.id === layer.id);
        if (layerIndex >= 0) {
            this.layerController.setActiveLayer(layerIndex);
        }
    };

    private copyToClipboard(showCrop: boolean = false, closeOnBlur: boolean = true) {
        clipboardDialog(
            this.rootEl,
            (maskSelection) => {
                return this.klCanvas.getCompleteCanvas(1, maskSelection);
            },
            (inputObj) => {
                if (
                    inputObj.left === 0 &&
                    inputObj.right === 0 &&
                    inputObj.top === 0 &&
                    inputObj.bottom === 0
                ) {
                    return;
                }
                //do a crop
                FILTER_LIB.cropExtend.apply!({
                    layer: this.currentLayer,
                    klCanvas: this.klCanvas,
                    input: inputObj,
                    klHistory: this.klHistory,
                });
                // this.layersUi.update();
                this.easelProjectUpdater.update();
                this.easel.resetOrFitTransform(true);
            },
            { out: this.showStatusMessageCallback } as StatusOverlay,
            showCrop || false,
            closeOnBlur,
            this.klCanvas.getSelection(),
        );
    };

    /**
     * Uncommited action is something like select tool > transform which puts the canvas and UI into
     * a temporary state. Changes need to be committed or discarded *before* doing something else.
     *
     * returns true if something was applied
     */
    private applyUncommitted(): boolean {
        let didApply = false;
        if (this.easel.getTool() === 'select') {
            didApply = this.klAppSelect.commitTransform();
        }
        return didApply;
    };

    /** see applyUncommitted **/
    private discardUncommitted(): boolean {
        if (this.easel.getTool() === 'select') {
            return this.klAppSelect.discardTransform();
        }
        return false;
    };

    private getCurrentBrush() {
        return this.brushes[this.uiState.currentBrushId];
    }

    private clearLayer(showStatus?: boolean, ignoreSelection?: boolean) {
        this.applyUncommitted();
        const layerIndex = this.currentLayer.index;
        this.klCanvas.eraseLayer({
            layerIndex,
            useAlphaLock: layerIndex === 0 && !(this.brushes.eraserBrush as EraserBrush).getTransparentBG(),
            useSelection: !ignoreSelection,
        });
        showStatus &&
        this.showStatusMessageCallback(
            this.klCanvas.getSelection()
                ? LANG('cleared-selected-area')
                : LANG('cleared-layer')
        );
    };

    // when cycling through brushes you need to know the next non-eraser brush
    private getNextBrushId(): TKlBrushId {
        if (this.uiState.currentBrushId === 'EraserBrush') {
            return this.lastNonEraserBrushId;
        }
        const keyArr = Object.keys(this.brushes).filter((item) => item !== 'EraserBrush') as TKlBrushId[];
        const i = keyArr.findIndex((item) => item === this.uiState.currentBrushId);
        return keyArr[(i + 1) % keyArr.length];
    };

    private propagateUndoRedoChanges(
        type: THistoryExecutionType,
        composedBefore: THistoryEntryDataComposed,
    ) {
        if (['undo', 'redo'].includes(type)) {
            const composedAfter = this.klHistory.getComposed();

            this.klCanvas.updateViaComposed(composedBefore!, composedAfter);

            this.setCurrentLayer(
                this.klCanvas.getLayer(
                    composedAfter.layerMap[composedAfter.activeLayerId].index,
                ),
            );
            this.easelProjectUpdater.update(); // triggers render

            const dimensionChanged =
                composedBefore.size.width !== composedAfter.size.width ||
                composedBefore.size.height !== composedAfter.size.height;
            if (dimensionChanged) {
                this.easel.resetOrFitTransform(true);
            }
            this.easelBrush.setLastDrawEvent();
            this.updateUi();
        }

        // This may also happen on a "tempUndo"
        this.klAppSelect.onHistory(type);
    };

    public undo(showMessage?: boolean) {
        if (!this.tempHistory.canDecreaseIndex()) {
            this.discardUncommitted();
        }
        const composedBefore = this.klHistory.getComposed();
        const result = this.klHistoryExecutor.undo();
        if (!result) {
            // didn't do anything
            return;
        }
        this.klRecorder?.record('undo', []);
        this.propagateUndoRedoChanges(result.type, composedBefore);
        if (showMessage) {
            this.showStatusMessageCallback(LANG('undo'));
        }
    };

    public redo(showMessage?: boolean) {
        const composedBefore = this.klHistory.getComposed();
        const result = this.klHistoryExecutor.redo();
        if (!result) {
            // didn't do anything
            return;
        }
        this.klRecorder?.record('redo', []);
        this.propagateUndoRedoChanges(result.type, composedBefore);
        if (showMessage) {
            this.showStatusMessageCallback(LANG('redo'));
        }
    };


    constructor(p: TKlHeadlessAppParams) {
        // Register parameter
        this.on('statusMessage', p.showStatusMessageCallback);

        // UI is full browser size
        this.uiWidth = Math.max(0, window.innerWidth);
        this.uiHeight = Math.max(0, window.innerHeight);
        this.rootEl = el({
            className: 'g-root',
            css: {
                display: 'absolute',
                left: '0',
                top: '0',
                right: '0',
                bottom: '0',
            },
        });

        // default 2048, unless your screen is bigger than that (that computer then probably has the horsepower for that)
        // but not larger than 4096 - a fairly arbitrary decision
        const maxCanvasSize = Math.min(
            4096,
            Math.max(2048, Math.max(window.screen.width, window.screen.height)),
        );
        const desiredWidth = p.canvasWidth ?? this.uiWidth;
        const desiredHeight = p.canvasHeight ?? this.uiHeight;
        const initialWidth = Math.max(10, Math.min(maxCanvasSize, desiredWidth));
        const initialHeight = Math.max(10, Math.min(maxCanvasSize, desiredHeight));

        const oldestComposed = projectToComposed(
            p.project ?? getDefaultProjectOptions(randomUuid(), initialWidth, initialHeight),
        );

        this.klHistory = new KlHistory({
            oldest: oldestComposed
        });

        if (p.project) {
            // attempt at freeing memory
            p.project.layers.forEach((layer) => {
                if (layer.image instanceof HTMLCanvasElement) {
                    freeCanvas(layer.image);
                }
                layer.image = null as any;
            });
        }

        // Initialize Recorder if configuration is provided
        if (p.eventStorageProvider) {
            const projectId = oldestComposed.projectId.value;
            this.klRecorder = new KlEventRecorder(projectId, undefined, p.eventStorageProvider);
        }

        this.klCanvas = new KlCanvas(this.klHistory, /* -1 ? */ 1, this.klRecorder);

        this.currentLayer = this.klCanvas.getLayer(
            this.klCanvas.getLayerCount() - 1,
        );
        this.uiState.currentLayerId = this.currentLayer.id;

        // create brushes
        Object.entries(BRUSHES).forEach(([brushId, brushType]) => {
            const brush = new brushType();
            this.brushes[brushId] = brush;
            this.uiState.brushConfig[brushId] = brush.getBrushConfig();
            brush.setHistory(this.klHistory);
            // this.setBrushConfig(brush.getBrushConfig());
        });

        // Draw Event Chain 1:
        this.chainRecorder = this.klRecorder?.createChainRecorder(() => {
            return {
                id: this.uiState.currentBrushId,
                cfg: this.getCurrentBrushConfig()
            };
        });

        // Event Chain 2:
        this.lineSanitizer = new LineSanitizer();

        // Event Chain 3:
        const lineSmoothing = new LineSmoothing({
            smoothing: translateSmoothing(1),
        });

        const drawEventChain = new EventChain({
            // TODO replace any with proper type/interface. EventChain needs to get a change here.
            chainArr: [this.chainRecorder as any, this.lineSanitizer as any, lineSmoothing as any].filter(c => !!c),
        });

        drawEventChain.setChainOut(((event: TDrawEvent) => {
            if (event.type === 'down') {
                this.triggerUiEvent('isDrawing', true);
                this.getCurrentBrush().startLine(event.x, event.y, event.pressure);
                this.easelBrush.setLastDrawEvent({ x: event.x, y: event.y });
                this.easel.requestRender();
            }
            if (event.type === 'move') {
                this.getCurrentBrush().goLine(event.x, event.y, event.pressure, undefined);
                this.easelBrush.setLastDrawEvent({ x: event.x, y: event.y });
                this.easel.requestRender();
            }
            if (event.type === 'up') {
                this.triggerUiEvent('isDrawing', false);
                this.getCurrentBrush().endLine();
                this.easel.requestRender();
            }
            if (event.type === 'line' && event.x0 && event.y0) {
                this.getCurrentBrush().drawLineSegment(event.x0, event.y0, event.x1, event.y1);
                this.easelBrush.setLastDrawEvent({ x: event.x1, y: event.y1 });
                this.easel.requestRender();
            }
        }) as any);

        // Selection
        this.klAppSelect = new KlAppSelect({
            klCanvas: this.klCanvas,
            getCurrentLayerCtx: () => this.currentLayer.context,
            onUpdateProject: () => this.easelProjectUpdater.update(),
            klHistory: this.klHistory,
            tempHistory: this.tempHistory,
            statusOverlay: { out: this.showStatusMessageCallback } as StatusOverlay,
            onFill: () => {
                this.klCanvas.layerFill(
                    this.currentLayer.index,
                    this.uiState.primaryColorRgb,
                    undefined,
                    true,
                );
                this.showStatusMessageCallback(
                    this.klCanvas.getSelection() ? LANG('filled-selected-area') : LANG('filled')
                );
            },
            onErase: () => {
                const layerIndex = this.currentLayer.index;
                this.klCanvas.eraseLayer({
                    layerIndex,
                    useAlphaLock: layerIndex === 0 && !(this.brushes.eraserBrush as EraserBrush).getTransparentBG(),
                    useSelection: true,
                });
                this.showStatusMessageCallback(
                    this.klCanvas.getSelection()
                        ? LANG('cleared-selected-area')
                        : LANG('cleared-layer')
                );
            },
        });


        let isEraserPen: boolean = false;
        this.easelBrush = new EaselBrush({
            radius: 5,
            onLineStart: (e) => {
                // expects TDrawEvent
                isEraserPen = e.isEraserPen || false;
                if (isEraserPen) {
                    // Temporary switch to eraser
                    this.applyUncommitted();
                    this.setCurrentBrush('EraserBrush');
                    this.updateUi();
                }

                drawEventChain.chainIn({
                    type: 'down',
                    scale: this.easel.getTransform().scale,
                    shiftIsPressed: keyListener.isPressed('shift'),
                    pressure: e.pressure,
                    isCoalesced: e.isCoalesced,
                    x: e.x,
                    y: e.y,
                } as TDrawEvent as any);
            },
            onLineGo: (e) => {
                // expects TDrawEvent
                drawEventChain.chainIn({
                    type: 'move',
                    scale: this.easel.getTransform().scale,
                    shiftIsPressed: keyListener.isPressed('shift'),
                    pressure: e.pressure,
                    isCoalesced: e.isCoalesced,
                    x: e.x,
                    y: e.y,
                } as TDrawEvent as any);
            },
            onLineEnd: () => {
                // expects TDrawEvent
                drawEventChain.chainIn({
                    type: 'up',
                    scale: this.easel.getTransform().scale,
                    shiftIsPressed: keyListener.isPressed('shift'),
                    isCoalesced: false,
                } as TDrawEvent as any);
                if (isEraserPen) {
                    isEraserPen = false;
                    // Return to brush
                    this.applyUncommitted();
                    this.setCurrentBrush(this.lastNonEraserBrushId);
                    this.updateUi();
                }
            },
            onLine: (p1, p2) => {
                // expects TDrawEvent
                drawEventChain.chainIn({
                    type: 'line',
                    x0: p1.x,
                    y0: p1.y,
                    x1: p2.x,
                    y1: p2.y,
                    pressure0: 1,
                    pressure1: 1,
                } as TDrawEvent as any);
                if (isEraserPen) {
                    isEraserPen = false;
                    // Return to brush
                    this.applyUncommitted();
                    this.setCurrentBrush(this.lastNonEraserBrushId);
                    this.updateUi();
                }
            },
        });

        const shapeTool = new ShapeTool({
            onShape: (isDone, x1, y1, x2, y2, angleRad) => {
                const layerIndex = this.currentLayer.index;

                const shapeObj: any = {
                    type: this.uiState.shape.shape,
                    x1: x1,
                    y1: y1,
                    x2: x2,
                    y2: y2,
                    angleRad: angleRad,
                    isOutwards: this.uiState.shape.isOutwards,
                    opacity: this.uiState.shape.opacity,
                    isEraser: this.uiState.shape.isEraser,
                    doLockAlpha: this.uiState.shape.isLockAlpha,
                };
                if (this.uiState.shape.shape === 'line') {
                    shapeObj.strokeRgb = this.uiState.primaryColorRgb;
                    shapeObj.lineWidth = this.uiState.shape.lineWidth;
                    shapeObj.isAngleSnap = this.uiState.shape.isSnap || keyListener.isPressed('shift');
                } else {
                    shapeObj.isFixedRatio = this.uiState.shape.isFixed || keyListener.isPressed('shift');
                    if (this.uiState.shape.mode === 'stroke') {
                        shapeObj.strokeRgb = this.uiState.primaryColorRgb;
                        shapeObj.lineWidth = this.uiState.shape.lineWidth;
                    } else {
                        shapeObj.fillRgb = this.uiState.primaryColorRgb;
                    }
                }

                if (isDone) {
                    this.klCanvas.setComposite(layerIndex, undefined);
                    this.klCanvas.drawShape(layerIndex, shapeObj);
                } else {
                    const selection = this.klCanvas.getSelection();
                    const selectionPath = selection
                        ? new Path2D(getSelectionPath2d(selection))
                        : undefined;
                    this.klCanvas.setComposite(layerIndex, {
                        draw: (ctx) => {
                            drawShape(ctx, shapeObj, selectionPath);
                        },
                    });
                }

                this.easelProjectUpdater.update();
            },
        });

        const gradientTool = new GradientTool({
            onGradient: (isDone, x1, y1, x2, y2, angleRad) => {
                const layerIndex = this.currentLayer.index;
                const gradientObj: TGradient = {
                    type: this.uiState.gradient.type,
                    color1: this.uiState.primaryColorRgb,
                    isReversed: this.uiState.gradient.isReversed,
                    opacity: this.uiState.gradient.opacity,
                    doLockAlpha: this.uiState.gradient.doLockAlpha,
                    isEraser: this.uiState.gradient.isEraser,
                    doSnap: keyListener.isPressed('shift') || this.uiState.gradient.doSnap,
                    x1,
                    y1,
                    x2,
                    y2,
                    angleRad,
                };

                if (isDone) {
                    this.klCanvas.setComposite(layerIndex, undefined);
                    this.klCanvas.drawGradient(layerIndex, gradientObj);
                } else {
                    const selection = this.klCanvas.getSelection();
                    const selectionPath = selection
                        ? new Path2D(getSelectionPath2d(selection))
                        : undefined;
                    this.klCanvas.setComposite(layerIndex, {
                        draw: (ctx) => {
                            drawGradient(ctx, gradientObj, selectionPath);
                        },
                    });
                }

                this.easelProjectUpdater.update();
            },
        });

        const easelHand = new EaselHand({});

        const easelShape = new EaselShape({
            onDown: (p, angleRad) => {
                shapeTool.onDown(p.x, p.y, angleRad);
            },
            onMove: (p) => {
                shapeTool.onMove(p.x, p.y);
            },
            onUp: (p) => {
                shapeTool.onUp(p.x, p.y);
            },
        });

        // This is the canvas:
        this.easel = new Easel({
            width: Math.max(0, this.uiWidth),
            height: this.uiHeight,
            project: {
                width: this.klCanvas.getWidth(),
                height: this.klCanvas.getHeight(),
                layers: [],
            }, // temp
            tools: {
                brush: this.easelBrush,
                hand: easelHand,
                select: this.klAppSelect.getEaselSelect(),
                eyedropper: new EaselEyedropper({
                    onPick: (p) => {
                        // -> pointer move event
                        const color = this.klCanvas.getColorAt(p.x, p.y);
                        this.setColor(color);
                        return color;
                    },
                    onPickEnd: () => {
                        // -> pointer up event
                        // Toggle the "pick ui" off.
                        this.updateUi(); // again?
                    },
                }),
                paintBucket: new EaselPaintBucket({
                    onFill: (p) => {
                        this.klCanvas.floodFill(
                            this.currentLayer.index,
                            p.x,
                            p.y,
                            this.uiState.fill.isEraser ? null : this.uiState.primaryColorRgb,
                            this.uiState.fill.opacity,
                            this.uiState.fill.tolerance,
                            this.uiState.fill.mode,
                            this.uiState.fill.grow,
                            this.uiState.fill.isContiguous,
                        );
                        this.easel.requestRender();
                    },
                }),
                gradient: new EaselGradient({
                    onDown: (p, angleRad) => {
                        gradientTool.onDown(p.x, p.y, angleRad);
                    },
                    onMove: (p) => {
                        gradientTool.onMove(p.x, p.y);
                    },
                    onUp: (p) => {
                        gradientTool.onUp(p.x, p.y);
                    },
                }),
                text: new EaselText({
                    onDown: (p, angleRad) => {
                        if (DIALOG_COUNTER.get() > 0) {
                            return;
                        }

                        // TODO
                        /*KL.textToolDialog({
                            klCanvas: this.klCanvas,
                            layerIndex: this.currentLayer.index,
                            primaryColor: this.uiState.primaryColorRgb,
                            secondaryColor: this.uiState.secondaryColorRgb,

                            text: {
                                ...textToolSettings,
                                text: '',
                                x: p.x,
                                y: p.y,
                                angleRad: angleRad,
                                fill: textToolSettings.fill
                                    ? {
                                        color: {
                                            ...this.uiState.primaryColorRgb,
                                            a: textToolSettings.fill.color.a,
                                        },
                                    }
                                    : undefined,
                                stroke: textToolSettings.stroke
                                    ? {
                                        ...textToolSettings.stroke,
                                        color: {
                                            ...this.klColorSlider.getSecondaryRGB(),
                                            a: textToolSettings.stroke.color.a,
                                        },
                                    }
                                    : undefined,
                            },

                            onConfirm: (val) => {
                                textToolSettings = {
                                    ...val,
                                    text: '',
                                };
                                this.klCanvas.text(this.currentLayer.index, val);
                            },
                        });*/
                    },
                }),
                shape: easelShape,
                rotate: new EaselRotate({}),
                zoom: new EaselZoom({}),
            },
            tool: 'brush',
            onChangeTool: (toolId) => {
                this.updateUi();
            },
            onTransformChange: (transform, isScaleOrAngleChanged) => {
                this.triggerUiEvent('transformChanged', { transform, isScaleOrAngleChanged });
            },
            onUndo: () => {
                this.undo(true);
            },
            onRedo: () => {
                this.redo(true);
            },
        });

        css(this.easel.getElement(), {
            position: 'absolute',
            left: '0',
            top: '0',
        });

        append(this.rootEl, [this.easel.getElement()]);

        this.easelProjectUpdater = new EaselProjectUpdater({
            klCanvas: this.klCanvas,
            easel: this.easel,
        });

        this.klHistory.addListener(() => {
            this.easelProjectUpdater.update();
        });

        DIALOG_COUNTER.subscribe((count) => {
            this.easel.setIsFrozen(count > 0);
        });

        const keyListener = new KeyListener({
            onDown: (keyStr, event, comboStr) => {
                if (DIALOG_COUNTER.get() > 0 || isInputFocused(true)) {
                    return;
                }

                if (this.isDrawing()) {
                    return;
                }

                if (comboStr === 'home') {
                    this.easel.fitTransform();
                }
                if (comboStr === 'end') {
                    this.easel.resetTransform();
                }
                if (['ctrl+z', 'cmd+z'].includes(comboStr)) {
                    event.preventDefault();
                    this.undo();
                }
                if (
                    ['ctrl+y', 'cmd+y'].includes(comboStr) ||
                    ((sameKeys('ctrl+shift+z', comboStr) ||
                            sameKeys('cmd+shift+z', comboStr)) &&
                        keyStr === 'z')
                ) {
                    event.preventDefault();
                    this.redo();
                }
                if (['ctrl+s', 'cmd+s'].includes(comboStr)) {
                    event.preventDefault();
                    this.applyUncommitted();
                    this.saveToComputer.save();
                }
                if (['ctrl+c', 'cmd+c'].includes(comboStr)) {
                    event.preventDefault();
                    this.applyUncommitted();
                    this.copyToClipboard(true);
                }

                if (['ctrl+a', 'cmd+a'].includes(comboStr)) {
                    event.preventDefault();
                }

                if (comboStr === 'sqbr_open') {
                    if (!this.isDrawing()) {
                        const changeVal = Math.max(0.005, 0.03 / this.easel.getTransform().scale);
                        this.updateBrushConfig(old => ({ size: old.size - changeVal }));
                    }
                }
                if (comboStr === 'sqbr_close') {
                    if (!this.isDrawing()) {
                        const changeVal = Math.max(0.005, 0.03 / this.easel.getTransform().scale);
                        this.updateBrushConfig(old => ({ size: old.size + changeVal }));
                    }
                }
                if (comboStr === 'enter') {
                    if (!this.applyUncommitted()) {
                        this.klCanvas.layerFill(
                            this.currentLayer.index,
                            this.uiState.primaryColorRgb,
                            undefined,
                            true,
                        );
                        this.showStatusMessageCallback(
                            this.klCanvas.getSelection()
                                ? LANG('filled-selected-area')
                                : LANG('filled')
                        );
                    }
                }
                if (comboStr === 'esc') {
                    if (this.discardUncommitted()) {
                        event.preventDefault();
                    }
                }
                if (['delete', 'backspace'].includes(comboStr)) {
                    this.clearLayer(true);
                }
                if (comboStr === 'shift+e') {
                    event.preventDefault();
                    this.updateBrushConfig(old => {
                        return 'isEraser' in old
                            ? ({ isEraser: !old.isEraser })
                            : null;
                    });
                } else if (comboStr === 'e') {
                    event.preventDefault();
                    this.applyUncommitted();
                    this.easel.setTool('brush');
                    this.uiState.tool = 'brush';
                    this.setCurrentBrush('EraserBrush');
                    this.updateUi();
                }
                if (comboStr === 'b') {
                    event.preventDefault();
                    this.applyUncommitted();
                    const prevMode = this.easel.getTool();
                    this.easel.setTool('brush');
                    this.uiState.tool = 'brush';
                    if (prevMode === 'brush') {
                        this.setCurrentBrush(this.getNextBrushId());
                    }
                }
                if (comboStr === 'g') {
                    event.preventDefault();
                    this.applyUncommitted();
                    const newMode =
                        this.easel.getTool() === 'paintBucket' ? 'gradient' : 'paintBucket';
                    this.easel.setTool(newMode);
                    this.uiState.tool = newMode;
                    this.updateUi();
                }
                if (comboStr === 't') {
                    event.preventDefault();
                    this.applyUncommitted();
                    this.easel.setTool('text');
                    this.uiState.tool = 'text';
                    this.updateUi();
                }
                if (comboStr === 'u') {
                    event.preventDefault();
                    this.applyUncommitted();
                    this.easel.setTool('shape');
                    this.uiState.tool = 'shape';
                    this.updateUi();
                }
                if (comboStr === 'l') {
                    event.preventDefault();
                    this.applyUncommitted();
                    this.easel.setTool('select');
                    this.uiState.tool = 'select';
                    this.updateUi();
                }
                if (comboStr === 'x') {
                    event.preventDefault();
                    // Swap primary and secondary color
                    const prevPrimaryRgb = this.uiState.primaryColorRgb;
                    const prevPrimaryHsv = this.uiState.primaryColorHsv;
                    this.uiState.primaryColorRgb = this.uiState.secondaryColorRgb;
                    this.uiState.primaryColorHsv = this.uiState.secondaryColorHsv;
                    this.uiState.secondaryColorRgb = prevPrimaryRgb;
                    this.uiState.secondaryColorHsv = prevPrimaryHsv;
                    this.updateUi();
                }
            },
            onUp: (keyStr, event) => {
            },
        });

        // Register replay handlers if recorder is enabled
        if (this.klRecorder) {
            const replayer = this.klRecorder.getReplayer();
            replayer.addReplayHandler('draw', event => {
                // Replay drawing events
                const drawEvents = event.data.events as string[];
                const brushData = event.data.brush; // {id, cfg}

                if (!drawEvents || drawEvents.length == 0)
                    return;

                // Set the brush configuration
                if (brushData && this.brushes[brushData.id]) {
                    this.setCurrentBrush(brushData.id);
                    if (brushData.cfg) {
                        this.brushes[brushData.id].setBrushConfig(brushData.cfg);
                    }
                } else {
                    console.log('Unknown brush during replay:', brushData);
                }

                this.chainRecorder?.emitReplayedEvent(drawEvents);
            });

            replayer.addReplayHandler('undo', event => {
                this.undo(false); // Don't show message during replay
            });

            replayer.addReplayHandler('redo', event => {
                this.redo(false); // Don't show message during replay
            });

            replayer.addReplayHandler('l-select', (event) => {
                const layer = this.klCanvas.getLayer((event.data as number[])[0]);
                if (layer) {
                    this.setCurrentLayer(layer);
                    this.klHistory.push({
                        activeLayerId: layer.id,
                    }, false);
                }
            });

            replayer.addReplayHandler('reset', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.reset>;
                const layerIndex = this.klCanvas.reset(...data);
                this.setCurrentLayer(this.klCanvas.getLayer(layerIndex));
                this.easelProjectUpdater.update();
                this.easel.resetOrFitTransform(true);
                this.updateUi();
            });

            replayer.addReplayHandler('resize', (event) => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.resize>;
                this.klCanvas.resize(...data);
                this.easelProjectUpdater.update();
                this.easel.resetOrFitTransform(true);
            });

            replayer.addReplayHandler('resize-c', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.resizeCanvas>;
                this.klCanvas.resizeCanvas(...data);
                this.easelProjectUpdater.update();
                this.easel.resetOrFitTransform(true);
            });

            replayer.addReplayHandler('l-add', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.addLayer>;
                this.klCanvas.addLayer(...data);
                this.easelProjectUpdater.update();
                this.updateUi();
            });

            replayer.addReplayHandler('l-dupl', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.duplicateLayer>;
                this.klCanvas.duplicateLayer(...data);
                this.easelProjectUpdater.update();
                this.updateUi();
            });

            replayer.addReplayHandler('l-rm', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.removeLayer>;
                this.klCanvas.removeLayer(...data);
                this.easelProjectUpdater.update();
                this.updateUi();
            });

            replayer.addReplayHandler('l-ren', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.renameLayer>;
                this.klCanvas.renameLayer(...data);
                this.updateUi();
            });

            replayer.addReplayHandler('l-opac', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.setOpacity>;
                this.klCanvas.setOpacity(...data);
                this.easelProjectUpdater.update();
                this.updateUi();
            });

            replayer.addReplayHandler('l-vis', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.setLayerIsVisible>;
                this.klCanvas.setLayerIsVisible(...data);
                this.easelProjectUpdater.update();
                this.updateUi();
            });

            replayer.addReplayHandler('l-move', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.moveLayer>;
                this.klCanvas.moveLayer(...data);
                this.easelProjectUpdater.update();
                this.updateUi();
            });

            replayer.addReplayHandler('l-merge', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.mergeLayers>;
                this.klCanvas.mergeLayers(...data);
                this.easelProjectUpdater.update();
                this.updateUi();
            });

            replayer.addReplayHandler('l-merge-all', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.mergeAll>;
                this.klCanvas.mergeAll(...data);
                this.easelProjectUpdater.update();
                this.updateUi();
            });

            replayer.addReplayHandler('rotate', (event) => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.rotate>;
                this.klCanvas.rotate(...data);
                this.easelProjectUpdater.update();
                this.easel.resetOrFitTransform(true);
            });

            replayer.addReplayHandler('l-flip', (event) => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.flip>;
                this.klCanvas.flip(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('l-fill', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.layerFill>;
                this.klCanvas.layerFill(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('flood-fill', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.floodFill>;
                this.klCanvas.floodFill(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('shape', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.drawShape>;
                this.klCanvas.drawShape(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('grad', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.drawGradient>;
                this.klCanvas.drawGradient(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('text', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.text>;
                this.klCanvas.text(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('l-erase', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.eraseLayer>;
                this.klCanvas.eraseLayer(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('set-mixmode', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.setMixMode>;
                this.klCanvas.setMixMode(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('selection', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.setSelection>;
                this.klCanvas.setSelection(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('selection-transform', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.transformViaSelection>;
                this.klCanvas.transformViaSelection(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('selection-transform-clone', event => {
                const data = event.data as Parameters<typeof KlCanvas.prototype.transformCloneViaSelection>;
                this.klCanvas.transformCloneViaSelection(...data);
                this.easelProjectUpdater.update();
            });

            replayer.addReplayHandler('filter', event => {
                const filterKey = event.data.filterKey as string;
                const filterInput = event.data.input as any;
                const filterResult = FILTER_LIB[filterKey].apply!({
                    layer: this.currentLayer,
                    klCanvas: this.klCanvas,
                    klHistory: this.klHistory,
                    input: filterInput
                });
                if (!filterResult) {
                    console.log('Failed to apply filter during replay:', filterKey);
                    return;
                }
                FILTER_LIB[filterKey].updatePos && this.easelProjectUpdater.update();
                this.easel.resetOrFitTransform(true);
            });
        }

        this.klHistoryExecutor = new KlHistoryExecutor({
            klHistory: this.klHistory,
            tempHistory: this.tempHistory,
            onCanUndoRedoChange: (canUndo, canRedo) => {
                this.uiState.canUndo = canUndo;
                this.uiState.canRedo = canRedo;
                this.updateUi();
            },
        });

        // Viewport initialization
        this.easel.setSize(Math.max(0, this.uiWidth), this.uiHeight);
        this.resize(this.uiWidth, this.uiHeight);

        // Update initial brush
        this.setBrushConfig({
            ...this.uiState.brushConfig[this.uiState.currentBrushId],
            size: 4,
            color: this.uiState.primaryColorRgb
        });

        if (p.initialViewport?.canvasWidth && p.canvasWidth) {
            // apply scale
            const scale = (p.initialViewport.canvasWidth ?? 0) / (p.canvasWidth ?? 1);
            this.easel.scale(scale);
            // this.resetView()
        }


        this.saveToComputer = new SaveToComputer(
            () => exportType,
            this.klCanvas,
            () => {
                this.updateLastSaved();
            },
        );

        // Initialize layer controller
        this.layerController = new LayerHeadlessController({
            klCanvas: this.klCanvas,
            klHistory: this.klHistory,
            applyUncommitted: () => this.applyUncommitted(),
            onUpdateProject: () => this.easelProjectUpdater.update(),
            onClearLayer: () => this.clearLayer(true),
            onActiveLayerChange: (layerIndex: number) => {
                const layer = this.klCanvas.getLayer(layerIndex);
                if (layer) {
                    this.setCurrentLayer(layer);
                }
            },
            onLayersChange: (layers) => {
                this.uiState.layers = layers;
                this.updateUi();
            }
        });

        // TODO enable if you like
        /*this.unloadWarningTrigger = new UnloadWarningTrigger({
            klHistory: this.klHistory,
            getLastSavedHistoryIndex: () => this.lastSavedHistoryIndex,
        });*/

        {
            window.addEventListener('resize', () => {
                this.resize(window.innerWidth, window.innerHeight);
            });
            window.addEventListener('orientationchange', () => {
                this.resize(window.innerWidth, window.innerHeight);
            });
            // 2024-08: window.resize doesn't fire on iPad Safari when:
            // pinch zoomed page, then reload, and un-pinch-zoom page
            // therefor also listen to visualViewport.
            if ('visualViewport' in window && visualViewport !== null) {
                visualViewport.addEventListener('resize', () => {
                    this.resize(window.innerWidth, window.innerHeight);
                });
            }

            // iPad doesn't trigger 'resize' event when using text zoom, although it's resizing the window.
            // Workaround: place a div in the body that fills the window, and use a ResizeObserver
            const windowResizeWatcher = el({
                parent: document.body,
                css: {
                    position: 'fixed',
                    left: '0',
                    top: '0',
                    right: '0',
                    bottom: '0',
                    pointerEvents: 'none',
                    zIndex: '-1',
                    userSelect: 'none',
                },
            });
            try {
                // Not all browsers support ResizeObserver. Not critical though.
                const observer = new ResizeObserver(() => {
                        this.resize(window.innerWidth, window.innerHeight);
                    },
                );
                observer.observe(windowResizeWatcher);
            } catch (e) {
                windowResizeWatcher.remove();
            }

            // prevent ctrl scroll -> zooming page
            this.rootEl.addEventListener(
                'wheel',
                (event) => {
                    if (keyListener.isPressed('ctrl')) {
                        event.preventDefault();
                    }
                },
                { passive: false },
            );
            //maybe prevent zooming on safari mac os - todo still needed?
            const prevent = (e: Event) => {
                e.preventDefault();
            };
            window.addEventListener('gesturestart', prevent, { passive: false });
            window.addEventListener('gesturechange', prevent, { passive: false });
            window.addEventListener('gestureend', prevent, { passive: false });

            const pinchZoomWatcher = new PinchZoomWatcher();
        }

        /*setTimeout(() => {
            runBrowserStorageBanner({
                projectStore,
                klRecoveryManager,
                onOpenBrowserStorage,
                klHistory: this.klHistory,
            });
        });*/
        this.saveReminder?.init();

        // Load the drawing from the storage provider, or start a new one.
        this.klRecorder?.loadFromStorage()
            .then(x => {
                if (x === 'empty-storage') {
                    // Initial clear
                    this.klRecorder?.record('reset', [{
                        width: oldestComposed.size.width,
                        height: oldestComposed.size.height,
                        color: { r: 255, g: 255, b: 255 } as TRgb
                    }]);
                }
                // Finalise
                this.klCanvas.fixHistoryState();
                this.klRecorder?.start();
            });


    } // end of constructor


    // -------- interface --------

    getElement(): HTMLElement {
        return this.rootEl;
    }

    resize(w: number, h: number): void {
        console.log('resize', w, h);

        // iPad scrolls down when increasing text zoom
        if (window.scrollY > 0) {
            window.scrollTo(0, 0);
        }

        if (this.uiWidth === Math.max(0, w) && this.uiHeight === Math.max(0, h)) {
            return;
        }

        this.uiWidth = Math.max(0, w);
        this.uiHeight = Math.max(0, h);

        this.updateUi();
    }

    out(msg: string): void {
        this.showStatusMessageCallback(msg);
    }

    async getPNG(): Promise<Blob> {
        return await canvasToBlob(this.klCanvas.getCompleteCanvas(1), 'image/png');
    }

    getPSD = async (): Promise<Blob> => {
        return await klCanvasToPsdBlob(this.klCanvas);
    };

    getProject(): TKlProject {
        return this.klCanvas.getProject();
    }

    saveAsPsd(): void {
        this.saveToComputer.save('psd');
    }

    isDrawing(): boolean {
        return this.lineSanitizer.getIsDrawing() || this.easel.getIsLocked();
    }

    setColor(c: TRgb): void {
        this.uiState.primaryColorRgb = c;
        this.setBrushConfig({ color: c });
        this.updateUi();
    }

    setCurrentBrush(brushId: TKlBrushId | -1) {
        if (brushId == -1)
            brushId = this.lastNonEraserBrushId;

        if (brushId !== 'EraserBrush') {
            this.lastNonEraserBrushId = brushId;
        }

        this.uiState.isColorPickerEnabled = brushId !== 'EraserBrush';

        this.uiState.currentBrushId = brushId;
        this.setBrushConfig({
            color: this.uiState.primaryColorRgb,
        });
        this.easelBrush.setBrush({
            radius: this.uiState.brushConfig[this.uiState.currentBrushId].size,
            type: this.uiState.currentBrushId === 'PixelBrush' ? 'pixel-square' : 'round',
        });
        this.updateUi();
    };

    setBrushConfig(data: Partial<TBrushConfigTypes>) {
        if (data == undefined)
            return;

        const brushLogic = this.brushes[this.uiState.currentBrushId];
        brushLogic.setBrushConfig(data);

        this.uiState.brushConfig[this.uiState.currentBrushId] = {
            ...this.uiState.brushConfig[this.uiState.currentBrushId],
            ...data,
        };

        // console.log('set brush', this.uiState.currentBrushId, this.uiState.brushConfig[this.uiState.currentBrushId]);

        // Update context (varies)
        if ('setLayer' in brushLogic)
            brushLogic.setLayer(this.currentLayer);
        else if ('setContext' in brushLogic)
            brushLogic.setContext(this.currentLayer.context);

        // if there is a "size" prop
        if (data.size !== undefined) {
            if (this.easelBrush) {
                this.easelBrush.setBrush({ radius: data.size });
            }
        }
        // if there is a "color" prop
        if ((data as any).color !== undefined && !!(data as any).color.r) {
            const color = (data as any).color as TRgb;
            this.uiState.primaryColorRgb = copyObj(color);
            this.uiState.primaryColorHsv = ColorConverter.toHSV(color);
        }
        this.updateUi();
    }

    updateBrushConfig(f: (old: TBrushConfigTypes) => Partial<TBrushConfigTypes> | null) {
        const oldConfig = this.uiState.brushConfig[this.uiState.currentBrushId];
        const newConfig = f(oldConfig);
        if (newConfig != null)
            this.setBrushConfig(newConfig);
    }

    setTool(toolId: TKlToolId): void {
        this.easel.setTool(toolId);
        this.uiState.tool = toolId;
        this.updateUi();
    }

    setShapeConfig(config: Partial<typeof this.uiState.shape>): void {
        this.uiState.shape = {
            ...this.uiState.shape,
            ...config,
        };
        this.updateUi();
    }

    setGradientConfig(config: Partial<typeof this.uiState.gradient>): void {
        // TODO
    }

    setFillConfig(config: Partial<typeof this.uiState.fill>): void {
        // TODO
    }

    setSelectConfig(config: Partial<typeof this.uiState.select>): void {
    }

    getCurrentBrushConfig() {
        return this.uiState.brushConfig[this.uiState.currentBrushId];
    }

    getUiState(): TKlHeadlessUiState {
        return { ...this.uiState };
    }

    getProjectId(): string {
        return this.klHistory.getComposed().projectId?.value || '';
    }

    destroy(): void {
        // Cleanup
        this.layerController.destroy();
        this.easel.destroy();
        this.klCanvas.destroy();
    }

    on(eventType: TUiEventType, handler: TUiEventHandler): void {
        if (!this.uiUpdateListeners.has(eventType)) {
            this.uiUpdateListeners.set(eventType, []);
        }
        this.uiUpdateListeners.get(eventType)!.push(handler);
    }

    off(eventType: TUiEventType, handler: TUiEventHandler): void {
        const handlers = this.uiUpdateListeners.get(eventType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
                if (handlers.length === 0) {
                    this.uiUpdateListeners.delete(eventType);
                }
            }
        }
    }

    getLayerController(): LayerHeadlessController {
        return this.layerController;
    }

    resetView(): void {
        this.easel.scaleToNormal(false);
        this.triggerUiEvent('transformChanged', {
            transform: this.easel.getTransform(),
            isScaleOrAngleChanged: true,
        });
    }
}

