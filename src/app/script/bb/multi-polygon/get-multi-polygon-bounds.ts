import { MultiPolygon } from 'polygon-clipping';
import { TCoordinateBounds, TIndexBounds } from '../bb-types';
import { coordinateBoundsToIndexBounds } from '../math/math';

export function getMultiPolyBounds<T extends TCoordinateBounds['type'] | TIndexBounds['type']>(
    poly: MultiPolygon,
    type: T,
): T extends 'index' ? TIndexBounds : TCoordinateBounds {
    let x1: number | undefined;
    let y1: number | undefined;
    let x2: number | undefined;
    let y2: number | undefined;
    poly.forEach((poly) => {
        poly.forEach((ring) => {
            ring.forEach((p) => {
                x1 = x1 === undefined ? p[0] : Math.min(x1, p[0]);
                y1 = y1 === undefined ? p[1] : Math.min(y1, p[1]);
                x2 = x2 === undefined ? p[0] : Math.max(x2, p[0]);
                y2 = y2 === undefined ? p[1] : Math.max(y2, p[1]);
            });
        });
    });
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
        throw new Error('empty MultiPolygon');
    }
    const bounds: TCoordinateBounds = {
        type: 'coordinate',
        x1,
        y1,
        x2,
        y2,
    };
    return (type === 'index' ? coordinateBoundsToIndexBounds(bounds) : bounds) as T extends 'index'
        ? TIndexBounds
        : TCoordinateBounds;
}
