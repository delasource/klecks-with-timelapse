import { KlCanvas } from './kl-canvas';
import { BB } from '../../bb/bb';
import { compose, identity, Matrix, translate } from 'transformation-matrix';
import { MultiPolygon } from 'polygon-clipping';
import { TIndexBounds, TRect } from '../../bb/bb-types';
import { coordinateBoundsToIndexBounds, indexBoundsInArea, updateBounds } from '../../bb/math/math';
import { transformCoordinateBounds } from '../../bb/transform/transform-coordinate-bounds';
import { transformMultiPolygon } from '../../bb/multi-polygon/transform-multi-polygon';
import { getSelectionPath2d } from '../../bb/multi-polygon/get-selection-path-2d';
import { matrixToTuple } from '../../bb/math/matrix-to-tuple';
import { getSelectionBounds } from '../select-tool/get-selection-bounds';
import { createLayerMap } from '../history/push-helpers/create-layer-map';
import { KlEventRecorder } from '../history/kl-event-recorder';
import { createFfdMeshForSelectionSample, TFfdLattice } from '../transform/ffd';
import { FfdRenderer } from '../transform/ffd-renderer';
import {
    RENDERED_FFD_MESH_RESOLUTION,
    transformSelection,
} from '../transform/composed-transformation';
import { createSelectionSample } from '../transform/selection-sample';
import { getSelectionSampleBounds } from '../transform/get-selection-sample-bounds';
import { getFfdMeshBoundsInArea } from '../transform/ffd-utils';
import {
    createHistoryEntryFromChanges,
    TChangeListEntry,
} from '../history/push-helpers/create-history-entry-from-changes';

/**
 * The area of a layer that got selected, with where it is now. Consecutive transformations move
 * the sample instead of sampling the layer again. `image` is undefined if the area was empty.
 */
export type TMatrixSelectionSample = {
    image?: HTMLCanvasElement;
    transformation: Matrix;
};

export type TTransformViaSelectionParams = {
    sourceLayer: number;
    targetLayer?: number;
    transformation: Matrix; // relative to (0,0) of canvas
    isPixelated?: boolean; // default false
    backgroundIsTransparent?: boolean;
};

export type TTransformCloneViaSelectionParams = {
    sourceLayer?: number;
    targetLayer: number;
    transformation: Matrix; // relative to (0,0) of canvas
    isPixelated?: boolean; // default false
};

export type TWarpViaSelectionParams = {
    sourceLayer: number;
    targetLayer?: number;
    // The lattice the selected area is drawn through: 5 × 5 control points in canvas coordinates,
    // laid over the bounds of the selection before anything was dragged.
    ffd: TFfdLattice;
    backgroundIsTransparent?: boolean;
};

function getSampleBounds(sample: TMatrixSelectionSample): TIndexBounds | undefined {
    if (!sample.image) {
        return undefined;
    }
    return coordinateBoundsToIndexBounds(
        transformCoordinateBounds(
            {
                type: 'coordinate',
                x1: 0,
                y1: 0,
                x2: sample.image.width,
                y2: sample.image.height,
            },
            sample.transformation,
        ),
    );
}

/**
 * Moves what is selected on a KlCanvas by a matrix: the two operations KlCanvas itself had until
 * Klecks 0.9.10 (transformViaSelection, transformCloneViaSelection), where upstream replaced them
 * by a free transform owned by its own UI (kl-canvas-transform.ts).
 *
 * They live on here because the headless app's selection tool is built on them, and because they
 * are what the recorded events 'selection-transform' and 'selection-transform-clone' mean: a
 * recording names the matrix, so replaying an existing drawing needs exactly this operation.
 * One call = one history entry = one recorded event.
 *
 * warpViaSelection is the third operation, and newer: upstream's warp (klCanvasFfd), as an event
 * of its own ('selection-warp') — a warp is a lattice, not a matrix.
 */
export class KlCanvasSelectionTransform {
    private readonly klCanvas: KlCanvas;
    private readonly klRecorder: KlEventRecorder | undefined;
    private selectionSample: TMatrixSelectionSample | undefined;
    private ffdRenderer: FfdRenderer | undefined; // made when the first warp needs it (WebGL)

    private getSelectionOrFallback(): MultiPolygon {
        const width = this.klCanvas.getWidth();
        const height = this.klCanvas.getHeight();
        return (
            this.klCanvas.getSelection() ?? [
                [
                    [
                        [0, 0],
                        [width, 0],
                        [width, height],
                        [0, height],
                        [0, 0],
                    ],
                ],
            ]
        );
    }

    /**
     * Create selection sample from the current selection. If none, will create of entire layer.
     */
    private createSelectionSample(layerIndex: number): void {
        const sampleBounds = this.getSelectionArea(layerIndex);

        // empty
        if (!sampleBounds) {
            this.selectionSample = {
                image: undefined,
                transformation: identity(),
            };
            return;
        }

        const srcLayer = this.klCanvas.getLayersReference()[layerIndex];
        const sampleCanvas = BB.canvas(sampleBounds.width, sampleBounds.height);
        const sampleCtx = BB.ctx(sampleCanvas);
        sampleCtx.save();
        sampleCtx.translate(-sampleBounds.x, -sampleBounds.y);
        sampleCtx.drawImage(srcLayer.canvas, 0, 0);
        sampleCtx.restore();

        this.selectionSample = {
            image: sampleCanvas,
            transformation: translate(sampleBounds.x, sampleBounds.y),
        };
    }

