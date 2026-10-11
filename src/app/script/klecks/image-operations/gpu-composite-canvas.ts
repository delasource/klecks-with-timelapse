import { createCanvas } from '../../bb/base/create-canvas';
import { BB } from '../../bb/bb';
import { TInterpolationAlgorithm } from '../kl-types';

export function webGl2IsSupported(): boolean {
    let webgl2IsSupported = false;
    const canvas = createCanvas();
    try {
        const gl = canvas.getContext('webgl2');
        webgl2IsSupported = gl !== null;
    } catch (_) {
        // noop
    }
    BB.freeCanvas(canvas);
    return webgl2IsSupported;
}

export type TGpuMesh = {
    readonly id: number;
    destroy(): void;
};

export type TGpuTexture = {
    readonly id: number;
    destroy(): void;
};

type TMeshData = {
    id: number;
    vao: WebGLVertexArrayObject;
    positionBuffer: WebGLBuffer;
    texCoordBuffer: WebGLBuffer;
    indexBuffer: WebGLBuffer;
    indexCount: number;
};

type TTextureData = {
    id: number;
    texture: WebGLTexture;
};

/**
 * WebGL2 canvas that can draw textured meshes with alpha blending.
 * - High-quality texture filtering with anisotropic filtering and mipmapping
 * - Multisample antialiasing (MSAA)
 *
 * FxCanvas would need a number of adjustments to do this. So it's its own thing, for now.
 */
export class GpuCompositeCanvas {
    private readonly gl: WebGL2RenderingContext;
    private readonly canvas: HTMLCanvasElement;
    private readonly interpolation: TInterpolationAlgorithm;

    private program: WebGLProgram | null = null;

    private positionLocation: number = -1;
    private texCoordLocation: number = -1;
    private textureLocation: WebGLUniformLocation | null = null;

    private meshes = new Map<number, TMeshData>();
    private textures = new Map<number, TTextureData>();
    private nextMeshId = 1;
    private nextTextureId = 1;

    private anisotropicExtension: EXT_texture_filter_anisotropic | null = null;
    private maxAnisotropy: number = 1;

    private multisampleFramebuffer: WebGLFramebuffer | null = null;
    private multisampleRenderbuffer: WebGLRenderbuffer | null = null;
    private msaaSamples: number = 0;

