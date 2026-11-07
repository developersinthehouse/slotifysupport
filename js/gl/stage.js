// The 3D stage: one canvas, one instanced mesh, a handful of formations. Plain WebGL 2, no libraries.
import { buildPill, buildQuad } from './geometry.js';
import { VERT_PILL, FRAG_PILL, VERT_DECAL, FRAG_DECAL } from './shaders.js';
import { buildFormations, N, COLS, ROWS, DAYS, FIRST_DOW, slotTime } from './formations.js';
import { resolvePose } from './poses.js';
import { perspective, lookAt, mul4, project, clamp, smooth } from '../util.js';

const THEMES = {
  dark: {
    baseOpen: [0.060, 0.058, 0.078], baseFlat: [0.150, 0.145, 0.185], accent: [0.40, 0.20, 0.70], accentHi: [0.80, 0.66, 1.0],
    spec: [0.85, 0.83, 0.96], rim: [0.10, 0.07, 0.17], lit: [0.80, 0.78, 0.92], poolCol: [0.46, 0.27, 0.80], shadowCol: [0, 0, 0],
    env: 1.0, amb: 0.5, ghostA: 0.24, mirrorA: 0.42, glow: 1.0, poolA: 0.60, shadowA: 0.0,
  },
  light: {
    baseOpen: [0.90, 0.89, 0.935], baseFlat: [0.77, 0.765, 0.83], accent: [0.42, 0.24, 0.82], accentHi: [0.80, 0.70, 1.0],
    spec: [1, 1, 1], rim: [0.07, 0.05, 0.13], lit: [0.10, 0.09, 0.14], poolCol: [0.42, 0.24, 0.82], shadowCol: [0.10, 0.06, 0.20],
    env: 0.30, amb: 0.80, ghostA: 0.40, mirrorA: 0.10, glow: 0.4, poolA: 0.30, shadowA: 0.30,
  },
};
const mixT = (a, b, t) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * t) : a + (b - a) * t);

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
  const loc = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i), name = u.name.replace(/\[0\]$/, ''); loc[name] = gl.getUniformLocation(p, u.name); }
  return { p, loc };
}
function put(gl, loc, name, v) {
  const l = loc[name]; if (l === undefined || l === null) return;
  if (typeof v === 'number') gl.uniform1f(l, v);
  else if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v);
  else if (v.length === 4) gl.uniform4fv(l, v); else if (v.length === 16) gl.uniformMatrix4fv(l, false, v); else gl.uniform4fv(l, v);
}

