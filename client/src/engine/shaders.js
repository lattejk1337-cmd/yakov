// GLSL ES 3.0 shader sources. Defines are injected by Program (MAX_POINT, MAX_SPOT, SHADOW_TAPS ...).

const COMMON = `
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

export const LIT_VS = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aTangent;
layout(location=3) in vec2 aUV;
layout(location=4) in vec3 aAttr;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform vec2 uUVScale;
out vec3 vPos;
out vec3 vN;
out vec3 vT;
out vec2 vUV;
out vec3 vAttr;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.0);
  vPos = wp.xyz;
  vN = normalize(uNormalMat * aNormal);
  vT = normalize(mat3(uModel) * aTangent);
  vUV = aUV * uUVScale;
  vAttr = aAttr;
  gl_Position = uViewProj * wp;
}`;

export const LIT_FS = `
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;
${COMMON}
in vec3 vPos;
in vec3 vN;
in vec3 vT;
in vec2 vUV;
in vec3 vAttr;
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormalMap;
uniform sampler2D uDecal;
uniform sampler2D uLampState;
uniform float uUseDecal;
uniform float uMatOverride;
uniform float uSkyOverride;
uniform vec4 uTint;
uniform float uEmissive;
uniform float uMatEmissive[32];
uniform float uLampMat;
uniform vec3 uCamPos;
uniform vec3 uAmbient;
uniform vec3 uSkyAmbient;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uWetness;

uniform int uNumPoint;
uniform vec4 uPointPos[MAX_POINT];
uniform vec4 uPointColor[MAX_POINT];

uniform int uNumSpot;
uniform vec4 uSpotPos[MAX_SPOT];
uniform vec4 uSpotDir[MAX_SPOT];
uniform vec4 uSpotColor[MAX_SPOT];
uniform mat4 uSpotMat[MAX_SPOT];
uniform vec4 uSpotShadow[MAX_SPOT];
uniform sampler2DShadow uShadowMap;
uniform vec2 uShadowTexel;
uniform float uShadowSoft;

out vec4 outColor;

const vec2 POISSON[16] = vec2[](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790)
);

float spotShadow(int i, vec3 wp, vec3 n, float ndl){
  vec4 sh = uSpotShadow[i];
  if (sh.w < 0.5) return 1.0;
  vec3 off = n * (0.02 + 0.05 * (1.0 - ndl));
  vec4 lp = uSpotMat[i] * vec4(wp + off, 1.0);
  vec3 c = lp.xyz / lp.w * 0.5 + 0.5;
  if (lp.w <= 0.0 || c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  vec2 base = sh.xy + c.xy * sh.z;
  float ref = c.z - 0.0004;
  vec2 lo = sh.xy + uShadowTexel, hi = sh.xy + vec2(sh.z) - uShadowTexel;
#if SHADOW_TAPS > 1
  float a = ign(gl_FragCoord.xy) * 6.2831853;
  float ca = cos(a), sa = sin(a);
  mat2 rot = mat2(ca, sa, -sa, ca);
  float radius = uShadowSoft * sh.z;
  float sum = 0.0;
  for (int k = 0; k < SHADOW_TAPS; k++) {
    vec2 uv = clamp(base + rot * POISSON[k] * radius, lo, hi);
    sum += texture(uShadowMap, vec3(uv, ref));
  }
  return sum / float(SHADOW_TAPS);
#else
  return texture(uShadowMap, vec3(clamp(base, lo, hi), ref));
#endif
}

float cookie(float t){
  // flashlight reflector pattern: hot center, faint ring, darker halo
  return 0.6 + 0.55 * exp(-t * t * 10.0) + 0.15 * smoothstep(0.55, 0.62, t) * smoothstep(0.75, 0.66, t);
}

void main(){
  float mat = uMatOverride >= 0.0 ? uMatOverride : floor(vAttr.x + 0.5);
  float ao = vAttr.y;
  // static lamp vertices store their lamp index in the sky channel
  bool isLamp = abs(mat - uLampMat) < 0.5 && uSkyOverride < 0.0;
  float sky = uSkyOverride >= 0.0 ? uSkyOverride : (isLamp ? 0.0 : vAttr.z);
  vec4 alb;
  vec3 nTex = vec3(0.0, 0.0, 1.0);
  if (uUseDecal > 0.5) {
    alb = texture(uDecal, vUV);
    if (alb.a < 0.5) discard;
    alb.rgb = pow(alb.rgb, vec3(2.2));
    alb.a = 0.85;
  } else {
    alb = texture(uAlbedo, vec3(vUV, mat));
    nTex = texture(uNormalMap, vec3(vUV, mat)).xyz * 2.0 - 1.0;
  }
  vec3 albedo = alb.rgb * uTint.rgb;
  float rough = alb.a;
  // global wetness (rainy maps) lowers roughness on upward surfaces
  rough = mix(rough, rough * 0.35, uWetness * sky * smoothstep(0.5, 0.9, vN.y));

  vec3 Ng = normalize(vN);
  if (!gl_FrontFacing) Ng = -Ng;
  vec3 T = normalize(vT - Ng * dot(Ng, vT));
  vec3 B = cross(Ng, T);
  vec3 N = normalize(T * nTex.x + B * nTex.y + Ng * nTex.z);
  vec3 V = normalize(uCamPos - vPos);
  float NdV = max(dot(N, V), 0.001);
  float shin = exp2(11.0 * (1.0 - rough) + 1.0);
  float specNorm = (shin + 8.0) / 25.13;
  float specMask = (1.0 - rough * 0.85);

  vec3 diff = vec3(0.0), spec = vec3(0.0);

  // point lights
  for (int i = 0; i < MAX_POINT; i++) {
    if (i >= uNumPoint) break;
    vec3 Lv = uPointPos[i].xyz - vPos;
    float d2 = dot(Lv, Lv);
    float r = uPointPos[i].w;
    float d = sqrt(d2);
    float win = clamp(1.0 - pow(d / r, 4.0), 0.0, 1.0);
    float att = win * win / (d2 * 0.35 + 1.0);
    if (att <= 0.0) continue;
    vec3 L = Lv / d;
    float ndl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 rad = uPointColor[i].rgb * att;
    diff += rad * ndl;
    spec += rad * ndl * pow(max(dot(N, H), 0.0), shin) * specNorm * F * specMask;
  }

  // spot lights (flashlights) with soft shadows
  for (int i = 0; i < MAX_SPOT; i++) {
    if (i >= uNumSpot) break;
    vec3 Lv = uSpotPos[i].xyz - vPos;
    float d = length(Lv);
    float range = uSpotPos[i].w;
    vec3 L = Lv / d;
    float cosA = dot(-L, uSpotDir[i].xyz);
    float cosO = uSpotDir[i].w, cosI = uSpotColor[i].w;
    if (cosA <= cosO || d > range) continue;
    float cone = smoothstep(cosO, cosI, cosA);
    float t = clamp((1.0 - cosA) / max(1.0 - cosO, 1e-4), 0.0, 1.0);
    float win = clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0);
    float att = win * win / (d * d * 0.12 + 1.0) * cone * cookie(sqrt(t));
    float ndlG = max(dot(Ng, L), 0.0);
    float ndl = max(dot(N, L), 0.0);
    float shadow = spotShadow(i, vPos, Ng, ndlG);
    vec3 H = normalize(L + V);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 rad = uSpotColor[i].rgb * att * shadow;
    diff += rad * ndl;
    spec += rad * ndl * pow(max(dot(N, H), 0.0), shin) * specNorm * F * specMask;
  }

  // moon (outdoor only)
  if (sky > 0.0) {
    float ndl = max(dot(N, uMoonDir), 0.0);
    vec3 H = normalize(uMoonDir + V);
    diff += uMoonColor * ndl * sky;
    spec += uMoonColor * sky * ndl * pow(max(dot(N, H), 0.0), shin) * specNorm * 0.04 * specMask;
  }

  float hemi = 0.65 + 0.35 * N.y;
  vec3 ambient = (uAmbient + uSkyAmbient * sky) * hemi * ao;
  vec3 color = albedo * (diff * ao + ambient) + spec * ao;

  // emissive
  float em = uMatEmissive[int(mat)];
  if (em > 0.0) {
    float lamp = 1.0;
    if (isLamp) {
      float idx = floor(vAttr.z + 0.5);
      lamp = texelFetch(uLampState, ivec2(int(mod(idx, 256.0)), int(idx / 256.0)), 0).r * 1.5;
    }
    color += albedo * em * lamp;
  }
  color += uTint.rgb * uEmissive;

  // exponential fog
  float dist = length(uCamPos - vPos);
  float fog = 1.0 - exp(-dist * uFogDensity);
  color = mix(color, uFogColor, fog);

#ifdef LDR_OUTPUT
  color = color / (color + vec3(1.0));
#endif
  outColor = vec4(color, 1.0);
}`;

