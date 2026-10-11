import { createFfdMeshForSelectionSample, TFfdLattice } from './ffd';
import {
    GpuCompositeCanvas,
    TGpuMesh,
    TGpuTexture,
} from '../image-operations/gpu-composite-canvas';
import { TInterpolationAlgorithm } from '../kl-types';
import { createCanvas } from '../../bb/base/create-canvas';
import { RENDERED_FFD_MESH_RESOLUTION } from './composed-transformation';
import { TSelectionSample } from './selection-sample';

/**
 * Renders a warped (FFD) selection sample onto a canvas.
 * Attempts to catch all exceptions by GpuCompositeCanvas.
 *
 * Caches resources over its lifetime for faster rendering and lower resource usage.
 */
export class FfdRenderer {
    private canvas: GpuCompositeCanvas | undefined;
    private texture: TGpuTexture | undefined;
    private cachedSelectionSample: TSelectionSample | undefined;
    private cachedAlgorithm: TInterpolationAlgorithm | undefined;
    private cachedWidth: number | undefined;
    private cachedHeight: number | undefined;
    private cachedFfdLattice: TFfdLattice | undefined;

    private invalidateCompositeCanvas(): void {
        try {
            this.texture?.destroy();
            this.texture = undefined;
            this.canvas?.destroy();
            this.canvas = undefined;
        } catch (_) {
            // noop
        }
        this.cachedSelectionSample = undefined;
        this.cachedAlgorithm = undefined;
        this.cachedWidth = undefined;
        this.cachedHeight = undefined;
        this.cachedFfdLattice = undefined;
    }

    private ensureCompositeCanvas(
        width: number,
        height: number,
        algorithm: TInterpolationAlgorithm,
    ): void {
        if (
            !this.canvas ||
            this.canvas.isContextLost() ||
            this.cachedAlgorithm !== algorithm ||
            this.cachedWidth !== width ||
            this.cachedHeight !== height
        ) {
            this.invalidateCompositeCanvas();
            try {
                this.canvas = new GpuCompositeCanvas(createCanvas(width, height), algorithm);
                this.cachedAlgorithm = algorithm;
                this.cachedWidth = width;
                this.cachedHeight = height;
            } catch (_) {
                // noop
            }
        }
    }

    private ensureTexture(selectionSample: TSelectionSample): void {
        if (this.cachedSelectionSample !== selectionSample || !this.texture) {
            this.texture?.destroy();
            this.texture = undefined;
            try {
                this.texture = this.canvas!.createTexture(selectionSample.image);
                this.cachedSelectionSample = selectionSample;
            } catch (_) {
                // noop
            }
        }
    }

    // ---- public ----

    render(p: {
        // ffdLattice **must** have different references for different objects
        ffdLattice: TFfdLattice;
        selectionSample: TSelectionSample;
        algorithm: TInterpolationAlgorithm;
        outputWidth: number;
        outputHeight: number;
    }): void {
        if (
            p.ffdLattice === this.cachedFfdLattice &&
            p.selectionSample === this.cachedSelectionSample &&
            p.algorithm === this.cachedAlgorithm &&
            p.outputWidth === this.cachedWidth &&
            p.outputHeight === this.cachedHeight
        ) {
            return; // output canvas already holds the correct result
        }

        this.ensureCompositeCanvas(p.outputWidth, p.outputHeight, p.algorithm);
        if (!this.canvas) {
            return;
        }
        this.ensureTexture(p.selectionSample);
        if (!this.texture) {
            return;
        }

        this.cachedFfdLattice = p.ffdLattice;
        const ffdMesh = createFfdMeshForSelectionSample(
            RENDERED_FFD_MESH_RESOLUTION,
            RENDERED_FFD_MESH_RESOLUTION,
            p.ffdLattice,
            p.selectionSample,
            p.outputWidth,
            p.outputHeight,
            undefined,
        );

        let frontMesh: TGpuMesh | undefined;
        let backMesh: TGpuMesh | undefined;
        try {
            frontMesh = this.canvas.createMesh(
                ffdMesh.vertices,
                ffdMesh.texCoords,
                ffdMesh.frontIndices,
            );
            backMesh = this.canvas.createMesh(
                ffdMesh.vertices,
                ffdMesh.texCoords,
                ffdMesh.backIndices,
            );
            this.canvas.clear();
            this.canvas.draw(frontMesh, this.texture!);
            this.canvas.draw(backMesh, this.texture!);
            this.canvas.present();
        } catch (_) {
            // noop
        } finally {
            frontMesh?.destroy();
            backMesh?.destroy();
        }
    }

    getCanvas(): HTMLCanvasElement | undefined {
        return this.canvas?.getCanvas();
    }

    freeResources(): void {
        this.invalidateCompositeCanvas();
    }

    // when you want to discard this object
    destroy(): void {
        this.invalidateCompositeCanvas();
    }
}
