/**
 * ColorMari: snapping of the scale in FreeTransform (fork file).
 *
 * The handles already pull the rectangle to the edges of the drawing and the angle to 45° steps.
 * With a base size (what the rectangle measured before it was transformed - the bounds of the
 * selection) they also pull its size to these factors of it, like a magnet: a size this close
 * (in pixels of the screen) to one of them becomes that one.
 */
export const SCALE_SNAP_FACTORS: readonly number[] = [0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export type TScaleSnapBase = {
    width: number;
    height: number;
};

/**
 * The factor of base that size is to be pulled to, or undefined if none is within maxDist.
 * Sign of size is ignored (a negative width is a mirrored one).
 *
 * @param size - image space
 * @param base - image space, > 0
 * @param maxDist - image space
 */
export function findScaleSnapFactor(
    size: number,
    base: number,
    maxDist: number,
): { factor: number; dist: number } | undefined {
    if (!(base > 0)) {
        return undefined;
    }
    let best: { factor: number; dist: number } | undefined;
    for (const factor of SCALE_SNAP_FACTORS) {
        const dist = Math.abs(Math.abs(size) - factor * base);
        if (dist < maxDist && (!best || dist < best.dist)) {
            best = { factor, dist };
        }
    }
    return best;
}

/**
 * size pulled to factor · base, keeping its sign. Whole pixels where the rectangle sits on the
 * pixel grid (angle a multiple of 90°), as FreeTransform keeps it there.
 */
export function scaledSize(
    size: number,
    base: number,
    factor: number,
    wholePixels: boolean,
): number {
    let result = factor * base;
    if (wholePixels) {
        result = Math.max(1, Math.round(result));
    }
    return size < 0 ? -result : result;
}
