// The one mesh the whole stage is made of: a rounded-stadium prism (a "pill") with a bevelled top edge.
//
// Local space: origin at the middle of the base, the pill runs along X, Y is up.
// Vertices store their offset from the centre of their own end cap and which end that is (aEnd = -1 | 0 | +1),
// so the vertex shader can stretch the straight middle to any length while the caps stay perfectly round.

export const PILL = { W: 0.5, H: 0.22, BEVEL: 0.07, L: 1 };

/**
 * @returns {{ data: Float32Array, index: Uint16Array, stride: number }}
 *   data layout per vertex: x, y, z, nx, ny, nz, end
 */
export function buildPill({ caps = 14, bevelSteps = 4 } = {}) {
  const { W, H, BEVEL: b, L } = PILL;
  const r = W / 2, half = (L - W) / 2;
  const verts = [];   // {p:[x,y,z], n:[x,y,z], e}
  const tris = [];

  // Unit outward direction around the outline, and the end cap each point belongs to.
  const ring = [];
  for (let i = 0; i <= caps; i++) { const a = -Math.PI / 2 + (Math.PI * i) / caps; ring.push({ e: 1, dx: Math.cos(a), dz: Math.sin(a) }); }
  for (let i = 0; i <= caps; i++) { const a = Math.PI / 2 + (Math.PI * i) / caps; ring.push({ e: -1, dx: Math.cos(a), dz: Math.sin(a) }); }
  const N = ring.length;

  const addRing = (inset, y, up, side) => {
    const first = verts.length;
    for (const pt of ring) {
      verts.push({
        p: [(r - inset) * pt.dx, y, (r - inset) * pt.dz],
        n: [side * pt.dx, up, side * pt.dz],
        e: pt.e,
      });
    }
    return first;
  };

  // Rings from the top edge, round the bevel, down the wall to the base.
  const rings = [];
  for (let k = 0; k <= bevelSteps; k++) {
    const a = (Math.PI / 2) * (k / bevelSteps);
    rings.push(addRing(b * (1 - Math.sin(a)), H - b + b * Math.cos(a), Math.cos(a), Math.sin(a)));
  }
  rings.push(addRing(0, 0, 0, 1));

  // Top face as a fan from the middle.
  const centre = verts.length;
  verts.push({ p: [0, H, 0], n: [0, 1, 0], e: 0 });

  const full = (v) => [v.e * half + v.p[0], v.p[1], v.p[2]];
  const tri = (a, bb, c) => {
    // orient so the geometric normal agrees with the averaged vertex normals
    const A = full(verts[a]), B = full(verts[bb]), C = full(verts[c]);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const nx = verts[a].n[0] + verts[bb].n[0] + verts[c].n[0];
    const ny = verts[a].n[1] + verts[bb].n[1] + verts[c].n[1];
    const nz = verts[a].n[2] + verts[bb].n[2] + verts[c].n[2];
    if (gx * nx + gy * ny + gz * nz >= 0) tris.push(a, bb, c); else tris.push(a, c, bb);
  };

  for (let i = 0; i < N; i++) tri(centre, rings[0] + i, rings[0] + ((i + 1) % N));
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = rings[k] + i, b2 = rings[k] + j, c = rings[k + 1] + i, d = rings[k + 1] + j;
      tri(a, b2, c); tri(b2, d, c);
    }
  }

  const stride = 7;
  const data = new Float32Array(verts.length * stride);
  verts.forEach((v, i) => {
    data.set([v.p[0], v.p[1], v.p[2], v.n[0], v.n[1], v.n[2], v.e], i * stride);
  });
  return { data, index: new Uint16Array(tris), stride };
}

/** A unit quad (two triangles) in the XZ plane for floor decals: x, z in [-1, 1]. */
export function buildQuad() {
  return { data: new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), count: 6 };
}
