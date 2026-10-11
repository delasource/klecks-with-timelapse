import { TKlCanvasLayer } from '../../canvas/kl-canvas';
import { THistoryEntryData } from '../history.types';
import { MultiPolygon } from 'polygon-clipping';
import { TIndexBounds } from '../../../bb/bb-types';
import { createLayerMap } from './create-layer-map';
import { updateBounds } from '../../../bb/math/math';

export type TChangeListEntry =
    | { selection: MultiPolygon | undefined }
    | { layerId: string; bounds: TIndexBounds };

/**
 * Merges a list of changes
 */
export function createHistoryEntryFromChanges(
    layers: TKlCanvasLayer[],
    changes: TChangeListEntry[],
): THistoryEntryData {
    const result: THistoryEntryData = {};
    const layerEntries: { layerId: string; attributes: ['tiles']; bounds: TIndexBounds }[] = [];
    for (const change of changes) {
        if ('selection' in change) {
            result.selection = { value: change.selection };
        } else {
            const existing = layerEntries.find((e) => e.layerId === change.layerId);
            if (existing) {
                existing.bounds = updateBounds(existing.bounds, change.bounds);
            } else {
                layerEntries.push({
                    layerId: change.layerId,
                    attributes: ['tiles'],
                    bounds: change.bounds,
                });
            }
        }
    }
    if (layerEntries.length > 0) {
        result.layerMap = createLayerMap(layers, ...layerEntries);
    }
    return result;
}