export const DEPTH_VS = `
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
void main(){ gl_Position = uViewProj * uModel * vec4(aPos, 1.0); }`;

export const DEPTH_FS = `
precision mediump float;
out vec4 o;
void main(){ o = vec4(1.0); }`;

export const SKY_FS = `
precision highp float;
${COMMON}
in vec2 vUV;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uMoonDir;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uTime;
uniform float uCloudiness;
out vec4 o;
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += n2(p) * a; p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec4 p = uInvViewProj * vec4(vUV * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - uCamPos);
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(h, 0.45));
  // stars
  vec2 sp = dir.xz / max(dir.y, 0.05) * 60.0;
  float st = step(0.997, hash12(floor(sp))) * smoothstep(0.05, 0.3, dir.y);
  col += vec3(st) * 0.8 * (0.6 + 0.4 * sin(uTime * 3.0 + hash12(floor(sp)) * 40.0));
  // moon disc + halo
  float md = dot(dir, uMoonDir);
  col += vec3(0.9, 0.95, 1.0) * smoothstep(0.9993, 0.9996, md) * 6.0;
  col += vec3(0.25, 0.32, 0.45) * pow(max(md, 0.0), 64.0) * 0.6;
  // clouds
  vec2 cp = dir.xz / max(dir.y + 0.08, 0.05) * 1.6 + vec2(uTime * 0.01, uTime * 0.004);
  float c = smoothstep(0.45, 0.85, fbm2(cp)) * uCloudiness;
  vec3 cloudCol = mix(vec3(0.02, 0.025, 0.035), vec3(0.12, 0.13, 0.16), pow(max(md, 0.0), 8.0));
  col = mix(col, cloudCol, c * smoothstep(0.0, 0.2, dir.y));
  col = mix(uFogColor, col, smoothstep(-0.02, 0.25, dir.y));
#ifdef LDR_OUTPUT
  col = col / (col + vec3(1.0));
#endif
  o = vec4(col, 1.0);
}`;

