import { getIconSvg } from '../../icon/icon';
import { BB } from '../../bb/bb';
import { createPenPressureToggle } from '../ui/components/create-pen-pressure-toggle';
import { EVENT_RES_MS } from './brushes-consts';
import { createLockAlphaToggle } from '../ui/components/create-brush-toggles';
import { BoxToggle } from '../ui/components/box-toggle';
import { BRUSHES } from '../brushes/brushes';
import { KlSlider } from '../ui/components/kl-slider';
import { TBrushUi } from '../kl-types';
import { LANG, LANGUAGE_STRINGS } from '../../language/language';
import { BlendBrush, TBlendBrushConfig } from '../brushes/blend-brush';

export const blendBrushUi = (function () {
    const brushInterface = {
        image: getIconSvg('brush-blend'),
        tooltip: LANG('brush-blend'),
        sizeSlider: {
            min: 0.5,
            max: 100,
            exponent: 2,
            displayScale: 2, // radius displayed as diameter
            decimals: 'adaptive',
        },
        opacitySlider: {
            min: 1 / 100,
            max: 1,
            displayScale: 100,
        },
    } as TBrushUi<BlendBrush>;

    LANGUAGE_STRINGS.subscribe(() => {
        brushInterface.tooltip = LANG('brush-blend');
    });

    brushInterface.Ui = function (p) {
        const div = document.createElement('div'); // the gui
        const brush = new BRUSHES.BlendBrush();
        brush.setHistory(p.klHistory);
        p.onSizeChange(brush.getSize());

        let sizeSlider: KlSlider;
        let opacitySlider: KlSlider;
        let blendingSlider: KlSlider;
        let pressureSizeToggle: HTMLElement;
        let pressureOpacityToggle: HTMLElement;
        let lockAlphaToggle: BoxToggle;

        function setSize(size: number): void {
            brush.setSize(size);
        }

        function init() {
            sizeSlider = new KlSlider({
                label: LANG('brush-size'),
                width: 225,
                height: 30,
                ...brushInterface.sizeSlider,
                value: 58,
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
                value: brush.getOpacity(),
                eventResMs: EVENT_RES_MS,
                onChange: (val) => {
                    brush.setOpacity(val);
                    p.onOpacityChange(val);
                },
            });
            blendingSlider = new KlSlider({
                label: LANG('brush-blending'),
                width: 225,
                height: 30,
                min: 0,
                max: 1,
                displayScale: 100,
                value: brush.getBlending(),
                eventResMs: EVENT_RES_MS,
                onChange: function (val) {
                    brush.setBlending(val);
                },
            });
            blendingSlider.getElement().style.marginTop = '10px';

            pressureSizeToggle = createPenPressureToggle(true, function (b) {
                brush.setSizePressure(b);
            });
            pressureOpacityToggle = createPenPressureToggle(false, function (b) {
                brush.setOpacityPressure(b);
            });

            lockAlphaToggle = createLockAlphaToggle(brush.getLockAlpha(), (b) => {
                brush.setLockAlpha(b);
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
                blendingSlider.getElement(),
                BB.el({
                    content: lockAlphaToggle.getElement(),
                    css: {
                        display: 'flex',
                        marginTop: 10,
                    },
                }),
            );
        }

        init();

        this.increaseSize = function (f) {
            if (!brush.getIsDrawing()) {
                sizeSlider.changeSliderValue(f);
            }
        };
        this.decreaseSize = function (f) {
            if (!brush.getIsDrawing()) {
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

        this.setColor = function (c) {
            brush.setColor(c);
        };
        this.setLayer = function (layer) {
            brush.setLayer(layer);
        };
        this.startLine = function (x, y, p) {
            brush.startLine(x, y, p);
        };
        this.goLine = function (x, y, p, isCoalesced) {
            brush.goLine(x, y, p, false); // looks weird with isCoalesced
        };
        this.endLine = function () {
            brush.endLine();
        };
        this.getBrush = function () {
            return brush;
        };
        this.isDrawing = function () {
            return brush.getIsDrawing();
        };
        this.getElement = function () {
            return div;
        };
        this.getBrushConfig = function () {
            return brush.getBrushConfig();
        };
        this.setBrushConfig = function (config: TBlendBrushConfig) {
            brush.setBrushConfig(config);

            // Update UI components to match brush state
            if (config.size !== undefined) {
                sizeSlider.setValue(config.size);
            }
            if (config.opacity !== undefined) {
                opacitySlider.setValue(config.opacity);
            }
            if (config.blending !== undefined) {
                blendingSlider.setValue(config.blending);
            }
            if (config.lockLayerAlpha !== undefined) {
                lockAlphaToggle.setValue(config.lockLayerAlpha);
            }
            // TODO: sizePressure, opacityPressure
            // Above variable is of type `HTMLElement` and should be of type `BoxToggle`
        };
    } as TBrushUi<BlendBrush>['Ui'];

    return brushInterface;
})();
