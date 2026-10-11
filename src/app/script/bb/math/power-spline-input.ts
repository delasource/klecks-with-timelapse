import { TSplineInputPoints } from './line';

/**
 * input for a spline, following curve of a power function x^n [0 - 1]
 * returns [[0, startVal], ..., [1, endVal]]
 *
 * Was part of line.ts until upstream dropped it with Klecks 0.10.5 (its sliders map their values
 * differently now, slider-value-mapping.ts). The headless entry point still exports it: the
 * sliders of the application around it are built on it.
 */
export function powerSplineInput(
    startVal: number,
    endVal: number,
    stepSize: number,
    exponent: number = 2,
): TSplineInputPoints {
    function round(v: number, dec: number): number {
        return Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec);
    }

    const resultArr: TSplineInputPoints = [];
    for (let i = 0; i <= 1; i += stepSize) {
        resultArr.push([
            round(i, 4),
            round(startVal + Math.pow(i, exponent) * (endVal - startVal), 4),
        ]);
    }
    return resultArr;
}
