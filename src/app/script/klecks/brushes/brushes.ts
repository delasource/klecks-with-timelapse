import { PenBrush, TPenBrushConfig } from './pen-brush';
import { BlendBrush, TBlendBrushConfig } from './blend-brush';
import { SketchyBrush, TSketchyBrushConfig } from './sketchy-brush';
import { PixelBrush, TPixelBrushConfig } from './pixel-brush';
import { ChemyBrush, TChemyBrushConfig } from './chemy-brush';
import { SmudgeBrush, TSmudgeBrushConfig } from './smudge-brush';
import { EraserBrush, TEraserBrushConfig } from './eraser-brush';

export const BRUSHES = {
    PenBrush,
    SketchyBrush,
    PixelBrush,
    ChemyBrush,
    BlendBrush,
    SmudgeBrush,
    EraserBrush,
};

export type TBrushClassTypes =
    PenBrush
    | BlendBrush
    | SketchyBrush
    | PixelBrush
    | ChemyBrush
    | SmudgeBrush
    | EraserBrush;


export type TBrushConfigTypes =
    TPenBrushConfig
    | TBlendBrushConfig
    | TSketchyBrushConfig
    | TPixelBrushConfig
    | TChemyBrushConfig
    | TSmudgeBrushConfig
    | TEraserBrushConfig;
