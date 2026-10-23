import { BB } from '../../../../bb/bb';
import { TPointerEvent, TPointerType } from '../../../../bb/input/event.types';
import { TVector2D } from '../../../../bb/bb-types';
import { TSelectToolMode } from '../../tool-tabs/select-ui';
import { createMatrixFromTransform } from '../../../../bb/transform/create-matrix-from-transform';
import { applyToPoint, inverse } from 'transformation-matrix';
import { TArrowKey, TEaselInterface, TEaselTool, TEaselToolTrigger } from '../easel.types';
import { TViewportTransform, TViewportTransformXY } from '../../project-viewport/project-viewport';
import { rotate, snapAngleDeg } from '../../../../bb/math/math';
import { MultiPolygon } from 'polygon-clipping';
import { TBooleanOperation, TSelectShape } from '../../../select-tool/select-tool';
import { getSelectionPath2d } from '../../../../bb/multi-polygon/get-selection-path-2d';
import { EventChain } from '../../../../bb/input/event-chain/event-chain';
import { DoubleTapper } from '../../../../bb/input/event-chain/double-tapper';
import { TChainElement } from '../../../../bb/input/event-chain/event-chain.types';
import { CornerPanning } from '../corner-panning';
import { FreeTransform } from '../../components/free-transform';
import { TScaleSnapBase } from '../../components/free-transform-scale-snap';
import { TFreeTransform } from '../../../transform/transform-types';
import {
    createFfdMesh,
    evalFFD,
    findParametricCoordinate,
    TFfdLattice,
    TFfdMesh,
    TParametric2D,
    warpLatticeViaPoint,
} from '../../../transform/ffd';
import { RENDERED_FFD_MESH_RESOLUTION } from '../../../transform/composed-transformation';

const modeToCursor: Record<TSelectToolMode, string> = {
    select: 'default',
    transform: 'move',
};

const operationToCursor: Record<TBooleanOperation, string> = {
    new: 'default',
    union: 'copy',
    difference: 'alias',
};

export type TEaselSelectMoveParams = {
    selectMode: TSelectToolMode;
    onStartSelect: (p: TVector2D, operation: TBooleanOperation) => void;
    onGoSelect: (p: TVector2D) => void;
    onEndSelect: () => void;
    onStartMoveSelect: (p: TVector2D) => void;
    onGoMoveSelect: (p: TVector2D) => void;
    onEndMoveSelect: () => void;
    onSelectAddPoly: (path: TVector2D[], operation: TBooleanOperation) => void;
    onTranslateTransform: (d: TVector2D) => void;
    // the handles moved, resized or turned the rectangle around the selection
    onFreeTransform: (transform: TFreeTransform) => void;
    // the lattice of a warp was dragged somewhere
    onWarp: (ffd: TFfdLattice) => void;
    onResetSelection: () => void;
};

/**
 * for select tool and transform tool
 *
 * This is EaselSelect as it was until Klecks 0.9.10: its transform mode moves the selection by
 * dragging and tells by how much (onTranslateTransform). Upstream's EaselSelect has since got a
 * free transform with handles and warping, which belongs to its own UI. The headless app's
 * selection tool (kl-headless-select.ts) is built on this one.
 *
 * The handles are upstream's (FreeTransform, as its EaselSelect uses it — DOM elements in the
 * easel's HTML overlay, styled inline, nothing of Klecks' stylesheet): a rectangle around the
 * selection with a grip in each corner and on each edge to resize it, and one above it to turn
 * it. They tell the rectangle they were dragged to (onFreeTransform) and are told the one to
 * show (setFreeTransform) whenever it changes without them: a drag on the canvas, the arrow
 * keys, a flip, an undo.
 *
 * The warp is upstream's too, as its EaselSelect has it: while a lattice is set (setWarp) the
 * handles are hidden, the lattice is drawn over the canvas, and a drag that starts inside it
 * pulls the point it started on to where the pointer is (onWarp); a drag that starts outside
 * moves everything, as without a warp.
 */
