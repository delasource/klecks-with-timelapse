import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import dts from 'rollup-plugin-dts';
import json from '@rollup/plugin-json';
import image from '@rollup/plugin-image';
import scss from 'rollup-plugin-scss';
import { string } from 'rollup-plugin-string';
import terser from '@rollup/plugin-terser';

const config = [
  {
    input: 'src/headless.ts',
    output: {
      file: 'dist/headless.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true,
    },
    plugins: [
      resolve({
        browser: false,
        preferBuiltins: false,
      }),
      commonjs(),
      json(),
      image({
        include: ['**/*.svg', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.woff2'],
        limit: 8192, // embed all small assets
      }),
      scss({
        output: 'dist/styles.css',
        outputStyle: 'compressed',
        fileName: 'styles.css',
        modules: {
          auto: true,
          localsConvention: 'camelCase'
        },
      }),
      string({
        include: '**/*.glsl',
      }),
      terser(),
      typescript({
        tsconfig: './tsconfig.build.json',
        declaration: false,
      }),
    ],
    external: [
      'buffer',
      'transformation-matrix',
      'ag-psd',
      'polygon-clipping',
      'json5',
      'js-beautify',
      'mdn-polyfills',
    ],
  },
  // Type definitions
  {
    input: 'src/headless.ts',
    output: {
      file: 'dist/headless.d.ts',
      format: 'es',
    },
    plugins: [dts()],
  }
];

export default config;
