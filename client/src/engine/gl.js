// Thin WebGL2 helpers: programs with reflected uniforms, render targets, textures.

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    desynchronized: false,
  });
  if (!gl) return null;
  const caps = {
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    colorBufferHalfFloat: !!gl.getExtension('EXT_color_buffer_half_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    aniso: gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic'),
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxArrayLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),
    renderer: '',
  };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (dbg) caps.renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
  caps.maxAniso = caps.aniso ? gl.getParameter(caps.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
  gl.caps = caps;
  return gl;
}

function compile(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    console.error(`[shader ${name}] compile error\n${log}\n${numbered}`);
    throw new Error(`Shader compile failed: ${name}: ${log}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vs, fs, defines = {}, name = 'program') {
    this.gl = gl;
    this.name = name;
    const header = '#version 300 es\n' + Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`).join('\n') + '\n';
    const v = compile(gl, gl.VERTEX_SHADER, header + vs, name + '.vs');
    const f = compile(gl, gl.FRAGMENT_SHADER, header + fs, name + '.fs');
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      throw new Error(`Program link failed: ${name}: ${log}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    this.program = p;
    this.uniforms = new Map();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      let uname = info.name;
      if (uname.endsWith('[0]')) uname = uname.slice(0, -3);
      this.uniforms.set(uname, { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size });
    }
    this.texUnit = 0;
  }
  use() {
    this.gl.useProgram(this.program);
    this.texUnit = 0;
    return this;
  }
  has(name) {
    return this.uniforms.has(name);
  }
  set(name, value) {
    const u = this.uniforms.get(name);
    if (!u) return this;
    const gl = this.gl;
    switch (u.type) {
      case gl.FLOAT:
        if (typeof value === 'number') gl.uniform1f(u.loc, value);
        else gl.uniform1fv(u.loc, value);
        break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, value); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, value); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, value); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, value); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, value); break;
      case gl.INT:
      case gl.BOOL:
        if (typeof value === 'number' || typeof value === 'boolean') gl.uniform1i(u.loc, +value);
        else gl.uniform1iv(u.loc, value);
        break;
      default:
        gl.uniform1i(u.loc, value);
    }
    return this;
  }
  // Bind a texture to the next free unit and point the sampler at it.
  tex(name, texture, target) {
    const u = this.uniforms.get(name);
    if (!u) return this;
    const gl = this.gl;
    const unit = this.texUnit++;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target || gl.TEXTURE_2D, texture);
    gl.uniform1i(u.loc, unit);
    return this;
  }
}

export function createTexture2D(gl, w, h, opts = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const internal = opts.internal ?? gl.RGBA8;
  const format = opts.format ?? gl.RGBA;
  const type = opts.type ?? gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, opts.data ?? null);
  const filter = opts.filter ?? gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mipmap ? gl.LINEAR_MIPMAP_LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  const wrap = opts.wrap ?? gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (opts.compare) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  }
  if (opts.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

export function textureFromCanvas(gl, canvas, opts = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opts.flipY !== false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const wrap = opts.wrap ?? gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (gl.caps.aniso) gl.texParameterf(gl.TEXTURE_2D, gl.caps.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.caps.maxAniso));
  return t;
}

// Render target with any number of color attachments and an optional depth texture.
export class RenderTarget {
  constructor(gl, w, h, opts = {}) {
    this.gl = gl;
    this.opts = opts;
    this.fbo = gl.createFramebuffer();
    this.colors = [];
    this.depth = null;
    this.resize(w, h);
  }
  resize(w, h) {
    const gl = this.gl;
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    for (const c of this.colors) gl.deleteTexture(c);
    if (this.depth) gl.deleteTexture(this.depth);
    this.colors = [];
    this.depth = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const colorSpecs = this.opts.colors ?? [{}];
    const drawBuffers = [];
    colorSpecs.forEach((spec, i) => {
      const t = createTexture2D(gl, w, h, {
        internal: spec.internal ?? gl.RGBA8,
        format: spec.format ?? gl.RGBA,
        type: spec.type ?? gl.UNSIGNED_BYTE,
        filter: spec.filter ?? gl.LINEAR,
      });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      this.colors.push(t);
      drawBuffers.push(gl.COLOR_ATTACHMENT0 + i);
    });
    if (colorSpecs.length) gl.drawBuffers(drawBuffers);
    else {
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
    }
    if (this.opts.depth) {
      this.depth = createTexture2D(gl, w, h, {
        internal: gl.DEPTH_COMPONENT24,
        format: gl.DEPTH_COMPONENT,
        type: gl.UNSIGNED_INT,
        filter: this.opts.depthCompare ? gl.LINEAR : gl.NEAREST,
        compare: !!this.opts.depthCompare,
      });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    this.complete = status === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }
  get color() {
    return this.colors[0];
  }
  dispose() {
    const gl = this.gl;
    for (const c of this.colors) gl.deleteTexture(c);
    if (this.depth) gl.deleteTexture(this.depth);
    gl.deleteFramebuffer(this.fbo);
  }
}

// Fullscreen triangle (no buffers needed: uses gl_VertexID)
export const FULLSCREEN_VS = `
out vec2 vUV;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
