// "Try the rules": the booking-rules demonstration. It builds its own DOM (no innerHTML) on top of sim/engine.js.
// Notification wording comes from the app's own text builder (notification_text.dart); the option lists are the
// app's own (booking_rules_section.dart, service_editor_sheet.dart).
import { computeDay, fmt, DAY } from './engine.js';

const HOURS = { start: 9 * 60, end: 17 * 60 };
const BREAK = { start: 13 * 60, end: 14 * 60 };
const NOW = 10 * 60 + 20;                 // the sample clock: 10:20 AM today
const VIEW = { start: 8 * 60, end: 18 * 60 };
const DATES = ['Wed, 4 Nov', 'Thu, 5 Nov'];
const CLIENT = 'Aarav Mehta', PRACTICE = 'Sample Practice';

const SAMPLE = [
  { start: 11 * 60, end: 11 * 60 + 30, who: 'Ravi Menon' },
  { start: 12 * 60, end: 12 * 60 + 45, who: 'Sana Qureshi' },
  { start: 14 * 60 + 30, end: 15 * 60, who: 'Kabir Rao' },
  { start: 16 * 60, end: 16 * 60 + 30, who: 'Isha Patel' },
  { start: DAY + 9 * 60, end: DAY + 9 * 60 + 30, who: 'Dev Malhotra' },
  { start: DAY + 14 * 60, end: DAY + 14 * 60 + 30, who: 'Nisha Verma' },
  { start: DAY + 15 * 60 + 30, end: DAY + 16 * 60, who: 'Arjun Nair' },
];