export class EaselSelectMove implements TEaselTool {
    // from params
    private readonly onStartSelect: (p: TVector2D, operation: TBooleanOperation) => void;
    private readonly onGoSelect: (p: TVector2D) => void;
    private readonly onEndSelect: () => void;
    private readonly onStartMoveSelect: (p: TVector2D) => void;
    private readonly onGoMoveSelect: (p: TVector2D) => void;
    private readonly onEndMoveSelect: () => void;
    private readonly onSelectAddPoly: (path: TVector2D[], operation: TBooleanOperation) => void;
    private readonly onTranslateTransform: TEaselSelectMoveParams['onTranslateTransform'];
    private readonly onFreeTransform: TEaselSelectMoveParams['onFreeTransform'];
    private readonly onWarp: TEaselSelectMoveParams['onWarp'];
    private readonly onResetSelection: () => void;

    private readonly svgEl: SVGElement;
    private readonly htmlEl: HTMLElement;
    private easel: TEaselInterface = {} as TEaselInterface;
    private viewportTransform: TViewportTransform = {} as TViewportTransform;
    private tempCtx: CanvasRenderingContext2D = BB.ctx(BB.canvas(1, 1)); // used for isPointInPath()
    private pointerChain: EventChain;
    private cornerPanning: CornerPanning;

    // state
    private canvasSelection: MultiPolygon = [];
    private selectionPath: Path2D = getSelectionPath2d([]);
    private mode: TSelectToolMode = 'select';
    private isDragging: boolean = false;

    // select-mode state
    private selectSelectMode: 'select' | 'move' = 'select';
    private didSelectionMove: boolean = false;
    private defaultBooleanOperation: TBooleanOperation = 'new'; // set by the UI
    private appliedBooleanOperation: TBooleanOperation | undefined; // once dragging, the locked in boolean operation
    private selectShape: TSelectShape = 'rect';
    private polyShape: (TVector2D & { temp?: true })[] = [];

    // transform-mode state
    private transformPointerStart: TVector2D = { x: 0, y: 0 }; // initial position, canvas coordinate
    private transformPreviousPointer: TVector2D = { x: 0, y: 0 };
    private freeTransform: FreeTransform | undefined; // the handles. exists in transform mode
    private freeTransformValue: TFreeTransform | undefined; // what they show, or are to show
    private freeTransformIsConstrained: boolean = true;
    private freeTransformIsSnapping: boolean = true;
    // what the scale snaps to factors of: the selection, untransformed
    private freeTransformScaleBase: TScaleSnapBase | undefined;
    private warpLattice: TFfdLattice | undefined; // set: the lattice is what is dragged
    private warpMesh: TFfdMesh | undefined; // to find the point of the lattice under the pointer
    private warpLatticePath: Path2D | undefined; // the lines of the lattice
    private warpStart: { parametricCoordinate: TParametric2D; lattice: TFfdLattice } | undefined;

    private viewportToCanvas(p: TVector2D): TVector2D {
        const matrix = inverse(createMatrixFromTransform(this.easel.getTransform()));
        return applyToPoint(matrix, p);
    }

    private updateSelectionPath(): void {
        this.selectionPath = getSelectionPath2d(this.canvasSelection);
    }

    private resetPolyShape(): boolean {
        if (this.polyShape.length === 0) {
            return false;
        }
        this.polyShape = [];
        this.doubleTapPointerTypes = ['touch'];
        this.easel.updateDoubleTapPointerTypes();
        this.easel.requestRender(); // because polyShape might have changed
        return true;
    }

    /** boolean operation if you also consider keys */
    private getEffectiveBooleanOperation(): TBooleanOperation {
        const isSubtract =
            this.defaultBooleanOperation === 'new'
                ? this.easel.keyListener.isPressed('alt')
                : this.defaultBooleanOperation === 'difference';
        const isAdd =
            this.defaultBooleanOperation === 'new'
                ? this.easel.keyListener.isPressed('shift')
                : this.defaultBooleanOperation === 'union';

        if (isSubtract) {
            return 'difference';
        }
        if (isAdd) {
            return 'union';
        }
        return 'new';
    }

    private getDoMoveSelection(
        effectiveOperation: TBooleanOperation,
        cursorCanvasPos: TVector2D,
    ): boolean {
        const isOverSelection =
            this.polyShape.length < 2 &&
            this.selectionPath &&
            this.tempCtx.isPointInPath(this.selectionPath, cursorCanvasPos.x, cursorCanvasPos.y);
        return effectiveOperation === 'new' && isOverSelection;
    }

