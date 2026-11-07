// Slotify website: the conductor. It chooses between the 3D page (html.fx) and the plain page (html.lite), then drives the
// stage and the pinned chapters from the scroll position. Nothing here is needed to read the page: the markup is complete
// on its own, and site.js already handles the configured buttons, the theme switch, the menu and the reveals.
import { Stage } from './gl/stage.js';
import { COLS, ROWS } from './gl/formations.js';
import { poseSet, resolvePose } from './gl/poses.js';
import { createChapters } from './chapters.js';
import { initFx } from './fx.js';
import { initJourney } from './journey.js';
import { initAnatomy } from './anatomy.js';
import { initSim, lanePatternFrom } from './sim/ui.js';
import { clamp, damp, smooth } from './util.js';

const root = document.documentElement;
const $ = (s, c = document) => c.querySelector(s);
const params = new URLSearchParams(location.search);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const soft = Boolean(window.__SLOTIFY_SOFT_GL) || params.get('gl') === 'soft';       // software rendering: for testing only
const saveData = Boolean(navigator.connection && navigator.connection.saveData);
const canvas = $('#stage');

// ------------------------------------------------------------------ which page
let stage = null;
const wantsPlain = reduce || saveData || params.get('fx') === '0' || matchMedia('(forced-colors: active)').matches;
if (!wantsPlain) {
  try {
    stage = new Stage(canvas, { allowSoftware: soft, autoQuality: !soft, dprCap: soft ? 1 : coarse || innerWidth < 820 ? 1.5 : 2 });
  } catch (err) {
    stage = null;                       // no WebGL 2, or only a software renderer: the plain page is the right page
  }
}
root.classList.add(stage ? 'fx' : 'lite');

// A hidden element as tall as one CSS `--vh` tells us the stable viewport height, even while a phone's address bar moves.
const probe = document.createElement('div');
probe.setAttribute('aria-hidden', 'true');
probe.style.cssText = 'position:fixed;left:-10px;top:0;width:1px;height:var(--vh);visibility:hidden;pointer-events:none';
document.body.append(probe);

const chapters = createChapters();
const fx = initFx({ reduce, fine });
const journey = initJourney({ section: $('#how'), reduce });
const anatomy = initAnatomy({ section: $('#app'), reduce });
let simPattern = null;
try {
  initSim($('#sim-root'), { onChange: (s) => { simPattern = lanePatternFrom(s); } });
} catch (err) {
  console.error('The rules demonstration could not start.', err);
}

// ------------------------------------------------------------------ sizing
let sw = innerWidth, sh = innerHeight, vh = innerHeight;

function measureAll() {
  vh = probe.offsetHeight || innerHeight;
  chapters.measure(); fx.measure(); journey.measure(vh); anatomy.measure(vh);
  if (stage) chooseHeroRow(false);
}
// Wide, tall screens with the 3D stage pin the two long chapters and let the scroll walk through them. Narrower screens let the
// page flow: the steps and the layers are buttons there, and the phones respond to scrolling instead of being held in place.
function layout() {
  const pinned = Boolean(stage) && sw > 960 && sh >= 640;      // below that height the two chapters do not fit pinned, so they flow like the rest of the page
  root.classList.toggle('pin', pinned);
  const mode = pinned ? 'pin' : stage ? 'flow' : 'static';
  journey.setMode(mode); anatomy.setMode(mode);
}
function applySize() {
  if (stage) { canvas.style.height = sh + 'px'; stage.resize(sw, sh, window.devicePixelRatio || 1); }
  layout();
  measureAll();
}
function onResize() {
  const w = innerWidth, h = innerHeight;
  if (coarse && w === sw && Math.abs(h - sh) < 200) {   // a phone's address bar came or went: keep the canvas as it is
    if (h > sh) { sh = h; applySize(); } else measureAll();
    return;
  }
  sw = w; sh = h; applySize();
}
let queued = false;
const queueMeasure = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; measureAll(); }); } };
addEventListener('resize', onResize);
addEventListener('load', queueMeasure);
if ('ResizeObserver' in window) new ResizeObserver(queueMeasure).observe(document.body);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueMeasure);

