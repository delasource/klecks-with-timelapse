import { fitInto } from '../bb/base/base';
import { canvasToBlob, freeCanvas } from '../bb/base/canvas';
import { KlCanvas, MAX_LAYERS, TKlCanvasLayer } from '../klecks/canvas/kl-canvas';
import { KlHistory } from '../klecks/history/kl-history';
import { TMixMode, TRgb } from '../klecks/kl-types';

export type TLayerInfo = {
    index: number;
    id: number;
    name: string;
    opacity: number;
    isVisible: boolean;
    mixModeStr: TMixMode;
};

export type TLayerThumbnailOptions = {
    width?: number;
    height?: number;
    fitInside?: boolean;
};

export type TLayerHeadlessControllerParams = {
    klCanvas: KlCanvas;
    klHistory: KlHistory;
    applyUncommitted: () => void;
    onUpdateProject: () => void;
    onClearLayer: () => void;
    onActiveLayerChange?: (layerIndex: number) => void;
    onLayersChange?: (layers: TLayerInfo[]) => void;
};

export class LayerHeadlessController {
    private readonly klCanvas: KlCanvas;
    private readonly klHistory: KlHistory;
    private readonly applyUncommitted: () => void;
    private readonly onUpdateProject: () => void;
    private readonly onClearLayer: () => void;
    private readonly onActiveLayerChange?: (layerIndex: number) => void;
    private readonly onLayersChange?: (layers: TLayerInfo[]) => void;

    private activeLayerIndex: number;
    private thumbnailCanvas: HTMLCanvasElement;

    constructor(params: TLayerHeadlessControllerParams) {
        this.klCanvas = params.klCanvas;
        this.klHistory = params.klHistory;
        this.applyUncommitted = params.applyUncommitted;
        this.onUpdateProject = params.onUpdateProject;
        this.onClearLayer = params.onClearLayer;
        this.onActiveLayerChange = params.onActiveLayerChange;
        this.onLayersChange = params.onLayersChange;

        // Initialize with the top layer
        const layers = this.klCanvas.getLayers();
        this.activeLayerIndex = layers.length - 1;

        // Create reusable thumbnail canvas
        this.thumbnailCanvas = document.createElement('canvas');
    }

    private notifyLayersChange(): void {
        if (this.onLayersChange) {
            this.onLayersChange(this.getLayers());
        }
    }

    // ------------------- Layer Information -------------------

    getLayers(): TLayerInfo[] {
        const canvasLayers = this.klCanvas.getLayers();
        return canvasLayers.map((layer, index) => {
            const layerObj = this.klCanvas.getLayer(index);
            return {
                index,
                id: layerObj?.index || 0,
                name: layerObj?.name || `Layer ${index + 1}`,
                opacity: layer.opacity,
                isVisible: layerObj?.isVisible ?? true,
                mixModeStr: layer.mixModeStr,
            };
        });
    }

    getLayer(index: number): TLayerInfo | null {
        const layers = this.getLayers();
        return index >= 0 && index < layers.length ? layers[index] : null;
    }

    getActiveLayerIndex(): number {
        return this.activeLayerIndex;
    }

    getActiveLayer(): TLayerInfo | null {
        return this.getLayer(this.activeLayerIndex);
    }

    getLayerCount(): number {
        return this.klCanvas.getLayerCount();
    }

    // ------------------- Layer Selection -------------------

    setActiveLayer(index: number): void {
        if (index < 0 || index >= this.getLayerCount()) {
            throw new Error(`Invalid layer index: ${index}`);
        }

        this.applyUncommitted();
        this.activeLayerIndex = index;
        this.onActiveLayerChange?.(index);
    }

    // ------------------- Layer Creation -------------------

    addLayer(index?: number): boolean {
        this.applyUncommitted();

        const result = this.klCanvas.addLayer(index ?? this.activeLayerIndex);
        if (result === false) {
            return false;
        }

        // If no index specified, add above current layer
        if (index === undefined) {
            this.activeLayerIndex++;
        } else {
            this.activeLayerIndex = index;
        }

        this.onActiveLayerChange?.(this.activeLayerIndex);
        this.onUpdateProject();
        this.notifyLayersChange();
        return true;
    }

    duplicateLayer(index?: number): boolean {
        this.applyUncommitted();

        const targetIndex = index ?? this.activeLayerIndex;
        const result = this.klCanvas.duplicateLayer(targetIndex);

        if (result === false) {
            return false;
        }

        // Set active layer to the duplicated layer
        this.activeLayerIndex = targetIndex + 1;
        this.onActiveLayerChange?.(this.activeLayerIndex);
        this.onUpdateProject();
        this.notifyLayersChange();
        return true;
    }

