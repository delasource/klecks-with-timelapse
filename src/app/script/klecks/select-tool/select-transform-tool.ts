import { TCoordinateBounds, TVector2D } from '../../bb/bb-types';
import { MultiPolygon } from 'polygon-clipping';
import { getSelectionPath2d } from '../../bb/multi-polygon/get-selection-path-2d';
import {
    applyToPoint,
    compose,
    identity,
    Matrix,
    rotate,
    scale,
    translate,
} from 'transformation-matrix';
import { transformMultiPolygon } from '../../bb/multi-polygon/transform-multi-polygon';
import { getMultiPolyBounds } from '../../bb/multi-polygon/get-multi-polygon-bounds';
import { TLayerComposite } from '../canvas/kl-canvas';
import { TMatrixSelectionSample } from '../canvas/kl-canvas-selection-transform';
import { BB } from '../../bb/bb';
import { snapToPixel } from '../ui/components/free-transform-utils';
import { TFreeTransform } from '../transform/transform-types';
import { matrixToTuple } from '../../bb/math/matrix-to-tuple';
import { createFfdLattice, TFfdLattice } from '../transform/ffd';
import { transformFfd, transformSelection } from '../transform/composed-transformation';
import { getFfdBounds } from '../transform/ffd-utils';
import { TRect } from '../../bb/bb-types';

/** The warp of a transformation, as the temp history keeps it. */
export type TSelectTransformWarp = {
    // where the lattice is, before the matrix (canvas coordinates)
    ffd: TFfdLattice;
    // true: the lattice itself is being dragged. false: it is moved as a whole, by the matrix
    isWarping: boolean;
};

// what the matrix of a warped transformation is told relative to: the box around the lattice
function ffdFrame(ffd: TFfdLattice): TCoordinateBounds {
    const bounds = getFfdBounds(ffd);
    return {
        type: 'coordinate',
        x1: Math.floor(bounds.x1),
        y1: Math.floor(bounds.y1),
        x2: Math.max(Math.floor(bounds.x1) + 1, Math.ceil(bounds.x2)),
        y2: Math.max(Math.floor(bounds.y1) + 1, Math.ceil(bounds.y2)),
    };
}

/**
 * The matrix as "this rectangle, at this place, of this size, turned by this angle" — the form
 * the handles of FreeTransform work on. It is the inverse of freeTransformToMatrix, which composes
 * translate · rotate · scale: the angle is therefore the direction the rectangle's x-axis points
 * in after the transformation, not the rotation of transformation-matrix's decomposeTSR, which
 * takes a matrix apart as scale · rotate and names another angle as soon as the two scales
 * differ (and named a wrong one for a rotation followed by a flip).
 *
 * A mirrored matrix is told the way upstream's flipTransformation tells it: a negative width.
 */
function matrixToFreeTransform(transform: Matrix, bounds: TCoordinateBounds): TFreeTransform {
    const centerBefore = {
        x: bounds.x1 + (bounds.x2 - bounds.x1) / 2,
        y: bounds.y1 + (bounds.y2 - bounds.y1) / 2,
    };
    const centerAfter = applyToPoint(transform, centerBefore);

    const scaleX = Math.hypot(transform.a, transform.b);
    const determinant = transform.a * transform.d - transform.b * transform.c;
    const scaleY = scaleX === 0 ? 0 : determinant / scaleX;
    const isMirrored = scaleY < 0;

    let angleDeg = (Math.atan2(transform.b, transform.a) / Math.PI) * 180;
    if (isMirrored) {
        // rotate(a) · scale(x, -y) = rotate(a + 180°) · scale(-x, y)
        angleDeg += 180;
    }
    // (-180, 180]
    if (angleDeg > 180) {
        angleDeg -= 360;
    } else if (angleDeg <= -180) {
        angleDeg += 360;
    }
    angleDeg = BB.round(angleDeg, 7) + 0; // + 0: no -0

    const width = (bounds.x2 - bounds.x1) * scaleX * (isMirrored ? -1 : 1);
    const height = (bounds.y2 - bounds.y1) * Math.abs(scaleY);

    return {
        ...centerAfter,
        width,
        height,
        angleDeg,
    };
}