// ------------------------------------------------------------------ the plain page
function buildDial() {
  const box = $('#dial-fallback');
  if (!box || box.childElementCount) return;
  for (let k = 0; k < 48; k++) {
    const s = document.createElement('span');
    s.style.setProperty('--k', String(k));
    if (k >= 18 && k < 34 && k !== 26 && k !== 27) s.className = k === 22 ? 'on pick' : 'on';
    box.append(s);
  }
}
let liteQueued = false;
function liteScroll() {
  if (liteQueued) return;
  liteQueued = true;
  requestAnimationFrame(() => { liteQueued = false; fx.update(window.scrollY, vh); });
}
function startLite() {
  buildDial();
  addEventListener('scroll', liteScroll, { passive: true });
  liteScroll();
}

// ------------------------------------------------------------------ the 3D page
const ptr = { nx: 0, ny: 0, on: false };
let smoothY = window.scrollY, last = performance.now(), time = 0, orbit = 0, raf = 0, stageHidden = false, cur = null, lostTimer = 0;
let chipFor = -1, chipText = '', transient = null;
const chip = $('#pick-chip'), pickLabel = $('#ruler-pick');
let heroRow = 6, heroDy = 0, heroChipRoom = true;   // the hero's demonstration row, how far the field slides to seat it, and whether its label has room
const KIND = { booked: 'Booked', off: 'Day off', break: 'Break' };

// where each label on the day dial sits relative to its pill (pixels), so neighbouring labels never collide
const TAGS = Array.from(document.querySelectorAll('.tag[data-ring]')).map((el) => {
  const slot = Number(el.dataset.ring);
  const at = { 18: [-26, -2, 'end'], 22: [14, 40, 'start'], 26: [-14, 76, 'end'], 34: [26, -2, 'start'] }[slot] || [20, 0, 'start'];
  return { el, slot, dx: at[0], dy: at[1], align: at[2] };
});

const weight = (name) => { const [a, b] = stage.pair, m = stage.morph; return (a === name ? 1 - m : 0) + (b === name ? m : 0); };

function showPick(info) {
  chipFor = info.id; transient = null;
  chipText = `${info.day} ${info.time}`;
  chip.textContent = chipText;
  pickLabel.textContent = 'Selected ' + chipText;
}
function flash(info) {
  transient = { id: info.id, until: performance.now() + 1700 };
  chip.textContent = `${info.day} ${info.time} · ${KIND[info.kind] || ''}`;
}

function spinOf(c, ref) {
  if (c.scene !== 'ring') return 0;
  return clamp((ref - (c.top + c.h * 0.5)) / (vh * 1.6), -1, 1) * -0.55;
}

// On tall, narrow screens the day dial sits in the text flow rather than beside it: slide the lens so the ring lands on its box.
function anchorRing(c, w, cam) {
  if (w <= 0 || !c.anchor || c.pose !== 'ring') return;
  const r = c.anchor.getBoundingClientRect(), base = poseSet(stage.aspect).ring.sh;
  cam.shift[0] += ((r.left + r.width / 2) / stage.w * 2 - 1 - base[0]) * w;
  cam.shift[1] += (1 - (r.top + r.height / 2) / stage.h * 2 - base[1]) * w;
}

// Point the camera for this moment of the scroll. How visible the stage is comes out of this, so it is decided here.
function aim(ch, dt) {
  const A = ch.a, B = ch.b, t = ch.t;
  stage.setPair(A.scene, B.scene);
  stage.selEnabled = A.id === 'top';                   // the hero is the only place a pill stays selected
  orbit = damp(orbit, fine && ptr.on ? ptr.nx * 2.4 : 0, 3, dt);
  stage.setCamera(A.pose, B.pose, t, orbit + Math.sin(time * 0.16) * 0.8);
  const cam = stage.camera;
  if (stage.aspect < 0.85) { anchorRing(A, 1 - smooth(t), cam); if (B !== A) anchorRing(B, smooth(t), cam); }
  const wHero = (A.pose === 'hero' ? 1 - smooth(t) : 0) + (B !== A && B.pose === 'hero' ? smooth(t) : 0);
  if (wHero > 0) cam.shift[1] += heroDy * wHero;
  cam.dim *= 1 - 0.45 * stage.themeT * clamp(1 - cam.dim * 1.4);      // dark pills on a light page read louder, so the field behind text steps back further
  const R = chapters.byId('rules');                    // the day beside the demonstration's heading steps back as its controls arrive
  if (R && (t > 0.5 ? B : A) === R) cam.dim *= 1 - 0.88 * smooth((ch.ref - R.top - 0.55 * vh) / (0.45 * vh));
}

