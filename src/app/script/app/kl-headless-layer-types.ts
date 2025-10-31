import { TMixMode, TRgb } from '../klecks/kl-types';

export type TLayerInfo = {
    index: number;
    id: string;
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

export interface IHeadlessLayerControllerActions {
    setLayerVisibility(layerIndex: number, isVisible: boolean): void;

    setLayerOpacity(layerIndex: number, opacity: number, isTemp?: boolean): void;

    setLayerMixMode(layerIndex: number, mixMode: TMixMode): void;

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
}

export type THeadlessLayerState = {
    layers: TLayerInfo[];
    activeLayerIndex: number;
}
