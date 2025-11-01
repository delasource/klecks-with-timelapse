import { fitInto } from '../bb/base/base';
import { canvasToBlob, freeCanvas } from '../bb/base/canvas';
import { KlCanvas, MAX_LAYERS } from '../klecks/canvas/kl-canvas';
import { KlHistory } from '../klecks/history/kl-history';
import { TMixMode, TRgb } from '../klecks/kl-types';
import {
  IHeadlessLayerControllerActions,
  THeadlessLayerState,
  TLayerInfo,
  TLayerThumbnailOptions,
} from './kl-headless-layer-types';

export type TLayerHeadlessControllerParams = {
  klCanvas: KlCanvas;
  klHistory: KlHistory;
  applyUncommitted: () => void;
  onUpdateProject: () => void;
  onClearLayer: () => void;
  onSelect?: (layerIndex: number) => void;
  onLayersChange?: (state: THeadlessLayerState) => void;
  maxNumLayers?: number;
};

export class LayerHeadlessController implements IHeadlessLayerControllerActions {
  private readonly klCanvas: KlCanvas;
  private readonly klHistory: KlHistory;
  private readonly applyUncommitted: () => void;
  private readonly onUpdateProject: () => void;
  private readonly onClearLayer: () => void;
  private readonly onSelectLayer?: (layerIndex: number) => void;
  private readonly onLayersChange?: (state: THeadlessLayerState) => void;
  private readonly maxNumLayers: number = MAX_LAYERS;

  private activeLayerIndex: number;
  private thumbnailCanvas: HTMLCanvasElement;

  constructor(params: TLayerHeadlessControllerParams) {
    this.klCanvas = params.klCanvas;
    this.klHistory = params.klHistory;
    this.applyUncommitted = params.applyUncommitted;
    this.onUpdateProject = params.onUpdateProject;
    this.onClearLayer = params.onClearLayer;
    this.onSelectLayer = params.onSelect;
    this.onLayersChange = params.onLayersChange;

    if (params.maxNumLayers) {
      this.maxNumLayers = params.maxNumLayers;
    }

    // Initialize with the top layer
    const layers = this.klCanvas.getLayers();
    this.activeLayerIndex = layers.length - 1;

    // Create reusable thumbnail canvas
    this.thumbnailCanvas = document.createElement('canvas');
  }

  private notifyLayersChange(): void {
    if (this.onLayersChange) {
      this.onLayersChange(this.getState());
    }
  }

  // ------------------- Layer Information -------------------

  private getLayers(): TLayerInfo[] {
    const canvasLayers = this.klCanvas.getLayers();
    return canvasLayers.map((layer, index) => {
      const layerObj = this.klCanvas.getLayer(index);
      return {
        index,
        id: layerObj.id,
        name: layerObj?.name || `Layer ${index + 1}`,
        opacity: layer.opacity,
        isVisible: layerObj?.isVisible ?? true,
        mixModeStr: layer.mixModeStr,
      };
    });
  }

  private getLayer(index: number): TLayerInfo | null {
    const layers = this.getLayers();
    return index >= 0 && index < layers.length ? layers[index] : null;
  }

  private getLayerCount(): number {
    return this.klCanvas.getLayerCount();
  }

  setActiveLayerInternal(index: number) {
    this.activeLayerIndex = index;
  }

  setActiveLayer(index: number): void {
    if (index < 0 || index >= this.getLayerCount()) {
      //throw new Error(`Invalid layer index: ${index}`);
      index = 0;
    }

    this.applyUncommitted();
    this.activeLayerIndex = index;
    this.onSelectLayer?.(index);
  }

  addLayer(): boolean {
    if (!this.canAddLayer()) {
      return false;
    }

    this.applyUncommitted();

    const result = this.klCanvas.addLayer(this.activeLayerIndex);
    if (result === false) {
      return false;
    }

    this.activeLayerIndex++;
    this.onSelectLayer?.(this.activeLayerIndex);

    this.notifyLayersChange();
    return true;
  }

  duplicateLayer(): boolean {
    this.applyUncommitted();

    const result = this.klCanvas.duplicateLayer(this.activeLayerIndex);
    if (result === false) {
      return false;
    }

    // Set active layer to the duplicated layer
    this.activeLayerIndex++;
    this.onSelectLayer?.(this.activeLayerIndex);

    this.notifyLayersChange();
    return true;
  }

  removeLayer(): boolean {
    this.applyUncommitted();

    if (this.getLayerCount() <= 1) {
      return false; // Cannot remove the last layer
    }

    this.klCanvas.removeLayer(this.activeLayerIndex);

    // Adjust active layer index if necessary
    if (this.activeLayerIndex > 0) {
      this.activeLayerIndex--;
    }

    this.onSelectLayer?.(this.activeLayerIndex);

    this.notifyLayersChange();
    return true;
  }

  clearLayer(): void {
    const layer = this.klCanvas.getLayer(this.activeLayerIndex);
    if (!layer) {
      return;
    }

    this.applyUncommitted();
    this.onClearLayer?.(); // Canvas will be cleared here -> The AppState will decide if it will be cleared with the default color or with transparency
    //
  }

