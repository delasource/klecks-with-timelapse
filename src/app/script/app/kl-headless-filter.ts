import { copyObj } from '../bb/base/base';
import { createCanvas } from '../bb/base/create-canvas';
import { ctx as getCtx, freeCanvas } from '../bb/base/canvas';
import { TFxCanvas } from '../fx-canvas/fx-canvas-types';
import { getSharedFx } from '../fx-canvas/shared-fx';
import { KlCanvas, TKlCanvasLayer } from '../klecks/canvas/kl-canvas';
import { applyFxFilter, runFxFilter } from '../klecks/filters/apply-fx-filter';
import { FILTER_LIB } from '../klecks/filters/filters';
import { KlHistory } from '../klecks/history/kl-history';
import { DIALOG_COUNTER } from '../klecks/ui/modals/modal-count';
import type { TFilterBlurInput } from '../klecks/filters/filter-blur';
import type { TFilterBrightnessContrastInput } from '../klecks/filters/filter-brightness-contrast';
import type { TFilterCurvesInput } from '../klecks/filters/filter-curves';
import type { TFilterDistortInput } from '../klecks/filters/filter-distort';
import type { TFilterHueSaturationInput } from '../klecks/filters/filter-hue-saturation';
import type { TFilterInvertInput } from '../klecks/filters/filter-invert';
import type { TFilterTiltShiftInput } from '../klecks/filters/filter-tilt-shift';
import type { TFilterToAlphaInput } from '../klecks/filters/filter-to-alpha';
import type { TFilterUnsharpMaskInput } from '../klecks/filters/filter-unsharp-mask';

/**
 * The filters of Klecks' "Edit" tab that change the pixels of the active layer through WebGL,
 * for a UI that is not Klecks' own.
 *
 * Klecks keeps each of these filters in a file together with its dialog (filter-*.ts), and the
 * dialog is built from Klecks' DOM widgets and stylesheet. The headless app has neither: it
 * takes the parameters from its host and runs the same shader calls through the same
 * applyFxFilter. The input types are Klecks' own, and what is recorded is Klecks' own 'filter'
 * event ({ filterKey, input }) — a paper filtered here replays in Klecks' full app and the other
 * way round.
 */
export type THeadlessFilterInputs = {
  brightnessContrast: TFilterBrightnessContrastInput; // brightness, contrast: -1 … 1
  curves: TFilterCurvesInput; // per channel four points [in, out], 0 … 1
  distort: TFilterDistortInput;
  hueSaturation: TFilterHueSaturationInput; // hue, saturation: -1 … 1
  invert: TFilterInvertInput; // null — no parameters
  tiltShift: TFilterTiltShiftInput; // a, b: the focus line, in canvas pixels
  toAlpha: TFilterToAlphaInput; // sourceId: 'inverted-luminance' | 'luminance'
  blur: TFilterBlurInput; // radius in canvas pixels
  unsharpMask: TFilterUnsharpMaskInput; // radius in canvas pixels, strength 0 … 5
};

export type THeadlessFilterKey = keyof THeadlessFilterInputs;

/**
 * The shader calls, exactly as the `apply` of the filter's file makes them. A change to one of
 * those files belongs here too.
 */
const FX: { [K in THeadlessFilterKey]: (fxCanvas: TFxCanvas, input: THeadlessFilterInputs[K]) => void } = {
  brightnessContrast: (fxCanvas, input) => {
    fxCanvas.brightnessContrast(input.brightness, input.contrast);
  },
  curves: (fxCanvas, input) => {
    fxCanvas.curves(input.curves.r, input.curves.g, input.curves.b);
  },
  distort: (fxCanvas, input) => {
    fxCanvas.multiplyAlpha().distort(input).unmultiplyAlpha();
  },
  hueSaturation: (fxCanvas, input) => {
    fxCanvas.hueSaturation(input.hue, input.saturation);
  },
  invert: fxCanvas => {
    fxCanvas.invert();
  },
  tiltShift: (fxCanvas, input) => {
    fxCanvas
      .multiplyAlpha()
      .tiltShift(input.a.x, input.a.y, input.b.x, input.b.y, input.blur, input.gradient)
      .unmultiplyAlpha();
  },
  toAlpha: (fxCanvas, input) => {
    fxCanvas.toAlpha(input.sourceId === 'inverted-luminance', input.selectedRgbaObj);
  },
  blur: (fxCanvas, input) => {
    fxCanvas.multiplyAlpha().triangleBlur(input.radius).unmultiplyAlpha();
  },
  unsharpMask: (fxCanvas, input) => {
    fxCanvas.unsharpMask(input.radius, input.strength);
  },
};

