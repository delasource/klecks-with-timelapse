import { TViewportTransform } from '../project-viewport';
import { TRect, TSize2D } from '../../../../bb/bb-types';
import { createMatrixFromTransform } from '../../../../bb/transform/create-matrix-from-transform';
import { applyToPoint } from 'transformation-matrix';

/**
 * Returns true if the rect (in canvas space) is fully visible within the viewport.
 * @param rect - rectangle in canvas space
 * @param viewportTransform - current viewport transform
 * @param easelSize - size of the viewport DOM element
 * @param padding - viewport space padding per side (default 0)
 */
export function checkRectFullyVisible(
    rect: TRect,
    viewportTransform: TViewportTransform,
    easelSize: TSize2D,
    padding: number = 0,
): boolean {
    const rectCenterX = rect.x + rect.width / 2;
    const rectCenterY = rect.y + rect.height / 2;

    // compute AABB of the rotated rect in viewport space
    const angleRad = (viewportTransform.angleDeg / 180) * Math.PI;
    const cos = Math.abs(Math.cos(angleRad));
    const sin = Math.abs(Math.sin(angleRad));
    const aabbWidth = (rect.width * cos + rect.height * sin) * viewportTransform.scale;
    const aabbHeight = (rect.width * sin + rect.height * cos) * viewportTransform.scale;

    const matrix = createMatrixFromTransform(viewportTransform);
    const centerInViewport = applyToPoint(matrix, { x: rectCenterX, y: rectCenterY });

    const halfW = aabbWidth / 2;
    const halfH = aabbHeight / 2;
    return (
        centerInViewport.x - halfW >= padding &&
        centerInViewport.x + halfW <= easelSize.width - padding &&
        centerInViewport.y - halfH >= padding &&
        centerInViewport.y + halfH <= easelSize.height - padding
    );
}