    // ------------------- Layer Removal -------------------

    removeLayer(index?: number): boolean {
        this.applyUncommitted();

        const targetIndex = index ?? this.activeLayerIndex;

        if (this.getLayerCount() <= 1) {
            return false; // Cannot remove the last layer
        }

        this.klCanvas.removeLayer(targetIndex);

        // Adjust active layer index if necessary
        if (index === undefined || index === this.activeLayerIndex) {
            if (this.activeLayerIndex > 0) {
                this.activeLayerIndex--;
            }
        } else if (index < this.activeLayerIndex) {
            this.activeLayerIndex--;
        }

        this.onActiveLayerChange?.(this.activeLayerIndex);
        this.onUpdateProject();
        this.notifyLayersChange();
        return true;
    }

    clearLayer(index?: number): void {
        this.applyUncommitted();

        const targetIndex = index ?? this.activeLayerIndex;
        const layer = this.klCanvas.getLayer(targetIndex);

        if (!layer) {
            return;
        }

        this.klCanvas.eraseLayer({
            layerIndex: targetIndex,
            useAlphaLock: targetIndex === 0, // Background layer
            useSelection: false,
        });

        this.onUpdateProject();
    }

    // ------------------- Layer Properties -------------------

    setLayerName(index: number, name: string): void {
        const layer = this.getLayer(index);
        if (!layer || layer.name === name) {
            return;
        }

        this.klCanvas.renameLayer(index, name);
        this.onUpdateProject();
        this.notifyLayersChange();
    }

    setLayerOpacity(index: number, opacity: number, isTemp: boolean = false): void {
        const layer = this.getLayer(index);
        if (!layer || layer.opacity === opacity) {
            return;
        }

        if (isTemp) {
            this.klHistory.pause(true);
        }

        this.klCanvas.setOpacity(index, opacity);
        this.onUpdateProject();
        this.notifyLayersChange();

        if (isTemp) {
            this.klHistory.pause(false);
        }
    }

    setLayerVisibility(index: number, isVisible: boolean): void {
        const layer = this.getLayer(index);
        if (!layer || layer.isVisible === isVisible) {
            return;
        }

        this.klCanvas.setLayerIsVisible(index, isVisible);

        // Pause history for visibility changes to avoid cluttering undo stack
        this.klHistory.pause(true);
        if (index === this.activeLayerIndex) {
            this.onActiveLayerChange?.(this.activeLayerIndex);
        }
        this.klHistory.pause(false);

        this.onUpdateProject();
        this.notifyLayersChange();
    }

    setLayerMixMode(index: number, mixMode: TMixMode): void {
        const layer = this.getLayer(index);
        if (!layer || layer.mixModeStr === mixMode) {
            return;
        }

        this.klCanvas.setMixMode(index, mixMode);
        this.onUpdateProject();
        this.notifyLayersChange();
    }

  
    // ------------------- Layer Ordering -------------------

    moveLayer(fromIndex: number, toIndex: number): void {
        const layers = this.getLayers();
        if (fromIndex < 0 || fromIndex >= layers.length ||
            toIndex < 0 || toIndex >= layers.length ||
            fromIndex === toIndex) {
            return;
        }

        this.applyUncommitted();
        this.klCanvas.moveLayer(fromIndex, toIndex - fromIndex);

        // Adjust active layer index
        if (fromIndex === this.activeLayerIndex) {
            this.activeLayerIndex = toIndex;
        } else if (fromIndex < this.activeLayerIndex && toIndex >= this.activeLayerIndex) {
            this.activeLayerIndex--;
        } else if (fromIndex > this.activeLayerIndex && toIndex <= this.activeLayerIndex) {
            this.activeLayerIndex++;
        }

        this.onActiveLayerChange?.(this.activeLayerIndex);
        this.onUpdateProject();
        this.notifyLayersChange();
    }

    moveLayerUp(index?: number): boolean {
        const targetIndex = index ?? this.activeLayerIndex;
        if (targetIndex >= this.getLayerCount() - 1) {
            return false; // Already at top
        }

        this.moveLayer(targetIndex, targetIndex + 1);
        return true;
    }

    moveLayerDown(index?: number): boolean {
        const targetIndex = index ?? this.activeLayerIndex;
        if (targetIndex <= 0) {
            return false; // Already at bottom
        }

        this.moveLayer(targetIndex, targetIndex - 1);
        return true;
    }

    // ------------------- Layer Merging -------------------

