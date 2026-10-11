import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lets Vite (and Vitest) bundle Klecks' sources as they are.
 *
 * Klecks is written for Parcel, and two of its import conventions mean nothing to Vite:
 *
 * - `import img from 'url:/src/app/img/x.png'` / `'url:./font.woff2'` — Parcel's "give me the URL
 *   of this file". A specifier that starts with `/src/` is relative to the root of this
 *   repository, any other to the importing file. Vite answers a plain import of such a file with
 *   its URL already, so the prefix only has to go.
 * - `import shader from './x.glsl'` — the file's text.
 *
 * An application that imports `src/headless.ts` puts this plugin into its Vite configuration.
 * The sources then need no changes for it, which is what keeps a merge of upstream small.
 *
 * (Typed loosely on purpose: this repository does not depend on Vite.)
 */
export function klecksImports(): {
    name: string;
    enforce: 'pre';
    resolveId: (source: string, importer?: string) => string | null;
    load: (id: string) => string | null;
} {
    const root = dirname(fileURLToPath(import.meta.url));
    return {
        name: 'klecks-imports',
        enforce: 'pre',
        resolveId(source, importer) {
            if (!source.startsWith('url:')) {
                return null;
            }
            const path = source.slice('url:'.length);
            if (path.startsWith('/src/')) {
                return resolve(root, '.' + path);
            }
            return importer ? resolve(dirname(importer.split('?')[0]), path) : null;
        },
        load(id) {
            const file = id.split('?')[0];
            if (!file.endsWith('.glsl') || id.includes('?')) {
                return null;
            }
            return 'export default ' + JSON.stringify(readFileSync(file, 'utf8')) + ';';
        },
    };
}
