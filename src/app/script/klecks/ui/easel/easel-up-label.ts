import { BB } from '../../../bb/bb';
import { applyToPoint } from 'transformation-matrix';
import { createMatrixFromTransform } from '../../../bb/transform/create-matrix-from-transform';
import { minimizeAngleDeg } from '../../../bb/math/math';
import { TViewportTransform } from '../project-viewport/project-viewport';

/** From this angle of the view on (either way), the label shows. */
const SHOW_FROM_ANGLE_DEG = 45;
/** Space between the drawing's top edge and the label, in screen pixels. */
const GAP_PX = 6;

/**
 * ColorMari: a small "This side up" over the drawing's top edge, at its top left corner, turning with the view.
 * Shown only while the view is turned by more than 45 degrees, so a player who turned the drawing around still
 * knows where its top is.
 *
 * A DOM element of the easel only: not drawn into the canvas, never recorded, rendered or exported. Its size stays
 * the same at every zoom.
 */
export class EaselUpLabel {
  private readonly rootEl: HTMLElement;

  constructor() {
    this.rootEl = BB.el({
      content: 'This side up',
      css: {
        position: 'absolute',
        left: '0',
        top: '0',
        transformOrigin: '0 0',
        padding: '1px 6px',
        borderRadius: '4px',
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        fontSize: '12px',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        userSelect: 'none',
        display: 'none',
      },
    });
  }

  getElement(): HTMLElement {
    return this.rootEl;
  }

  /** Follows the view as it is rendered (`transform` = the one on screen, not the one it eases to). */
  update(transform: TViewportTransform, projectWidth: number, projectHeight: number): void {
    if (Math.abs(minimizeAngleDeg(transform.angleDeg)) <= SHOW_FROM_ANGLE_DEG || projectHeight <= 0) {
      this.rootEl.style.display = 'none';
      return;
    }
    const m = createMatrixFromTransform(transform);
    const topLeft = applyToPoint(m, { x: 0, y: 0 });
    const topRight = applyToPoint(m, { x: projectWidth, y: 0 });
    const bottomLeft = applyToPoint(m, { x: 0, y: projectHeight });

    // "Up" of the drawing on the screen, and the direction its text reads in (up turned by 90 degrees clockwise).
    // Mirrored, the drawing's left edge is on the right on screen: the label goes to the corner that *looks* left.
    const upX = topLeft.x - bottomLeft.x;
    const upY = topLeft.y - bottomLeft.y;
    const readX = -upY;
    const readY = upX;
    const corner =
      topLeft.x * readX + topLeft.y * readY <= topRight.x * readX + topRight.y * readY ? topLeft : topRight;
    const angleRad = Math.atan2(readY, readX);

    this.rootEl.style.transform = `translate(${corner.x}px, ${corner.y}px) rotate(${angleRad}rad) translate(0, calc(-100% - ${GAP_PX}px))`;
    this.rootEl.style.display = '';
  }
}
