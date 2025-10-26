import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import dts from 'rollup-plugin-dts';
import json from '@rollup/plugin-json';

const config = [
  // ES Module build
  {
    input: 'src/headless.ts',
    output: {
      file: 'dist/index.js',
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
      // Externalize all asset files that Rollup can't process
      /^url:/,
      /\.scss$/,
      /\.css$/,
      /\.glsl$/,
      /\.woff2?$/,
      /\.svg$/,
      /\.png$/,
      /\.gif$/,
      /\.jpg$/,
      /\.jpeg$/,
      /\.json$/,
    ],
    onwarn: (warning, warn) => {
      if (warning.code === 'UNRESOLVED_IMPORT') return;
      warn(warning);
    },
  },
  // Type definitions
  {
    input: 'src/headless.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es',
    },
    plugins: [dts()],
  },
  // UMD build for compatibility
  {
    input: 'src/headless.ts',
    output: {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'KlecksHeadlessApp',
      sourcemap: true,
      globals: {
        'buffer': 'Buffer',
        'transformation-matrix': 'Transform',
      },
      inlineDynamicImports: true,
    },
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: false,
      }),
      commonjs(),
      json(),
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
      // Externalize all asset files that Rollup can't process
      /^url:/,
      /\.scss$/,
      /\.css$/,
      /\.glsl$/,
      /\.woff2?$/,
      /\.svg$/,
      /\.png$/,
      /\.gif$/,
      /\.jpg$/,
      /\.jpeg$/,
      /\.json$/,
    ],
    onwarn: (warning, warn) => {
      // Only suppress UNRESOLVED_IMPORT for known external dependencies
      if (warning.code === 'UNRESOLVED_IMPORT') return;
      warn(warning);
    },
  },
];

export default config;
