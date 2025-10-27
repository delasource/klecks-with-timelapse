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

