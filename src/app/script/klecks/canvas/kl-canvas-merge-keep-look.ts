import { createCanvas } from '../../bb/base/create-canvas';
import { ctx, freeCanvas } from '../../bb/base/canvas';
import { TMixMode } from '../kl-types';
import { LayerCompositor } from './layer-compositor';
import type { TKlCanvasLayer } from './kl-canvas';

/**
 * ColorMari: merging a layer down so that the picture looks exactly as it did before.
 *
 * Upstream's merge (`LayerCompositor.merge`) draws the upper layer onto the pixels of the layer
 * below only. With a blend mode that is not the same: where the lower layer is empty or half
 * transparent, the upper layer mixed with what lies further down (the colours under a layer of
 * line art) and now has nothing to mix with - multiplied grey shading turns into plain grey on
 * top of the colours.
 *
 * What is solved instead, per pixel. Canvas compositing treats alpha like source-over in every
 * blend mode, so the merged layer must cover exactly `u = 1 - (1 - a_bottom)(1 - a_top)` (each
 * alpha times its layer's opacity). With B = everything below the lower layer and F = everything
 * up to the upper layer (premultiplied), a layer L drawn normally over B gives F when
 * `L = F - (1 - u) * B`. That colour is baked into the lower layer - which also means the merged
 * paint no longer follows a later change of the layers further down, as it is the look of the
 * moment that is kept.
 *
 * Only pixels the upper layer paints are rewritten; elsewhere the lower layer stays untouched.
 */

/** Whether the look-keeping merge applies, or upstream's plain merge is exact (or all there is). */
export function canMergeKeepingLook(
    bottom: TKlCanvasLayer,
    top: TKlCanvasLayer,
    mixModeStr: TMixMode,
): boolean {
    return (
        // Normal over normal is associative: the plain merge is exact already.
        mixModeStr !== 'source-over' &&
        // A clipped upper layer is merged as its clipping group by upstream - exact as well.
        !top.hasClipping &&
        top.isVisible &&
        top.opacity > 0 &&
        // The lower layer must show its pixels as they are, else there is no single solution.
        bottom.isVisible &&
        bottom.opacity > 0 &&
        bottom.mixModeStr === 'source-over' &&
        !bottom.hasClipping
    );
}

/**
 * Merges `layers[topIndex]` into the layer below it, keeping the look (see above). The caller
 * removes the upper layer and records the step. Returns whether a pixel changed.
 */
export function mergeKeepingLook(
    layers: readonly TKlCanvasLayer[],
    topIndex: number,
    mixModeStr: TMixMode,
): boolean {
    const bottom = layers[topIndex - 1];
    const top = { ...layers[topIndex], mixModeStr };
    const { width, height } = bottom.canvas;

    const compose = (stack: readonly TKlCanvasLayer[]): ImageData => {
        const canvas = createCanvas(width, height);
        const context = ctx(canvas);
        const compositor = new LayerCompositor();
        try {
            compositor.draw(context, stack, width, height, (target, layer) =>
                target.drawImage(layer.canvas, 0, 0),
            );
            return context.getImageData(0, 0, width, height);
        } finally {
            compositor.destroy();
            freeCanvas(canvas);
        }
    };
    const below = compose(layers.slice(0, topIndex - 1)).data;
    const full = compose([...layers.slice(0, topIndex), top]).data;
    const topPixels = ctx(top.canvas).getImageData(0, 0, width, height).data;
    const bottomImage = bottom.context.getImageData(0, 0, width, height);
    const bottomPixels = bottomImage.data;

    let hasChanges = false;
    for (let i = 0; i < bottomPixels.length; i += 4) {
        const topAlpha = (topPixels[i + 3] / 255) * top.opacity;
        if (topAlpha === 0) {
            continue;
        }
        const bottomAlpha = (bottomPixels[i + 3] / 255) * bottom.opacity;
        const coverage = 1 - (1 - bottomAlpha) * (1 - topAlpha);
        const fullAlpha = full[i + 3] / 255;
        const belowAlpha = below[i + 3] / 255;
        // Stored alpha: the lower layer's opacity is applied again when it is drawn. Above 1
        // (a half transparent lower layer under paint of the upper one) it cannot be exact.
        const storedAlpha = Math.min(1, coverage / bottom.opacity);
        for (let c = 0; c < 3; c++) {
            const premultiplied =
                (full[i + c] / 255) * fullAlpha -
                (1 - coverage) * (below[i + c] / 255) * belowAlpha;
            const color = Math.min(1, Math.max(0, premultiplied / coverage));
            bottomPixels[i + c] = Math.round(color * 255);
        }
        bottomPixels[i + 3] = Math.round(storedAlpha * 255);
        hasChanges = true;
    }
    if (hasChanges) {
        bottom.context.putImageData(bottomImage, 0, 0);
    }
    return hasChanges;
}
