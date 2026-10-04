// Forward HDR renderer: soft-shadowed spot lights (flashlights) via a shadow atlas,
// clustered-by-distance point lights, sky, particles, volumetric light, bloom, ACES, FXAA.
import { Program, RenderTarget, createTexture2D, FULLSCREEN_VS } from './gl.js';
import * as S from './shaders.js';
import { m4, Frustum, v3 } from './math.js';
import { MAT, MAT_INFO, MAT_COUNT } from './textures.js';

export const QUALITY_PRESETS = {
  low: { ssao: false, scale: 0.6, maxDpr: 1, shadowSize: 1024, shadowTaps: 1, maxShadowed: 1, maxPoint: 6, bloom: false, volumetric: false, volSteps: 0, fxaa: false, particles: 150, texSize: 256 },
  medium: { ssao: false, scale: 0.75, maxDpr: 1.25, shadowSize: 1024, shadowTaps: 4, maxShadowed: 2, maxPoint: 10, bloom: true, volumetric: false, volSteps: 0, fxaa: true, particles: 400, texSize: 256 },
  high: { ssao: true, scale: 0.9, maxDpr: 1.5, shadowSize: 2048, shadowTaps: 8, maxShadowed: 4, maxPoint: 14, bloom: true, volumetric: true, volSteps: 14, fxaa: true, particles: 800, texSize: 512 },
  ultra: { ssao: true, scale: 1.0, maxDpr: 2, shadowSize: 4096, shadowTaps: 16, maxShadowed: 4, maxPoint: 16, bloom: true, volumetric: true, volSteps: 22, fxaa: true, particles: 1400, texSize: 512 },
};

const MAX_SPOT = 4;
const MAX_GLOWS = 160;
const MAX_LAMPS = 1024;

export class Camera {
  constructor() {
    this.pos = [0, 1.7, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.fov = 75;
    this.near = 0.05;
    this.far = 120;
    this.aspect = 1;
    this.view = m4.create();
    this.proj = m4.create();
    this.viewProj = m4.create();
    this.invViewProj = m4.create();
    this.invProj = m4.create();
    this.frustum = new Frustum();
    this.forward = [0, 0, -1];
    this._target = [0, 0, 0];
    this._up = [0, 1, 0];
  }
  update() {
    v3.fromYawPitch(this.forward, this.yaw, this.pitch);
    v3.add(this._target, this.pos, this.forward);
    this._up[0] = Math.sin(this.roll) * Math.cos(this.yaw);
    this._up[1] = Math.cos(this.roll);
    this._up[2] = -Math.sin(this.roll) * Math.sin(this.yaw);
    m4.lookAt(this.view, this.pos, this._target, this._up);
    m4.perspective(this.proj, (this.fov * Math.PI) / 180, this.aspect, this.near, this.far);
    m4.mul(this.viewProj, this.proj, this.view);
    m4.invert(this.invViewProj, this.viewProj);
    m4.invert(this.invProj, this.proj);
    this.frustum.fromMatrix(this.viewProj);
  }
}

// A drawable instance. Game code keeps these and pushes them into scene lists each frame.
export class DrawItem {
  constructor(mesh, mat = MAT.CONCRETE, tint = [1, 1, 1]) {
    this.mesh = mesh;
    this.model = m4.create();
    this.tint = new Float32Array([tint[0], tint[1], tint[2], 1]);
    this.mat = mat;
    this.emissive = 0;
    this.sky = 0;
    this.decal = null;
    this.castShadow = true;
    this.uvScale = [1, 1];
    this.visible = true;
    this.center = [0, 0, 0];
    this.radius = 2;
  }
  setColor(c) {
    this.tint[0] = c[0]; this.tint[1] = c[1]; this.tint[2] = c[2];
    return this;
  }
}

function normalMatrix(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];
  const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
  let det = a00 * b01 + a01 * b11 + a02 * b21;
  det = det ? 1 / det : 0;
  out[0] = b01 * det; out[1] = (-a22 * a01 + a02 * a21) * det; out[2] = (a12 * a01 - a02 * a11) * det;
  out[3] = b11 * det; out[4] = (a22 * a00 - a02 * a20) * det; out[5] = (-a12 * a00 + a02 * a10) * det;
  out[6] = b21 * det; out[7] = (-a21 * a00 + a01 * a20) * det; out[8] = (a11 * a00 - a01 * a10) * det;
  // transpose (inverse-transpose)
  let t = out[1]; out[1] = out[3]; out[3] = t;
  t = out[2]; out[2] = out[6]; out[6] = t;
  t = out[5]; out[5] = out[7]; out[7] = t;
  return out;
}