    private compileShader(source: string, type: number): WebGLShader | null {
        const shader = this.gl.createShader(type);
        if (!shader) {
            return null;
        }
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    private createProgram(): void {
        const vertexShaderSource = `#version 300 es
            in vec2 a_position;
            in vec2 a_texCoord;
            out vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;
        const fragmentShaderSource = `#version 300 es
            precision mediump float;
            in vec2 v_texCoord;
            out vec4 outColor;
            uniform sampler2D u_texture;
            void main() {
                outColor = texture(u_texture, v_texCoord);
            }
        `;
        const vertexShader = this.compileShader(vertexShaderSource, this.gl.VERTEX_SHADER);
        if (!vertexShader) {
            throw new Error('Failed to compile vertex shader');
        }
        const fragmentShader = this.compileShader(fragmentShaderSource, this.gl.FRAGMENT_SHADER);
        if (!fragmentShader) {
            throw new Error('Failed to compile fragment shader');
        }

        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);

        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            console.error('Program link error:', this.gl.getProgramInfoLog(this.program));
            throw new Error('Failed to link program');
        }

        this.gl.deleteShader(vertexShader);
        this.gl.deleteShader(fragmentShader);

        this.gl.useProgram(this.program);
        this.positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
        this.texCoordLocation = this.gl.getAttribLocation(this.program, 'a_texCoord');
        this.textureLocation = this.gl.getUniformLocation(this.program, 'u_texture');
        this.gl.useProgram(null);
    }

    private createMultisampleFramebuffer(): void {
        const gl = this.gl;
        const maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
        this.msaaSamples = Math.min(maxSamples, 8);

        this.multisampleRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.multisampleRenderbuffer);
        gl.renderbufferStorageMultisample(
            gl.RENDERBUFFER,
            this.msaaSamples,
            gl.RGBA8,
            this.canvas.width,
            this.canvas.height,
        );

        this.multisampleFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.multisampleFramebuffer);
        gl.framebufferRenderbuffer(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.RENDERBUFFER,
            this.multisampleRenderbuffer,
        );

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    }

    private detectAnisotropicFiltering(): void {
        // Check for anisotropic filtering extension
        this.anisotropicExtension =
            this.gl.getExtension('EXT_texture_filter_anisotropic') ||
            this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
            this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic');

        if (this.anisotropicExtension) {
            this.maxAnisotropy = this.gl.getParameter(
                this.anisotropicExtension.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
            );
        }
    }

    // ----------------------------------- public -----------------------------------

    constructor(canvas: HTMLCanvasElement, interpolation: TInterpolationAlgorithm = 'smooth') {
        this.canvas = canvas;
        this.interpolation = interpolation;

        const gl = canvas.getContext('webgl2', {
            alpha: true,
            // All textures and framebuffers have premultiplied alpha
            premultipliedAlpha: true,
            // we manually handle MSAA via a framebuffer
            antialias: false,
        });

        if (!gl) {
            throw new Error('WebGL2 not supported');
        }

        // init
        this.gl = gl;
        this.createProgram();
        if (this.interpolation === 'smooth') {
            this.detectAnisotropicFiltering();
            this.createMultisampleFramebuffer();
        }
        // we always want textures with premultiplied alpha
        this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        // we always want blending
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
    }

    /**
     * Creates a mesh (vertex array object)
     * @param positions - x,y positions in clip space top-left: (-1,1), bottom-right: (1,-1)
     * @param texCoords - u,v texture coordinates top-left: (0,0), bottom-right: (1,1)
     * @param indices - indices specifying triangles
     */
    createMesh(positions: number[], texCoords: number[], indices: number[]): TGpuMesh {
        const vao = this.gl.createVertexArray();
        this.gl.bindVertexArray(vao);

        const positionBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(positions), this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(this.positionLocation);
        this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);

        const texCoordBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, texCoordBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(texCoords), this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(this.texCoordLocation);
        this.gl.vertexAttribPointer(this.texCoordLocation, 2, this.gl.FLOAT, false, 0, 0);

        const indexBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        this.gl.bufferData(
            this.gl.ELEMENT_ARRAY_BUFFER,
            new Uint16Array(indices),
            this.gl.STATIC_DRAW,
        );

        const id = this.nextMeshId++;
        this.meshes.set(id, {
            id,
            vao,
            positionBuffer,
            texCoordBuffer,
            indexBuffer,
            indexCount: indices.length,
        });
        return {
            id,
            destroy: () => this.destroyMesh(id),
        };
    }

    destroyMesh(id: number): void {
        const mesh = this.meshes.get(id);
        if (mesh) {
            this.gl.deleteVertexArray(mesh.vao);
            this.gl.deleteBuffer(mesh.positionBuffer);
            this.gl.deleteBuffer(mesh.texCoordBuffer);
            this.gl.deleteBuffer(mesh.indexBuffer);
            this.meshes.delete(id);
        }
    }

    createTexture(source: HTMLImageElement | HTMLCanvasElement | ImageData): TGpuTexture {
        const texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

        if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
            this.gl.texImage2D(
                this.gl.TEXTURE_2D,
                0,
                this.gl.RGBA8,
                this.gl.RGBA,
                this.gl.UNSIGNED_BYTE,
                source,
            );
        } else {
            this.gl.texImage2D(
                this.gl.TEXTURE_2D,
                0,
                this.gl.RGBA8,
                source.width,
                source.height,
                0,
                this.gl.RGBA,
                this.gl.UNSIGNED_BYTE,
                source.data,
            );
        }

        // texture filtering
        if (this.interpolation === 'pixelated') {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        } else {
            this.gl.generateMipmap(this.gl.TEXTURE_2D);
            this.gl.texParameteri(
                this.gl.TEXTURE_2D,
                this.gl.TEXTURE_MIN_FILTER,
                this.gl.LINEAR_MIPMAP_LINEAR,
            );
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
            if (this.anisotropicExtension) {
                this.gl.texParameterf(
                    this.gl.TEXTURE_2D,
                    this.anisotropicExtension.TEXTURE_MAX_ANISOTROPY_EXT,
                    Math.min(this.maxAnisotropy, 8),
                );
            }
        }
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        const id = this.nextTextureId++;
        this.textures.set(id, {
            id,
            texture,
        });
        return {
            id,
            destroy: () => this.destroyTexture(id),
        };
    }

    destroyTexture(id: number): void {
        const texture = this.textures.get(id);
        if (texture) {
            this.gl.deleteTexture(texture.texture);
            this.textures.delete(id);
        }
    }

    clear(): void {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.multisampleFramebuffer ?? null);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    draw(mesh: TGpuMesh, texture: TGpuTexture): void {
        const meshData = this.meshes.get(mesh.id);
        const textureData = this.textures.get(texture.id);
        if (!meshData || !textureData) {
            throw new Error('Invalid mesh or texture');
        }

        // null -> directly onto the canvas
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.multisampleFramebuffer ?? null);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        this.gl.useProgram(this.program);
        this.gl.bindVertexArray(meshData.vao);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, textureData.texture);
        this.gl.uniform1i(this.textureLocation, 0);

        this.gl.drawElements(this.gl.TRIANGLES, meshData.indexCount, this.gl.UNSIGNED_SHORT, 0);
    }

    present(): void {
        if (!this.multisampleFramebuffer) {
            // pixelated: already drew directly to canvas
            return;
        }
        // Resolve the multisample FBO to the canvas by blitting.
        const gl = this.gl;
        const w = this.canvas.width;
        const h = this.canvas.height;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.multisampleFramebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null); // canvas
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    isContextLost(): boolean {
        // Yes, every browser supports this for WebGL2RenderingContext.
        return this.gl.isContextLost();
    }

    destroy(): void {
        for (const [id] of this.meshes) {
            this.destroyMesh(id);
        }
        for (const [id] of this.textures) {
            this.destroyTexture(id);
        }
        if (this.multisampleFramebuffer) {
            this.gl.deleteFramebuffer(this.multisampleFramebuffer);
            this.multisampleFramebuffer = null;
        }
        if (this.multisampleRenderbuffer) {
            this.gl.deleteRenderbuffer(this.multisampleRenderbuffer);
            this.multisampleRenderbuffer = null;
        }
        if (this.program) {
            this.gl.deleteProgram(this.program);
        }
        BB.freeCanvas(this.canvas);
    }
}
