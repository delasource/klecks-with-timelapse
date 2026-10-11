import { Matrix } from 'transformation-matrix';
import { transformCoordinateBounds } from '../../bb/transform/transform-coordinate-bounds';
import { MultiPolygon } from 'polygon-clipping';
import {
    coordinateBoundsToIndexBounds,
    indexBoundsToCoordinateBounds,
    rectToBounds,
} from '../../bb/math/math';
import { TIndexBounds, TRect } from '../../bb/bb-types';
import { TSelectionSample } from './selection-sample';

export function getSelectionBoundsFromSample(selectionSample: TSelectionSample): TIndexBounds {
    const x = selectionSample.x - selectionSample.imageOffset.x;
    const y = selectionSample.y - selectionSample.imageOffset.y;
    return rectToBounds(
        {
            x,
            y,
            width: selectionSample.selectionSize.width,
            height: selectionSample.selectionSize.height,
        },
        'index',
    );
}

export function getSelectionSampleBounds(
    selectionSample: TSelectionSample,
    transformation?: Matrix,
): TIndexBounds {
    const rect: TRect = {
        x: selectionSample.x,
        y: selectionSample.y,
        width: selectionSample.image.width,
        height: selectionSample.image.height,
    };
    if (transformation) {
        return coordinateBoundsToIndexBounds(
            transformCoordinateBounds(rectToBounds(rect, 'coordinate'), transformation),
        );
    }
    return rectToBounds(rect, 'index');
}

export function getSelectionSampleBoundsMultiPolygon(
    selectionSample: TSelectionSample,
    transformation?: Matrix,
): MultiPolygon {
    const bounds = indexBoundsToCoordinateBounds(
        getSelectionSampleBounds(selectionSample, transformation),
    );
    return [
        [
            [
                [bounds.x1, bounds.y1],
                [bounds.x2, bounds.y1],
                [bounds.x2, bounds.y2],
                [bounds.x1, bounds.y2],
                [bounds.x1, bounds.y1],
            ],
        ],
    ];
}