export const PARTICLE_VS = `
layout(location=0) in vec4 aSeed;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uTime;
uniform float uPointScale;
uniform vec3 uDrift;
uniform int uNumSpot;
uniform vec4 uSpotPos[MAX_SPOT];
uniform vec4 uSpotDir[MAX_SPOT];
uniform vec4 uSpotColor[MAX_SPOT];
uniform vec3 uBaseColor;
uniform vec3 uCamPos;
out vec3 vColor;
out float vAlpha;
void main(){
  vec3 p = aSeed.xyz * uBox + uDrift * uTime * (0.5 + aSeed.w);
  p += vec3(sin(uTime * 0.7 + aSeed.w * 40.0), cos(uTime * 0.5 + aSeed.x * 30.0), sin(uTime * 0.6 + aSeed.z * 50.0)) * 0.15;
  vec3 origin = uCenter - uBox * 0.5;
  vec3 wp = origin + mod(p - origin, uBox);
  vec3 light = uBaseColor;
  for (int i = 0; i < MAX_SPOT; i++) {
    if (i >= uNumSpot) break;
    vec3 Lv = wp - uSpotPos[i].xyz;
    float d = length(Lv);
    float cosA = dot(Lv / d, uSpotDir[i].xyz);
    float cone = smoothstep(uSpotDir[i].w, uSpotColor[i].w, cosA);
    float win = clamp(1.0 - d / uSpotPos[i].w, 0.0, 1.0);
    light += uSpotColor[i].rgb * cone * win * win * 0.9;
  }
  vColor = light;
  float dist = length(wp - uCamPos);
  vAlpha = smoothstep(0.2, 0.8, dist) * smoothstep(uBox.x * 0.5, uBox.x * 0.3, dist);
  gl_Position = uViewProj * vec4(wp, 1.0);
  gl_PointSize = clamp(uPointScale * (0.004 + aSeed.w * 0.006) / max(gl_Position.w, 0.1), 1.0, 8.0);
}`;

export const PARTICLE_FS = `
precision mediump float;
in vec3 vColor;
in float vAlpha;
out vec4 o;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(c, c) * 3.0) * vAlpha;
  o = vec4(vColor * a, a);
}`;