function drawStage(ch, dt) {
  const A = ch.a, B = ch.b, t = ch.t;
  stage.lanePattern = (t > 0.5 ? B : A).id === 'rules' ? simPattern : journey.pattern();
  stage.setPointer(ptr.nx, ptr.ny, ptr.on && fine && weight('field') > 0.5);
  stage.update(dt, { morph: A.scene === B.scene ? 0 : t, spinA: spinOf(A, ch.ref), spinB: spinOf(B, ch.ref) });
  stage.render();
}

function placeOverlays(ch, gone, now) {
  // the label that rides on the selected hero pill
  if (transient && now > transient.until) { transient = null; chip.textContent = chipText; }
  const id = transient ? transient.id : chipFor;
  const heroAmt = gone || ch.a.id !== 'top' || (!transient && (sw < 760 || !heroChipRoom)) ? 0 : 1 - clamp(ch.t * 2.5);   // with no room it only answers a tap
  if (heroAmt > 0.01 && id >= 0) {
    const a = stage.fieldAnchor(id), [px, py, vis] = stage.project(a[0], a[1], a[2]);
    chip.style.transform = `translate(${px.toFixed(1)}px, ${(py - 16).toFixed(1)}px) translate(-50%, -100%)`;
    chip.style.opacity = vis ? heroAmt.toFixed(2) : '0';
  } else {
    chip.style.opacity = '0';
  }
  // the labels on the day dial
  const w = gone ? 0 : weight('ring'), on = w > 0.86 && innerWidth >= 820;
  for (const tag of TAGS) {
    if (!on) { tag.el.style.opacity = '0'; continue; }
    const a = stage.slotAnchor('ring', tag.slot), [px, py, vis] = stage.project(a[0], a[1], a[2]);
    tag.el.style.transform = `translate(${(px + tag.dx).toFixed(1)}px, ${(py + tag.dy).toFixed(1)}px) translate(${tag.align === 'end' ? '-100%' : '0'}, -50%)`;
    tag.el.style.opacity = vis ? clamp((w - 0.86) / 0.12).toFixed(2) : '0';
  }
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now; time += dt;
  const y = Math.max(0, window.scrollY);
  smoothY = damp(smoothY, y, 10, dt);
  if (Math.abs(smoothY - y) < 0.3) smoothY = y;

  const ch = chapters.at(smoothY, vh);
  if (!ch.a) return;
  cur = ch;
  journey.update(y, smoothY, ptr, dt);
  anatomy.update(y, smoothY, ptr, dt);
  fx.update(y, vh);

  aim(ch, dt);
  const gone = stage.camera.dim < 0.01;                // nothing to show here (a chapter without the stage, or a narrow screen's text-only stretch)
  if (gone !== stageHidden) { canvas.style.visibility = gone ? 'hidden' : ''; stageHidden = gone; }
  if (!gone) drawStage(ch, dt);
  placeOverlays(ch, gone, now);
}

function syncTheme(instant) {
  if (!stage) return;
  const light = matchMedia('(prefers-color-scheme: light)').matches;
  stage.setTheme(root.dataset.theme || (light ? 'light' : 'dark'), instant);
}