export class Renderer {
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.hdr = gl.caps.colorBufferFloat || gl.caps.colorBufferHalfFloat;
    this.emptyVao = gl.createVertexArray();
    this.identity = m4.create();
    this.identityN = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.tmpN = new Float32Array(9);
    this.matEmissive = new Float32Array(32);
    for (let i = 0; i < MAT_COUNT; i++) this.matEmissive[i] = MAT_INFO[i].emissive ?? 0;
    this.lampData = new Uint8Array(256 * 4 * 4);
    this.lampTex = createTexture2D(gl, 256, 4, { filter: gl.NEAREST, data: this.lampData });
    this.whiteTex = createTexture2D(gl, 1, 1, { data: new Uint8Array([255, 255, 255, 255]) });
    this.frame = 0;
    this.time = 0;
    this.stats = { draws: 0, tris: 0 };
    // uniform scratch
    this.pointPos = new Float32Array(16 * 4);
    this.pointCol = new Float32Array(16 * 4);
    this.spotPos = new Float32Array(MAX_SPOT * 4);
    this.spotDir = new Float32Array(MAX_SPOT * 4);
    this.spotCol = new Float32Array(MAX_SPOT * 4);
    this.spotMat = new Float32Array(MAX_SPOT * 16);
    this.spotShadow = new Float32Array(MAX_SPOT * 4);
    this.spotView = m4.create();
    this.spotProj = m4.create();
    this.spotVP = m4.create();
    this.spotFrustum = new Frustum();
    this.lightCandidates = [];
    this.glowData = new Float32Array(MAX_GLOWS * 8);
    this.glowBuf = gl.createBuffer();
    this.glowVao = gl.createVertexArray();
    gl.bindVertexArray(this.glowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.glowData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    this.post = {
      brightness: 1,
      exposure: 1.15,
      fear: 0,
      damage: 0,
      desat: 0,
      fade: 1,
      vignette: 0.4,
      grain: 0.05,
      ca: 0.002,
    };
    this.materials = null;
    this.configure(QUALITY_PRESETS.medium);
  }

  setMaterials(arrays) {
    this.materials = arrays;
  }

  configure(q) {
    const gl = this.gl;
    this.q = { ...q };
    const lit = { MAX_POINT: q.maxPoint, MAX_SPOT, SHADOW_TAPS: q.shadowTaps };
    if (!this.hdr) lit.LDR_OUTPUT = 1;
    this.progLit = new Program(gl, S.LIT_VS, S.LIT_FS, lit, 'lit');
    this.progDepth = new Program(gl, S.DEPTH_VS, S.DEPTH_FS, {}, 'depth');
    this.progSky = new Program(gl, FULLSCREEN_VS, S.SKY_FS, this.hdr ? {} : { LDR_OUTPUT: 1 }, 'sky');
    this.progParticles = new Program(gl, S.PARTICLE_VS, S.PARTICLE_FS, { MAX_SPOT }, 'particles');
    this.progGlow = new Program(gl, S.GLOW_VS, S.GLOW_FS, {}, 'glow');
    this.progVolume = q.volumetric ? new Program(gl, FULLSCREEN_VS, S.VOLUME_FS, { MAX_SPOT, MAX_POINT: q.maxPoint, VOL_STEPS: q.volSteps }, 'volume') : null;
    this.progPrefilter = new Program(gl, FULLSCREEN_VS, S.BLOOM_PREFILTER_FS, {}, 'prefilter');
    this.progDown = new Program(gl, FULLSCREEN_VS, S.DOWNSAMPLE_FS, {}, 'down');
    this.progUp = new Program(gl, FULLSCREEN_VS, S.UPSAMPLE_FS, {}, 'up');
    this.progSSAO = q.ssao ? new Program(gl, FULLSCREEN_VS, S.SSAO_FS, {}, 'ssao') : null;
    this.progComposite = new Program(gl, FULLSCREEN_VS, S.COMPOSITE_FS, this.hdr ? {} : { LDR_INPUT: 1 }, 'composite');
    this.progFxaa = new Program(gl, FULLSCREEN_VS, S.FXAA_FS, {}, 'fxaa');

    if (this.shadowTarget) this.shadowTarget.dispose();
    this.shadowTarget = new RenderTarget(gl, q.shadowSize, q.shadowSize, { colors: [], depth: true, depthCompare: true });

    this.buildParticles(q.particles);
    this.width = 0; // force resize
    this.resize();
  }