    mergeWithLayerBelow(index?: number): boolean {
        this.applyUncommitted();

        const targetIndex = index ?? this.activeLayerIndex;
        if (targetIndex <= 0) {
            return false; // Cannot merge background layer down
        }

        // Default merge mode is normal
        const result = this.klCanvas.mergeLayers(targetIndex, targetIndex - 1, 'source-over');

        if (!result) {
            return false;
        }

        // Set active layer to the merged layer below
        this.activeLayerIndex = targetIndex - 1;
        this.onActiveLayerChange?.(this.activeLayerIndex);
        this.onUpdateProject();
        this.notifyLayersChange();
        return true;
    }

    mergeWithLayerAbove(index?: number): boolean {
        this.applyUncommitted();

        const targetIndex = index ?? this.activeLayerIndex;
        if (targetIndex >= this.getLayerCount() - 1) {
            return false; // Cannot merge top layer up
        }

        // Merge the layer above into the current layer
        const result = this.klCanvas.mergeLayers(targetIndex + 1, targetIndex, 'source-over');

        if (!result) {
            return false;
        }

        // Active layer stays the same (now contains merged content)
        this.onActiveLayerChange?.(this.activeLayerIndex);
        this.onUpdateProject();
        this.notifyLayersChange();
        return true;
    }

    mergeAll(): number | false {
        this.applyUncommitted();

        const result = this.klCanvas.mergeAll();
        if (result === false) {
            return false;
        }

        this.activeLayerIndex = result;
        this.onActiveLayerChange?.(this.activeLayerIndex);
        this.onUpdateProject();
        this.notifyLayersChange();
        return result;
    }

    // ------------------- Layer Operations -------------------

    fillLayer(index: number, color: TRgb): void {
        this.applyUncommitted();

        const layer = this.klCanvas.getLayer(index);
        if (!layer) {
            return;
        }

        this.klCanvas.layerFill(index, color, undefined, true);
        this.onUpdateProject();
    }

    // ------------------- Thumbnail Generation -------------------

    getThumbnail(index: number, options: TLayerThumbnailOptions = {}): Promise<Blob> {
        const layer = this.klCanvas.getLayer(index);
        if (!layer) {
            throw new Error(`Layer at index ${index} does not exist`);
        }

        const sourceCanvas = layer.context.canvas;
        const {
            width = 100,
            height = 100,
            fitInside = true
        } = options;

        let thumbnailDimensions;
        if (fitInside) {
            thumbnailDimensions = fitInto(
                sourceCanvas.width,
                sourceCanvas.height,
                width,
                height,
                1
            );
        } else {
            thumbnailDimensions = { width, height };
        }

        // Resize the temporary thumbnail canvas if needed
        if (this.thumbnailCanvas.width !== thumbnailDimensions.width ||
            this.thumbnailCanvas.height !== thumbnailDimensions.height) {
            this.thumbnailCanvas.width = thumbnailDimensions.width;
            this.thumbnailCanvas.height = thumbnailDimensions.height;
        }

        const ctx = this.thumbnailCanvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get 2D context from thumbnail canvas');
        }

        ctx.clearRect(0, 0, this.thumbnailCanvas.width, this.thumbnailCanvas.height);

        // Disable smoothing for pixel art when scaling up
        const smoothingEnabled = this.thumbnailCanvas.width <= sourceCanvas.width;
        ctx.imageSmoothingEnabled = smoothingEnabled;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(
            sourceCanvas,
            0, 0,
            this.thumbnailCanvas.width,
            this.thumbnailCanvas.height
        );

        return canvasToBlob(this.thumbnailCanvas, 'image/png');
    }

    // ------------------- Utility Methods -------------------

    canAddLayer(): boolean {
        return this.getLayerCount() < MAX_LAYERS;
    }

    canRemoveLayer(index?: number): boolean {
        return this.getLayerCount() > 1;
    }

    canDuplicateLayer(index?: number): boolean {
        return this.canAddLayer();
    }

    canMergeDown(index?: number): boolean {
        const targetIndex = index ?? this.activeLayerIndex;
        return targetIndex > 0;
    }

    canMergeUp(index?: number): boolean {
        const targetIndex = index ?? this.activeLayerIndex;
        return targetIndex < this.getLayerCount() - 1;
    }

    canMergeAll(): boolean {
        return this.getLayerCount() > 1;
    }

    // ------------------- Cleanup -------------------

    destroy(): void {
        if (this.thumbnailCanvas) {
            freeCanvas(this.thumbnailCanvas);
        }
    }
}
