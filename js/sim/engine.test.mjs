// node js/sim/engine.test.mjs  -- checks the port against hand-worked cases and an independent brute-force reading of the rules.
import assert from 'node:assert/strict';
import { computeDay, fmt, DAY } from './engine.js';

const H = (h, m = 0) => h * 60 + m;
const base = () => ({
  dayOffset: 0, now: H(10, 20), hours: { start: H(9), end: H(17) }, brk: { on: true, start: H(13), end: H(14) },
  existing: [], duration: 30, gap: 0, step: 30, notice: 120, perDay: 0,
});
const times = (c) => computeDay(c).open.map(fmt);

// 1. hand-worked: now 10:20 + 2h notice -> earliest 12:20, so the first half-hour start is 12:30; the break (1-2 PM) offers nothing
let c = base();
assert.deepEqual(times(c).slice(0, 3), ['12:30 PM', '2:00 PM', '2:30 PM']);
assert.equal(times(c).at(-1), '4:30 PM', 'a 30-minute service must end by 5 PM');
assert.ok(!times(c).includes('1:00 PM') && !times(c).includes('1:30 PM'));

// 2. no notice: the past is still not offered ("now" is 10:20), the first start is 10:30
c = base(); c.notice = 0;
assert.equal(times(c)[0], '10:30 AM');

// 3. a booking blocks itself and the gap after it, and a new start also needs its own gap before the next booking
c = base(); c.notice = 0; c.existing = [{ start: H(11), end: H(11, 30) }]; c.gap = 15;
let t = times(c);
assert.ok(!t.includes('10:30 AM'), '10:30 + 30 min + 15 min gap would run into the 11:00 booking');
assert.ok(!t.includes('11:00 AM') && !t.includes('11:30 AM'), 'the booking and its gap block until 11:45');
assert.equal(t[0], '12:00 PM');
c.step = 15; t = times(c);
assert.ok(t.includes('11:45 AM') && !t.includes('11:30 AM'), 'with 15-minute steps 11:45 is the first start after the gap');
assert.ok(!t.includes('10:15 AM') && !t.includes('10:30 AM') && !t.includes('10:45 AM'));

// 4. daily limit closes the day
c = base(); c.notice = 0; c.perDay = 4;
c.existing = [11, 12, 14, 16].map((h) => ({ start: H(h), end: H(h, 30) }));
assert.equal(computeDay(c).open.length, 0);
assert.ok(computeDay(c).candidates.every((x) => x.status === 'limit' || x.status === 'tooLong'));
c.perDay = 6; assert.ok(computeDay(c).open.length > 0);

// 5. tomorrow: only tomorrow's bookings count towards the limit, notice is measured from now
c = base(); c.dayOffset = 1; c.notice = DAY; c.existing = [{ start: DAY + H(9), end: DAY + H(9, 30) }];
t = times(c);
assert.equal(t[0], '10:30 AM', '1 day notice from 10:20 today means 10:20 tomorrow');
c.notice = 0; assert.ok(!times(c).includes('9:00 AM') && times(c)[0] === '9:30 AM');

// 6. a service that does not fit before the break or closing time is never offered
c = base(); c.notice = 0; c.duration = 90; c.step = 30;
t = times(c);
assert.ok(!t.includes('12:30 PM'), '12:30 + 90 min runs into the break');
assert.ok(t.includes('11:30 AM'), '11:30 + 90 ends exactly at the break');
assert.ok(t.at(-1) === '3:30 PM', 'last fit before 5 PM is 3:30 PM');

// 7. property test against an independent brute-force reading, over many random configurations
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
for (let i = 0; i < 4000; i++) {
  const cfg = base();
  cfg.dayOffset = pick([0, 1]); cfg.duration = pick([15, 30, 45, 60, 90]); cfg.gap = pick([0, 10, 15, 30]);
  cfg.step = pick([15, 30, 60]); cfg.notice = pick([0, 60, 120, 240, 1440]); cfg.perDay = pick([0, 4, 6, 8]);
  cfg.brk = { on: rnd() < 0.7, start: H(13), end: H(14) };
  cfg.now = H(8) + Math.floor(rnd() * 300);
  const n = Math.floor(rnd() * 6);
  cfg.existing = Array.from({ length: n }, () => {
    const d = pick([0, 1]) * DAY, s = d + H(9) + 15 * Math.floor(rnd() * 28), len = pick([15, 30, 45, 60]);
    return { start: s, end: s + len };
  });
  const got = computeDay(cfg).open;
  // brute force: every minute of the day is a candidate; it is offered only if it is a step-aligned start inside a range
  const day = cfg.dayOffset * DAY;
  const ranges = [{ s: day + cfg.hours.start, e: day + cfg.hours.end }];
  const rs = cfg.brk.on ? [{ s: ranges[0].s, e: day + cfg.brk.start }, { s: day + cfg.brk.end, e: ranges[0].e }] : ranges;
  const sameDayCount = cfg.existing.filter((a) => a.start >= day && a.start < day + DAY).length;
  const want = [];
  for (let m = day; m < day + DAY; m++) {
    if (cfg.perDay && sameDayCount >= cfg.perDay) break;
    const r = rs.find((x) => m >= x.s && m < x.e); if (!r) continue;
    if ((m - r.s) % cfg.step !== 0) continue;
    if (m + cfg.duration > r.e) continue;
    if (m < cfg.now + cfg.notice) continue;
    const end = m + cfg.duration;
    if (cfg.existing.some((a) => m < a.end + cfg.gap && a.start < end + cfg.gap)) continue;
    want.push(m);
  }
  assert.deepEqual(got, want, 'mismatch for ' + JSON.stringify(cfg));
  // invariants
  for (const m of got) {
    assert.ok(m >= cfg.now + cfg.notice);
    assert.ok(!cfg.existing.some((a) => m < a.end + cfg.gap && a.start < m + cfg.duration + cfg.gap));
  }
}
console.log('engine: all checks passed (7 groups, 4000 random configurations)');