  buildParticles(count) {
    const gl = this.gl;
    if (this.particleVao) {
      gl.deleteVertexArray(this.particleVao);
      gl.deleteBuffer(this.particleBuf);
    }
    const data = new Float32Array(count * 4);
    for (let i = 0; i < data.length; i++) data[i] = Math.random();
    this.particleCount = count;
    this.particleVao = gl.createVertexArray();
    gl.bindVertexArray(this.particleVao);
    this.particleBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.maxDpr);
    const cw = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    const scale = this.dynScale ?? this.q.scale;
    if (cw === this.width && ch === this.height && scale === this.appliedScale) return;
    this.width = cw;
    this.height = ch;
    this.appliedScale = scale;
    this.canvas.width = cw;
    this.canvas.height = ch;
    const sw = Math.max(1, Math.floor(cw * scale)), sh = Math.max(1, Math.floor(ch * scale));
    const colorFmt = this.hdr ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : { internal: gl.RGBA8 };
    if (!this.sceneTarget) this.sceneTarget = new RenderTarget(gl, sw, sh, { colors: [colorFmt], depth: true });
    else this.sceneTarget.resize(sw, sh);
    if (this.hdr && !this.sceneTarget.complete) {
      // half-float not renderable after all: fall back to LDR
      this.hdr = false;
      this.sceneTarget.dispose();
      this.sceneTarget = null;
      this.configure(this.q);
      return;
    }
    const half = { internal: this.hdr ? gl.RGBA16F : gl.RGBA8, format: gl.RGBA, type: this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE };
    if (!this.bloomTargets) this.bloomTargets = [];
    const levels = 5;
    for (let i = 0; i < levels; i++) {
      const w = Math.max(1, sw >> (i + 1)), h = Math.max(1, sh >> (i + 1));
      if (!this.bloomTargets[i]) this.bloomTargets[i] = new RenderTarget(gl, w, h, { colors: [half] });
      else this.bloomTargets[i].resize(w, h);
    }
    const vw = Math.max(1, sw >> 1), vh = Math.max(1, sh >> 1);
    if (!this.volumeTarget) this.volumeTarget = new RenderTarget(gl, vw, vh, { colors: [half] });
    else this.volumeTarget.resize(vw, vh);
    if (!this.aoTarget) this.aoTarget = new RenderTarget(gl, vw, vh, { colors: [{ internal: gl.RGBA8 }] });
    else this.aoTarget.resize(vw, vh);
    if (!this.ldrTarget) this.ldrTarget = new RenderTarget(gl, cw, ch, { colors: [{ internal: gl.RGBA8 }] });
    else this.ldrTarget.resize(cw, ch);
  }

  setDynamicScale(s) {
    this.dynScale = s;
  }

  // -------------------------------------------------------------------------------- lights
  selectLights(scene, cam) {
    const q = this.q;
    const cands = this.lightCandidates;
    cands.length = 0;
    const maxDist = Math.min(cam.far, 60);
    for (const l of scene.pointLights) {
      if (l.intensity <= 0.01) continue;
      const d = v3.dist(l.pos, cam.pos) - l.radius;
      if (d > maxDist) continue;
      if (!cam.frustum.testSphere(l.pos, l.radius)) continue;
      l._score = d;
      cands.push(l);
    }
    cands.sort((a, b) => a._score - b._score);
    const n = Math.min(cands.length, q.maxPoint);
    for (let i = 0; i < n; i++) {
      const l = cands[i];
      // fade lights near the cut-off so they don't pop
      const fade = i >= n - 2 && cands.length > n ? 0.5 : 1;
      this.pointPos[i * 4] = l.pos[0];
      this.pointPos[i * 4 + 1] = l.pos[1];
      this.pointPos[i * 4 + 2] = l.pos[2];
      this.pointPos[i * 4 + 3] = l.radius;
      this.pointCol[i * 4] = l.color[0] * l.intensity * fade;
      this.pointCol[i * 4 + 1] = l.color[1] * l.intensity * fade;
      this.pointCol[i * 4 + 2] = l.color[2] * l.intensity * fade;
      this.pointCol[i * 4 + 3] = 0;
    }
    this.numPoint = n;

    // spots
    let ns = 0, shadowed = 0;
    for (const s of scene.spotLights) {
      if (ns >= MAX_SPOT) break;
      if (s.intensity <= 0.01) continue;
      const i = ns++;
      this.spotPos.set([s.pos[0], s.pos[1], s.pos[2], s.range], i * 4);
      this.spotDir.set([s.dir[0], s.dir[1], s.dir[2], Math.cos(s.outer)], i * 4);
      this.spotCol.set([s.color[0] * s.intensity, s.color[1] * s.intensity, s.color[2] * s.intensity, Math.cos(s.inner)], i * 4);
      if (s.shadow && shadowed < q.maxShadowed) {
        const tile = shadowed++;
        s._tile = tile;
        this.spotShadow.set([(tile % 2) * 0.5, Math.floor(tile / 2) * 0.5, 0.5, 1], i * 4);
      } else {
        s._tile = -1;
        this.spotShadow.set([0, 0, 0, 0], i * 4);
      }
    }
    this.numSpot = ns;
  }

  renderShadows(scene) {
    const gl = this.gl;
    const st = this.shadowTarget;
    const tileSize = st.width / 2;
    let any = false;
    let si = 0;
    const p = this.progDepth;
    for (const s of scene.spotLights) {
      if (si >= this.numSpot) break;
      if (s.intensity <= 0.01) continue;
      const i = si++;
      if (s._tile < 0) continue;
      if (!any) {
        st.bind();
        gl.enable(gl.SCISSOR_TEST);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.6, 3.0);
        gl.disable(gl.CULL_FACE);
        p.use();
        any = true;
      }
      const tx = (s._tile % 2) * tileSize, ty = Math.floor(s._tile / 2) * tileSize;
      gl.viewport(tx, ty, tileSize, tileSize);
      gl.scissor(tx, ty, tileSize, tileSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const target = [s.pos[0] + s.dir[0], s.pos[1] + s.dir[1], s.pos[2] + s.dir[2]];
      const up = Math.abs(s.dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
      m4.lookAt(this.spotView, s.pos, target, up);
      m4.perspective(this.spotProj, Math.min(2.6, s.outer * 2 + 0.1), 1, 0.08, s.range);
      m4.mul(this.spotVP, this.spotProj, this.spotView);
      this.spotMat.set(this.spotVP, i * 16);
      this.spotFrustum.fromMatrix(this.spotVP);
      p.set('uViewProj', this.spotVP);
      p.set('uModel', this.identity);
      for (const c of scene.static) {
        if (!this.spotFrustum.testAABB(c.min, c.max)) continue;
        c.mesh.draw();
      }
      for (const d of scene.dynamic) {
        if (!d.visible || !d.castShadow) continue;
        if (!this.spotFrustum.testSphere(d.center, d.radius)) continue;
        p.set('uModel', d.model);
        d.mesh.draw();
      }
    }
    if (any) {
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
  }

  setLitUniforms(p, scene, cam) {
    const gl = this.gl;
    const env = scene.env;
    p.use();
    p.set('uViewProj', cam.viewProj);
    p.set('uCamPos', cam.pos);
    p.set('uAmbient', env.ambient);
    p.set('uSkyAmbient', env.skyAmbient);
    p.set('uMoonDir', env.moonDir);
    p.set('uMoonColor', env.moonColor);
    p.set('uFogColor', env.fogColor);
    p.set('uFogDensity', env.fogDensity);
    p.set('uWetness', env.wetness ?? 0);
    p.set('uGroundFog', env.groundFog ?? 0);
    p.set('uDetail', this.q.texSize >= 512 ? 0.5 : 0.35);
    p.set('uAlphaOut', 1);
    p.set('uTime', this.time);
    p.set('uMatEmissive', this.matEmissive);
    p.set('uLampMat', MAT.LAMP);
    p.set('uNumPoint', this.numPoint);
    p.set('uPointPos', this.pointPos);
    p.set('uPointColor', this.pointCol);
    p.set('uNumSpot', this.numSpot);
    p.set('uSpotPos', this.spotPos);
    p.set('uSpotDir', this.spotDir);
    p.set('uSpotColor', this.spotCol);
    p.set('uSpotMat', this.spotMat);
    p.set('uSpotShadow', this.spotShadow);
    p.set('uShadowTexel', [1 / this.shadowTarget.width, 1 / this.shadowTarget.height]);
    p.set('uShadowSoft', (this.q.shadowTaps > 1 ? 2.5 : 0) / (this.shadowTarget.width / 2));
    p.tex('uAlbedo', this.materials.albedo, gl.TEXTURE_2D_ARRAY);
    p.tex('uNormalMap', this.materials.normal, gl.TEXTURE_2D_ARRAY);
    p.tex('uShadowMap', this.shadowTarget.depth);
    p.tex('uLampState', this.lampTex);
    this.decalUnit = p.texUnit;
    p.tex('uDecal', this.whiteTex);
  }

  drawItems(p, items, cam, cull = true) {
    const gl = this.gl;
    let lastDecal = undefined;
    for (const d of items) {
      if (!d.visible) continue;
      if (cull && !cam.frustum.testSphere(d.center, d.radius)) continue;
      p.set('uModel', d.model);
      p.set('uNormalMat', normalMatrix(this.tmpN, d.model));
      p.set('uTint', d.tint);
      p.set('uMatOverride', d.mat);
      p.set('uSkyOverride', d.sky);
      p.set('uEmissive', d.emissive);
      p.set('uUVScale', d.uvScale);
      if (d.decal !== lastDecal) {
        gl.activeTexture(gl.TEXTURE0 + this.decalUnit);
        gl.bindTexture(gl.TEXTURE_2D, d.decal || this.whiteTex);
        p.set('uUseDecal', d.decal ? 1 : 0);
        lastDecal = d.decal;
      }
      d.mesh.draw();
      this.stats.draws++;
    }
  }

  // ------------------------------------------------------------------------------ main entry
  render(scene, cam, dt) {
    const gl = this.gl;
    if (!this.materials) return;
    this.time += dt;
    this.frame++;
    this.stats.draws = 0;
    this.resize();
    cam.aspect = this.width / this.height;
    cam.update();

    // lamp states
    if (scene.lampState) {
      const n = Math.min(scene.lampState.length, MAX_LAMPS);
      for (let i = 0; i < n; i++) this.lampData[i * 4] = Math.max(0, Math.min(255, scene.lampState[i] * 170));
      gl.bindTexture(gl.TEXTURE_2D, this.lampTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 4, gl.RGBA, gl.UNSIGNED_BYTE, this.lampData);
    }

    gl.bindVertexArray(null);
    this.selectLights(scene, cam);
    this.renderShadows(scene);

    // ----- main scene
    const st = this.sceneTarget;
    st.bind();
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.clearColor(scene.env.fogColor[0], scene.env.fogColor[1], scene.env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (scene.env.sky) {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      const p = this.progSky.use();
      p.set('uInvViewProj', cam.invViewProj);
      p.set('uCamPos', cam.pos);
      p.set('uMoonDir', scene.env.moonDir);
      p.set('uSkyTop', scene.env.skyTop);
      p.set('uSkyHorizon', scene.env.skyHorizon);
      p.set('uFogColor', scene.env.fogColor);
      p.set('uTime', this.time);
      p.set('uCloudiness', scene.env.cloudiness ?? 0.7);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const p = this.progLit;
    this.setLitUniforms(p, scene, cam);
    // static world
    p.set('uModel', this.identity);
    p.set('uNormalMat', this.identityN);
    p.set('uTint', [1, 1, 1, 1]);
    p.set('uMatOverride', -1);
    p.set('uSkyOverride', -1);
    p.set('uEmissive', 0);
    p.set('uUVScale', [1, 1]);
    p.set('uUseDecal', 0);
    for (const c of scene.static) {
      if (!cam.frustum.testAABB(c.min, c.max)) continue;
      c.mesh.draw();
      this.stats.draws++;
    }
    gl.disable(gl.CULL_FACE);
    this.drawItems(p, scene.dynamic, cam);
    gl.enable(gl.CULL_FACE);

    // ----- additive effects
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    if (scene.env.dust && this.particleCount) {
      const pp = this.progParticles.use();
      pp.set('uViewProj', cam.viewProj);
      pp.set('uCenter', cam.pos);
      pp.set('uBox', [14, 7, 14]);
      pp.set('uTime', this.time);
      pp.set('uPointScale', this.height * 1.2);
      pp.set('uDrift', scene.env.dust.drift ?? [0.02, -0.01, 0.015]);
      pp.set('uNumSpot', this.numSpot);
      pp.set('uSpotPos', this.spotPos);
      pp.set('uSpotDir', this.spotDir);
      pp.set('uSpotColor', this.spotCol);
      pp.set('uBaseColor', scene.env.dust.color);
      pp.set('uCamPos', cam.pos);
      gl.bindVertexArray(this.particleVao);
      gl.drawArrays(gl.POINTS, 0, this.particleCount);
    }
    if (scene.glows.length) {
      const n = Math.min(scene.glows.length, MAX_GLOWS);
      const g = this.glowData;
      let k = 0;
      for (let i = 0; i < n; i++) {
        const s = scene.glows[i];
        if (s.intensity <= 0.01) continue;
        g[k * 8] = s.pos[0]; g[k * 8 + 1] = s.pos[1]; g[k * 8 + 2] = s.pos[2]; g[k * 8 + 3] = s.size;
        g[k * 8 + 4] = s.color[0]; g[k * 8 + 5] = s.color[1]; g[k * 8 + 6] = s.color[2]; g[k * 8 + 7] = s.intensity;
        k++;
      }
      if (k) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, g, 0, k * 8);
        const gp = this.progGlow.use();
        gp.set('uViewProj', cam.viewProj);
        gp.set('uPointScale', this.height * 0.6);
        gl.bindVertexArray(this.glowVao);
        gl.drawArrays(gl.POINTS, 0, k);
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // ----- volumetric light (reads scene depth before the viewmodel clears it)
    const useVolume = this.progVolume && this.hdr && scene.env.volumetric !== false;
    if (useVolume) {
      this.volumeTarget.bind();
      gl.disable(gl.DEPTH_TEST);
      const vp = this.progVolume.use();
      vp.tex('uDepth', st.depth);
      vp.tex('uShadowMap', this.shadowTarget.depth);
      vp.set('uInvViewProj', cam.invViewProj);
      vp.set('uCamPos', cam.pos);
      vp.set('uDensity', scene.env.volumeDensity ?? 0.05);
      vp.set('uMaxDist', 18);
      vp.set('uFrame', this.frame % 64);
      vp.set('uNumSpot', this.numSpot);
      vp.set('uSpotPos', this.spotPos);
      vp.set('uSpotDir', this.spotDir);
      vp.set('uSpotColor', this.spotCol);
      vp.set('uSpotMat', this.spotMat);
      vp.set('uSpotShadow', this.spotShadow);
      vp.set('uNumPoint', Math.min(this.numPoint, 6));
      vp.set('uPointPos', this.pointPos);
      vp.set('uPointColor', this.pointCol);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ----- screen-space ambient occlusion (before the viewmodel clears depth)
    const useAO = !!this.progSSAO;
    if (useAO) {
      this.aoTarget.bind();
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      const ap = this.progSSAO.use();
      ap.tex('uDepth', st.depth);
      ap.set('uProj', cam.proj);
      ap.set('uInvProj', cam.invProj);
      ap.set('uRadius', 0.55);
      ap.set('uStrength', 1.4);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ----- first-person viewmodel
    if (scene.viewmodel && scene.viewmodel.length) {
      st.bind();
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const vmCam = this.vmCam || (this.vmCam = { viewProj: m4.create(), proj: m4.create(), pos: cam.pos, frustum: cam.frustum });
      m4.perspective(vmCam.proj, (62 * Math.PI) / 180, cam.aspect, 0.01, 10);
      m4.mul(vmCam.viewProj, vmCam.proj, cam.view);
      p.use();
      this.setLitUniforms(p, scene, { ...cam, viewProj: vmCam.viewProj });
      p.set('uAlphaOut', 0);
      this.drawItems(p, scene.viewmodel, cam, false);
      p.set('uAlphaOut', 1);
    }

    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.emptyVao);

    // ----- bloom
    const useBloom = this.q.bloom;
    if (useBloom) {
      const b = this.bloomTargets;
      b[0].bind();
      let pp = this.progPrefilter.use();
      pp.tex('uSrc', st.color);
      pp.set('uTexel', [1 / st.width, 1 / st.height]);
      pp.set('uThreshold', this.hdr ? 1.0 : 0.6);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pp = this.progDown.use();
      for (let i = 1; i < b.length; i++) {
        b[i].bind();
        pp.use();
        pp.tex('uSrc', b[i - 1].color);
        pp.set('uTexel', [1 / b[i - 1].width, 1 / b[i - 1].height]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      pp = this.progUp;
      for (let i = b.length - 1; i > 0; i--) {
        b[i - 1].bind();
        pp.use();
        pp.tex('uSrc', b[i].color);
        pp.set('uTexel', [1 / b[i].width, 1 / b[i].height]);
        pp.set('uWeight', 0.85);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }

    // ----- composite
    const useFxaa = this.q.fxaa;
    if (useFxaa) this.ldrTarget.bind();
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
    }
    const cp = this.progComposite.use();
    cp.tex('uScene', st.color);
    cp.tex('uBloom', useBloom ? this.bloomTargets[0].color : this.whiteTex);
    cp.tex('uVolume', useVolume ? this.volumeTarget.color : this.whiteTex);
    cp.tex('uAO', useAO ? this.aoTarget.color : this.whiteTex);
    cp.set('uHasAO', useAO ? 1 : 0);
    cp.set('uAOTexel', [1 / this.aoTarget.width, 1 / this.aoTarget.height]);
    cp.set('uHasBloom', useBloom ? 1 : 0);
    cp.set('uHasVolume', useVolume ? 1 : 0);
    cp.set('uBloomStrength', 0.09);
    cp.set('uVolStrength', 1.0);
    const post = this.post;
    cp.set('uExposure', post.exposure);
    cp.set('uBrightness', post.brightness);
    cp.set('uVignette', post.vignette);
    cp.set('uGrain', post.grain);
    cp.set('uCA', post.ca);
    cp.set('uFear', post.fear);
    cp.set('uDamage', post.damage);
    cp.set('uDesat', post.desat);
    cp.set('uFade', post.fade);
    cp.set('uTime', this.time);
    cp.set('uResolution', [this.width, this.height]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (useFxaa) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      const fp = this.progFxaa.use();
      fp.tex('uSrc', this.ldrTarget.color);
      fp.set('uTexel', [1 / this.width, 1 / this.height]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
  }
}