function freeTransformToMatrix(transform: TFreeTransform, bounds: TCoordinateBounds): Matrix {
    const centerBefore = {
        x: bounds.x1 + (bounds.x2 - bounds.x1) / 2,
        y: bounds.y1 + (bounds.y2 - bounds.y1) / 2,
    };

    const widthBefore = bounds.x2 - bounds.x1;
    const heightBefore = bounds.y2 - bounds.y1;

    const scaleX = transform.width / widthBefore;
    const scaleY = transform.height / heightBefore;

    const angleRad = (transform.angleDeg / 180) * Math.PI;

    return compose(
        translate(transform.x, transform.y),
        rotate(angleRad),
        scale(scaleX, scaleY),
        translate(-centerBefore.x, -centerBefore.y),
    );
}

/**
 * to facilitate KlCanvasSelectionTransform.transformViaSelection and provide a preview (composite)
 *
 * Upstream removed this tool with Klecks 0.9.10, in favour of a free transform inside its own UI.
 * It stays for the headless app's selection tool (kl-headless-select.ts), which moves a selection
 * by a matrix — see kl-canvas-selection-transform.ts. The handles of upstream's free transform
 * work on it too (get/setFreeTransform): what they do to the rectangle around the selection is
 * a matrix again, so it is recorded and replayed as the same event as before.
 *
 * A warp (upstream's free-form deformation: a lattice of 5 × 5 control points over the selection,
 * transform/ffd.ts) is no matrix. With one, the transformation is "the lattice, then the matrix":
 * - while the lattice is dragged (isWarping) the matrix stays the identity — a move, a flip or a
 *   turn goes into the lattice at once;
 * - afterwards the handles are back, around the box of the warped lattice, and the matrix moves
 *   the lattice as a whole (upstream calls the two states 'ffd' and 'ffd+free').
 * What is applied in the end is getFfd(): the lattice with the matrix in it.
 */
export class SelectTransformTool {
    private selection: MultiPolygon = [];
    private selectionBounds: TCoordinateBounds = {} as TCoordinateBounds;
    private transform: Matrix = {} as Matrix;
    private doClone: boolean = false; // true -> draw selected area twice (original position, and transformed position)
    private selectionSample: TMatrixSelectionSample | undefined;
    private backgroundIsTransparent: boolean = false;
    private warp: TSelectTransformWarp | undefined;
    // what the lattice was laid over, and what its outline is made from
    private warpSelection: MultiPolygon = [];

    // the matrix goes into the lattice: what the two meant together, the lattice now means alone
    private bakeMatrixIntoWarp(): void {
        if (!this.warp) {
            return;
        }
        this.warp = { ...this.warp, ffd: transformFfd(this.warp.ffd, this.getTransform()) };
        this.selectionBounds = ffdFrame(this.warp.ffd);
        this.transform = identity();
    }

    // ----------------------------------- public -----------------------------------
    constructor() {}

    setBackgroundIsTransparent(isTransparent: boolean): void {
        this.backgroundIsTransparent = isTransparent;
    }

    setSelection(selection: MultiPolygon): void {
        this.selection = selection;
        // floor & ceil to prevent blurriness
        const bounds = getMultiPolyBounds(this.selection, 'coordinate');
        this.selectionBounds = {
            type: 'coordinate',
            x1: Math.floor(bounds.x1),
            y1: Math.floor(bounds.y1),
            x2: Math.ceil(bounds.x2),
            y2: Math.ceil(bounds.y2),
        };
        this.transform = identity();
        this.warp = undefined;
        this.warpSelection = [];
    }

