import { TMixMode, TRgb } from '../klecks/kl-types';

export type TLayerInfo = {
  index: number;
  id: string;
  name: string;
  opacity: number;
  isVisible: boolean;
  mixModeStr: TMixMode;
  // a clipping mask: the layer shows only where the layer it is clipped to (the next one below
  // that is not clipped itself) has paint
  hasClipping: boolean;
};

export type TLayerThumbnailOptions = {
  width?: number;
  height?: number;
  fitInside?: boolean;
};

export interface IHeadlessLayerControllerActions {
  setLayerVisibility(layerIndex: number, isVisible: boolean): void;

  setLayerOpacity(layerIndex: number, opacity: number, isTemp?: boolean): void;

  setLayerMixMode(layerIndex: number, mixMode: TMixMode): void;

  // makes the layer a clipping mask of the layers below it, or an ordinary layer again
  setLayerClipping(layerIndex: number, hasClipping: boolean): void;

  setLayerName(newName: string): void;

  addLayer(): boolean;

  duplicateLayer(): boolean;

  removeLayer(): boolean;

  mergeWithLayerBelow(index?: number): boolean;

  mergeWithLayerAbove(index?: number): boolean;

  mergeAll(): number | false;

  clearLayer(): void;

  setActiveLayer(layerIndex: number): void;

  moveLayer(fromIndex: number, toIndex: number): void;

  moveLayerUp(): boolean;

  moveLayerDown(): boolean;

  fillLayer(color: TRgb): void;

  getState(): THeadlessLayerState;

  getThumbnail(id: string, options: TLayerThumbnailOptions): Promise<Blob>;

  canAddLayer(): boolean;

  canRemoveLayer(): boolean;

  canDuplicateLayer(): boolean;

  canMergeDown(): boolean;

  canMergeUp(): boolean;

  canMergeAll(): boolean;

  addUpToNLayers(n: number): void;
}

export type THeadlessLayerState = {
  layers: TLayerInfo[];
  activeLayerIndex: number;
};
