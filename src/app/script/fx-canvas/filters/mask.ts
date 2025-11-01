import { gl } from '../core/gl';
import { FxShader } from '../core/fx-shader';
import { simpleShader } from '../core/simple-shader';
import { TFxCanvas, TWrappedTexture } from '../fx-canvas-types';

/**
 * Mask
 * @description Blends with an unfiltered image using a mask.
 * @param maskTexture mask (grayscale). 0 - unfiltered, 255 - filtered
 * @param originalTexture original/unfiltered image. undefined -> empty original
 */
export type TFilterMask = (
  this: TFxCanvas,
  maskTexture: TWrappedTexture,
  originalTexture?: TWrappedTexture
) => TFxCanvas;

export const mask: TFilterMask = function (maskTexture, originalTexture) {
  maskTexture._.use(1);

  if (originalTexture) {
    originalTexture._.use(2);
  } else {
    // should be faster than introducing a conditional in the shader
    this._.extraTexture.use(2);
    this._.extraTexture.initFromBytes(1, 1, [0, 0, 0, 0]);
  }

  gl.mask =
    gl.mask ||
    new FxShader(
      null,
      `
        uniform sampler2D texture;
        uniform sampler2D mask;
        uniform sampler2D original;
        varying vec2 texCoord;

        void main() {
            vec4 filteredCol = texture2D(texture, texCoord);
            vec4 originalCol = texture2D(original, texCoord);
            float maskStrength = texture2D(mask, texCoord).r;
            gl_FragColor = mix(originalCol, filteredCol, maskStrength);
        }
        `,
      'mask'
    );

  gl.mask.textures({
    mask: 1,
    original: 2,
  });

  simpleShader.call(this, gl.mask, {});

  return this;
};