const OPTIONS = {
  duration: [15, 30, 45, 60, 90].map((v) => [v, v + ' min']),
  gap: [[0, 'None'], [10, '10 min'], [15, '15 min'], [30, '30 min']],
  step: [[15, '15 min'], [30, '30 min'], [60, '1 hour']],
  notice: [[0, 'No minimum'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [1440, '1 day']],
  perDay: [[0, 'No limit'], [4, 'At most 4'], [6, 'At most 6'], [8, 'At most 8']],
};

// `words` is the practice's own wording: [client, appointment]. `service` is the name of the sample service.
const PRESETS = {
  start: {
    label: 'Starting point', service: 'Consultation', words: ['Client', 'Appointment'],
    rules: { duration: 30, gap: 0, step: 30, notice: 120, perDay: 0, brk: true, approval: false },
    note: 'A plain day: 9 to 5, a one-hour break, 30-minute appointments offered every half hour, and two hours of notice. Change anything on the left.',
  },
  consultant: {
    label: 'A consultant', service: 'Strategy call', words: ['Client', 'Appointment'],
    rules: { duration: 45, gap: 15, step: 30, notice: 240, perDay: 0, brk: true, approval: false },
    note: 'Add questions to a service and mark the ones that are required. The client answers them while booking, so you arrive prepared. Here: 45-minute sessions with a 15-minute gap after each and 4 hours of notice.',
  },
  clinic: {
    label: 'A clinic', service: 'Check-up', words: ['Patient', 'Consultation'],
    rules: { duration: 30, gap: 10, step: 30, notice: 60, perDay: 0, brk: true, approval: true },
    note: 'Turn on manual confirmation, choose the wording Patient and Consultation, and answer requests from your dashboard. The client sees Pending until you do.',
  },
  tutor: {
    label: 'A tutor', service: 'Maths lesson', words: ['Student', 'Lesson'],
    rules: { duration: 60, gap: 0, step: 60, notice: 120, perDay: 6, brk: true, approval: false },
    note: 'Set working hours, a break in the middle of the day, the days you are off, and a daily limit. Lessons only appear in the gaps that are really open. Here: hour-long lessons, at most 6 a day.',
  },
};

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

/** A group of choices where exactly one is selected. Arrow keys move the selection, as radio buttons do. */
function radio(label, options, get, set) {
  const group = h('div', { class: 'opts', role: 'radiogroup', 'aria-label': label });
  const btns = options.map(([, text]) => h('button', { type: 'button', class: 'chip', role: 'radio', text }));
  btns.forEach((b, i) => {
    b.addEventListener('click', () => set(options[i][0]));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = (i + d + btns.length) % btns.length;
      set(options[n][0]);
      btns[n].focus();
    });
  });
  group.append(...btns);
  const sync = () => btns.forEach((b, i) => {
    const on = options[i][0] === get();
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  return { el: h('div', { class: 'sim-field' }, h('span', { text: label }), group), sync };
}

function toggle(label, hint, get, set) {
  const btn = h('button', { type: 'button', class: 'sw-btn', role: 'switch', 'aria-label': label, onclick: () => set(!get()) });
  return { el: h('div', { class: 'sw-row' }, h('span', null, label, h('small', { text: hint })), btn), sync: () => btn.setAttribute('aria-checked', String(get())) };
}

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/**
 * What each of the sixteen half-hour pills of the 3D day should look like for the current state.
 * Every entry is [lift, accent, ghost, flat], the stage's per-pill channels.
 * @returns {number[][]}
 */
export function lanePatternFrom({ result, state, existing, hours, brk }) {
  const day = result.day, out = [];
  const covered = result.open.map((m) => [m, m + state.duration]);
  for (let c = 0; c < 16; c++) {
    const a = day + hours.start + c * 30, b = a + 30;
    const mine = existing.find((x) => x.mine && overlaps(a, b, x.start, x.end));
    const taken = existing.find((x) => overlaps(a, b, x.start, x.end));
    if (mine) out.push([0.12, 1, 0, 0]);
    else if (taken) out.push([0, 0, 0, 1]);
    else if (state.brk && overlaps(a, b, day + brk.start, day + brk.end)) out.push([0, 0, 1, 0]);
    else if (covered.some(([s, e]) => overlaps(a, b, s, e))) out.push([0.2, 0, 0, 0]);
    else out.push([0, 0, 0.75, 0]);
  }
  return out;
}

/**
 * @param {HTMLElement} root
 * @param {{ onChange?: (s:object) => void }} hooks
 */
export function initSim(root, hooks = {}) {
  root.replaceChildren();
  const S ={ preset: 'start', ...PRESETS.start.rules, day: 0, mine: [], last: null };
  const syncers = [];
  const track = (c) => { syncers.push(c.sync); return c.el; };

  const strip = h('div', { class: 'sim-strip', role: 'img', 'aria-label': 'The day from 8 AM to 6 PM: hours, break, bookings and offered start times.' });
  const timesBox = h('div', { class: 'sim-times' });
  const status = h('p', { class: 'sim-status', role: 'status', 'aria-live': 'polite' });
  const resultBox = h('div', { class: 'sim-result', tabindex: '-1', 'aria-label': 'Result of the booking you tried' });
  resultBox.hidden = true;
  const note = h('p', { class: 'sim-note' });
  const nowLabel = h('p', { class: 'sim-now' });
  const dayBtns = [[0, 'Today'], [1, 'Tomorrow']].map(([v, text]) => h('button', {
    type: 'button', class: 'chip', role: 'radio', text, onclick: () => { S.day = v; S.last = null; render(); },
  }));
  const dayGroup = h('div', { class: 'opts', role: 'radiogroup', 'aria-label': 'Which day to look at' }, ...dayBtns);

  const presetBtns = Object.entries(PRESETS).map(([key, p]) => h('button', {
    type: 'button', class: 'chip', 'data-preset': key, text: p.label, onclick: () => applyPreset(key),
  }));
  const presets = h('div', { class: 'sim-presets', role: 'group', 'aria-label': 'Start from an example' }, h('span', { class: 'sim-label', text: 'Start from' }), ...presetBtns);

  const mk = (key, label, opts) => track(radio(label, opts, () => S[key], (v) => { S[key] = v; S.last = null; render(); }));
  const controls = h('form', { class: 'sim-controls', 'aria-label': 'Booking rules', onsubmit: (e) => e.preventDefault() },
    h('fieldset', null, h('legend', { text: 'The service' }),
      mk('duration', 'Duration', OPTIONS.duration),
      mk('gap', 'Gap after each appointment', OPTIONS.gap),
      mk('step', 'Start times every', OPTIONS.step)),
    h('fieldset', null, h('legend', { text: 'Booking rules' }),
      mk('notice', 'Minimum notice', OPTIONS.notice),
      mk('perDay', 'Appointments per day', OPTIONS.perDay),
      track(toggle('Daily break', '1:00 PM to 2:00 PM', () => S.brk, (v) => { S.brk = v; S.last = null; render(); })),
      track(toggle('Confirm requests manually', 'Bookings wait for your approval', () => S.approval, (v) => { S.approval = v; render(); }))));

  const board = h('div', { class: 'sim-board' }, h('div', { class: 'sim-top' }, dayGroup, nowLabel), strip, timesBox, status, resultBox);
  root.append(presets, note, h('div', { class: 'sim-grid' }, controls, board));

  function applyPreset(key) {
    S.preset = key; Object.assign(S, PRESETS[key].rules); S.mine = []; S.last = null;
    render();
  }

  const existingFor = () => [...SAMPLE.map((b) => ({ ...b })), ...S.mine];
  const compute = () => computeDay({
    dayOffset: S.day, now: NOW, hours: HOURS, brk: { on: S.brk, ...BREAK }, existing: existingFor(),
    duration: S.duration, gap: S.gap, step: S.step, notice: S.notice, perDay: S.perDay,
  });

  function book(m) {
    const hadFocus = timesBox.contains(document.activeElement);
    S.mine.push({ start: m, end: m + S.duration, who: 'You', mine: true });
    S.last = { m, day: S.day, pending: S.approval, preset: S.preset, duration: S.duration };
    render();
    if (hadFocus) resultBox.focus({ preventScroll: true });   // the time just taken left the list; keep keyboard users oriented
  }

  function renderStrip(res) {
    const span = VIEW.end - VIEW.start, pct = (m) => (((m - res.day) - VIEW.start) / span) * 100;
    const stepW = (S.step / span) * 100;
    const nodes = [];
    const band = (cls, a, b, label) => h('div', { class: 'band ' + cls, style: `left:${pct(a)}%;width:${pct(b) - pct(a)}%` }, label ? h('span', { class: 'band-label', text: label }) : null);
    nodes.push(band('band-closed', res.day + VIEW.start, res.day + HOURS.start), band('band-closed', res.day + HOURS.end, res.day + VIEW.end));
    if (S.brk) nodes.push(band('band-break', res.day + BREAK.start, res.day + BREAK.end, 'Break'));
    const soonEnd = Math.min(res.earliest, res.day + VIEW.end);
    if (soonEnd > res.day + HOURS.start && !res.limited) {
      nodes.push(band('band-soon', res.day + HOURS.start, soonEnd, S.notice ? 'Too soon' : 'Past'));
    }
    for (const c of res.candidates) {
      if (c.status === 'open') continue;
      nodes.push(h('i', { class: 'gh', 'data-why': c.status, style: `left:calc(${pct(c.m)}% + 1px);width:calc(${stepW}% - 3px)` }));
    }
    for (const b of existingFor()) {
      if (b.start < res.day || b.start >= res.day + DAY) continue;
      nodes.push(h('div', { class: 'bk' + (b.mine ? ' mine' : ''), style: `left:${pct(b.start)}%;width:${pct(b.end) - pct(b.start)}%` }, b.who));
      if (S.gap) nodes.push(h('i', { class: 'gap', style: `left:${pct(b.end)}%;width:${(S.gap / span) * 100}%` }));
    }
    for (const m of res.open) {
      nodes.push(h('span', { class: 'st', 'data-m': String(m), style: `left:calc(${pct(m)}% + 1px);width:calc(${stepW}% - 3px)` }));
    }
    if (S.day === 0) {
      nodes.push(h('div', { class: 'band', style: `left:${pct(NOW)}%;width:2px;background:var(--accent)` },
        h('span', { class: 'band-label', style: 'left:8px;color:var(--accent-text)', text: 'Now' })));
    }
    const axis = h('div', { class: 'sim-axis' });
    for (const hh of [9, 11, 13, 15, 17]) {
      axis.append(h('span', { style: `left:${pct(res.day + hh * 60)}%`, text: hh === 9 ? '9 AM' : hh === 13 ? '1 PM' : String(hh > 12 ? hh - 12 : hh) }));
    }
    strip.replaceChildren(...nodes, axis);
  }

  function renderTimes(res) {
    const inDay = (m) => m - res.day;
    const groups = [['Morning', (m) => inDay(m) < 12 * 60], ['Afternoon', (m) => inDay(m) >= 12 * 60 && inDay(m) < 17 * 60], ['Evening', (m) => inDay(m) >= 17 * 60]];
    const out = [h('h3', { text: 'What a client sees' })];
    for (const [name, test] of groups) {
      const list = res.open.filter(test);
      out.push(h('p', { class: 'sim-sub', text: name }));
      out.push(list.length
        ? h('div', { class: 'tgroup', role: 'group', 'aria-label': name }, ...list.map((m) => h('button', {
          type: 'button', class: 'tchip' + (S.last && S.last.m === m ? ' is-pick' : ''), text: fmt(m), onclick: () => book(m),
        })))
        : h('p', { class: 'sim-empty', text: 'No times left on this day.' }));
    }
    timesBox.replaceChildren(...out);
  }

  function renderResult() {
    if (!S.last) { resultBox.hidden = true; return; }
    const { m, day, pending, preset, duration } = S.last;
    const p = PRESETS[preset], noun = p.words[1].toLowerCase();
    const when = `${DATES[day]} at ${fmt(m)}`;
    const cap = noun.charAt(0).toUpperCase() + noun.slice(1);
    const note1 = h('div', { class: 'res-n' }, h('i'), h('span', null,
      h('b', { text: pending ? 'New request' : 'New booking' }),
      h('small', { text: `${CLIENT} · ${p.service} · ${when}` })));
    resultBox.hidden = false;
    resultBox.replaceChildren(
      h('span', { class: 'res-k', text: pending ? 'Pending' : 'Confirmed' }),
      h('p', { class: 'res-t', text: `${DATES[day]}, ${fmt(m)} to ${fmt(m + duration)}` }),
      h('p', { class: 'res-d', text: pending
        ? `The ${p.words[0].toLowerCase()} sees Pending until you confirm or decline. The time is held, so nobody else can take it.`
        : 'Confirmed straight away. The time is taken, so nobody else can book it, and any start that would overlap it or its gap is gone.' }),
      h('p', { class: 'res-d', text: 'The professional is notified:' }),
      note1,
      pending && h('p', { class: 'res-d', text: 'When you confirm it, the client is notified:' }),
      pending && h('div', { class: 'res-n' }, h('i'), h('span', null,
        h('b', { text: `${cap} confirmed` }),
        h('small', { text: `${PRACTICE} · ${p.service} · ${when}` }))),
      h('div', { class: 'res-a' },
        h('button', { type: 'button', class: 'chip', text: 'Undo', onclick: () => { S.mine.pop(); S.last = null; render(); } }),
        h('button', { type: 'button', class: 'chip', text: 'Reset the day', onclick: () => { S.mine = []; S.last = null; render(); } })));
  }

  function describe(res) {
    const n = res.open.length, when = S.day ? 'tomorrow' : 'today';
    if (res.limited) return `No times left ${when}: the limit of ${S.perDay} appointments a day is reached (${res.booked} booked).`;
    if (!n) return `No times left ${when} with these rules.`;
    return `${n} start time${n === 1 ? '' : 's'} offered ${when}, from ${fmt(res.open[0])} to ${fmt(res.open[n - 1])}.`;
  }

  function render() {
    const res = compute();
    presetBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === S.preset)));
    dayBtns.forEach((b, i) => { b.setAttribute('aria-checked', String(i === S.day)); b.tabIndex = i === S.day ? 0 : -1; });
    note.textContent = PRESETS[S.preset].note;
    nowLabel.textContent = `Sample clock: ${fmt(NOW)} on ${DATES[0]}`;
    syncers.forEach((f) => f());
    renderStrip(res); renderTimes(res); renderResult();
    status.textContent = describe(res);
    if (hooks.onChange) hooks.onChange({ result: res, state: { ...S }, existing: existingFor(), hours: HOURS, brk: BREAK });
  }

  strip.addEventListener('click', (e) => { const t = e.target.closest('.st'); if (t) book(+t.dataset.m); });
  dayGroup.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    S.day = (S.day + d + 2) % 2; S.last = null; render(); dayBtns[S.day].focus();
  });
  root.hidden = false;
  render();
  return { state: S, render };
}
