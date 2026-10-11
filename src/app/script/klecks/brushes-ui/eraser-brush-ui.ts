import { getIconSvg } from '../../icon/icon';
import { BB } from '../../bb/bb';
import { BRUSHES } from '../brushes/brushes';
import { EVENT_RES_MS } from './brushes-consts';
import { KlSlider } from '../ui/components/kl-slider';
import { createPenPressureToggle } from '../ui/components/create-pen-pressure-toggle';
import { Checkbox } from '../ui/components/checkbox';
import { TBrushUi } from '../kl-types';
import { LANG, LANGUAGE_STRINGS } from '../../language/language';
import { EraserBrush, TEraserBrushConfig } from '../brushes/eraser-brush';

export const eraserBrushUi = (function () {
    const brushInterface = {
        image: getIconSvg('brush-eraser'),
        tooltip: LANG('eraser') + ' [E]',
        sizeSlider: {
            min: 0.5,
            max: 200,
            exponent: 2,
            displayScale: 2, // radius displayed as diameter
            decimals: 'adaptive',
        },
        opacitySlider: {
            min: 1 / 100,
            max: 1,
            displayScale: 100,
        },
    } as TBrushUi<EraserBrush>;

    LANGUAGE_STRINGS.subscribe(() => {
        brushInterface.tooltip = LANG('eraser') + ' [E]';
    });

    brushInterface.Ui = function (p) {
        const div = document.createElement('div'); // the gui
        const brush = new BRUSHES.EraserBrush();
        brush.setHistory(p.klHistory);
        p.onSizeChange(brush.getSize());

        let sizeSlider: KlSlider;
        let opacitySlider: KlSlider;
        let isTransparentBg = false;
        let transparencyToggle: Checkbox;
        let pressureSizeToggle: HTMLElement;
        let pressureOpacityToggle: HTMLElement;

        function setSize(size: number) {
            brush.setSize(size);
        }

        function init() {
            sizeSlider = new KlSlider({
                label: LANG('brush-size'),
                width: 225,
                height: 30,
                ...brushInterface.sizeSlider,
                value: 30,
                eventResMs: EVENT_RES_MS,
                onChange: (val) => {
                    setSize(val);
                    p.onSizeChange(val);
                },
            });
            opacitySlider = new KlSlider({
                label: LANG('opacity'),
                width: 225,
                height: 30,
                ...brushInterface.opacitySlider,
                value: brushInterface.opacitySlider.max,
                eventResMs: EVENT_RES_MS,
                onChange: (val) => {
                    brush.setOpacity(val);
                    p.onOpacityChange(val);
                },
            });

            pressureSizeToggle = createPenPressureToggle(true, function (b) {
                brush.sizePressure(b);
            });
            pressureOpacityToggle = createPenPressureToggle(false, function (b) {
                brush.opacityPressure(b);
            });

            div.append(
                BB.el({
                    content: [sizeSlider.getElement(), pressureSizeToggle],
                    css: {
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 10,
                    },
                }),
                BB.el({
                    content: [opacitySlider.getElement(), pressureOpacityToggle],
                    css: {
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    },
                }),
            );

            transparencyToggle = new Checkbox({
                init: false,
                label: LANG('brush-eraser-transparent-bg'),
                callback: function (b) {
                    isTransparentBg = b;
                    brush.setTransparentBG(b);
                },
                css: {
                    marginTop: 10,
                },
                name: 'transparency-toggle',
            });
            div.append(transparencyToggle.getElement());
        }

        init();

        this.increaseSize = function (f) {
            if (!brush.isDrawing()) {
                sizeSlider.changeSliderValue(f);
            }
        };
        this.decreaseSize = function (f) {
            if (!brush.isDrawing()) {
                sizeSlider.changeSliderValue(-f);
            }
        };
        this.getSize = function () {
            return brush.getSize();
        };
        this.setSize = function (size) {
            setSize(size);
            sizeSlider.setValue(size);
        };
        this.getOpacity = function () {
            return brush.getOpacity();
        };
        this.setOpacity = function (opacity) {
            brush.setOpacity(opacity);
            opacitySlider.setValue(opacity);
        };
        this.setColor = function () {};

        this.setLayer = function (layer) {
            brush.setLayer(layer);
        };
        this.startLine = function (x, y, p) {
            brush.startLine(x, y, p);
        };
        this.goLine = function (x, y, p) {
            brush.goLine(x, y, p);
        };
        this.endLine = function () {
            brush.endLine();
        };
        this.getBrush = function () {
            return brush;
        };
        this.getIsTransparentBg = function () {
            return isTransparentBg;
        };
        this.isDrawing = function () {
            return brush.isDrawing();
        };
        this.getElement = function () {
            return div;
        };
        this.getBrushConfig = function () {
            return brush.getBrushConfig();
        };
        this.setBrushConfig = function (config: TEraserBrushConfig) {
            brush.setBrushConfig(config);

            // Update UI components to match brush state
            if (config.size !== undefined) {
                sizeSlider.setValue(config.size);
            }
            if (config.opacity !== undefined) {
                opacitySlider.setValue(config.opacity);
            }
            if (config.transparentBg !== undefined) {
                isTransparentBg = config.transparentBg;
                transparencyToggle.setValue(config.transparentBg);
            }
            // TODO: sizePressure, opacityPressure
            // Above variable is of type `HTMLElement` and should be of type `BoxToggle`
        };
    } as TBrushUi<EraserBrush>['Ui'];

    return brushInterface;
})();