// The hero's demonstration runs along one row of the field. Seat that row in the clear band between the buttons and the key, so a
// pill never glows behind the headline or the paragraph, whatever the window size: take the nearest row that has open times and
// slide the whole field (a lens shift, so nothing is distorted) until the row sits in the middle of the band.
function chooseHeroRow(first) {
  const meta = $('.hero .meta'), foot = $('.hero-foot');
  if (!stage || !meta || !foot) return;
  const y0 = window.scrollY || 0;                       // document y is viewport y at the top of the page
  const metaEnd = meta.getBoundingClientRect().bottom + y0;
  const from = metaEnd + 52, to = Math.max(from, Math.min(sh - 30, foot.getBoundingClientRect().top + y0 - 26)), mid = (from + to) / 2;   // a selected pill stands up and glows, so it needs room
  const cam = resolvePose('hero', 'hero', 0, stage.aspect, 0), col = COLS >> 1;
  const info = stage.F.field.info, hasOpen = (r) => info.slice(r * COLS, (r + 1) * COLS).some((i) => i.kind === 'open');
  let best = heroRow, bestD = Infinity, bestY = mid;
  for (let r = 0; r < ROWS; r++) {
    if (!hasOpen(r)) continue;                          // days off have nothing to select
    const a = stage.fieldAnchor(r * COLS + col), [, py, vis] = stage.projectUnder(cam, a[0], a[1], a[2]);
    if (vis && Math.abs(py - mid) < bestD) { bestD = Math.abs(py - mid); best = r; bestY = py; }
  }
  heroDy = clamp((bestY - mid) / (sh / 2), -0.26, 0.26);
  heroChipRoom = mid - metaEnd >= 84;                 // the label stands about 75px above the resting pill
  if (!first && best === heroRow) return;
  heroRow = best; stage.demoRow = best;
  const pref = stage.sel >= 0 ? stage.sel % COLS : 6;   // keep the same time of day when the row moves
  const pick = [pref, 6, 7, 5, 4, 3].map((c) => best * COLS + c).find((id) => info[id].kind === 'open');
  if (pick !== undefined) { stage.select(pick, true); showPick(stage.describe(pick)); }
}

function toPlain() {
  if (!stage) return;
  stage = null;
  cancelAnimationFrame(raf); raf = 0;
  root.classList.remove('fx', 'pin'); root.classList.add('lite');
  journey.setMode('static'); anatomy.setMode('static');
  startLite(); measureAll();
}

function startStage() {
  chooseHeroRow(true);
  stage.onPick = (info) => showPick(info);
  stage.onLost = () => { lostTimer = setTimeout(toPlain, 3000); };
  stage.onRestored = () => { clearTimeout(lostTimer); syncTheme(true); };

  document.addEventListener('slotify:theme', () => syncTheme(false));
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => syncTheme(false));

  addEventListener('pointermove', (e) => {
    if (!stage || e.pointerType === 'touch') return;      // (the stage is gone once the page has fallen back to the plain one)
    ptr.nx = e.clientX / stage.w * 2 - 1; ptr.ny = -(e.clientY / stage.h * 2 - 1); ptr.on = true;
  }, { passive: true });
  root.addEventListener('mouseleave', () => { ptr.on = false; });
  addEventListener('blur', () => { ptr.on = false; });

  // a click or tap on the hero field picks a pill; links, buttons and the demonstration are left alone
  document.addEventListener('click', (e) => {
    if (!stage || e.button || e.defaultPrevented || !cur || cur.a.id !== 'top' || cur.t > 0.3) return;
    if (e.target.closest('a, button, input, select, textarea, summary, label, [role="radio"], [role="switch"], #sim-root')) return;
    const info = stage.pickAt(e.clientX / stage.w * 2 - 1, -(e.clientY / stage.h * 2 - 1));
    if (info && info.kind !== 'open') flash(info);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf && stage) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
  addEventListener('load', () => { smoothY = window.scrollY; });

  syncTheme(true);
  raf = requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ go
applySize();
if (stage) startStage(); else startLite();
if (params.has('debug')) {
  window.__slotify = {
    get mode() { return root.classList.contains('fx') ? (root.classList.contains('pin') ? 'fx+pin' : 'fx') : 'lite'; },
    stage: () => stage, chapters, journey, anatomy,
    settle() { smoothY = window.scrollY; },
    state() { return cur && { a: cur.a.id, b: cur.b.id, t: cur.t, ref: cur.ref }; },
  };
}
