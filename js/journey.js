// "How it works": five steps and one phone. Three ways to live in the page:
//   pin    wide screens with the 3D stage: the section is pinned and scrolling walks through the steps
//   flow   narrow screens with the 3D stage: nothing is pinned; the steps are buttons and the phone tilts as it scrolls by
//   static the plain page: the steps are buttons and the phone is still
// Whatever the mode, the phone shows the screen that belongs to the current step.
import { clamp, damp, lerp } from './util.js';

// The day on stage at each step, one entry per half-hour pill: [lift, accent, ghost, flat].
const L = { open: [0, 0, 0, 0], lift: [0.18, 0, 0, 0], ghost: [0, 0, 1, 0], flat: [0, 0, 0, 1], pick: [0.3, 1, 0, 0], held: [0, 1, 0, 0] };
const BREAK = [8, 9];                    // 1:00 to 2:00 PM
const TAKEN = [3, 4, 6, 7, 12, 15];      // the times the phone's "Pick a date and time" screen does not offer
const lane = (f) => Array.from({ length: 16 }, (_, c) => f(c));
export const PATTERNS = [
  lane((c) => (BREAK.includes(c) ? L.ghost : L.open)),                                                           // hours and a break are set
  lane(() => L.ghost),                                                                                           // waiting for review: nothing is live
  lane((c) => (BREAK.includes(c) ? L.ghost : L.lift)),                                                           // the page is live
  lane((c) => (BREAK.includes(c) ? L.ghost : TAKEN.includes(c) ? L.flat : c === 2 ? L.pick : L.lift)),          // a client picks 10:00
  lane((c) => (BREAK.includes(c) ? L.ghost : TAKEN.includes(c) ? L.flat : c === 2 ? L.held : L.lift)),          // confirmed
];

/** Give a CSS phone real thickness: a stack of rounded slabs behind the front face. */
export function addSlabs(phone, count = 10) {
  const body = phone.querySelector('.p3-body'), front = body && body.querySelector('.p3-front');
  if (!front || body.querySelector('.p3-slab')) return;
  for (let i = 1; i <= count; i++) {
    const s = document.createElement('span');
    s.className = 'p3-slab'; s.style.setProperty('--i', String(i));
    body.insertBefore(s, front);
  }
}

export function tiltPhone(phone, rx, ry) {
  phone.style.setProperty('--rx', rx.toFixed(2) + 'deg');
  phone.style.setProperty('--ry', ry.toFixed(2) + 'deg');
  phone.style.setProperty('--gx', (50 + ry * 2.6).toFixed(1) + '%');
}

/** @param {{section:HTMLElement, reduce:boolean}} o */
export function initJourney({ section, reduce }) {
  const steps = Array.from(section.querySelectorAll('.j-step'));
  const phone = section.querySelector('#phone-j');
  const screens = Array.from(phone.querySelectorAll('.screen'));
  let mode = 'static', step = -1, top = 0, h = 1, vh = 1;
  const tilt = { rx: 0, ry: 0, wx: 99, wy: 99 };

  addSlabs(phone);

  steps.forEach((li, i) => {
    const head = li.querySelector('.j-head'), body = li.querySelector('.j-body');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.append(...head.childNodes);
    head.append(btn);
    body.id = `j-body-${i}`;
    btn.setAttribute('aria-controls', body.id);
    btn.addEventListener('click', () => go(i));
  });

  function setStep(i) {
    if (i === step) return;
    step = i;
    steps.forEach((li, k) => {
      li.classList.toggle('is-active', k === i);
      const b = li.querySelector('.j-head button');
      if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    const want = steps[i].dataset.screen;
    screens.forEach((s) => s.classList.toggle('is-on', s.dataset.screen === want));
  }

  function go(i) {
    if (mode !== 'pin') { setStep(i); return; }
    const span = Math.max(1, h - vh);
    window.scrollTo({ top: top + span * ((i + 0.5) / steps.length), behavior: reduce ? 'auto' : 'smooth' });
  }

  function measure(viewH) {
    const r = section.getBoundingClientRect();
    top = r.top + (window.scrollY || 0); h = r.height; vh = viewH;
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    tilt.wx = tilt.wy = 99;
    if (next === 'static') tiltPhone(phone, 4, -12);
  }

  /** @param {number} y scroll now @param {number} ys smoothed scroll @param {{nx:number,ny:number,on:boolean}} ptr */
  function update(y, ys, ptr, dt) {
    if (mode === 'static' || y < top - vh || y > top + h) return;
    let ps, ryT, rxT;
    if (mode === 'pin') {
      const span = Math.max(1, h - vh);
      setStep(Math.min(steps.length - 1, Math.floor(clamp((y - top) / span) * steps.length)));
      ps = clamp((ys - top) / span);
      ryT = lerp(-24, 16, ps); rxT = 9 - 13 * Math.sin(ps * Math.PI);
    } else {
      ps = clamp((ys + vh - top) / (h + vh));          // 0 as the section enters, 1 as it leaves
      ryT = lerp(-20, 14, ps) * 0.7; rxT = 8 - 10 * Math.sin(ps * Math.PI);
    }
    if (ptr.on) { ryT += ptr.nx * 7; rxT -= ptr.ny * 4; }
    tilt.rx = damp(tilt.rx, rxT, 6, dt); tilt.ry = damp(tilt.ry, ryT, 6, dt);
    if (Math.abs(tilt.rx - tilt.wx) > 0.03 || Math.abs(tilt.ry - tilt.wy) > 0.03) {
      tiltPhone(phone, tilt.rx, tilt.ry); tilt.wx = tilt.rx; tilt.wy = tilt.ry;
    }
  }

  setStep(0);
  tiltPhone(phone, 4, -12);
  return { measure, update, setMode, pattern: () => PATTERNS[Math.max(0, step)], get step() { return step; } };
}