    isTransformationChanged(): boolean {
        if (this.warp) {
            return true;
        }
        const identityMatrix = identity();
        const keys = Object.keys(identityMatrix) as (keyof Matrix)[];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (identityMatrix[key] !== this.transform[key]) {
                return true;
            }
        }
        return false;
    }

    reset(): void {
        this.transform = identity();
        this.warp = undefined;
        this.warpSelection = [];
        this.selection = [];
        this.selectionBounds = {
            type: 'coordinate',
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0,
        };
    }

    // ---- transform ----

    translate(d: TVector2D): void {
        this.transform = compose(translate(d.x, d.y), this.transform);
        this.warp?.isWarping && this.bakeMatrixIntoWarp();
    }

    flip(axis: 'x' | 'y'): void {
        const center = {
            x: (this.selectionBounds.x1 + this.selectionBounds.x2) / 2,
            y: (this.selectionBounds.y1 + this.selectionBounds.y2) / 2,
        };
        const transformedCenter = applyToPoint(this.transform, center);
        this.transform = compose(
            translate(transformedCenter.x, transformedCenter.y),
            scale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1),
            translate(-transformedCenter.x, -transformedCenter.y),
            this.transform,
        );
        this.warp?.isWarping && this.bakeMatrixIntoWarp();
    }

    rotateDeg(deg: number): void {
        const center = {
            x: (this.selectionBounds.x1 + this.selectionBounds.x2) / 2,
            y: (this.selectionBounds.y1 + this.selectionBounds.y2) / 2,
        };
        const transformedCenter = applyToPoint(this.transform, center);
        this.transform = compose(
            translate(transformedCenter.x, transformedCenter.y),
            rotate((deg / 180) * Math.PI),
            translate(-transformedCenter.x, -transformedCenter.y),
            this.transform,
        );
        this.warp?.isWarping && this.bakeMatrixIntoWarp();
    }

    // --------

    setDoClone(b: boolean): void {
        this.doClone = b;
    }

    getDoClone(): boolean {
        return this.doClone;
    }

    getTransform(): Matrix {
        return freeTransformToMatrix(this.getFreeTransform(), this.selectionBounds);
    }

    setTransform(transform: Matrix): void {
        this.transform = transform;
    }

    /**
     * The transformation as the handles show it: the rectangle around the selection, where it is
     * now. What getTransform() returns is this, as a matrix.
     */
    getFreeTransform(): TFreeTransform {
        return snapToPixel(matrixToFreeTransform(this.transform, this.selectionBounds));
    }

    /**
     * The transformation as the handles left it. A rectangle dragged shut would be a matrix that
     * cannot be inverted and a selection without an area: it keeps one pixel.
     */
    setFreeTransform(freeTransform: TFreeTransform): void {
        const atLeastOne = (size: number) => (Math.abs(size) < 1 ? (size < 0 ? -1 : 1) : size);
        this.transform = freeTransformToMatrix(
            {
                ...freeTransform,
                width: atLeastOne(freeTransform.width),
                height: atLeastOne(freeTransform.height),
            },
            this.selectionBounds,
        );
    }

    /**
     * The size of what is transformed, before the transformation: the bounds of the selection
     * (while warped: of the lattice). A width of 1 in getFreeTransform() / this = scale 1.
     */
    getUntransformedSize(): { width: number; height: number } {
        return {
            width: this.selectionBounds.x2 - this.selectionBounds.x1,
            height: this.selectionBounds.y2 - this.selectionBounds.y1,
        };
    }

    getTransformedSelection(): MultiPolygon {
        const ffd = this.getFfd();
        if (ffd) {
            return transformSelection({ type: 'ffd', ffd }, this.warpSelection);
        }
        return transformMultiPolygon(this.selection, this.getTransform());
    }

    // ---- warp ----

    /**
     * The lattice may be dragged from now on. `latticeRect` is what it is laid over at first (the
     * bounds of the selection — of upstream's selection sample, which the warp is drawn from),
     * `selection` what its outline is made from. What the matrix did so far goes into the lattice.
     */
    startWarp(latticeRect: TRect, selection: MultiPolygon): void {
        if (!this.warp) {
            this.warp = { ffd: createFfdLattice(5, 5, latticeRect), isWarping: true };
            this.warpSelection = selection;
        }
        this.warp = { ...this.warp, isWarping: true };
        this.bakeMatrixIntoWarp();
    }

    /** The lattice stays as it is; the handles move it as a whole from now on. */
    endWarp(): void {
        if (!this.warp) {
            return;
        }
        this.bakeMatrixIntoWarp();
        this.warp = { ...this.warp, isWarping: false };
    }

    /** The lattice as it was dragged to. Only while warping. */
    setWarpLattice(ffd: TFfdLattice): void {
        if (!this.warp?.isWarping) {
            return;
        }
        this.warp = { ...this.warp, ffd };
        this.selectionBounds = ffdFrame(ffd);
    }

    hasWarp(): boolean {
        return !!this.warp;
    }

    isWarping(): boolean {
        return !!this.warp?.isWarping;
    }

    /**
     * The lattice with the matrix in it — the warp as it is applied, shown and outlined.
     * undefined: no warp, the transformation is getTransform().
     */
    getFfd(): TFfdLattice | undefined {
        if (!this.warp) {
            return undefined;
        }
        return this.warp.isWarping
            ? this.warp.ffd
            : transformFfd(this.warp.ffd, this.getTransform());
    }

    getWarp(): TSelectTransformWarp | undefined {
        return this.warp;
    }

    /** For the temp history: the warp of an earlier state, with setTransform. */
    setWarp(warp: TSelectTransformWarp | undefined): void {
        if (warp) {
            this.warp = warp;
            this.selectionBounds = ffdFrame(warp.ffd);
        } else {
            // Back to the box around the selection. What the lattice was laid over is kept: a redo
            // brings the warp back.
            const transform = this.transform;
            const warpSelection = this.warpSelection;
            this.setSelection(this.selection);
            this.transform = transform;
            this.warpSelection = warpSelection;
        }
    }

    getWarpSelection(): MultiPolygon {
        return this.warpSelection;
    }

    setSelectionSample(selectionSample: TMatrixSelectionSample | undefined): void {
        this.selectionSample = selectionSample;
    }

    /**
     * creates composite for KlCanvas layer
     * if source === target
     */
    createComposite(originalSrcCanvas: HTMLCanvasElement): TLayerComposite {
        const selectionPath = getSelectionPath2d(this.selection);
        const transform = this.getTransform();

        return {
            draw: (ctx: CanvasRenderingContext2D) => {
                ctx.save();

                if (this.selectionSample && this.doClone) {
                    if (this.selectionSample.image) {
                        ctx.setTransform(...matrixToTuple(transform));
                        ctx.clip(selectionPath);
                        const canvasTransform = compose(
                            transform,
                            this.selectionSample.transformation,
                        );
                        ctx.setTransform(...matrixToTuple(canvasTransform));
                        ctx.drawImage(this.selectionSample.image, 0, 0);
                    }
                } else {
                    //draw original with inverted selection before transformation
                    if (!this.doClone) {
                        ctx.save();
                        ctx.clip(selectionPath);
                        if (this.backgroundIsTransparent) {
                            ctx.clearRect(0, 0, originalSrcCanvas.width, originalSrcCanvas.height);
                        } else {
                            ctx.globalCompositeOperation = 'source-in';
                            ctx.fillStyle = '#fff';
                            ctx.fillRect(0, 0, originalSrcCanvas.width, originalSrcCanvas.height);
                        }
                        ctx.restore();
                    }

                    ctx.setTransform(...matrixToTuple(transform));
                    ctx.clip(selectionPath);
                    ctx.drawImage(originalSrcCanvas, 0, 0);
                }

                ctx.restore();
            },
        } as any;
    }

    /**
     * creates composite for source KlCanvas layer
     * if source != target
     */
    createSourceComposite(originalSrcCanvas: HTMLCanvasElement): TLayerComposite | undefined {
        const selectionPath = getSelectionPath2d(this.selection);

        if (this.doClone) {
            return undefined;
        }

        return {
            draw: (ctx: CanvasRenderingContext2D) => {
                //draw original with inverted selection before transformation
                ctx.save();
                ctx.clip(selectionPath);
                if (this.backgroundIsTransparent) {
                    ctx.clearRect(0, 0, originalSrcCanvas.width, originalSrcCanvas.height);
                } else {
                    ctx.globalCompositeOperation = 'source-in';
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, originalSrcCanvas.width, originalSrcCanvas.height);
                }
                ctx.restore();
            },
        } as any;
    }

    /**
     * creates composite for target KlCanvas layer
     * if source != target
     */
    createTargetComposite(originalSrcCanvas: HTMLCanvasElement): TLayerComposite {
        const selectionPath = getSelectionPath2d(this.selection);
        const transform = this.getTransform();

        return {
            draw: (ctx: CanvasRenderingContext2D) => {
                ctx.save();

                if (this.selectionSample && this.doClone) {
                    if (this.selectionSample.image) {
                        ctx.setTransform(...matrixToTuple(transform));
                        ctx.clip(selectionPath);
                        const canvasTransform = compose(
                            transform,
                            this.selectionSample.transformation,
                        );
                        ctx.setTransform(...matrixToTuple(canvasTransform));
                        ctx.drawImage(this.selectionSample.image, 0, 0);
                    }
                } else {
                    ctx.setTransform(...matrixToTuple(transform));
                    ctx.clip(selectionPath);
                    ctx.drawImage(originalSrcCanvas, 0, 0);
                }

                ctx.restore();
            },
        } as any;
    }
}
