import { TVector2D } from '../../../../bb/bb-types';
import { BB } from '../../../../bb/bb';
import { TPointerEvent } from '../../../../bb/input/event.types';
import { createMatrixFromTransform } from '../../../../bb/transform/create-matrix-from-transform';
import { applyToPoint, inverse } from 'transformation-matrix';
import { TEaselInterface, TEaselTool } from '../easel.types';
import { ReferenceOverlay, TOverlayTransform } from '../reference-overlay';
import { FreeTransform } from '../../components/free-transform';
import { TFreeTransform } from '../../../transform/transform-types';
import { TViewportTransform } from '../../project-viewport/project-viewport';

export type TEaselOverlayParams = {
  overlay: ReferenceOverlay;
};

/**
 * The overlay's place as the handles see it: a rectangle around the picture, centred where it
 * lies, turned by its angle. A mirrored picture is a negative width - as freeTransformToMatrix of
 * the select tool reads one, so the rectangle and ReferenceOverlay.getMatrix() agree.
 */
function overlayToFreeTransform(overlay: ReferenceOverlay): TFreeTransform {
  const state = overlay.getState();
  return {
    x: state.x,
    y: state.y,
    width: state.imageWidth * state.scale * (state.flipX ? -1 : 1),
    height: state.imageHeight * state.scale,
    angleDeg: state.angleDeg,
  };
}

/**
 * The rectangle the handles were dragged to, as the overlay's transform. The handles keep the
 * picture's proportions (constrained), so the height alone gives the scale. A corner pulled
 * through the opposite one turns both sides negative: the same as half a turn.
 */
function freeTransformToOverlay(transform: TFreeTransform, imageHeight: number): TOverlayTransform {
  let { width, height, angleDeg } = transform;
  if (height < 0) {
    width = -width;
    height = -height;
    angleDeg += 180;
  }
  if (angleDeg > 180) {
    angleDeg -= 360;
  } else if (angleDeg <= -180) {
    angleDeg += 360;
  }
  return {
    x: transform.x,
    y: transform.y,
    scale: height / imageHeight,
    angleDeg,
    flipX: width < 0,
  };
}

/**
 * Places the reference overlay: dragging anywhere moves it; upstream's FreeTransform handles (as
 * the select tool has them - DOM elements in the easel's HTML overlay, styled inline) around the
 * picture resize it at a corner or an edge, keeping its proportions, and turn it with the grip
 * above it. The rectangle is also what shows where the picture really lies: it is clipped to the
 * paper and often faint. Opacity, mirroring and placement are set through the overlay controller.
 *
 * The overlay only reacts while this tool is active: with any other tool it cannot be moved or
 * drawn on by accident, and the handles are hidden.
 */
export class EaselOverlay implements TEaselTool {
  private readonly svgEl: SVGElement;
  private readonly htmlEl: HTMLElement;
  private readonly overlay: ReferenceOverlay;
  private easel: TEaselInterface = {} as TEaselInterface;
  private isActive: boolean = false;
  private isDragging: boolean = false;
  private grabOffset: TVector2D = { x: 0, y: 0 }; // from the pointer to the picture's centre, project space
  private freeTransform: FreeTransform | undefined; // the handles, made once the easel is known
  private isFromHandles: boolean = false; // a change the handles made: they must not be told it back

  private toProjectSpace(e: TPointerEvent): TVector2D {
    const m = createMatrixFromTransform(this.easel.getTransform());
    return applyToPoint(inverse(m), { x: e.relX, y: e.relY });
  }

  private projectSnapping(): { snapX: number[]; snapY: number[] } {
    const { width, height } = this.easel.getProjectSize();
    // the edges and the middle of the paper
    return { snapX: [0, width / 2, width], snapY: [0, height / 2, height] };
  }

  private getFreeTransform(): FreeTransform | undefined {
    if (this.freeTransform || !this.easel.getTransform) {
      return this.freeTransform;
    }
    this.freeTransform = new FreeTransform({
      ...overlayToFreeTransform(this.overlay),
      isConstrained: true,
      ...this.projectSnapping(),
      viewportTransform: this.easel.getTransform(),
      callback: transform => {
        const state = this.overlay.getState();
        if (
          !this.isActive ||
          !state.hasImage ||
          [transform.x, transform.y, transform.width, transform.height].some(isNaN)
        ) {
          return;
        }
        this.isFromHandles = true;
        try {
          this.overlay.setTransform(freeTransformToOverlay(transform, state.imageHeight));
        } finally {
          this.isFromHandles = false;
        }
      },
      onWheel: this.easel.onWheel,
      wheelParent: this.easel.getElement(),
    });
    this.htmlEl.append(this.freeTransform.getElement());
    return this.freeTransform;
  }

  // ----------------------------------- public -----------------------------------
  constructor(p: TEaselOverlayParams) {
    this.overlay = p.overlay;
    this.svgEl = BB.createSvg({
      elementType: 'g',
    });
    this.htmlEl = BB.el({ css: { display: 'none' } });
  }

  getSvgElement(): SVGElement {
    return this.svgEl;
  }

  getHtmlOverlayElement(): HTMLElement {
    return this.htmlEl;
  }

  /**
   * Puts the handles where the picture lies, and shows them only while this tool is active and
   * there is a visible picture. Called by the easel on a view change, by the app on an overlay
   * change.
   */
  updateOutline(): void {
    const state = this.overlay.getState();
    const isShown = this.isActive && state.hasImage && state.isVisible;
    this.htmlEl.style.display = isShown ? 'block' : 'none';
    if (!isShown || this.isFromHandles) {
      return;
    }
    const freeTransform = this.getFreeTransform();
    if (!freeTransform) {
      return;
    }
    const { snapX, snapY } = this.projectSnapping();
    freeTransform.setSnappingPoints(snapX, snapY);
    freeTransform.setViewportTransform(this.easel.getTransform());
    freeTransform.initialise(overlayToFreeTransform(this.overlay));
  }

  onPointer(e: TPointerEvent): void {
    const hasImage = this.overlay.getState().hasImage;
    this.easel.setCursor(hasImage ? (this.isDragging ? 'grabbing' : 'move') : 'default');
    if (!hasImage) {
      this.isDragging = false;
      return;
    }

    if (e.type === 'pointerdown' && e.button === 'left') {
      const p = this.toProjectSpace(e);
      const state = this.overlay.getState();
      this.grabOffset = { x: state.x - p.x, y: state.y - p.y };
      this.isDragging = true;
      this.easel.setCursor('grabbing');
    }
    if (e.type === 'pointermove' && e.button === 'left' && this.isDragging) {
      const p = this.toProjectSpace(e);
      this.overlay.setTransform({ x: p.x + this.grabOffset.x, y: p.y + this.grabOffset.y });
    }
    if (e.type === 'pointerup' && this.isDragging) {
      this.isDragging = false;
      this.easel.setCursor('move');
    }
  }

  onUpdateTransform(transform: TViewportTransform): void {
    this.freeTransform?.setViewportTransform(transform);
    this.updateOutline();
  }

  setEaselInterface(easelInterface: TEaselInterface): void {
    this.easel = easelInterface;
  }

  // the handles are this tool's: another tool on the easel must not find them in its way
  onTool(toolId: string): void {
    this.isActive = toolId === 'overlay';
    this.updateOutline();
  }

  getIsLocked(): boolean {
    return this.isDragging;
  }

  activate(cursorPos?: TVector2D): void {
    this.easel.setCursor(this.overlay.getState().hasImage ? 'move' : 'default');
    this.isDragging = false;
    this.isActive = true;
    this.updateOutline();
  }
}