export class Stage {
  /** @param {HTMLCanvasElement} canvas @param {{allowSoftware?:boolean, autoQuality?:boolean}} opts */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false,
      powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !opts.allowSoftware,
    });
    if (!gl) throw new Error('WebGL 2 is not available');
    this.gl = gl;
    this.F = buildFormations();
    this.autoQuality = opts.autoQuality !== false;
    this.dprCap = opts.dprCap || 2;
    this.mirror = true;
    this.lost = false;

    // scene state
    this.pair = ['', ''];
    this.morph = 0; this.aspect = 1; this.w = 1; this.h = 1; this.dpr = 1;
    this.spin = [0, 0];
    this.themeName = 'dark'; this.themeT = 0; this.themeGoal = 0;
    this.camera = resolvePose('hero', 'hero', 0, 1.7);
    this.vp = new Float32Array(16);
    this._proj = new Float32Array(16); this._view = new Float32Array(16);

    // interaction
    this.pointer = { x: 0, y: 0, on: false, wx: 0, wz: 0, k: 0 };
    this.rips = [{ x: 0, z: 0, age: 99, amp: 0 }, { x: 0, z: 0, age: 99, amp: 0 }, { x: 0, z: 0, age: 99, amp: 0 }];
    this.sel = -1; this.idle = 0; this.demoClock = 0; this.demoAt = 0; this.demoRow = 2; this.selEnabled = true;
    this.lanePattern = null;
    this.onPick = null;

    // per-instance springs: lift, accent, ghost, flat
    this.dyn = new Float32Array(N * 4); this.tgt = new Float32Array(N * 4); this.vel = new Float32Array(N);

    // frame timing
    this.time = 0; this.ema = 16; this.slow = 0; this.frames = 0;

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.onLost && this.onLost(); });
    canvas.addEventListener('webglcontextrestored', () => { this._init(); this.lost = false; this.onRestored && this.onRestored(); });
    this._init();
    this.setPair('field', 'field');
  }

  // ---------------------------------------------------------------- GL resources
  _init() {
    const gl = this.gl;
    this.pillProg = link(gl, VERT_PILL, FRAG_PILL);
    this.decalProg = link(gl, VERT_DECAL, FRAG_DECAL);

    const pill = buildPill(), quad = buildQuad();
    this.idxCount = pill.index.length;
    this.geo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.geo); gl.bufferData(gl.ARRAY_BUFFER, pill.data, gl.STATIC_DRAW);
    this.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, pill.index, gl.STATIC_DRAW);
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, quad.data, gl.STATIC_DRAW);
    this.bufA = gl.createBuffer(); this.bufB = gl.createBuffer();
    this.bufDyn = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bufDyn); gl.bufferData(gl.ARRAY_BUFFER, N * 16, gl.DYNAMIC_DRAW);
    this.bufInfo = gl.createBuffer();

    const instance = (loc, buf, size, offset, stride) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset); gl.vertexAttribDivisor(loc, 1);
    };
    const wire = (vao, isPill) => {
      gl.bindVertexArray(vao);
      if (isPill) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.geo);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idx);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      }
      const S = 56;
      [[this.bufA, 3], [this.bufB, 7]].forEach(([buf, base]) => {
        instance(base, buf, 3, 0, S); instance(base + 1, buf, 4, 12, S); instance(base + 2, buf, 3, 28, S); instance(base + 3, buf, 4, 40, S);
      });
      instance(11, this.bufDyn, 4, 0, 16); instance(12, this.bufInfo, 4, 0, 16);
      gl.bindVertexArray(null);
    };
    this.vaoPill = gl.createVertexArray(); wire(this.vaoPill, true);
    this.vaoDecal = gl.createVertexArray(); wire(this.vaoDecal, false);
    this._pairKey = '';
    if (this.pair[0]) { const [a, b] = this.pair; this.pair = ['', '']; this.setPair(a, b); }
  }

  _pack(f) {
    const d = new Float32Array(N * 14);
    for (let i = 0; i < N; i++) {
      d.set(f.pos.subarray(i * 3, i * 3 + 3), i * 14); d.set(f.rot.subarray(i * 4, i * 4 + 4), i * 14 + 3);
      d.set(f.scl.subarray(i * 3, i * 3 + 3), i * 14 + 7); d.set(f.look.subarray(i * 4, i * 4 + 4), i * 14 + 10);
    }
    return d;
  }

  /** Choose the two formations being blended. Uploads only when the pair changes. */
  setPair(a, b) {
    if (this.pair[0] === a && this.pair[1] === b) return;
    this.pair = [a, b];
    const gl = this.gl, A = this.F[a], B = this.F[b];
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufA); gl.bufferData(gl.ARRAY_BUFFER, this._pack(A), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufB); gl.bufferData(gl.ARRAY_BUFFER, this._pack(B), gl.DYNAMIC_DRAW);
    const info = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const xm = (A.pos[i * 3] + B.pos[i * 3]) / 2, seed = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      info[i * 4] = clamp((xm + 10) / 20) * 0.78 + seed * 0.22; info[i * 4 + 1] = seed; info[i * 4 + 2] = i;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufInfo); gl.bufferData(gl.ARRAY_BUFFER, info, gl.STATIC_DRAW);
  }

  // ---------------------------------------------------------------- sizing, theme, camera
  resize(cssW, cssH, dpr) {
    this.w = Math.max(1, cssW); this.h = Math.max(1, cssH); this.aspect = this.w / this.h;
    this.dpr = clamp(dpr, 1, this.dprCap);
    const pw = Math.round(this.w * this.dpr), ph = Math.round(this.h * this.dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
  }
  setTheme(name, instant = false) {
    this.themeName = name; this.themeGoal = name === 'light' ? 1 : 0;
    if (instant) this.themeT = this.themeGoal;
  }
  setQuality({ dpr, mirror }) {
    if (typeof mirror === 'boolean') this.mirror = mirror;
    if (dpr) { this.dprCap = dpr; this.resize(this.w, this.h, this.dpr); }
  }

  /** @param {string} a pose name @param {string} b pose name @param {number} t 0..1 */
  setCamera(a, b, t, orbit = 0) { this.camera = resolvePose(a, b, t, this.aspect, orbit); }

  _matrices() {
    const c = this.camera;
    perspective(this._proj, c.fov, this.aspect, 0.5, 160);
    this._proj[8] = -c.shift[0]; this._proj[9] = -c.shift[1];
    lookAt(this._view, c.pos, c.target);
    mul4(this.vp, this._proj, this._view);
  }

  /** World point to CSS pixels in the viewport. Returns [x, y, visible]. */
  project(x, y, z) {
    const p = project(this.vp, x, y, z, this.w, this.h);
    return [p[0], p[1], p[3] > 0];
  }

  /** The same, under another camera (a resolved pose), without disturbing the one in use. */
  projectUnder(c, x, y, z) {
    const proj = this._proj2 || (this._proj2 = new Float32Array(16)), view = this._view2 || (this._view2 = new Float32Array(16)), vp = this._vp2 || (this._vp2 = new Float32Array(16));
    perspective(proj, c.fov, this.aspect, 0.5, 160);
    proj[8] = -c.shift[0]; proj[9] = -c.shift[1];
    lookAt(view, c.pos, c.target);
    mul4(vp, proj, view);
    const p = project(vp, x, y, z, this.w, this.h);
    return [p[0], p[1], p[3] > 0];
  }

  _ray(nx, ny) {
    const c = this.camera, tv = Math.tan(c.fov / 2), th = tv * this.aspect;
    let fx = c.target[0] - c.pos[0], fy = c.target[1] - c.pos[1], fz = c.target[2] - c.pos[2];
    let l = Math.hypot(fx, fy, fz); fx /= l; fy /= l; fz /= l;
    let rx = -fz, ry = 0, rz = fx; l = Math.hypot(rx, rz) || 1; rx /= l; rz /= l;      // right = f x up(0,1,0), the same axes lookAt() builds
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;       // up = right x f
    const a = (nx - c.shift[0]) * th, b = (ny - c.shift[1]) * tv;
    return { o: c.pos, d: [fx + rx * a + ux * b, fy + ry * a + uy * b, fz + rz * a + uz * b] };
  }
  /** Where the ray through (nx, ny) meets the horizontal plane at height `y` (the floor by default), as [x, z]. */
  _floorPoint(nx, ny, y = 0) {
    const r = this._ray(nx, ny);
    if (r.d[1] > -1e-4) return null;
    const t = (y - r.o[1]) / r.d[1];
    return [r.o[0] + r.d[0] * t, r.o[2] + r.d[2] * t];
  }

  // ---------------------------------------------------------------- interaction
  setPointer(nx, ny, on) {
    this.pointer.x = nx; this.pointer.y = ny; this.pointer.on = on;
    if (on) this.idle = 0;
  }
  ripple(x, z, amp = 1) {
    const r = this.rips.reduce((a, b) => (b.age > a.age ? b : a));
    r.x = x; r.z = z; r.age = 0; r.amp = amp;
  }
  /** What a field pill is: day, time and kind. */
  describe(id) {
    const info = this.F.field.info[id]; if (!info) return null;
    return { id, row: info.row, col: info.col, kind: info.kind, day: DAYS[(FIRST_DOW + info.row) % 7], time: slotTime(info.col) };
  }
  fieldWeight() { const [a, b] = this.pair, m = this.morph; return (a === 'field' ? 1 - m : 0) + (b === 'field' ? m : 0); }
  laneWeight() { const [a, b] = this.pair, m = this.morph; return (a === 'lane' ? 1 - m : 0) + (b === 'lane' ? m : 0); }

  /** A click or tap at normalised device coordinates. Returns what was hit, or null. */
  pickAt(nx, ny) {
    if (this.fieldWeight() < 0.95) return null;
    const p = this._floorPoint(nx, ny, 0.1); if (!p) return null;                // a pill is 0.2 tall: aim at its middle, not the floor under it
    const f = this.F.field; let best = -1, bd = 0.62 * 0.62 * 1.6;
    for (let i = 0; i < N; i++) {
      const dx = f.pos[i * 3] - p[0], dz = f.pos[i * 3 + 2] - p[1], d = dx * dx * 0.42 + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    const info = this.describe(best); this.idle = 0;
    if (info.kind === 'open') { this.select(best); } else { this.nudge(best); }
    this.ripple(f.pos[best * 3], f.pos[best * 3 + 2], info.kind === 'open' ? 1 : 0.5);
    return info;
  }
  select(id, silent) {
    this.sel = id;
    if (!silent && this.onPick) this.onPick(this.describe(id), true);
  }
  nudge(id) { this.vel[id] += 2.6; }
  /** World position of the top of a field pill, for pinning labels to it. */
  fieldAnchor(id) { const f = this.F.field; return [f.pos[id * 3], 0.2 + this.dyn[id * 4], f.pos[id * 3 + 2]]; }
  /** World position of a slot on a named formation (ring slots are spun with the ring). */
  slotAnchor(name, slot) {
    const F = this.F[name], i = F.inst[slot];
    let x = F.pos[i * 3], y = F.pos[i * 3 + 1], z = F.pos[i * 3 + 2];
    const side = this.pair[0] === name ? this.spin[0] : this.pair[1] === name ? this.spin[1] : 0;
    const c = Math.cos(side), s = Math.sin(side);
    return [c * x + s * z, y + 0.25, -s * x + c * z];
  }

  _demo(dt) {
    // when nobody is touching it, the hero picks open times on its own, like a person browsing
    this.idle += dt;
    if (!this.selEnabled || this.idle < 4 || this.fieldWeight() < 0.9) return;
    this.demoClock += dt;
    if (this.demoClock < 2.4) return;
    this.demoClock = 0;
    const open = [];
    for (let c = 0; c < COLS; c++) { const id = this.demoRow * COLS + c; if (this.F.field.info[id].kind === 'open') open.push(id); }
    this.demoAt = (this.demoAt + 1) % open.length;
    const id = open[this.demoAt];
    this.sel = id; if (this.onPick) this.onPick(this.describe(id), false);
    this.ripple(this.F.field.pos[id * 3], this.F.field.pos[id * 3 + 2], 0.6);
  }

  _springs(dt) {
    const m = this.morph, dyn = this.dyn, tgt = this.tgt, vel = this.vel, F = this.F;
    tgt.fill(0);
    const wf = this.fieldWeight(), wl = this.laneWeight();
    if (this.sel >= 0 && wf > 0 && this.selEnabled) { tgt[this.sel * 4] = 0.34 * wf; tgt[this.sel * 4 + 1] = wf; }
    if (this.lanePattern && wl > 0) {
      const inst = F.lane.inst;
      for (let j = 0; j < this.lanePattern.length; j++) {
        const t = this.lanePattern[j], i = inst[j];
        tgt[i * 4] = t[0] * wl; tgt[i * 4 + 1] = t[1] * wl; tgt[i * 4 + 2] = t[2] * wl; tgt[i * 4 + 3] = t[3] * wl;
      }
    }
    const k = 1 - Math.exp(-11 * dt);
    for (let i = 0; i < N; i++) {
      const o = i * 4, v = vel[i] + ((tgt[o] - dyn[o]) * 230 - vel[i] * 19) * dt;
      vel[i] = v; dyn[o] += v * dt;
      dyn[o + 1] += (tgt[o + 1] - dyn[o + 1]) * k; dyn[o + 2] += (tgt[o + 2] - dyn[o + 2]) * k; dyn[o + 3] += (tgt[o + 3] - dyn[o + 3]) * k;
    }
    void m;
  }

  // ---------------------------------------------------------------- frame
  /** Advance interaction state. Call once per frame before render(). */
  update(dt, { morph = 0, spinA = 0, spinB = 0 } = {}) {
    dt = Math.min(dt, 1 / 24);
    this.time += dt; this.morph = morph; this.spin = [spinA, spinB];
    this.themeT += (this.themeGoal - this.themeT) * (1 - Math.exp(-7 * dt));
    if (Math.abs(this.themeGoal - this.themeT) < 0.002) this.themeT = this.themeGoal;
    this._matrices();

    const pt = this.pointer, floor = pt.on ? this._floorPoint(pt.x, pt.y) : null;
    if (floor) { pt.wx = floor[0]; pt.wz = floor[1]; }
    pt.k += ((pt.on && floor ? 1 : 0) - pt.k) * (1 - Math.exp(-8 * dt));

    this._demo(dt);
    this._springs(dt);
    for (const r of this.rips) { if (r.age < 99) r.age += dt; if (r.age > 3.4) { r.amp = 0; r.age = 99; } }

    // frame-time watch: if the device cannot keep up, give up pixels before giving up smoothness
    this.ema += (dt * 1000 - this.ema) * 0.05; this.frames++;
    if (this.autoQuality && this.frames > 40) {
      this.slow = this.ema > 27 ? this.slow + 1 : Math.max(0, this.slow - 2);
      if (this.slow > 50) {
        this.slow = 0;
        if (this.dprCap > 1.01) this.setQuality({ dpr: Math.max(1, this.dprCap - 0.35) });
        else if (this.mirror) this.setQuality({ mirror: false });
        if (this.onQuality) this.onQuality({ dpr: this.dprCap, mirror: this.mirror });
      }
    }
  }

  render() {
    if (this.lost) return;
    const gl = this.gl, T = this.themeT, th = {};
    for (const k of Object.keys(THEMES.dark)) th[k] = mixT(THEMES.dark[k], THEMES.light[k], T);
    const c = this.camera, pt = this.pointer;
    const cursor = [pt.wx, pt.wz, 1.9, pt.k];
    const rips = []; for (const r of this.rips) rips.push(r.x, r.z, r.age, r.amp);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufDyn); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.dyn);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);

    const common = (prog) => {
      const u = prog.loc;
      put(gl, u, 'uVP', this.vp); put(gl, u, 'uMorph', this.morph); put(gl, u, 'uStagger', 0.55); put(gl, u, 'uArc', 1.0);
      put(gl, u, 'uSpin', this.spin); put(gl, u, 'uCursor', cursor); put(gl, u, 'uCam', c.pos);
      put(gl, u, 'uFogA', c.fogA); put(gl, u, 'uFogB', c.fogB); put(gl, u, 'uDim', c.dim);
      gl.uniform4fv(u.uRip, rips);
    };

    // 1. the glossy floor: the same pills, mirrored, faded with depth
    gl.useProgram(this.pillProg.p); gl.bindVertexArray(this.vaoPill);
    common(this.pillProg);
    const u = this.pillProg.loc;
    put(gl, u, 'uBaseOpen', th.baseOpen); put(gl, u, 'uBaseFlat', th.baseFlat); put(gl, u, 'uAccent', th.accent); put(gl, u, 'uAccentHi', th.accentHi);
    put(gl, u, 'uSpec', th.spec); put(gl, u, 'uLitCol', th.lit); put(gl, u, 'uRim', th.rim); put(gl, u, 'uEnv', th.env); put(gl, u, 'uAmb', th.amb);
    put(gl, u, 'uMirrorA', th.mirrorA); put(gl, u, 'uGhostA', th.ghostA); put(gl, u, 'uGlow', th.glow);
    if (this.mirror) {
      put(gl, u, 'uMirror', 1); gl.frontFace(gl.CW);
      gl.drawElementsInstanced(gl.TRIANGLES, this.idxCount, gl.UNSIGNED_SHORT, 0, N);
      gl.frontFace(gl.CCW);
    }

    // 2. pools of light (dark) and contact shadows (light) on the floor
    gl.useProgram(this.decalProg.p); gl.bindVertexArray(this.vaoDecal);
    common(this.decalProg);
    const d = this.decalProg.loc;
    put(gl, d, 'uPoolCol', th.poolCol); put(gl, d, 'uShadowCol', th.shadowCol); put(gl, d, 'uPoolA', th.poolA); put(gl, d, 'uShadowA', th.shadowA);
    put(gl, d, 'uMargin', 1.6);
    gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, N);
    gl.depthMask(true); gl.enable(gl.CULL_FACE);

    // 3. the pills
    gl.useProgram(this.pillProg.p); gl.bindVertexArray(this.vaoPill);
    put(gl, u, 'uMirror', 0);
    gl.drawElementsInstanced(gl.TRIANGLES, this.idxCount, gl.UNSIGNED_SHORT, 0, N);
    gl.bindVertexArray(null);
  }
}

export { smooth };
