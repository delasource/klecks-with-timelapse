import { TRect } from '../../bb/bb-types';
import { getMultiPolyBounds } from '../../bb/multi-polygon/get-multi-polygon-bounds';
import { indexBoundsInArea } from '../../bb/math/math';
import { getCanvasBounds } from '../../bb/base/canvas';
import { MultiPolygon } from 'polygon-clipping';

// returns bounds of selection, where layer is not empty (transparent)
export function getSelectionBounds(
    selection: MultiPolygon,
    context: CanvasRenderingContext2D,
): TRect | undefined {
    const selectionBounds = getMultiPolyBounds(selection, 'index');
    // integer bounds that are within the canvas
    const canvasSelectionBounds = indexBoundsInArea(
        selectionBounds,
        context.canvas.width,
        context.canvas.height,
    );

    // selection area outside of canvas
    if (!canvasSelectionBounds) {
        return undefined;
    }

    // bounds of where pixels are non-transparent
    return getCanvasBounds(context, canvasSelectionBounds);
}
