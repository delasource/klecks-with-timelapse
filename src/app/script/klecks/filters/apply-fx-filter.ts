import { TFxCanvas, TWrappedTexture } from '../../fx-canvas/fx-canvas-types';
import { BB } from '../../bb/bb';
import { drawSelectionMask } from '../../bb/base/canvas';
import { getPushableLayerChange } from '../history/push-helpers/get-pushable-layer-change';
import { canvasToLayerTiles } from '../history/push-helpers/canvas-to-layer-tiles';
import { integerBounds } from '../../bb/math/math';
import { getMultiPolyBounds } from '../../bb/multi-polygon/get-multi-polygon-bounds';
import { MultiPolygon } from 'polygon-clipping';
import { KlHistory } from '../history/kl-history';
import { getSharedFx } from '../../fx-canvas/shared-fx';

/**
 * Runs a WebGL filter over `source` and draws the result into `target` (which may be the context
 * of `source` itself). With a selection only the selected area changes. Nothing is pushed to
 * the history: this is the filter alone, as a preview needs it — applyFxFilter is the edit.
 */
export function runFxFilter(
  source: HTMLCanvasElement,
  target: CanvasRenderingContext2D,
  selection: MultiPolygon | undefined,
  applyFn: (fxCanvas: TFxCanvas) => void
): boolean {
  const fxCanvas = getSharedFx();
  if (!fxCanvas) {
    return false; // todo more specific error?
  }

  let maskTexture: TWrappedTexture | undefined;
  if (selection) {
    const maskCanvas = BB.canvas(source.width, source.height);
    const maskContext = BB.ctx(maskCanvas);
    drawSelectionMask(selection, maskContext);
    maskTexture = fxCanvas.texture(maskCanvas);
    BB.freeCanvas(maskCanvas);
  }
  const originalTexture = fxCanvas.texture(source);
  fxCanvas.draw(originalTexture);
  applyFn(fxCanvas);
  if (maskTexture) {
    fxCanvas.multiplyAlpha().mask(maskTexture, originalTexture).unmultiplyAlpha();
    maskTexture.destroy();
  }
  originalTexture.destroy();
  fxCanvas.update();
  target.clearRect(0, 0, target.canvas.width, target.canvas.height);
  target.drawImage(fxCanvas, 0, 0);
  return true;
}

export function applyFxFilter(
  context: CanvasRenderingContext2D,
  selection: MultiPolygon | undefined,
  applyFn: (fxCanvas: TFxCanvas) => void,
  klHistory: KlHistory
): boolean {
  if (!runFxFilter(context.canvas, context, selection, applyFn)) {
    return false;
  }

  klHistory.push(
    getPushableLayerChange(
      klHistory.getComposed(),
      canvasToLayerTiles(context.canvas, selection ? integerBounds(getMultiPolyBounds(selection)) : undefined)
    )
  );
  return true;
}