    // can be repeatedly called with the same event
    private selectOnPointer(event: TPointerEvent): void {
        const effectiveOperation = this.getEffectiveBooleanOperation();
        const wasDragging = this.isDragging;
        const cursorCanvasPos = this.viewportToCanvas({ x: event.relX, y: event.relY });
        const doMove = this.getDoMoveSelection(effectiveOperation, cursorCanvasPos);

        if (event.type === 'pointerdown') {
            this.isDragging = true;
            if (doMove) {
                this.selectSelectMode = 'move';
            } else {
                this.selectSelectMode = 'select';
            }
        }
        if (event.type === 'pointerup') {
            this.isDragging = false;
        }

        if (this.selectSelectMode === 'move') {
            if (event.type === 'pointerdown' && event.button === 'left') {
                this.didSelectionMove = false;
                this.onStartMoveSelect(cursorCanvasPos);
            }
            if (event.type === 'pointermove' && event.button === 'left') {
                this.didSelectionMove = true;
                this.onGoMoveSelect(cursorCanvasPos);
            }
            if (event.type === 'pointerup') {
                this.onEndMoveSelect();
                if (!this.didSelectionMove) {
                    this.onResetSelection();
                }
            }
        } else {
            // select

            if (this.selectShape === 'poly') {
                if (event.type === 'pointermove') {
                    if (this.polyShape[this.polyShape.length - 1]?.temp) {
                        this.polyShape.pop();
                    }
                    this.polyShape.push({
                        ...cursorCanvasPos,
                        temp: true,
                    });
                    this.easel.requestRender();
                }
                if (event.type === 'pointerup' && wasDragging) {
                    if (this.polyShape.length < 2) {
                        this.appliedBooleanOperation = effectiveOperation;
                    }

                    this.doubleTapPointerTypes = [];
                    this.easel.updateDoubleTapPointerTypes();

                    if (this.polyShape[this.polyShape.length - 1]?.temp) {
                        this.polyShape.pop();
                    }

                    this.polyShape.push(cursorCanvasPos);

                    const first = this.polyShape[0];
                    const last = this.polyShape[this.polyShape.length - 1];
                    if (
                        this.polyShape.length > 2 &&
                        BB.dist(first.x, first.y, last.x, last.y) * this.viewportTransform.scale < 4
                    ) {
                        this.polyShape.pop();
                        this.polyShape.push({ ...this.polyShape[0] });
                        const shape = this.polyShape;
                        this.polyShape = [];
                        this.onSelectAddPoly(shape, this.appliedBooleanOperation!);
                        this.appliedBooleanOperation = undefined;
                    }
                }
            } else {
                if (event.type === 'pointerdown' && event.button === 'left') {
                    this.appliedBooleanOperation = effectiveOperation;
                    this.onStartSelect(cursorCanvasPos, this.appliedBooleanOperation!);
                }
                if (event.type === 'pointermove' && event.button === 'left' && this.isDragging) {
                    this.onGoSelect(cursorCanvasPos);
                }
                if (event.type === 'pointerup' && wasDragging) {
                    this.onEndSelect();
                    this.appliedBooleanOperation = undefined;
                }
            }
        }

        if (!event.button) {
            if (doMove) {
                this.selectSelectMode = 'move';
            } else {
                this.selectSelectMode = 'select';
            }
        }

        if (this.selectSelectMode === 'move') {
            this.easel.setCursor('move');
        } else {
            this.easel.setCursor(
                operationToCursor[this.appliedBooleanOperation ?? effectiveOperation],
            );
        }
    }

    // the lattice changed: what is found and drawn by it follows
    private updateWarpGeometry(): void {
        const lattice = this.warpLattice;
        if (!lattice) {
            this.warpMesh = undefined;
            this.warpLatticePath = undefined;
            return;
        }
        const { width, height } = this.easel.getProjectSize();
        this.warpMesh = createFfdMesh(
            RENDERED_FFD_MESH_RESOLUTION,
            RENDERED_FFD_MESH_RESOLUTION,
            lattice,
            width,
            height,
            true,
        );

        const sampleCount = RENDERED_FFD_MESH_RESOLUTION;
        const path = new Path2D();
        const addLine = (pointAt: (position: number) => TVector2D): void => {
            for (let e = 0; e <= sampleCount; e++) {
                const point = pointAt(e / sampleCount);
                e === 0 ? path.moveTo(point.x, point.y) : path.lineTo(point.x, point.y);
            }
        };
        for (let i = 0; i < lattice.rows; i++) {
            const t = i / (lattice.rows - 1);
            addLine((s) => evalFFD(s, t, lattice));
        }
        for (let i = 0; i < lattice.cols; i++) {
            const s = i / (lattice.cols - 1);
            addLine((t) => evalFFD(s, t, lattice));
        }
        this.warpLatticePath = path;
    }

