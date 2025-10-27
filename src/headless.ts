// Headless entry point - only exports the KlHeadlessApp and essential types


export * from './app/script/app/kl-headless-app';

export type {
    TKlProject,
    TKlProjectLayer,
    TProjectId,
    TRgb,
    TFillSampling,
} from './app/script/klecks/kl-types';

export type {
    TViewportTransform,
} from './app/script/klecks/ui/project-viewport/project-viewport';

export type {
    IEventStorageProvider,
    BrowserEventStorageProvider
} from './app/script/klecks/history/kl-event-storage-provider';

export type {
    TBrushConfigTypes
} from './app/script/klecks/brushes/brushes';

export type { TPenBrushConfig } from './app/script/klecks/brushes/pen-brush';
export type { TBlendBrushConfig } from './app/script/klecks/brushes/blend-brush';
export type { TSketchyBrushConfig } from './app/script/klecks/brushes/sketchy-brush';
export type { TPixelBrushConfig } from './app/script/klecks/brushes/pixel-brush';
export type { TChemyBrushConfig } from './app/script/klecks/brushes/chemy-brush';
export type { TSmudgeBrushConfig } from './app/script/klecks/brushes/smudge-brush';
export type { TEraserBrushConfig } from './app/script/klecks/brushes/eraser-brush';

export {
    genBrushAlpha01,
    genBrushAlpha02
} from './app/script/klecks/brushes/alphas/brush-alphas';

export * from './app/script/klecks/kl-types';

export {
    LayerHeadlessController,
} from './app/script/app/layer-headless-controller';

export type {
    TLayerInfo,
    TLayerThumbnailOptions
} from './app/script/app/layer-headless-controller';

export type {
    TLayerId,
} from './app/script/klecks/history/history.types';
