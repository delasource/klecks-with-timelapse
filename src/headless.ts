// Headless entry point - only exports the KlHeadlessApp and essential types

// First of all, and before anything that it collects: `bb.ts` is a barrel that the modules it
// re-exports import back (`BB.…`). As native ES modules (Vite's dev server, Vitest) that circle
// only closes if the barrel is where it is entered — entered through one of its members, the
// barrel is evaluated while that member is not initialised yet ("Cannot access … before
// initialization"). Parcel's bundles do not care, which is why upstream does not either.
import './app/script/bb/bb';

export { ColorConverter } from './app/script/bb/color/color';

export * from './app/script/app/kl-headless-app';

export type {
  TKlProject,
  TKlProjectLayer,
  TProjectId,
  TRgb,
  TFillSampling,
  TLayerFill,
  TMixMode,
} from './app/script/klecks/kl-types';

export type { TViewportTransform } from './app/script/klecks/ui/project-viewport/project-viewport';

export type { IEventStorageProvider } from './app/script/klecks/history/kl-event-storage-provider';
export { BrowserEventStorageProvider, ReadOnlyPlayer } from './app/script/klecks/history/kl-event-storage-provider';

export type { TBrushConfigTypes } from './app/script/klecks/brushes/brushes';

export type { TPenBrushConfig } from './app/script/klecks/brushes/pen-brush';
export type { TBlendBrushConfig } from './app/script/klecks/brushes/blend-brush';
export type { TSketchyBrushConfig } from './app/script/klecks/brushes/sketchy-brush';
export type { TPixelBrushConfig, TPixelBrushTip } from './app/script/klecks/brushes/pixel-brush';
export type { TPixelPattern } from './app/script/klecks/brushes/pixel-brush-patterns';
export { DEFAULT_PIXEL_PATTERNS } from './app/script/klecks/brushes/pixel-brush-patterns';
export type { TChemyBrushConfig } from './app/script/klecks/brushes/chemy-brush';
export type { TSmudgeBrushConfig } from './app/script/klecks/brushes/smudge-brush';
export type { TEraserBrushConfig } from './app/script/klecks/brushes/eraser-brush';

export { genBrushAlpha01, genBrushAlpha02 } from './app/script/klecks/brushes/alphas/brush-alphas';

export * from './app/script/klecks/kl-types';

export { LayerHeadlessController } from './app/script/app/layer-headless-controller';

export type {
  TLayerInfo,
  TLayerThumbnailOptions,
  THeadlessLayerState,
  IHeadlessLayerControllerActions,
} from './app/script/app/kl-headless-layer-types';

export type {
  IHeadlessOverlayActions,
  TOverlayState,
  TOverlayTransform,
  TOverlayPlacement,
} from './app/script/klecks/ui/easel/reference-overlay';
export { OVERLAY_MIN_SCALE, OVERLAY_MAX_SCALE } from './app/script/klecks/ui/easel/reference-overlay';

export type { TLayerId } from './app/script/klecks/history/history.types';

export type { TBooleanOperation, TSelectShape } from './app/script/klecks/select-tool/select-tool';

export type { TSelectToolMode } from './app/script/klecks/ui/tool-tabs/select-ui';

export type { IHeadlessSelectActions, IHeadlessSelectState } from './app/script/app/kl-headless-select-types';

export type {
  IHeadlessFilterActions,
  THeadlessFilterInputs,
  THeadlessFilterKey,
  THeadlessFilterPreview,
} from './app/script/app/kl-headless-filter';

export { SplineInterpolator } from './app/script/bb/math/line';
export { powerSplineInput } from './app/script/bb/math/power-spline-input';

export type {
  TRecordedEvent,
  TGetEventsOptions,
  TEventType,
  TReplayConfig,
  TReplayStats,
  TEventReplayingHandler,
} from './app/script/klecks/history/kl-event-types';
