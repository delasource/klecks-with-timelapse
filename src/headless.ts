// Headless entry point - only exports the KlHeadlessApp and essential types

export {
    ColorConverter
} from './app/script/bb/color/color';

export * from './app/script/app/kl-headless-app';

export type {
    TKlProject,
    TKlProjectLayer,
    TProjectId,
    TRgb,
    TFillSampling,
    TLayerFill,
    TMixMode
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
    TLayerThumbnailOptions,
    THeadlessLayerState,
    IHeadlessLayerControllerActions
} from './app/script/app/kl-headless-layer-types';

export type {
    TLayerId,
} from './app/script/klecks/history/history.types';

export type {
    TBooleanOperation,
    TSelectShape
} from './app/script/klecks/select-tool/select-tool';

export type {
    TSelectToolMode
} from './app/script/klecks/ui/tool-tabs/select-ui';

export type {
    IHeadlessSelectActions,
    IHeadlessSelectState
} from './app/script/app/kl-headless-select-types';

export {
    SplineInterpolator,
    powerSplineInput
} from './app/script/bb/math/line';

export type {
    TRecordedEvent,
    TGetEventsOptions,
    TEventType,
} from './app/script/klecks/history/kl-event-types';