  setLayerName(name: string): void {
    const layer = this.getLayer(this.activeLayerIndex);
    if (!layer || layer.name === name) {
      return;
    }

    this.klCanvas.renameLayer(this.activeLayerIndex, name);

    this.notifyLayersChange();
  }

  setLayerOpacity(index: number, opacity: number, isTemp?: boolean): void {
    const layer = this.getLayer(index);
    if (!layer || (layer.opacity === opacity && isTemp)) {
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
      this.onSelectLayer?.(this.activeLayerIndex);
    }
    this.klHistory.pause(false);

    this.notifyLayersChange();
  }

  setLayerMixMode(index: number, mixMode: TMixMode): void {
    const layer = this.getLayer(index);
    if (!layer || layer.mixModeStr === mixMode) {
      return;
    }

    this.klCanvas.setMixMode(index, mixMode);

    this.notifyLayersChange();
  }

  moveLayer(fromIndex: number, toIndex: number): void {
    const layers = this.getLayers();
    if (
      fromIndex < 0 ||
      fromIndex >= layers.length ||
      toIndex < 0 ||
      toIndex >= layers.length ||
      fromIndex === toIndex
    ) {
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

    this.onSelectLayer?.(this.activeLayerIndex);

    this.notifyLayersChange();
  }

  moveLayerUp(): boolean {
    const targetIndex = this.activeLayerIndex;
    if (targetIndex >= this.getLayerCount() - 1) {
      return false; // Already at top
    }

    this.moveLayer(targetIndex, targetIndex + 1);
    return true;
  }

  moveLayerDown(): boolean {
    const targetIndex = this.activeLayerIndex;
    if (targetIndex <= 0) {
      return false; // Already at bottom
    }

    this.moveLayer(targetIndex, targetIndex - 1);
    return true;
  }

  mergeWithLayerBelow(index?: number): boolean {
    this.applyUncommitted();

    const targetIndex = index ?? this.activeLayerIndex;
    if (targetIndex <= 0) {
      return false; // Cannot merge background layer down
    }

    // Default merge mode is normal
    const result = this.klCanvas.mergeLayers(targetIndex, targetIndex - 1, 'source-over');

    if (result === undefined) {
      return false;
    }

    // Set active layer to the merged layer below
    this.activeLayerIndex = targetIndex - 1;
    this.onSelectLayer?.(this.activeLayerIndex);

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

    if (result === undefined) {
      return false;
    }

    // Active layer stays the same (now contains merged content)
    this.onSelectLayer?.(this.activeLayerIndex);

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
    this.onSelectLayer?.(this.activeLayerIndex);

    this.notifyLayersChange();
    return result;
  }

  fillLayer(color: TRgb): void {
    this.applyUncommitted();

    const layer = this.klCanvas.getLayer(this.activeLayerIndex);
    if (!layer) {
      return;
    }

    this.klCanvas.layerFill(this.activeLayerIndex, color, undefined, true);
  }

  getThumbnail(id: string, options: TLayerThumbnailOptions = {}): Promise<Blob> {
    const layer = this.klCanvas.getLayerById(id);
    if (!layer) {
      throw new Error(`Layer ${id} does not exist`);
    }

    const sourceCanvas = layer.context.canvas;
    const { width = 100, height = 100, fitInside = true } = options;

    let thumbnailDimensions;
    if (fitInside) {
      thumbnailDimensions = fitInto(sourceCanvas.width, sourceCanvas.height, width, height, 1);
    } else {
      thumbnailDimensions = { width, height };
    }

    // Resize the temporary thumbnail canvas if needed
    if (
      this.thumbnailCanvas.width !== thumbnailDimensions.width ||
      this.thumbnailCanvas.height !== thumbnailDimensions.height
    ) {
      this.thumbnailCanvas.width = thumbnailDimensions.width;
      this.thumbnailCanvas.height = thumbnailDimensions.height;
    }

    const ctx = this.thumbnailCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context from thumbnail canvas');
    }

    ctx.clearRect(0, 0, this.thumbnailCanvas.width, this.thumbnailCanvas.height);

    // Disable smoothing for pixel art when scaling up
    ctx.imageSmoothingEnabled = this.thumbnailCanvas.width <= sourceCanvas.width;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(sourceCanvas, 0, 0, this.thumbnailCanvas.width, this.thumbnailCanvas.height);

    return canvasToBlob(this.thumbnailCanvas, 'image/png');
  }

  getState(): THeadlessLayerState {
    return {
      activeLayerIndex: this.activeLayerIndex,
      layers: this.getLayers(),
    };
  }

  canAddLayer(): boolean {
    return this.getLayerCount() < this.maxNumLayers;
  }

  canRemoveLayer(): boolean {
    return this.getLayerCount() > 1;
  }

  canDuplicateLayer(): boolean {
    return this.canAddLayer();
  }

  canMergeDown(): boolean {
    const targetIndex = this.activeLayerIndex;
    return targetIndex > 0;
  }

  canMergeUp(): boolean {
    const targetIndex = this.activeLayerIndex;
    return targetIndex < this.getLayerCount() - 1;
  }

  canMergeAll(): boolean {
    return this.getLayerCount() > 1;
  }

  destroy(): void {
    if (this.thumbnailCanvas) {
      freeCanvas(this.thumbnailCanvas);
    }
  }
}
