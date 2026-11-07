// Camera poses. A pose says what to look at, from which angle, and how many world units should span the width of the
// screen, so the same composition holds on a wide monitor and on a phone. `sh` is a lens shift (in screen halves)
// that slides the scene around the frame without changing perspective: that is how text gets its half of the screen.
const D = Math.PI / 180;

const LANDSCAPE = {
  hero: { t: [0, 0, -0.9], el: 29, az: 0, fit: 15.5, fov: 28, sh: [0, -0.34], fog: [-1.0, 5.4], dim: 1 },
  ring: { t: [0, 0, 0], el: 50, az: 0, fit: 24, fov: 28, sh: [0.48, 0.0], fog: [14, 40], dim: 1 },
  lane: { t: [0, 0, 0], el: 24, az: 0, fit: 21.5, fov: 28, sh: [0, 0.72], fog: [12, 40], dim: 0.85 },
  top:  { t: [0, 0, -1.2], el: 64, az: 0, fit: 22, fov: 30, sh: [0, 0], fog: [14, 40], dim: 0.22 },
  lane2: { t: [0, 0, 0], el: 30, az: 0, fit: 46, fov: 28, sh: [0.5, 0.36], fog: [12, 40], dim: 0.9 },
  none: { t: [0, 0, -1.2], el: 64, az: 0, fit: 22, fov: 30, sh: [0, 0], fog: [14, 40], dim: 0 },
  word: { t: [0, 0, 0.3], el: 58, az: 0, fit: 20.5, fov: 30, sh: [0, 0.1], fog: [20, 60], dim: 1 },
};
const PORTRAIT = {
  hero: { t: [0, 0, -0.9], el: 30, az: 0, fit: 9.5, fov: 40, sh: [0, -0.36], fog: [0, 6.5], dim: 0.8 },
  ring: { t: [0, 0, 0], el: 52, az: 0, fit: 15.5, fov: 40, sh: [0, -0.42], fog: [10, 40], dim: 1 },
  lane: { t: [0, 0, 0], el: 36, az: 0, fit: 11, fov: 40, sh: [0, -0.66], fog: [10, 40], dim: 0 },
  top:  { t: [0, 0, -1.2], el: 66, az: 0, fit: 12, fov: 40, sh: [0, 0], fog: [10, 40], dim: 0 },           // a finite field would show its edges behind a phone-width column of text
  lane2: { t: [0, 0, 0], el: 36, az: 0, fit: 11, fov: 40, sh: [0, -0.8], fog: [10, 40], dim: 0 },
  none: { t: [0, 0, -1.2], el: 66, az: 0, fit: 12, fov: 40, sh: [0, 0], fog: [10, 40], dim: 0 },
  word: { t: [0, 0, 0.3], el: 62, az: 0, fit: 19.5, fov: 40, sh: [0, 0.05], fog: [20, 60], dim: 1 },
};

export function poseSet(aspect) { return aspect < 0.85 ? PORTRAIT : LANDSCAPE; }

const mix = (a, b, t) => a + (b - a) * t;
const mixv = (a, b, t) => a.map((v, i) => mix(v, b[i], t));

/** Blend two named poses and resolve to an actual camera. */
export function resolvePose(a, b, t, aspect, orbit = 0) {
  const set = poseSet(aspect), A = set[a], B = set[b] || A;
  const tt = t * t * (3 - 2 * t);
  const el = mix(A.el, B.el, tt) * D, az = (mix(A.az, B.az, tt) + orbit) * D;
  const fov = mix(A.fov, B.fov, tt) * D, fit = mix(A.fit, B.fit, tt);
  const target = mixv(A.t, B.t, tt);
  const dist = fit / (2 * Math.tan(fov / 2) * aspect);
  const pos = [
    target[0] + dist * Math.cos(el) * Math.sin(az),
    target[1] + dist * Math.sin(el),
    target[2] + dist * Math.cos(el) * Math.cos(az),
  ];
  const fog = mixv(A.fog, B.fog, tt);
  return { pos, target, fov, shift: mixv(A.sh, B.sh, tt), fogA: dist + fog[0], fogB: dist + fog[1], dim: mix(A.dim, B.dim, tt), dist };
}
