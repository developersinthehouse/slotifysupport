// "The app, layer by layer": the dashboard is pulled apart in depth, one layer at a time, and each layer is named.
//   pin    wide screens with the 3D stage: pinned; scrolling pulls the layers apart and walks down the list
//   flow   narrow screens with the 3D stage: the phone comes apart as it scrolls into view; tap a layer to light it
//   static the plain page: the phone stays assembled and the list is simply read
import { clamp, damp, lerp, mapRange, easeInOut } from './util.js';
import { addSlabs, tiltPhone } from './journey.js';

/** @param {{section:HTMLElement, reduce:boolean}} o */
export function initAnatomy({ section, reduce }) {
  const phone = section.querySelector('#phone-a');
  const stageEl = section.querySelector('.anat-stage');
  const list = Array.from(section.querySelectorAll('#anat-list li'));
  const labelsEl = section.querySelector('#al-labels');
  const layers = list.map((li) => phone.querySelector(`.al[data-layer="${li.dataset.layer}"]`));
  let mode = 'static', top = 0, h = 1, vh = 1, sTop = 0, sH = 1, active = -1, ex = 0;
  const tilt = { rx: 0, ry: 0, wx: 99, wy: 99, ex: -1 };

  addSlabs(phone, 8);
  const labels = list.map((li) => {
    const el = document.createElement('li');
    el.textContent = li.querySelector('b').textContent;
    labelsEl.append(el);
    return el;
  });

  // every layer's name becomes a button: it scrolls to that layer when pinned, and lights it otherwise
  list.forEach((li, i) => {
    const b = li.querySelector('b'), body = li.querySelector('.al-body');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.append(...b.childNodes);
    b.append(btn);
    body.id = `al-body-${i}`;
    btn.setAttribute('aria-controls', body.id);
    btn.addEventListener('click', () => go(i));
  });

  function setActive(i) {
    if (i === active) return;
    active = i;
    list.forEach((li, k) => {
      li.classList.toggle('is-on', k === i);
      const btn = li.querySelector('b button');
      if (k === i) btn.setAttribute('aria-current', 'true'); else btn.removeAttribute('aria-current');
    });
  }

  function go(i) {
    if (mode !== 'pin') { setActive(i); return; }
    const span = Math.max(1, h - vh);
    window.scrollTo({ top: top + span * (0.16 + 0.82 * ((i + 0.5) / list.length)), behavior: reduce ? 'auto' : 'smooth' });
  }

  function measure(viewH) {
    const y = window.scrollY || 0, r = section.getBoundingClientRect(), s = stageEl.getBoundingClientRect();
    top = r.top + y; h = r.height; vh = viewH; sTop = s.top + y; sH = s.height;
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    tilt.wx = tilt.wy = 99; tilt.ex = -1;
    if (next === 'static') {
      phone.style.setProperty('--ex', '0');
      tiltPhone(phone, 3, -10);
      layers.forEach((el) => el.classList.remove('is-hl', 'is-dim'));
      labels.forEach((el) => { el.style.opacity = '0'; });
    }
  }

  function placeLabels() {
    const sr = stageEl.getBoundingClientRect();
    const rects = layers.map((el) => el.getBoundingClientRect());
    const right = Math.max(...rects.map((r) => r.right));
    const x = right - sr.left + 18, show = clamp((ex - 0.7) / 0.3);
    labels.forEach((el, i) => {
      const r = rects[i];
      el.style.transform = `translate(${x.toFixed(1)}px, ${(r.top + r.height / 2 - sr.top - 9).toFixed(1)}px)`;
      el.style.opacity = (show * (i === active ? 1 : 0.6)).toFixed(3);
      el.classList.toggle('is-on', i === active);
    });
  }

  function update(y, ys, ptr, dt) {
    if (mode === 'static' || y < top - vh || y > top + h) return;
    let ryT, rxT;
    if (mode === 'pin') {
      const span = Math.max(1, h - vh);
      const p = clamp((y - top) / span), ps = clamp((ys - top) / span);
      ex = easeInOut(mapRange(ps, 0.0, 0.16));
      setActive(clamp(Math.floor(mapRange(p, 0.16, 0.98) * list.length), 0, list.length - 1));
      ryT = lerp(-8, -34, ex); rxT = lerp(3, 13, ex);
    } else {
      ex = easeInOut(mapRange(sTop + sH / 2 - ys, vh * 0.95, vh * 0.5));    // apart once the phone is mid-screen
      ryT = lerp(-8, -22, ex); rxT = lerp(3, 10, ex);
      if (active < 0) setActive(0);
    }
    if (ptr.on) { ryT += ptr.nx * 5; rxT -= ptr.ny * 3; }
    tilt.rx = damp(tilt.rx, rxT, 6, dt); tilt.ry = damp(tilt.ry, ryT, 6, dt);
    if (Math.abs(tilt.rx - tilt.wx) > 0.03 || Math.abs(tilt.ry - tilt.wy) > 0.03) {
      tiltPhone(phone, tilt.rx, tilt.ry); tilt.wx = tilt.rx; tilt.wy = tilt.ry;
    }
    if (Math.abs(ex - tilt.ex) > 0.001) { phone.style.setProperty('--ex', ex.toFixed(3)); tilt.ex = ex; }
    const focus = ex > 0.5;
    layers.forEach((el, i) => { el.classList.toggle('is-hl', focus && i === active); el.classList.toggle('is-dim', focus && i !== active); });
    if (mode === 'pin') placeLabels();
  }

  // the app preview theme (both phones on the page follow it)
  const phones = Array.from(document.querySelectorAll('.phone3d'));
  const buttons = Array.from(section.querySelectorAll('[data-app-theme]'));
  buttons.forEach((b) => b.addEventListener('click', () => {
    phones.forEach((p) => { p.dataset.app = b.dataset.appTheme; });
    buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));

  setActive(0);
  tiltPhone(phone, 3, -10);
  return { measure, update, setMode };
}
