export type TFreeTransform = {
    x: number; // center of transform region. image space
    y: number;
    width: number; // size of transform region. image space
    height: number;
    angleDeg: number; // angle of transform region. degrees
};
