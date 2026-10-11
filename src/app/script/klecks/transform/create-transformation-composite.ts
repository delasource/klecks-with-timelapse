import {
    freeTransformToMatrix,
    TComposedTransformation,
    transformFfd,
} from './composed-transformation';
import { MultiPolygon } from 'polygon-clipping';
import { TInterpolationAlgorithm } from '../kl-types';
import { TLayerComposite } from '../canvas/kl-canvas';
import { getSelectionPath2d } from '../../bb/multi-polygon/get-selection-path-2d';
import {
    getSelectionBoundsFromSample,
    getSelectionSampleBoundsMultiPolygon,
} from './get-selection-sample-bounds';
import { rectToBounds } from '../../bb/math/math';
import { setContextAlgorithm } from '../utils/set-context-algorithm';
import { FfdRenderer } from './ffd-renderer';
import { TSelectionSample } from './selection-sample';
import { matrixToTuple } from '../../bb/math/matrix-to-tuple';

export function createTransformationComposite(
    config: {
        klCanvasWidth: number;
        klCanvasHeight: number;
        transform: TComposedTransformation;
        selection?: MultiPolygon;
        selectionSample: TSelectionSample;
        algorithm: TInterpolationAlgorithm;
        backgroundIsTransparent: boolean;
        doClone: boolean;
        ffdRenderer: FfdRenderer;
    },
    // "same" when (source layer === destination layer)
    layer: 'same' | 'src' | 'dest',
): TLayerComposite {
    const selectionPath = getSelectionPath2d(
        config.selection ?? getSelectionSampleBoundsMultiPolygon(config.selectionSample),
    );
    const erase = (ctx: CanvasRenderingContext2D) => {
        if (!config.doClone && (layer === 'same' || layer === 'src')) {
            // erase
            ctx.save();
            ctx.clip(selectionPath);
            if (config.backgroundIsTransparent) {
                ctx.clearRect(0, 0, config.klCanvasWidth, config.klCanvasHeight);
            } else {
                // fastest in firefox like so
                ctx.globalCompositeOperation = 'source-atop';
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, config.klCanvasWidth, config.klCanvasHeight);
            }
            ctx.restore();
        }
    };

    // ffd
    if (config.transform.type === 'ffd' || config.transform.type === 'ffd+free') {
        let ffd = config.transform.ffd;
        if (config.transform.type === 'ffd+free') {
            // apply further free transform
            ffd = transformFfd(
                ffd,
                freeTransformToMatrix(
                    config.transform.freeTransform,
                    rectToBounds(config.transform.ffdBounds, 'index'),
                ),
            );
        }

        return {
            draw: (ctx: CanvasRenderingContext2D) => {
                ctx.save();
                erase(ctx);
                if (layer === 'same' || layer === 'dest') {
                    config.ffdRenderer.render({
                        ffdLattice: ffd,
                        selectionSample: config.selectionSample,
                        algorithm: config.algorithm,
                        outputWidth: config.klCanvasWidth,
                        outputHeight: config.klCanvasHeight,
                    });
                    const outputCanvas = config.ffdRenderer.getCanvas();
                    outputCanvas && ctx.drawImage(outputCanvas, 0, 0);
                }
                ctx.restore();
            },
        } as any;
    }

    // free transform
    const selectionBounds = getSelectionBoundsFromSample(config.selectionSample);
    const transformMatrix = freeTransformToMatrix(config.transform.freeTransform, selectionBounds);
    return {
        draw: (ctx: CanvasRenderingContext2D) => {
            ctx.save();
            erase(ctx);
            if (layer === 'same' || layer === 'dest') {
                setContextAlgorithm(ctx, config.algorithm);
                ctx.setTransform(...matrixToTuple(transformMatrix));
                ctx.drawImage(
                    config.selectionSample.image,
                    config.selectionSample.x,
                    config.selectionSample.y,
                );
            }
            ctx.restore();
        },
    } as any;
}
