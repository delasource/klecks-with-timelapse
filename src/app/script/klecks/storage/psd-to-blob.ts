import type { Psd } from 'ag-psd/dist/psd';
import { loadAgPsd } from './load-ag-psd';

export async function psdToBlob(psd: Psd): Promise<Blob> {
    const agPsd = await loadAgPsd();
    const buffer = agPsd.writePsdBuffer(psd);
    // (a copy as Uint8Array: with Node's types in the program, a Buffer is no BlobPart)
    return new Blob([new Uint8Array(buffer)], { type: 'image/vnd.adobe.photoshop' });
}
