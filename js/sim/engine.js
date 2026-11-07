// The booking-rules engine behind "Try the rules". It is a plain-JavaScript port of the app's own SlotEngine
// (lib/features/scheduling/domain/slot_engine.dart) with the same rules, in the same order:
//   1. working hours minus the daily break give the bookable ranges;
//   2. if the daily limit is already reached, nothing is offered;
//   3. candidate start times run from the start of each range, every `step` minutes, while the service still fits;
//   4. a start before "now + minimum notice" is dropped;
//   5. a start is dropped when it would overlap another appointment or the gap after it (each blocks [start, end + gap)).
// Times are minutes from midnight of "today"; tomorrow's 9:00 is 1440 + 540.

export const DAY = 1440;

/** @typedef {{start:number,end:number}} Range */

export function subtractRange(r, cut) {
  if (cut.end <= r.start || cut.start >= r.end) return [r];
  const out = [];
  if (cut.start > r.start) out.push({ start: r.start, end: cut.start });
  if (cut.end < r.end) out.push({ start: cut.end, end: r.end });
  return out;
}

/**
 * @param {object} c
 * @param {number} c.dayOffset 0 = today, 1 = tomorrow
 * @param {number} c.now minutes from today's midnight
 * @param {{start:number,end:number}} c.hours opening hours as minutes into the day
 * @param {{on:boolean,start:number,end:number}} c.brk daily break
 * @param {{start:number,end:number}[]} c.existing appointments that block time (absolute minutes)
 * @param {number} c.duration service length
 * @param {number} c.gap gap kept after each appointment
 * @param {number} c.step spacing between offered start times
 * @param {number} c.notice minimum notice
 * @param {number} c.perDay daily limit, 0 = none
 */
export function computeDay(c) {
  const day = c.dayOffset * DAY;
  let ranges = [{ start: day + c.hours.start, end: day + c.hours.end }];
  if (c.brk.on) ranges = ranges.flatMap((r) => subtractRange(r, { start: day + c.brk.start, end: day + c.brk.end }));

  const blocking = c.existing;
  const sameDay = (a) => a.start >= day && a.start < day + DAY;
  const booked = blocking.filter(sameDay).length;
  const limited = c.perDay > 0 && booked >= c.perDay;
  const earliest = c.now + c.notice;

  const candidates = [];   // every start position the schedule could have, with the reason it is or is not offered
  const open = [];
  const seen = new Set();
  for (const r of ranges) {
    for (let m = r.start; m < r.end; m += c.step) {
      if (seen.has(m)) continue;
      seen.add(m);
      const end = m + c.duration;
      let status;
      if (end > r.end) status = 'tooLong';
      else if (limited) status = 'limit';
      else if (m < earliest) status = 'notice';
      else if (blocking.some((a) => m < a.end + c.gap && a.start < end + c.gap)) status = 'conflict';
      else status = 'open';
      candidates.push({ m, status });
      if (status === 'open') open.push(m);
    }
  }
  return { day, ranges, candidates, open, booked, limited, earliest };
}

/** "9:30 AM" for minutes into any day. */
export function fmt(m) {
  const t = ((m % DAY) + DAY) % DAY, h = Math.floor(t / 60), mm = t % 60;
  return (h % 12 === 0 ? 12 : h % 12) + ':' + String(mm).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}