    /**
     * transforms selection and selectionSample
     */
    private transformSelectionAndSample(transformation: Matrix): void {
        if (!this.selectionSample) {
            throw new Error('no selection sample');
        }
        const selection = this.klCanvas.getSelection();
        if (selection) {
            this.klCanvas.setSelectionSilently(transformMultiPolygon(selection, transformation));
        }
        this.selectionSample.transformation = compose([
            transformation,
            this.selectionSample.transformation,
        ]);
    }

    private drawSelectionSample(layerIndex: number, isPixelated: boolean): void {
        if (!this.selectionSample) {
            throw new Error('no selection sample');
        }

        if (!this.selectionSample.image) {
            // selection sample, but it's empty. noop
            return;
        }

        const targetLayer = this.klCanvas.getLayersReference()[layerIndex];
        const targetCtx = BB.ctx(targetLayer.canvas);

        const selectionPath = getSelectionPath2d(this.getSelectionOrFallback());

        targetCtx.save();
        targetCtx.clip(selectionPath);
        targetCtx.setTransform(...matrixToTuple(this.selectionSample.transformation));
        if (isPixelated) {
            targetCtx.imageSmoothingEnabled = false;
        }
        targetCtx.drawImage(this.selectionSample.image, 0, 0);
        targetCtx.restore();
    }

    // what of `bounds` lies on the canvas. undefined: nothing of it, or no bounds at all.
    private inCanvas(bounds: TIndexBounds | undefined): TIndexBounds | undefined {
        return bounds
            ? indexBoundsInArea(bounds, this.klCanvas.getWidth(), this.klCanvas.getHeight())
            : undefined;
    }

    // ----------------------------------- public -----------------------------------
    constructor(p: { klCanvas: KlCanvas; klRecorder?: KlEventRecorder }) {
        this.klCanvas = p.klCanvas;
        this.klRecorder = p.klRecorder;
    }

    /**
     * Transforms (move, not clone) the selected region (or the entire canvas if no selection).
     * Also transforms the selection, unless there is no selection.
     * Creates a new selection sample.
     */
    transformViaSelection(p: TTransformViaSelectionParams): void {
        const klHistory = this.klCanvas.getKlHistory();
        const layers = this.klCanvas.getLayersReference();
        let srcBounds: TIndexBounds | undefined;
        let targetBounds: TIndexBounds | undefined;
        klHistory.pause(true);
        try {
            this.createSelectionSample(p.sourceLayer);
            srcBounds = this.inCanvas(getSampleBounds(this.selectionSample!));
            this.klCanvas.eraseLayer({
                layerIndex: p.sourceLayer,
                useSelection: true,
                useAlphaLock: p.sourceLayer === 0 && !p.backgroundIsTransparent,
            });
            this.transformSelectionAndSample(p.transformation);
            targetBounds = this.inCanvas(getSampleBounds(this.selectionSample!));
            this.drawSelectionSample(p.targetLayer ?? p.sourceLayer, p.isPixelated ?? false);
        } finally {
            klHistory.pause(false);
        }

        const srcAndTargetEqual = !p.targetLayer || p.sourceLayer === p.targetLayer;

        if (!klHistory.isPaused()) {
            const srcLayer = layers[p.sourceLayer];
            const targetLayer =
                p.targetLayer !== undefined && p.targetLayer !== p.sourceLayer
                    ? layers[p.targetLayer]
                    : undefined;
            this.klRecorder?.record('selection-transform', [p]);
            klHistory.push({
                selection: {
                    value: this.klCanvas.getSelection(),
                },
                layerMap: createLayerMap(
                    layers,
                    {
                        layerId: srcLayer.id,
                        attributes: ['tiles'],
                        bounds:
                            srcAndTargetEqual && (srcBounds || targetBounds)
                                ? updateBounds(srcBounds && { ...srcBounds }, targetBounds)
                                : srcBounds,
                    },
                    targetLayer
                        ? {
                              layerId: targetLayer.id,
                              attributes: ['tiles'],
                              bounds: targetBounds,
                          }
                        : undefined,
                ),
            });
        }
    }

