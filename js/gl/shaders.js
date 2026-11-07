// GLSL for the stage. One vertex program drives both the pills and their floor decals, so a pill and its pool of light
// can never disagree about where they are mid-morph.
import { PILL } from './geometry.js';

const MORPH = /* glsl */ `
layout(location=3) in vec3 aAp;   // formation A: position
layout(location=4) in vec4 aAr;   //              rotation (quaternion)
layout(location=5) in vec3 aAs;   //              length, height, width
layout(location=6) in vec4 aAl;   //              look: flat, ghost, accent, lit
layout(location=7) in vec3 aBp;
layout(location=8) in vec4 aBr;
layout(location=9) in vec3 aBs;
layout(location=10) in vec4 aBl;
layout(location=11) in vec4 aDyn; // lift, accent, ghost, flat  (springs driven from JS)
layout(location=12) in vec4 aInfo;// delay, seed, id, -

uniform float uMorph, uStagger, uArc;
uniform vec2 uSpin;               // yaw of formation A and B
uniform vec4 uCursor;             // x, z, radius, strength
uniform vec4 uRip[3];             // x, z, age, amplitude
const float PI = 3.14159265;

vec4 qmul(vec4 a, vec4 b) { return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
vec3 qrot(vec4 q, vec3 v) { vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
vec4 yawQ(float a) { return vec4(0.0, sin(a * 0.5), 0.0, cos(a * 0.5)); }
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }

float ripples(vec2 xz) {
  float h = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 r = uRip[i];
    if (r.w > 0.0) {
      float k = (distance(xz, r.xy) - r.z * 6.0) / 1.15;
      h += r.w * exp(-k * k) * exp(-r.z * 1.3);
    }
  }
  return h;
}

struct Pill { vec3 c; vec4 q; vec3 s; vec4 look; float lift; float hover; };

Pill morph() {
  float t = clamp((uMorph - aInfo.x * uStagger) / max(1.0 - uStagger, 0.001), 0.0, 1.0);
  float e = t * t * (3.0 - 2.0 * t);
  vec3 pa = rotY(aAp, uSpin.x), pb = rotY(aBp, uSpin.y);
  vec4 qa = qmul(yawQ(uSpin.x), aAr), qb = qmul(yawQ(uSpin.y), aBr);
  if (dot(qa, qb) < 0.0) qb = -qb;
  vec3 c = mix(pa, pb, e);
  vec4 q = normalize(mix(qa, qb, e));
  vec3 s = mix(aAs, aBs, e);
  vec4 look = mix(aAl, aBl, e);
  c.y += sin(e * PI) * (0.6 + aInfo.y * 1.7) * uArc;                 // pills hop while they travel
  look = vec4(max(look.x, aDyn.w), max(look.y, aDyn.z), max(look.z, aDyn.y), look.w);
  vec2 dc = c.xz - uCursor.xy;
  float hover = uCursor.w * exp(-dot(dc, dc) / (uCursor.z * uCursor.z));
  float lift = aDyn.x + (hover * 0.30 + ripples(c.xz) * 0.55) * (1.0 - 0.85 * look.y);
  c.y += lift;
  return Pill(c, q, s, look, lift, hover);
}
`;

export const VERT_PILL = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aEnd;
${MORPH}
uniform mat4 uVP;
uniform float uMirror;
out vec3 vW; out vec3 vN; out vec4 vLook; out float vHover; out float vTop;
const float W0 = ${PILL.W.toFixed(3)}, H0 = ${PILL.H.toFixed(3)};

void main() {
  Pill p = morph();
  float wid = max(p.s.z, 0.0001);
  float hgt = max(p.s.y * mix(1.0, 0.42, p.look.x) * mix(1.0, 0.22, p.look.y), 0.0001);
  float kx = wid / W0, ky = hgt / H0;
  vec3 local = vec3(aEnd * max(p.s.x - wid, 0.0) * 0.5 + aPos.x * kx, aPos.y * ky, aPos.z * kx);
  vec3 w = p.c + qrot(p.q, local);
  vec3 n = qrot(p.q, normalize(aNrm / vec3(kx, ky, kx)));
  if (uMirror > 0.5) { w.y = -w.y; n.y = -n.y; }
  vW = w; vN = n; vLook = p.look; vHover = p.hover; vTop = aPos.y / H0;
  gl_Position = uVP * vec4(w, 1.0);
}
`;

export const FRAG_PILL = /* glsl */ `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec4 vLook; in float vHover; in float vTop;
uniform vec3 uCam;
uniform float uMirror;
uniform vec4 uCursor;
uniform vec3 uBaseOpen, uBaseFlat, uAccent, uAccentHi, uSpec, uRim, uLitCol;
uniform float uEnv, uAmb, uFogA, uFogB, uMirrorA, uGhostA, uDim, uGlow;
out vec4 o;

