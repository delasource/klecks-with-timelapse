import { BB } from '../../../bb/bb';
import { applyToPoint } from 'transformation-matrix';
import { createMatrixFromTransform } from '../../../bb/transform/create-matrix-from-transform';
import { minimizeAngleDeg } from '../../../bb/math/math';
import { TViewportTransform } from '../project-viewport/project-viewport';

/** From this angle of the view on (either way), "This side up" shows. */
const SHOW_UP_FROM_ANGLE_DEG = 45;
/** Space between the drawing's top edge and a label, in screen pixels. */
const GAP_PX = 6;

function createLabel(text: string): HTMLElement {
  return BB.el({
    content: text,
    css: {
      position: 'absolute',
      left: '0',
      top: '0',
      transformOrigin: '0 0',
      padding: '1px 6px',
      borderRadius: '4px',
      background: 'rgba(0, 0, 0, 0.55)',
      color: '#fff',
      fontSize: '14px',
      lineHeight: '18px',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      display: 'none',
    },
  });
}

/**
 * ColorMari: small labels over the drawing's top edge that turn with the view, so a player who turned or mirrored
 * the drawing still knows how it really lies:
 * - "This side up" at the top edge's corner that looks left, while the view is turned by more than 45 degrees
 * - "Gespiegelt (M)", itself mirrored, at the corner that looks right, while the view is mirrored (key M)
 *
 * DOM elements of the easel only: not drawn into the canvas, never recorded, rendered or exported. Their size stays
 * the same at every zoom.
 */
export class EaselViewLabels {
  private readonly rootEl: HTMLElement;
  private readonly upEl: HTMLElement;
  private readonly mirroredEl: HTMLElement;

  constructor() {
    this.upEl = createLabel('This side up');
    this.mirroredEl = createLabel('Gespiegelt (M)');
    // A wrapper without a size at the easel's top left corner: the labels are placed from there.
    this.rootEl = BB.el({
      css: {
        position: 'absolute',
        left: '0',
        top: '0',
        pointerEvents: 'none',
      },
    });
    this.rootEl.append(this.upEl, this.mirroredEl);
  }

  getElement(): HTMLElement {
    return this.rootEl;
  }

  /** Follows the view as it is rendered (`transform` = the one on screen, not the one it eases to). */
  update(transform: TViewportTransform, projectWidth: number, projectHeight: number): void {
    const showUp = Math.abs(minimizeAngleDeg(transform.angleDeg)) > SHOW_UP_FROM_ANGLE_DEG;
    const showMirrored = transform.isMirrored;
    if ((!showUp && !showMirrored) || projectWidth <= 0 || projectHeight <= 0) {
      this.upEl.style.display = 'none';
      this.mirroredEl.style.display = 'none';
      return;
    }
    const m = createMatrixFromTransform(transform);
    const topLeft = applyToPoint(m, { x: 0, y: 0 });
    const topRight = applyToPoint(m, { x: projectWidth, y: 0 });
    const bottomLeft = applyToPoint(m, { x: 0, y: projectHeight });

    // "Up" of the drawing on the screen, and the direction its text reads in (up turned by 90 degrees clockwise).
    // Mirrored, the drawing's left edge is on the right on screen: the corners are told by how they *look*.
    const upX = topLeft.x - bottomLeft.x;
    const upY = topLeft.y - bottomLeft.y;
    const readX = -upY;
    const readY = upX;
    const isTopLeftLeft = topLeft.x * readX + topLeft.y * readY <= topRight.x * readX + topRight.y * readY;
    const leftCorner = isTopLeftLeft ? topLeft : topRight;
    const rightCorner = isTopLeftLeft ? topRight : topLeft;
    const turn = `rotate(${Math.atan2(readY, readX)}rad) translate(0, calc(-100% - ${GAP_PX}px))`;

    this.upEl.style.display = showUp ? '' : 'none';
    this.upEl.style.transform = `translate(${leftCorner.x}px, ${leftCorner.y}px) ${turn}`;
    // scaleX(-1) about the origin mirrors the text and lays it to the left of the corner: it ends there.
    this.mirroredEl.style.display = showMirrored ? '' : 'none';
    this.mirroredEl.style.transform = `translate(${rightCorner.x}px, ${rightCorner.y}px) ${turn} scaleX(-1)`;
  }
}
