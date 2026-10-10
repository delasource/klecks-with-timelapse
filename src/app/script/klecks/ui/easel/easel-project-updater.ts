import { KlCanvas } from '../../canvas/kl-canvas';
import { Easel } from './easel';
import { BB } from '../../../bb/bb';
import { throwIfNull } from '../../../bb/base/base';
import { ReferenceOverlay } from './reference-overlay';
import { TProjectViewportProject } from '../project-viewport/project-viewport';

export type TEaselProjectUpdaterParams<T extends string> = {
  klCanvas: KlCanvas;
  easel: Easel<T>;
  overlay?: ReferenceOverlay; // a reference picture, shown with the layers without being one
};

/**
 * Allows KlCanvas to be rendered by Easel.
 * Call update when KlCanvas changed (added layer, moved layer, removed layer, changed selection, redo/undo)
 */
export class EaselProjectUpdater<T extends string> {
  private readonly klCanvas: KlCanvas;
  private readonly easel: Easel<T>;
  private readonly overlay: ReferenceOverlay | undefined;
  private readonly compositeCanvas = BB.canvas(1, 1);

  // ----------------------------------- public -----------------------------------
  constructor(p: TEaselProjectUpdaterParams<T>) {
    this.klCanvas = p.klCanvas;
    this.easel = p.easel;
    this.overlay = p.overlay;
    this.update();
  }

  update(): void {
    const width = this.klCanvas.getWidth();
    const height = this.klCanvas.getHeight();
    const layers: TProjectViewportProject['layers'] = this.klCanvas.getLayersFast().map(layer => {
      return {
        image: layer.compositeObj
          ? () => {
              if (this.compositeCanvas.width != width || this.compositeCanvas.height != height) {
                this.compositeCanvas.width = width;
                this.compositeCanvas.height = height;
              }
              const ctx = this.compositeCanvas.getContext('2d')!;
              ctx.clearRect(0, 0, width, height);
              ctx.drawImage(layer.canvas, 0, 0);
              layer.compositeObj?.draw(throwIfNull(this.compositeCanvas.getContext('2d')));
              return this.compositeCanvas;
            }
          : layer.canvas,
        isVisible: layer.isVisible,
        opacity: layer.opacity,
        mixModeStr: layer.mixModeStr,
        hasClipping: false,
      };
    });

    // The reference overlay exists in this list only — KlCanvas, the history and the recorder never
    // see it, which is what keeps it out of every replay, video and export.
    const overlayLayer = this.overlay?.getViewportLayer();
    if (overlayLayer) {
      if (this.overlay!.getState().placement === 'front') {
        layers.push(overlayLayer);
      } else {
        layers.unshift(overlayLayer);
      }
    }

    this.easel.setProject({
      width,
      height,
      layers,
      selection: this.klCanvas.getSelection(),
    });
  }

  // if you're not rendering easel for a while
  freeCompositeCanvas(): void {
    this.compositeCanvas.width = 1;
    this.compositeCanvas.height = 1;
  }
}