// A small fake photo studio: a big soft key above and behind, a strip light, two kickers and a faint horizon.
float studio(vec3 R) {
  float e = 1.15 * smoothstep(0.80, 0.97, dot(R, normalize(vec3(-0.25, 0.85, -0.45))));
  e += 0.9 * (1.0 - smoothstep(0.0, 0.05, abs(R.y - 0.42))) * smoothstep(-0.2, 0.3, -R.z);
  e += 0.55 * smoothstep(0.86, 0.98, dot(R, normalize(vec3(1.0, 0.35, 0.1))));
  e += 0.45 * smoothstep(0.86, 0.98, dot(R, normalize(vec3(-1.0, 0.30, 0.15))));
  e += 0.10 * smoothstep(-0.2, 0.8, R.y);
  return e;
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float nv = clamp(dot(N, V), 0.0, 1.0);
  vec3 R = reflect(-V, N);
  float fres = pow(1.0 - nv, 3.0);
  float e = studio(R);
  float diff = max(dot(N, normalize(vec3(-0.35, 0.85, 0.35))), 0.0);

  vec3 Lc = vec3(uCursor.x, 1.5, uCursor.y) - vW;
  float dc = length(Lc);
  float cl = max(dot(N, Lc / dc), 0.0) * uCursor.w / (1.0 + 0.16 * dc * dc);

  vec3 base = mix(mix(uBaseOpen, uBaseFlat, vLook.x), uLitCol, vLook.w);
  float slope = 1.0 - smoothstep(0.82, 1.0, N.y);                    // bevels and walls catch more light than the flat top
  vec3 col = base * (uAmb + 0.55 * diff) * (1.0 + 0.5 * vLook.w);
  col += uSpec * e * uEnv * (0.28 + 0.72 * fres) * mix(0.6, 1.0, slope) * mix(1.0, 0.12, vLook.x) * (1.0 - 0.45 * vLook.w);
  col += uRim * fres;
  col += uAccentHi * cl * 0.34;
  col = mix(col, uRim * 2.0 + uSpec * e * uEnv * 0.25, vLook.y * 0.55);

  vec3 acc = uAccent * (0.58 + 0.38 * diff) + uAccentHi * (0.14 * fres + 0.16 * e * uEnv) + uAccent * 0.10 * uGlow;
  col = mix(col, acc, vLook.z);
  col += uAccentHi * vHover * 0.10 * (1.0 - vLook.z);
  col *= mix(0.74, 1.0, smoothstep(0.0, 0.65, vTop));

  float dist = length(uCam - vW);
  float a = mix(1.0, uGhostA, vLook.y) * (1.0 - smoothstep(uFogA, uFogB, dist)) * uDim;
  if (uMirror > 0.5) a *= uMirrorA * (1.0 - smoothstep(0.0, 2.4, -vW.y));
  o = vec4(clamp(col, 0.0, 1.5) * a, a);
}
`;

export const VERT_DECAL = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec2 aQ;
${MORPH}
uniform mat4 uVP;
uniform float uMargin;
out vec3 vW; out vec2 vLocal; out vec2 vHalf; out vec4 vLook; out float vHover; out float vLift;

void main() {
  Pill p = morph();
  vec2 ext = vec2(p.s.x * 0.5, p.s.z * 0.5);
  vec3 local = vec3(aQ.x * (ext.x + uMargin), 0.0, aQ.y * (ext.y + uMargin));
  vec3 w = p.c + qrot(p.q, local);
  w.y = 0.004;
  vW = w; vLocal = local.xz; vHalf = ext; vLook = p.look; vHover = p.hover; vLift = max(p.lift, 0.0);
  gl_Position = uVP * vec4(w, 1.0);
}
`;

export const FRAG_DECAL = /* glsl */ `#version 300 es
precision highp float;
in vec3 vW; in vec2 vLocal; in vec2 vHalf; in vec4 vLook; in float vHover; in float vLift;
uniform vec3 uCam, uPoolCol, uShadowCol;
uniform float uPoolA, uShadowA, uFogA, uFogB, uDim;
out vec4 o;

float sdStadium(vec2 p, vec2 h) {
  vec2 q = vec2(max(abs(p.x) - max(h.x - h.y, 0.0), 0.0), p.y);
  return length(q) - h.y;
}

void main() {
  float size = smoothstep(0.03, 0.2, vHalf.y);                       // hidden pills cast nothing
  float sd = sdStadium(vLocal, vHalf);
  float pool = uPoolA * (vLook.z + vHover * 0.20 + vLift * 0.45) * exp(-max(sd, 0.0) * 2.2) * (1.0 - vLook.y);
  float sd2 = sdStadium(vLocal - vec2(0.05, 0.10) * (1.0 + vLift * 3.0), vHalf);
  float shade = uShadowA * exp(-max(sd2, 0.0) * 5.0 / (1.0 + vLift * 4.0)) * (1.0 - vLook.y * 0.9);
  float fog = (1.0 - smoothstep(uFogA, uFogB, length(uCam - vW))) * uDim * size;
  float a = clamp(pool + shade, 0.0, 1.0) * fog;
  vec3 c = (uPoolCol * pool + uShadowCol * shade) * fog;
  o = vec4(c, a);
}
`;