export const GLOW_VS = `
layout(location=0) in vec4 aPosSize;
layout(location=1) in vec4 aColor;
uniform mat4 uViewProj;
uniform float uPointScale;
out vec4 vColor;
void main(){
  gl_Position = uViewProj * vec4(aPosSize.xyz, 1.0);
  gl_PointSize = clamp(uPointScale * aPosSize.w / max(gl_Position.w, 0.1), 0.0, 256.0);
  vColor = aColor;
}`;

export const GLOW_FS = `
precision mediump float;
in vec4 vColor;
out vec4 o;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  float a = exp(-r * 4.0) * 0.7 + exp(-r * 22.0) * 0.6;
  o = vec4(vColor.rgb * a * vColor.a, 0.0);
}`;

export const VOLUME_FS = `
precision highp float;
precision highp sampler2DShadow;
${COMMON}
in vec2 vUV;
uniform sampler2D uDepth;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uDensity;
uniform float uMaxDist;
uniform float uFrame;
uniform int uNumSpot;
uniform vec4 uSpotPos[MAX_SPOT];
uniform vec4 uSpotDir[MAX_SPOT];
uniform vec4 uSpotColor[MAX_SPOT];
uniform mat4 uSpotMat[MAX_SPOT];
uniform vec4 uSpotShadow[MAX_SPOT];
uniform sampler2DShadow uShadowMap;
uniform int uNumPoint;
uniform vec4 uPointPos[MAX_POINT];
uniform vec4 uPointColor[MAX_POINT];
out vec4 o;
float shadowAt(int i, vec3 p){
  vec4 sh = uSpotShadow[i];
  if (sh.w < 0.5) return 1.0;
  vec4 lp = uSpotMat[i] * vec4(p, 1.0);
  vec3 c = lp.xyz / lp.w * 0.5 + 0.5;
  if (lp.w <= 0.0 || c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  return texture(uShadowMap, vec3(sh.xy + c.xy * sh.z, c.z - 0.001));
}
void main(){
  float d = texture(uDepth, vUV).r;
  vec4 wp = uInvViewProj * vec4(vUV * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  wp /= wp.w;
  vec3 ray = wp.xyz - uCamPos;
  float len = min(length(ray), uMaxDist);
  vec3 dir = normalize(ray);
  float stepLen = len / float(VOL_STEPS);
  float j = ign(gl_FragCoord.xy + vec2(uFrame * 5.588, uFrame * 3.31));
  vec3 acc = vec3(0.0);
  for (int s = 0; s < VOL_STEPS; s++) {
    vec3 p = uCamPos + dir * ((float(s) + j) * stepLen);
    for (int i = 0; i < MAX_SPOT; i++) {
      if (i >= uNumSpot) break;
      vec3 Lv = p - uSpotPos[i].xyz;
      float dl = length(Lv);
      vec3 Ld = Lv / max(dl, 1e-3);
      float cosA = dot(Ld, uSpotDir[i].xyz);
      if (cosA <= uSpotDir[i].w || dl > uSpotPos[i].w) continue;
      float cone = smoothstep(uSpotDir[i].w, uSpotColor[i].w, cosA);
      float win = clamp(1.0 - dl / uSpotPos[i].w, 0.0, 1.0);
      float att = cone * win * win / (dl * dl * 0.12 + 1.0);
      float g = 0.35;
      float cosT = dot(dir, -Ld);
      float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
      acc += uSpotColor[i].rgb * att * phase * shadowAt(i, p);
    }
    for (int i = 0; i < MAX_POINT; i++) {
      if (i >= uNumPoint) break;
      vec3 Lv = uPointPos[i].xyz - p;
      float d2 = dot(Lv, Lv);
      float r = uPointPos[i].w * 0.6;
      if (d2 > r * r) continue;
      float win = 1.0 - sqrt(d2) / r;
      acc += uPointColor[i].rgb * win * win * 0.12 / (d2 + 1.0);
    }
  }
  o = vec4(acc * stepLen * uDensity, 1.0);
}`;

export const BLOOM_PREFILTER_FS = `
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 o;
void main(){
  vec3 c = texture(uSrc, vUV + uTexel * vec2(-0.5, -0.5)).rgb + texture(uSrc, vUV + uTexel * vec2(0.5, -0.5)).rgb
         + texture(uSrc, vUV + uTexel * vec2(-0.5, 0.5)).rgb + texture(uSrc, vUV + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  o = vec4(min(c * w, vec3(64.0)), 1.0);
}`;

