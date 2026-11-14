/**
 * ColorMari: the dice of a stroke.
 *
 * Some brushes roll dice while they draw (the pen's scatter, chemy's distort, the sketchy brush's
 * lines between points). A stroke is recorded as its points and replayed by drawing them again:
 * with `Math.random()` every replay rolled other dice and drew another stroke - the scatter of a
 * pen came out different in every pixel. So every stroke gets a seed, recorded with it, and those
 * brushes draw from a generator started with that seed - live and in every replay.
 */

/** A seed for a new stroke: a whole number below a million (the sketchy brush counts on from it). */
export function createStrokeSeed(): number {
    return Math.floor(Math.random() * 1_000_000);
}

/**
 * Random numbers in [0, 1) from a seed, the same in every browser (mulberry32: integer arithmetic
 * only, nothing that a JavaScript engine may round its own way).
 */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