const isHeadlessFilterKey = (key: string): key is THeadlessFilterKey => Object.prototype.hasOwnProperty.call(FX, key);

/**
 * A picture of the whole drawing with a filter on the active layer, for a dialog to show while
 * its sliders move. Nothing of it touches the drawing.
 */
export type THeadlessFilterPreview = {
  /** Shows the drawing; sized to fit the box given to createPreview. Put it into the dialog. */
  canvas: HTMLCanvasElement;
  /** The size of the drawing itself — the coordinates of pixel-based inputs (tilt shift's a and b). */
  drawingWidth: number;
  drawingHeight: number;
  /** Draws the preview with these parameters. Without arguments: the drawing as it is. */
  render: <K extends THeadlessFilterKey>(filterKey?: K, input?: THeadlessFilterInputs[K]) => void;
  destroy: () => void;
};

export interface IHeadlessFilterActions {
  /** False where WebGL is missing: no filter can run, the UI should not offer them. */
  isSupported(): boolean;
  /** The keys a UI can offer, in the order of Klecks' Edit tab. */
  getFilterKeys(): THeadlessFilterKey[];
  /**
   * Applies a filter to the active layer (to the selected area, if there is a selection): one
   * undo step, one recorded event. Returns false if nothing was done.
   */
  apply<K extends THeadlessFilterKey>(filterKey: K, input: THeadlessFilterInputs[K]): boolean;
  /**
   * A preview that fits into maxWidth × maxHeight (CSS pixels). Undefined without WebGL. While
   * it exists the canvas takes no input and no keyboard shortcut — the caller destroys it when
   * its dialog closes.
   */
  createPreview(maxWidth: number, maxHeight: number): THeadlessFilterPreview | undefined;
}

export type TKlHeadlessFilterParams = {
  klCanvas: KlCanvas;
  klHistory: KlHistory;
  getCurrentLayer: () => TKlCanvasLayer;
  applyUncommitted: () => void;
  /** After a filter changed the layer and its history entry is pushed: record it, redraw. */
  onApplied: (filterKey: THeadlessFilterKey, input: unknown) => void;
  /** The colour behind the layers in the preview; undefined = transparent. */
  backdrop: string | undefined;
};

export class KlHeadlessFilter implements IHeadlessFilterActions {
  private readonly klCanvas: KlCanvas;
  private readonly klHistory: KlHistory;
  private readonly getCurrentLayer: () => TKlCanvasLayer;
  private readonly applyUncommitted: () => void;
  private readonly onApplied: TKlHeadlessFilterParams['onApplied'];
  private readonly backdrop: string | undefined;

  constructor(p: TKlHeadlessFilterParams) {
    this.klCanvas = p.klCanvas;
    this.klHistory = p.klHistory;
    this.getCurrentLayer = p.getCurrentLayer;
    this.applyUncommitted = p.applyUncommitted;
    this.onApplied = p.onApplied;
    this.backdrop = p.backdrop;
  }

  isSupported(): boolean {
    return !!getSharedFx();
  }

  getFilterKeys(): THeadlessFilterKey[] {
    return ['brightnessContrast', 'curves', 'distort', 'hueSaturation', 'invert', 'tiltShift', 'toAlpha', 'blur', 'unsharpMask'];
  }