    /**
     * A drag on the lattice. Returns false if this pointer is not the lattice's business (it went
     * down outside of it): then it moves the whole, as without a warp.
     */
    private warpOnPointer(event: TPointerEvent): boolean {
        if (!this.warpLattice || !this.warpMesh) {
            return false;
        }
        const cursorCanvasPos = this.viewportToCanvas({ x: event.relX, y: event.relY });
        const parametricCoordinate = findParametricCoordinate(
            cursorCanvasPos.x,
            cursorCanvasPos.y,
            this.warpMesh,
        );
        if (event.type === 'pointerdown' && event.button === 'left' && parametricCoordinate) {
            this.warpStart = { parametricCoordinate, lattice: this.warpLattice };
        }
        if (event.type === 'pointermove' && this.warpStart) {
            this.warpLattice = warpLatticeViaPoint(
                this.warpStart.parametricCoordinate,
                cursorCanvasPos,
                this.warpStart.lattice,
            );
            this.updateWarpGeometry();
            this.easel.requestRender();
            this.onWarp(this.warpLattice);
        }
        const isWarpDrag = !!this.warpStart;
        if (event.type === 'pointerup') {
            this.warpStart = undefined;
        }
        if (isWarpDrag || (!this.isDragging && parametricCoordinate)) {
            this.easel.setCursor('crosshair');
            return isWarpDrag;
        }
        return false;
    }

    // can be repeatedly called with the same event
    private transformOnPointer(event: TPointerEvent): void {
        this.easel.setCursor('move');
        if (this.warpOnPointer(event)) {
            return;
        }
        const transform = this.easel.getTransform();
        const matrix = inverse(createMatrixFromTransform(transform));

        if (event.type === 'pointerdown' && event.button === 'left') {
            this.transformPointerStart = applyToPoint(matrix, { x: event.relX, y: event.relY });
            this.transformPreviousPointer = { ...this.transformPointerStart };
            this.updateSelectionPath();
            this.isDragging = true;
        }
        if (event.type === 'pointermove' && event.button === 'left') {
            const canvasPointer = applyToPoint(matrix, { x: event.relX, y: event.relY });
            this.updateSelectionPath();

            const delta = {
                x: Math.round(canvasPointer.x - this.transformPreviousPointer.x),
                y: Math.round(canvasPointer.y - this.transformPreviousPointer.y),
            };
            if (delta.x === 0 && delta.y === 0) {
                return;
            }
            this.onTranslateTransform(delta);
            this.transformPreviousPointer = BB.Vec2.add(this.transformPreviousPointer, delta);
        }
        if (event.type === 'pointerup' && event.button === undefined && this.isDragging) {
            this.updateSelectionPath();
            this.isDragging = false;
        }
    }

    private createFreeTransform(): void {
        if (this.freeTransform) {
            return;
        }
        const value = this.freeTransformValue ?? { x: 1, y: 1, width: 1, height: 1, angleDeg: 0 };
        const { width, height } = this.easel.getProjectSize();
        this.freeTransform = new FreeTransform({
            ...value,
            isConstrained: this.freeTransformIsConstrained,
            // the edges of the drawing
            snapX: [0, width],
            snapY: [0, height],
            viewportTransform: this.easel.getTransform(),
            callback: (transform) => {
                if (
                    this.mode !== 'transform' ||
                    isNaN(transform.x) ||
                    isNaN(transform.y) ||
                    isNaN(transform.width) ||
                    isNaN(transform.height)
                ) {
                    // NaN: upstream's note — repeatedly halved, then dragged by a corner
                    return;
                }
                this.freeTransformValue = { ...transform };
                this.onFreeTransform(transform);
            },
            onWheel: this.easel.onWheel,
            wheelParent: this.easel.getElement(),
        });
        this.freeTransform.setSnapping(this.freeTransformIsSnapping);
        this.freeTransform.setScaleSnapping(this.freeTransformScaleBase);
        this.htmlEl.append(this.freeTransform.getElement());
        this.updateHandlesVisibility();
    }

