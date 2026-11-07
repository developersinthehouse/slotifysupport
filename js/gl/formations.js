// The four arrangements the same pills take as you scroll: a calendar field, a day dial, one day laid out flat, and the wordmark.
// Every formation is expressed per *instance*, so a pill that is a field cell in the hero can become a tick on the dial,
// then a slot in the lane. Instances a formation does not need shrink into the nearest pill that it does.
import { rng } from '../util.js';
import { WORDMARK } from './wordmark-data.js';

export const COLS = 16;           // half-hour slots, 9:00 to 17:00
export const ROWS = 16;           // days
export const N = COLS * ROWS;     // instances on stage
export const BREAK_COLS = [8, 9]; // 13:00 to 14:00
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const FIRST_DOW = 2;       // the front row of the field is a Wednesday
export const dayOff = (row) => ((FIRST_DOW + row) % 7) >= 5;

const PITCH_X = 1.18, PITCH_Z = 0.76;
const PILL = { len: 1, hgt: 0.2, wid: 0.5 };

export const slotTime = (col) => {
  const m = 9 * 60 + col * 30, h = Math.floor(m / 60), mm = m % 60;
  return (h > 12 ? h - 12 : h) + ':' + (mm ? '30' : '00') + ' ' + (h >= 12 ? 'PM' : 'AM');
};

const yawQ = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

function empty() {
  return { pos: new Float32Array(N * 3), rot: new Float32Array(N * 4), scl: new Float32Array(N * 3), look: new Float32Array(N * 4) };
}

/** Put `slots` onto instances, matching each slot to the nearest free pill of the previous formation. */
function place(slots, prev, seed) {
  const rand = rng(seed), out = empty();
  const used = new Uint8Array(N), inst = new Int32Array(slots.length).fill(-1);
  const order = slots.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const si of order) {
    const s = slots[si]; let best = -1, bd = Infinity;
    for (let j = 0; j < N; j++) {
      if (used[j]) continue;
      const dx = prev.pos[j * 3] - s.x, dz = prev.pos[j * 3 + 2] - s.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = j; }
    }
    inst[si] = best; used[best] = 1;
  }
  const write = (j, s, hidden) => {
    out.pos.set([s.x, s.y || 0, s.z], j * 3);
    out.rot.set(yawQ(s.yaw || 0), j * 4);
    out.scl.set(hidden ? [0.0001, 0.0001, 0.0001] : [s.len, s.hgt, s.wid], j * 3);
    out.look.set([s.flat || 0, hidden ? 0 : s.ghost || 0, hidden ? 0 : s.acc || 0, hidden ? 0 : s.lit || 0], j * 4);
  };
  slots.forEach((s, si) => write(inst[si], s, false));
  for (let j = 0; j < N; j++) {   // surplus pills fold into the nearest slot
    if (used[j]) continue;
    let best = 0, bd = Infinity;
    for (let si = 0; si < slots.length; si++) {
      const dx = prev.pos[j * 3] - slots[si].x, dz = prev.pos[j * 3 + 2] - slots[si].z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = si; }
    }
    write(j, slots[best], true);
  }
  return { ...out, inst: Array.from(inst) };
}

// ---------- field: 16 half-hour columns x 16 days, front row first
function makeField() {
  const f = empty(), rand = rng(7), info = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      const x = (col - (COLS - 1) / 2) * PITCH_X, z = ((ROWS - 1) / 2 - row) * PITCH_Z - 1.2;
      const off = dayOff(row), brk = BREAK_COLS.includes(col);
      const booked = !off && !brk && rand() < 0.27;
      f.pos.set([x, 0, z], i * 3); f.rot.set([0, 0, 0, 1], i * 4);
      f.scl.set([PILL.len, PILL.hgt, PILL.wid], i * 3);
      f.look.set([booked ? 1 : 0, off || brk ? 1 : 0, 0, 0], i * 4);
      info.push({ row, col, kind: off ? 'off' : brk ? 'break' : booked ? 'booked' : 'open' });
    }
  }
  return { ...f, info, inst: Array.from({ length: N }, (_, i) => i) };
}

// ---------- ring: 48 half-hour slots round the clock, noon at the back
export const RING_R = 5.3;
function ringSlots() {
  const slots = [];
  for (let k = 0; k < 48; k++) {
    const th = (k / 48) * Math.PI * 2, hour = k % 2 === 0;
    const open = k >= 18 && k < 34, brk = k === 26 || k === 27;
    slots.push({
      x: Math.sin(th) * RING_R, z: -Math.cos(th) * RING_R, yaw: Math.PI / 2 - th,
      len: hour ? 1.3 : 0.92, hgt: 0.2, wid: 0.5,
      ghost: open && !brk ? 0 : 1, flat: open && !brk && (k === 20 || k === 24 || k === 31) ? 1 : 0,
      acc: k === 22 ? 1 : 0, lit: open && !brk ? 0.55 : 0,
    });
  }
  return slots;
}

// ---------- lane: one day, laid flat and enlarged
function laneSlots() {
  // every pill starts open; the page then shows breaks, bookings and rules by driving each pill's own state
  const slots = [];
  for (let c = 0; c < COLS; c++) slots.push({ x: (c - (COLS - 1) / 2) * PITCH_X, z: 0, len: 1, hgt: 0.24, wid: 0.5, lit: 0.4 });
  return slots;
}

// ---------- wordmark
export const WORD_W = 17;
function wordSlots() {
  const s = WORD_W / WORDMARK.width, pitch = WORDMARK.band * s, slots = [];
  for (const [row, x0, x1, acc] of WORDMARK.pills) {
    slots.push({
      x: ((x0 + x1) / 2 - WORDMARK.width / 2) * s, z: (row + 0.5 - WORDMARK.rows / 2) * pitch + 0.3,
      len: (x1 - x0) * s, hgt: 0.11, wid: pitch * 0.74, acc, lit: 1,
    });
  }
  return slots;
}

export function buildFormations() {
  const field = makeField();
  const ring = place(ringSlots(), field, 11);
  const lane = place(laneSlots(), ring, 13);
  const word = place(wordSlots(), field, 17);
  return { field, ring, lane, word, N };
}
