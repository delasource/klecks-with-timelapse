import { BB } from '../../../../bb/bb';
import { TVector2D } from '../../../../bb/bb-types';
import { TPointerEvent } from '../../../../bb/input/event.types';
import { createMatrixFromTransform } from '../../../../bb/transform/create-matrix-from-transform';
import { applyToPoint, compose, inverse } from 'transformation-matrix';
import { TEaselInterface, TEaselTool } from '../easel.types';
import { ReferenceOverlay } from '../reference-overlay';

export type TEaselOverlayParams = {
  overlay: ReferenceOverlay;
};

/**
 * Moves the reference overlay by dragging, and outlines it while the tool is active — the picture
 * is clipped to the paper and often faint, so the outline is what shows where it really lies.
 * Scale, rotation and mirroring are set through the overlay controller (sliders in the UI).
 *
 * The overlay only reacts while this tool is active: with any other tool it cannot be moved or
 * drawn on by accident.
 */
export class EaselOverlay implements TEaselTool {
  private readonly svgEl: SVGElement;
  private readonly outlineEl: SVGElement;
  private readonly overlay: ReferenceOverlay;
  private easel: TEaselInterface = {} as TEaselInterface;
  private isDragging: boolean = false;
  private grabOffset: TVector2D = { x: 0, y: 0 }; // from the pointer to the picture's centre, project space

  private toProjectSpace(e: TPointerEvent): TVector2D {
    const m = createMatrixFromTransform(this.easel.getTransform());
    return applyToPoint(inverse(m), { x: e.relX, y: e.relY });
  }

  // ----------------------------------- public -----------------------------------
  constructor(p: TEaselOverlayParams) {
    this.overlay = p.overlay;
    this.svgEl = BB.createSvg({
      elementType: 'g',
    });
    this.outlineEl = BB.createSvg({
      elementType: 'path',
      fill: 'none',
      stroke: '#1e90ff',
      'stroke-width': '1.5',
    });
    this.outlineEl.setAttribute('stroke-dasharray', '6 4');
    this.svgEl.append(this.outlineEl);
  }

  getSvgElement(): SVGElement {
    return this.svgEl;
  }

  /** Redraws the outline. Called by the easel on a view change, by the app on an overlay change. */
  updateOutline(): void {
    const state = this.overlay.getState();
    if (!state.hasImage || !state.isVisible || !this.easel.getTransform) {
      this.outlineEl.setAttribute('d', '');
      return;
    }
    // picture space → project space → viewport (CSS pixels of the easel)
    const m = compose(createMatrixFromTransform(this.easel.getTransform()), this.overlay.getMatrix());
    const corners = [
      { x: 0, y: 0 },
      { x: state.imageWidth, y: 0 },
      { x: state.imageWidth, y: state.imageHeight },
      { x: 0, y: state.imageHeight },
    ].map(p => applyToPoint(m, p));
    this.outlineEl.setAttribute(
      'd',
      corners.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z'
    );
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

  onUpdateTransform(): void {
    this.updateOutline();
  }

  setEaselInterface(easelInterface: TEaselInterface): void {
    this.easel = easelInterface;
  }

  getIsLocked(): boolean {
    return this.isDragging;
  }

  activate(cursorPos?: TVector2D): void {
    this.easel.setCursor(this.overlay.getState().hasImage ? 'move' : 'default');
    this.isDragging = false;
    this.updateOutline();
  }
}
