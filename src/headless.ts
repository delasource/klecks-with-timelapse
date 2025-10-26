// Headless entry point - only exports the KlHeadlessApp and essential types
export {
    KlHeadlessApp
} from './app/script/app/kl-headless-app';
export type {
    TKlHeadlessUiState
} from './app/script/app/kl-headless-app';

export type {
    TKlProject,
    TKlProjectLayer,
    TProjectId
} from './app/script/klecks/kl-types';

export type {
    TViewportTransform
} from './app/script/klecks/ui/project-viewport/project-viewport';

// Re-export IEventStorageProvider from its source
export type { IEventStorageProvider } from './app/script/klecks/history/kl-event-storage-provider';
