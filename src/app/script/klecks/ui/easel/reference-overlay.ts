import { applyToPoint, compose, inverse, Matrix, rotateDEG, scale, translate } from 'transformation-matrix';
import { TSize2D } from '../../../bb/bb-types';
import { TProjectViewportProject } from '../project-viewport/project-viewport';

/** Where the overlay stands in what the easel shows: under every layer, or over them (multiplied). */
export type TOverlayPlacement = 'behind' | 'front';

/**
 * The reference picture and how it lies on the project.
 * x, y = where the picture's centre is, in project (canvas) pixels; scale = project pixels per
 * picture pixel.
 */
export type TOverlayState = {
  hasImage: boolean;
  imageWidth: number;
  imageHeight: number;
  x: number;
  y: number;
  scale: number;
  angleDeg: number;
  flipX: boolean;
  opacity: number;
  isVisible: boolean;
  placement: TOverlayPlacement;
};

export type TOverlayTransform = Pick<TOverlayState, 'x' | 'y' | 'scale' | 'angleDeg' | 'flipX'>;

/** What the application gets to work the overlay (KlHeadlessApp.getOverlayController). */
export interface IHeadlessOverlayActions {
  /** Shows a picture, fitted into the project. null takes the overlay away. */
  setImage(image: CanvasImageSource | null, size?: TSize2D): void;
  setTransform(transform: Partial<TOverlayTransform>): void;
  setOpacity(opacity: number): void;
  setVisible(isVisible: boolean): void;
  setPlacement(placement: TOverlayPlacement): void;
  /** As large as fits into the project, centred, upright, not mirrored. */
  fit(): void;
  getState(): TOverlayState;
  /**
   * Whether the eyedropper takes its colour from the picture where it lies (a game whose template is a palette, too).
   * Off by default: then the eyedropper sees only the drawing.
   */
  setPickable(isPickable: boolean): void;
}

/** 'transform' = only where the picture lies changed (a re-render shows it), 'other' = anything else. */
export type TOverlayChange = 'transform' | 'other';

export type TReferenceOverlayParams = {
  getProjectSize: () => TSize2D;
  onChange: (change: TOverlayChange) => void;
  isDisabled?: boolean; // read-only apps and controlled replays show no overlay
};

export const OVERLAY_MIN_SCALE = 0.01;
export const OVERLAY_MAX_SCALE = 50;

const DEFAULT_OPACITY = 0.4;

function sizeOfImage(image: CanvasImageSource): TSize2D {
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  const sized = image as { width: number | SVGAnimatedLength; height: number | SVGAnimatedLength };
  return {
    width: typeof sized.width === 'number' ? sized.width : sized.width.baseVal.value,
    height: typeof sized.height === 'number' ? sized.height : sized.height.baseVal.value,
  };
}

/**
 * A reference picture ("template") shown in the easel as a help for sketching.
 *
 * It is a layer of the *view* only: EaselProjectUpdater adds it to the list of layers the easel
 * renders, and that is the one place it exists. KlCanvas, the history and the event recorder know
 * nothing of it — so it cannot get into an undo step, a recording, a replay, a video, an export,
 * or the paint bucket. The eyedropper sees it only when told to (`setPickable`, a template mode game),
 * and then takes a colour, nothing else. Keep it that way: nothing in here may call KlCanvas or push
 * to the history.
 */
export class ReferenceOverlay implements IHeadlessOverlayActions {
  private readonly getProjectSize: TReferenceOverlayParams['getProjectSize'];
  private readonly onChange: TReferenceOverlayParams['onChange'];
  private readonly isDisabled: boolean;

  private image: CanvasImageSource | null = null;
  private isSuspended = false; // hidden for a while (an in-app replay), state kept
  private isPickable = false;
  /** The picture's pixels, for the eyedropper: read once per picture, when first asked. null = cannot be read. */
  private pixels: ImageData | null | undefined = undefined;
  private state: TOverlayState = {
    hasImage: false,
    imageWidth: 0,
    imageHeight: 0,
    x: 0,
    y: 0,
    scale: 1,
    angleDeg: 0,
    flipX: false,
    opacity: DEFAULT_OPACITY,
    isVisible: true,
    placement: 'behind',
  };

  // ----------------------------------- public -----------------------------------
  constructor(p: TReferenceOverlayParams) {
    this.getProjectSize = p.getProjectSize;
    this.onChange = p.onChange;
    this.isDisabled = !!p.isDisabled;
  }

  setImage(image: CanvasImageSource | null, size?: TSize2D): void {
    if (this.isDisabled) {
      return;
    }
    this.image = image;
    this.pixels = undefined;
    if (!image) {
      this.state = { ...this.state, hasImage: false, imageWidth: 0, imageHeight: 0 };
      this.onChange('other');
      return;
    }
    const { width, height } = size ?? sizeOfImage(image);
    if (!(width > 0) || !(height > 0)) {
      // Not loaded, or broken: there is nothing to show and nothing to place.
      this.image = null;
      this.state = { ...this.state, hasImage: false, imageWidth: 0, imageHeight: 0 };
      this.onChange('other');
      return;
    }
    this.state = { ...this.state, hasImage: true, imageWidth: width, imageHeight: height, isVisible: true };
    this.fit(); // emits the change
  }

