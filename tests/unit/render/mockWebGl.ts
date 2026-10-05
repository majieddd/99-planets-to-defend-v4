import { WebGLRenderer } from 'three';

/**
 * A WebGL2 context that draws nothing but records every shader source three hands it, so a unit test can run three's
 * real WebGLRenderer, which decides the program defines (WebGLPrograms.getParameters) and resolves every chunk, and read
 * the GLSL a GPU would compile. Constants are numbered on first use, reports and compiles succeed, and a program has
 * no active uniforms or attributes, so three uploads nothing.
 */
export interface MockGl {
  renderer: WebGLRenderer;
  /** Every vertex and fragment source passed to shaderSource, in order. */
  sources: string[];
  /** The vertex shaders among them: three's vertex prefix declares the position attribute. */
  vertexSources(): string[];
}

export function createMockRenderer(): MockGl {
  const sources: string[] = [];
  const constants = new Map<string, number>();
  const names = new Map<number, string>();
  const constant = (name: string): number => {
    let value = constants.get(name);
    if (value === undefined) {
      value = 0x8000 + constants.size;
      constants.set(name, value);
      names.set(value, name);
    }
    return value;
  };
  const listeners = () => undefined;
  const canvas = { width: 1, height: 1, style: {}, addEventListener: listeners, removeEventListener: listeners, setAttribute: listeners };
  const impl: Record<string, unknown> = {
    canvas,
    drawingBufferWidth: 1,
    drawingBufferHeight: 1,
    getContextAttributes: () => ({ alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false }),
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getParameter: (parameter: number) => {
      const name = names.get(parameter) ?? '';
      if (name === 'VERSION') return 'WebGL 2.0';
      if (name === 'SHADING_LANGUAGE_VERSION') return 'WebGL GLSL ES 3.00';
      if (name === 'VIEWPORT' || name === 'SCISSOR_BOX') return new Int32Array([0, 0, 1, 1]);
      if (name.startsWith('MAX_')) return 4096;
      if (name === 'VENDOR' || name === 'RENDERER') return 'mock';
      return 0;
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    shaderSource: (_shader: unknown, source: string) => {
      sources.push(source);
    },
    getShaderParameter: () => true,
    getProgramParameter: (_program: unknown, parameter: number) => {
      const name = names.get(parameter);
      return name === 'ACTIVE_UNIFORMS' || name === 'ACTIVE_ATTRIBUTES' ? 0 : true;
    },
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getUniformLocation: () => null,
    getAttribLocation: () => -1,
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    isContextLost: () => false,
    getError: () => 0,
  };
  const context = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string') return undefined;
        if (property in impl) return impl[property];
        if (/^[A-Z][A-Z0-9_]*$/.test(property)) return constant(property);
        // create* hands back a fresh handle; everything else is a draw or state call with nothing to return.
        return property.startsWith('create') ? () => ({}) : () => undefined;
      },
    },
  );
  const renderer = new WebGLRenderer({ canvas: canvas as unknown as HTMLCanvasElement, context: context as WebGL2RenderingContext });
  return {
    renderer,
    sources,
    vertexSources: () => sources.filter((source) => source.includes('attribute vec3 position;')),
  };
}