  apply<K extends THeadlessFilterKey>(filterKey: K, input: THeadlessFilterInputs[K]): boolean {
    if (!isHeadlessFilterKey(filterKey)) {
      return false;
    }
    // A selection that is still being transformed becomes part of the layer first.
    this.applyUncommitted();
    // The host's object may live on (React state): what is applied and recorded is a copy.
    const ownInput = copyObj(input);
    if (!this.run(filterKey, ownInput)) {
      return false;
    }
    // Only now, with the history entry pushed: an undo takes one entry and one event.
    this.onApplied(filterKey, ownInput);
    return true;
  }

  /**
   * A recorded 'filter' event, played back. Keys this class does not know are Klecks' other
   * edit actions (flip, rotate, …), recorded by its full app: they run if their module was
   * loaded (filters-lazy.ts), which the headless app does not do.
   */
  applyRecorded(filterKey: string, input: unknown): boolean {
    if (isHeadlessFilterKey(filterKey)) {
      return this.run(filterKey, input as THeadlessFilterInputs[typeof filterKey]);
    }
    const apply = FILTER_LIB[filterKey]?.apply;
    if (!apply) {
      return false;
    }
    return apply({
      layer: this.getCurrentLayer(),
      klCanvas: this.klCanvas,
      klHistory: this.klHistory,
      input,
    });
  }

  private run<K extends THeadlessFilterKey>(filterKey: K, input: THeadlessFilterInputs[K]): boolean {
    const context = this.getCurrentLayer().context;
    return applyFxFilter(
      context,
      this.klCanvas.getSelection(),
      fxCanvas => FX[filterKey](fxCanvas, input),
      this.klHistory
    );
  }

  createPreview(maxWidth: number, maxHeight: number): THeadlessFilterPreview | undefined {
    if (!this.isSupported()) {
      return undefined;
    }
    this.applyUncommitted();

    const width = this.klCanvas.getWidth();
    const height = this.klCanvas.getHeight();
    const activeCanvas = this.getCurrentLayer().context.canvas;
    const selection = this.klCanvas.getSelection();
    const layers = this.klCanvas.getLayers();

    // The filter runs on the layer at its real size and the picture is scaled down afterwards:
    // a radius or a position in the input means in the preview what it will mean on the canvas.
    const filtered = createCanvas(width, height);
    const filteredCtx = getCtx(filtered);

    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = Math.max(1, Math.round(width * scale));
    const cssHeight = Math.max(1, Math.round(height * scale));
    const canvas = createCanvas(
      Math.min(width, Math.round(cssWidth * pixelRatio)),
      Math.min(height, Math.round(cssHeight * pixelRatio))
    );
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    const ctx = getCtx(canvas);
    let isDestroyed = false;

    // A preview is an open dialog: as for Klecks' own, the easel is frozen and the keyboard
    // shortcuts (undo, brush keys) are off until it is destroyed — the drawing must not change
    // under the picture of it.
    DIALOG_COUNTER.increase();

    const render: THeadlessFilterPreview['render'] = (filterKey, input) => {
      if (isDestroyed) {
        return;
      }
      const isFiltered =
        filterKey !== undefined &&
        isHeadlessFilterKey(filterKey) &&
        runFxFilter(activeCanvas, filteredCtx, selection, fxCanvas => FX[filterKey](fxCanvas, input!));

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (this.backdrop) {
        ctx.fillStyle = this.backdrop;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      layers.forEach(layer => {
        if (!layer.isVisible || layer.opacity === 0) {
          return;
        }
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.mixModeStr;
        ctx.drawImage(layer.canvas === activeCanvas && isFiltered ? filtered : layer.canvas, 0, 0, canvas.width, canvas.height);
      });
      ctx.restore();
    };
    render();

    return {
      canvas,
      drawingWidth: width,
      drawingHeight: height,
      render,
      destroy: () => {
        if (isDestroyed) {
          return;
        }
        isDestroyed = true;
        DIALOG_COUNTER.decrease();
        freeCanvas(filtered);
        freeCanvas(canvas);
      },
    };
  }
}