export const DOWNSAMPLE_FS = `
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 o;
void main(){
  vec3 a = texture(uSrc, vUV + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(uSrc, vUV + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture(uSrc, vUV + uTexel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture(uSrc, vUV + uTexel * vec2(1.0, 1.0)).rgb;
  vec3 e = texture(uSrc, vUV).rgb;
  o = vec4((a + b + c + d) * 0.125 + e * 0.5, 1.0);
}`;

export const UPSAMPLE_FS = `
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
out vec4 o;
void main(){
  vec3 s = texture(uSrc, vUV + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture(uSrc, vUV + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
  s += texture(uSrc, vUV + uTexel * vec2(1.0, -1.0)).rgb;
  s += texture(uSrc, vUV + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
  s += texture(uSrc, vUV).rgb * 4.0;
  s += texture(uSrc, vUV + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
  s += texture(uSrc, vUV + uTexel * vec2(-1.0, 1.0)).rgb;
  s += texture(uSrc, vUV + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
  s += texture(uSrc, vUV + uTexel * vec2(1.0, 1.0)).rgb;
  o = vec4(s / 16.0 * uWeight, 1.0);
}`;

export const COMPOSITE_FS = `
precision highp float;
${COMMON}
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uVolume;
uniform float uBloomStrength;
uniform float uVolStrength;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uCA;
uniform float uFear;
uniform float uDamage;
uniform float uDesat;
uniform float uBrightness;
uniform float uFade;
uniform vec2 uResolution;
uniform float uHasBloom;
uniform float uHasVolume;
out vec4 o;
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main(){
  vec2 uv = vUV;
  vec2 cdir = uv - 0.5;
  float r2 = dot(cdir, cdir);
  // fear makes the world breathe
  uv += vec2(sin(uv.y * 23.0 + uTime * 2.7), cos(uv.x * 19.0 + uTime * 2.1)) * 0.0025 * uFear;
  float ca = (uCA + uFear * 0.004 + uDamage * 0.006) * r2;
  vec3 col;
  col.r = texture(uScene, uv - cdir * ca * 2.0).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv + cdir * ca * 2.0).b;
#ifndef LDR_INPUT
  if (uHasBloom > 0.5) col += texture(uBloom, uv).rgb * uBloomStrength;
  if (uHasVolume > 0.5) col += texture(uVolume, uv).rgb * uVolStrength;
  col *= uExposure * uBrightness;
  col = aces(col);
#else
  // input already compressed by x/(1+x); expand slightly and add effects
  if (uHasBloom > 0.5) col += texture(uBloom, uv).rgb * uBloomStrength * 0.3;
  col = clamp(col * uBrightness * 1.25, 0.0, 1.0);
#endif
  col = pow(col, vec3(1.0 / 2.2));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), clamp(uDesat, 0.0, 1.0));
  // cold horror grade
  col = mix(col, col * vec3(0.92, 1.0, 1.08), 0.35);
  float vig = smoothstep(0.85, 0.2, r2 * (1.0 + uVignette * 1.4 + uFear * 0.6));
  col *= mix(1.0, vig, 0.85);
  col = mix(col, vec3(0.35, 0.0, 0.0), uDamage * smoothstep(0.08, 0.35, r2) * 0.8);
  float g = hash12(vUV * uResolution + fract(uTime * 13.37) * 100.0) - 0.5;
  col += g * uGrain;
  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  col *= uFade;
  o = vec4(col, dot(col, vec3(0.299, 0.587, 0.114)));
}`;

export const FXAA_FS = `
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 o;
void main(){
  vec3 rgbNW = texture(uSrc, vUV + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture(uSrc, vUV + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture(uSrc, vUV + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 rgbSE = texture(uSrc, vUV + vec2(1.0, 1.0) * uTexel).rgb;
  vec4 c = texture(uSrc, vUV);
  vec3 rgbM = c.rgb;
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float lNW = dot(rgbNW, luma), lNE = dot(rgbNE, luma), lSW = dot(rgbSW, luma), lSE = dot(rgbSE, luma), lM = dot(rgbM, luma);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 rgbA = 0.5 * (texture(uSrc, vUV + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uSrc, vUV + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(uSrc, vUV + dir * -0.5).rgb + texture(uSrc, vUV + dir * 0.5).rgb);
  float lB = dot(rgbB, luma);
  o = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
}`;

export const BLIT_FS = `
precision mediump float;
in vec2 vUV;
uniform sampler2D uSrc;
out vec4 o;
void main(){ o = vec4(texture(uSrc, vUV).rgb, 1.0); }`;
