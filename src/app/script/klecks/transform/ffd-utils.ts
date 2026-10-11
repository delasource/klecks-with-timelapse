// returns bounds of mesh that ffd lattice would create
import { TCoordinateBounds, TIndexBounds } from '../../bb/bb-types';
import { coordinateBoundsToIndexBounds, indexBoundsInArea } from '../../bb/math/math';
import { RENDERED_FFD_MESH_RESOLUTION } from './composed-transformation';
import { createFfdMesh, TFfdLattice, TFfdMesh } from './ffd';

function getFfdMeshBounds(mesh: TFfdMesh): TCoordinateBounds {
    const { vertices } = mesh;

    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;

    for (let i = 0; i < vertices.length; i += 2) {
        x1 = Math.min(x1, vertices[i]);
        y1 = Math.min(y1, vertices[i + 1]);
        x2 = Math.max(x2, vertices[i]);
        y2 = Math.max(y2, vertices[i + 1]);
    }
    // round bernstein floating point errors
    const precision = 1e6;
    return {
        type: 'coordinate',
        x1: Math.round(x1 * precision) / precision,
        y1: Math.round(y1 * precision) / precision,
        x2: Math.round(x2 * precision) / precision,
        y2: Math.round(y2 * precision) / precision,
    };
}

// returns bounds of mesh that ffd lattice would create
export function getFfdBounds(ffd: TFfdLattice): TCoordinateBounds {
    // Use a dummy canvas size of 1x1 since we request canvas space — the actual
    // canvas dimensions don't matter here because useCanvasSpace bypasses the
    // NDC conversion entirely.
    const mesh = createFfdMesh(
        RENDERED_FFD_MESH_RESOLUTION,
        RENDERED_FFD_MESH_RESOLUTION,
        ffd,
        1,
        1,
        true,
    );
    return getFfdMeshBounds(mesh);
}

export function getFfdMeshBoundsInArea(
    mesh: TFfdMesh,
    width: number,
    height: number,
): TIndexBounds | undefined {
    const ffdBounds = coordinateBoundsToIndexBounds(getFfdMeshBounds(mesh));
    return indexBoundsInArea(ffdBounds, width, height);
}