    // the handles and the lattice are two ways to hold the same thing: one of them at a time
    private updateHandlesVisibility(): void {
        this.freeTransform
            ?.getElement()
            .style.setProperty('display', this.warpLattice ? 'none' : '');
    }

    private destroyFreeTransform(): void {
        this.freeTransform?.getElement().remove();
        this.freeTransform?.destroy();
        this.freeTransform = undefined;
        this.freeTransformValue = undefined;
    }

    private onPointerChainOut(event: TPointerEvent): void {
        this.cornerPanning.onPointer(event);

        if (this.mode === 'select') {
            this.selectOnPointer(event);
        } else {
            this.transformOnPointer(event);
        }
    }

    // ----------------------------------- public -----------------------------------
    doubleTapPointerTypes: TPointerType[] = ['touch'];
    blockTrigger: TEaselToolTrigger = 'alt';

    constructor(p: TEaselSelectMoveParams) {
        this.onTranslateTransform = p.onTranslateTransform;
        this.onFreeTransform = p.onFreeTransform;
        this.onWarp = p.onWarp;
        this.mode = p.selectMode;
        this.onStartSelect = p.onStartSelect;
        this.onGoSelect = p.onGoSelect;
        this.onEndSelect = p.onEndSelect;
        this.onStartMoveSelect = p.onStartMoveSelect;
        this.onGoMoveSelect = p.onGoMoveSelect;
        this.onEndMoveSelect = p.onEndMoveSelect;
        this.onSelectAddPoly = p.onSelectAddPoly;
        this.onResetSelection = p.onResetSelection;

        this.cornerPanning = new CornerPanning({
            getEaselSize: () => this.easel.getSize(),
            getTransform: () => this.easel.getTargetTransform(),
            setTransform: (transform) => this.easel.setTransform(transform, true),
            testCanPan: (buttonIsPressed) => {
                return (
                    (buttonIsPressed || this.polyShape.length > 1) &&
                    !(this.selectShape === 'lasso' && this.selectSelectMode === 'select')
                );
            },
            onRepeatEvent: (e) => {
                if (this.mode === 'select') {
                    this.selectOnPointer(e);
                } else {
                    this.transformOnPointer(e);
                }
            },
        });

        this.pointerChain = new EventChain({
            chainArr: [
                new DoubleTapper({
                    onDoubleTap: (e) => {
                        if (this.polyShape.length < 3) {
                            return;
                        }
                        const shape = this.polyShape.map((item) => ({ x: item.x, y: item.y }));
                        this.resetPolyShape();
                        if (shape.length > 1) {
                            shape.push({ ...shape[0] });
                            p.onSelectAddPoly(shape, this.appliedBooleanOperation!);
                        }
                    },
                    isInstant: true,
                }) as TChainElement,
            ],
        });

        this.svgEl = BB.createSvg({
            elementType: 'g',
        });
        this.htmlEl = BB.el();
    }

    getSvgElement(): SVGElement {
        return this.svgEl;
    }

    getHtmlOverlayElement(): HTMLElement {
        return this.htmlEl;
    }

    onPointer(event: TPointerEvent): void {
        this.onPointerChainOut(event);
        this.pointerChain.chainIn(event);
    }

    setEaselInterface(easelInterface: TEaselInterface): void {
        this.easel = easelInterface;
        this.viewportTransform = this.easel.getTransform();
    }

    setMode(mode: TSelectToolMode): void {
        this.mode = mode;
        this.resetPolyShape();
        if (this.mode === 'transform') {
            this.createFreeTransform();
        } else {
            this.destroyFreeTransform();
            this.setWarp(undefined);
        }
    }

    /**
     * The lattice of a warp, to be shown and dragged — in place of the handles. undefined: no
     * lattice (any more). Does not come back through onWarp.
     */
    setWarp(ffd: TFfdLattice | undefined): void {
        this.warpLattice = ffd;
        this.warpStart = undefined;
        this.updateWarpGeometry();
        this.updateHandlesVisibility();
        this.easel.requestRender?.();
    }

    // the handles are the select tool's: another tool on the easel must not find them in its way
    onTool(toolId: string): void {
        this.htmlEl.style.display = toolId === 'select' ? 'block' : 'none';
    }

    /**
     * The rectangle the handles are to show. Does not come back through onFreeTransform.
     */
    setFreeTransform(transform: TFreeTransform): void {
        this.freeTransformValue = { ...transform };
        this.freeTransform?.initialise(transform);
    }