    /**
     * Transforms the selection sample (creates one if there's none, same way as in transformViaSelection)
     * and draws a clone on target layer.
     * Also transforms the selection, unless there is no selection.
     */
    transformCloneViaSelection(p: TTransformCloneViaSelectionParams): void {
        const klHistory = this.klCanvas.getKlHistory();
        const layers = this.klCanvas.getLayersReference();
        let hasImage = false;
        let targetBounds: TIndexBounds | undefined;
        klHistory.pause(true);
        try {
            if (!this.selectionSample) {
                if (p.sourceLayer === undefined) {
                    throw new Error('no source layer');
                }
                this.createSelectionSample(p.sourceLayer);
            }
            this.transformSelectionAndSample(p.transformation);
            this.drawSelectionSample(p.targetLayer, p.isPixelated ?? false);
            hasImage = !!this.selectionSample!.image;
            targetBounds = this.inCanvas(getSampleBounds(this.selectionSample!));
        } finally {
            klHistory.pause(false);
        }

        if (!klHistory.isPaused() && hasImage) {
            const targetLayer = layers[p.targetLayer];
            this.klRecorder?.record('selection-transform-clone', [p]);
            klHistory.push({
                selection: {
                    value: this.klCanvas.getSelection(),
                },
                layerMap: createLayerMap(layers, {
                    layerId: targetLayer.id,
                    attributes: ['tiles'],
                    bounds: targetBounds,
                }),
            });
        }
    }

    /**
     * Warps the selected region (or, without a selection, what is on the layer) through a lattice,
     * and the selection with it.
     *
     * This is upstream's klCanvasFfd, written out here for one reason: that one sets the selection
     * through KlCanvas.setSelection, which records a 'selection' event of its own — and an undo
     * step has to be one recorded event.
     *
     * The warp is drawn with WebGL. Where there is none, nothing happens at all — the selected
     * area must not be erased for a picture that cannot be drawn. Returns whether it was applied.
     *
     * It ends the selection sample of the matrix transformations: a clone that follows samples
     * the layer anew.
     */
    warpViaSelection(p: TWarpViaSelectionParams): boolean {
        const klHistory = this.klCanvas.getKlHistory();
        const layers = this.klCanvas.getLayersReference();
        const targetLayerIndex = p.targetLayer ?? p.sourceLayer;
        const targetLayer = layers[targetLayerIndex];
        const width = this.klCanvas.getWidth();
        const height = this.klCanvas.getHeight();

        const sample = createSelectionSample(p.sourceLayer, this.klCanvas);
        if (!sample) {
            // nothing but transparent pixels
            return false;
        }
        const ffdRenderer = this.getFfdRenderer();
        ffdRenderer.render({
            ffdLattice: p.ffd,
            selectionSample: sample,
            algorithm: 'smooth',
            outputWidth: width,
            outputHeight: height,
        });
        const warped = ffdRenderer.getCanvas();
        if (!warped) {
            BB.freeCanvas(sample.image);
            return false;
        }

        const selection = this.klCanvas.getSelection();
        let transformedSelection: MultiPolygon | undefined;
        klHistory.pause(true);
        try {
            this.klCanvas.eraseLayer({
                layerIndex: p.sourceLayer,
                useSelection: true,
                useAlphaLock: p.sourceLayer === 0 && !p.backgroundIsTransparent,
            });
            targetLayer.context.drawImage(warped, 0, 0);
            if (selection) {
                transformedSelection = transformSelection({ type: 'ffd', ffd: p.ffd }, selection);
                this.klCanvas.setSelectionSilently(transformedSelection);
            }
        } finally {
            klHistory.pause(false);
        }

        if (!klHistory.isPaused()) {
            const ffdMesh = createFfdMeshForSelectionSample(
                RENDERED_FFD_MESH_RESOLUTION,
                RENDERED_FFD_MESH_RESOLUTION,
                p.ffd,
                sample,
                1,
                1,
                true,
            );
            const targetBounds = getFfdMeshBoundsInArea(ffdMesh, width, height);
            const changes: TChangeListEntry[] = [];
            transformedSelection && changes.push({ selection: transformedSelection });
            changes.push({
                layerId: layers[p.sourceLayer].id,
                bounds: getSelectionSampleBounds(sample),
            });
            targetBounds && changes.push({ layerId: targetLayer.id, bounds: targetBounds });
            this.klRecorder?.record('selection-warp', [p]);
            klHistory.push(createHistoryEntryFromChanges(layers, changes));
        }

        BB.freeCanvas(sample.image);
        // the renderer keeps a texture of the sample that was just freed
        ffdRenderer.freeResources();
        this.clearSelectionSample();
        return true;
    }

    /** Draws warps — for warpViaSelection, and for the preview of a warp that is not applied yet. */
    getFfdRenderer(): FfdRenderer {
        this.ffdRenderer ??= new FfdRenderer();
        return this.ffdRenderer;
    }

    clearSelectionSample(): void {
        if (!this.selectionSample) {
            return;
        }
        this.selectionSample.image && BB.freeCanvas(this.selectionSample.image);
        this.selectionSample = undefined;
    }

    // bounds of the selection (or of the canvas, without one) where the layer is not transparent
    getSelectionArea(layerIndex: number): TRect | undefined {
        const srcLayer = this.klCanvas.getLayersReference()[layerIndex];
        return getSelectionBounds(this.getSelectionOrFallback(), srcLayer.context);
    }

    getSelectionSample(): TMatrixSelectionSample | undefined {
        return this.selectionSample;
    }
}