  setTransform(transform: Partial<TOverlayTransform>): void {
    if (this.isDisabled) {
      return;
    }
    const next = { ...this.state };
    if (Number.isFinite(transform.x)) next.x = transform.x!;
    if (Number.isFinite(transform.y)) next.y = transform.y!;
    if (Number.isFinite(transform.scale)) {
      next.scale = Math.min(OVERLAY_MAX_SCALE, Math.max(OVERLAY_MIN_SCALE, transform.scale!));
    }
    if (Number.isFinite(transform.angleDeg)) next.angleDeg = transform.angleDeg!;
    if (transform.flipX !== undefined) next.flipX = !!transform.flipX;
    this.state = next;
    this.onChange('transform');
  }

  setOpacity(opacity: number): void {
    if (this.isDisabled || !Number.isFinite(opacity)) {
      return;
    }
    this.state = { ...this.state, opacity: Math.min(1, Math.max(0, opacity)) };
    this.onChange('other');
  }

  setVisible(isVisible: boolean): void {
    if (this.isDisabled) {
      return;
    }
    this.state = { ...this.state, isVisible };
    this.onChange('other');
  }

  setPlacement(placement: TOverlayPlacement): void {
    if (this.isDisabled) {
      return;
    }
    this.state = { ...this.state, placement };
    this.onChange('other');
  }

  fit(): void {
    if (this.isDisabled || !this.state.hasImage) {
      return;
    }
    const project = this.getProjectSize();
    this.state = {
      ...this.state,
      x: project.width / 2,
      y: project.height / 2,
      scale: Math.min(project.width / this.state.imageWidth, project.height / this.state.imageHeight),
      angleDeg: 0,
      flipX: false,
    };
    this.onChange('other');
  }

  getState(): TOverlayState {
    return { ...this.state };
  }

  setPickable(isPickable: boolean): void {
    this.isPickable = isPickable;
  }

  // ----------------------------------- for the engine -----------------------------------

  /** Hides the overlay without forgetting it — while a replay rebuilds the canvas from nothing. */
  setSuspended(isSuspended: boolean): void {
    if (this.isSuspended === isSuspended) {
      return;
    }
    this.isSuspended = isSuspended;
    this.onChange('other');
  }

  /**
   * The colour of the picture at a point of the project, for the eyedropper - only when it is pickable and shown,
   * and only where the picture has a pixel that is not (nearly) transparent. Its own colour, not as mixed with the
   * drawing on screen: the template is a palette. undefined everywhere else, and when the picture cannot be read
   * (a picture from another origin without CORS taints a canvas).
   *
   * This reads the picture, never the drawing: nothing of the overlay gets into KlCanvas, the history or a
   * recording. The colour taken is set like any other (a colour change is no event of its own).
   */
  getColorAt(x: number, y: number): { r: number; g: number; b: number } | undefined {
    if (!this.isPickable || !this.image || this.isSuspended || !this.state.isVisible || !this.state.hasImage) {
      return undefined;
    }
    const point = applyToPoint(inverse(this.getMatrix()), { x, y });
    const px = Math.floor(point.x);
    const py = Math.floor(point.y);
    if (px < 0 || py < 0 || px >= this.state.imageWidth || py >= this.state.imageHeight) {
      return undefined;
    }
    const pixels = this.readPixels();
    if (!pixels) {
      return undefined;
    }
    const i = (py * pixels.width + px) * 4;
    if (pixels.data[i + 3] < 128) {
      return undefined;
    }
    return { r: pixels.data[i], g: pixels.data[i + 1], b: pixels.data[i + 2] };
  }

  private readPixels(): ImageData | null {
    if (this.pixels !== undefined) {
      return this.pixels;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = this.state.imageWidth;
      canvas.height = this.state.imageHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(this.image!, 0, 0, canvas.width, canvas.height);
      this.pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (_) {
      this.pixels = null;
    }
    return this.pixels;
  }

  /** Picture pixels → project pixels. */
  getMatrix(): Matrix {
    const s = this.state;
    return compose(
      translate(s.x, s.y),
      rotateDEG(s.angleDeg),
      scale(s.flipX ? -s.scale : s.scale, s.scale),
      translate(-s.imageWidth / 2, -s.imageHeight / 2)
    );
  }

  /**
   * The entry EaselProjectUpdater puts into the easel's list of layers, or undefined while there is
   * nothing to show. Its image is a function, called at every render: a move needs a re-render of
   * the easel and nothing else.
   */
  getViewportLayer(): TProjectViewportProject['layers'][number] | undefined {
    const image = this.image;
    if (!image || this.isSuspended || !this.state.isVisible) {
      return undefined;
    }
    return {
      image: () => ({ image, transform: this.getMatrix() }),
      isVisible: true,
      opacity: this.state.opacity,
      // In front it is multiplied: on white paper that reads like lying under the ink.
      mixModeStr: this.state.placement === 'front' ? 'multiply' : 'source-over',
      hasClipping: false,
      isViewOnly: true,
    };
  }
}