    /**
     * The size of the selection before it was transformed: while snapping, the handles pull the
     * size to factors of it (1, 0.75, 0.5, ... - SCALE_SNAP_FACTORS).
     */
    setScaleSnapBase(base: TScaleSnapBase | undefined): void {
        this.freeTransformScaleBase = base ? { ...base } : undefined;
        this.freeTransform?.setScaleSnapping(this.freeTransformScaleBase);
    }

    /** true: a corner keeps the proportions of the rectangle. */
    setIsConstrained(isConstrained: boolean): void {
        this.freeTransformIsConstrained = isConstrained;
        this.freeTransform?.setIsConstrained(isConstrained);
    }

    activate(cursorPos?: TVector2D, poppedTemp?: boolean): void {
        this.easel.setCursor(modeToCursor[this.mode]);
        this.isDragging = false;
        this.onUpdateTransform(this.easel.getTransform());
        if (!poppedTemp) {
            this.resetPolyShape();
        }
    }

    /**
     * true: the rectangle is pulled to the edges of the drawing, its size to factors of the
     * selection's (setScaleSnapBase), and the angle to every 45°.
     */
    setIsSnapping(isSnapping: boolean): void {
        this.freeTransformIsSnapping = isSnapping;
        this.freeTransform?.setSnapping(isSnapping);
    }

    onUpdateTransform(transform: TViewportTransform): void {
        this.viewportTransform = transform;
        this.updateSelectionPath();
        this.freeTransform?.setViewportTransform(transform);
    }

    onUpdateSelection(selection: MultiPolygon | undefined): void {
        this.canvasSelection = selection || [];
        this.updateSelectionPath();
    }

    setRenderedSelection(selection: MultiPolygon | undefined): void {
        this.easel.setRenderedSelection(selection);
    }

    clearRenderedSelection(isImmediate?: boolean): void {
        this.easel.clearRenderedSelection(isImmediate);
    }

    setBooleanOperation(operation: TBooleanOperation): void {
        this.defaultBooleanOperation = operation;
    }

    setSelectShape(shape: TSelectShape): void {
        this.resetPolyShape();
        this.selectShape = shape;
    }

    getIsLocked(): boolean {
        return this.isDragging;
    }

    renderAfterViewport(ctx: CanvasRenderingContext2D, transform: TViewportTransformXY): void {
        if (this.mode === 'transform' && this.warpLatticePath) {
            ctx.save();
            ctx.lineWidth = 1 / transform.scaleY;
            // upstream's choice: 'difference' is slow in Firefox and looks no better
            ctx.strokeStyle = 'rgb(128, 128, 128)';
            ctx.stroke(this.warpLatticePath);
            ctx.restore();
        }

        if (this.polyShape.length < 2) {
            return;
        }

        ctx.save();
        ctx.globalCompositeOperation = 'difference';
        ctx.beginPath();
        const shape = this.polyShape;
        ctx.moveTo(shape[0].x, shape[0].y);
        for (let i = 1; i < shape.length; i++) {
            ctx.lineTo(shape[i].x, shape[i].y);
        }
        ctx.lineWidth = 1 / transform.scaleX;
        ctx.strokeStyle = 'white';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
    }

    onKeyDown(keyStr: string, e: KeyboardEvent): void {
        if (keyStr === 'esc') {
            if (this.resetPolyShape()) {
                e.preventDefault();
            }
        }
    }

    onClickOutside(): void {
        this.resetPolyShape();
    }

    onBlur(): void {
        this.resetPolyShape();
    }

    onArrowKeys(direction: TArrowKey): boolean {
        if (this.mode === 'select') {
            return false;
        }
        let movement = { x: 0, y: 0 };
        if (direction === 'left') {
            movement = {
                x: -1,
                y: 0,
            };
        }
        if (direction === 'right') {
            movement = {
                x: 1,
                y: 0,
            };
        }
        if (direction === 'up') {
            movement = {
                x: 0,
                y: -1,
            };
        }
        if (direction === 'down') {
            movement = {
                x: 0,
                y: 1,
            };
        }

        // accommodate easel rotation
        const rotatedDirection = rotate(
            movement.x,
            movement.y,
            -snapAngleDeg(this.easel.getTransform().angleDeg, 90, 90),
        );

        this.onTranslateTransform(rotatedDirection);
        return true;
    }
}
