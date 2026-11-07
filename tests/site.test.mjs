// Browser test for the public website: real Chromium against the real files.
//
//   PLAYWRIGHT_CORE=<path to playwright> [AXE_CORE=<path to axe.min.js>] [CHROME=<path to chrome>] node tests/site.test.mjs
//
// Most steps run the plain page (?fx=0): it is fast and needs no GPU. The steps marked "3D" start the real WebGL stage. Without a GPU
// they use a software renderer (?gl=soft, which exists for exactly this), so they are slow but real. GL=0 skips them.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const WITH_GL = process.env.GL !== '0' && !process.argv.includes('--plain');      // --plain (or GL=0) skips the 3D steps
const WITH_AXE = Boolean(process.env.AXE_CORE && fs.existsSync(process.env.AXE_CORE));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const executablePath = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
let glBrowser = null;
const getGlBrowser = async () => glBrowser || (glBrowser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }));

let passed = 0, failed = 0; const results = [];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;      // ONLY=<regex> runs just the matching steps
async function step(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  const t0 = Date.now();
  try { await fn(); passed++; results.push(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); } catch (e) { failed++; results.push(`FAIL ${name}\n     ${String(e.stack || e.message).split('\n').slice(0, 9).join('\n     ')}`); process.exitCode = 1; }
}

/** Open the site. By default the plain page (?fx=0); { gl: true } starts the 3D stage with the software renderer. */
async function open({ w = 1280, h = 900, scheme = 'dark', reduce = 'no-preference', config = null, gl = false, touch = false, init = null, url = null, media = null } = {}) {
  const b = gl ? await getGlBrowser() : browser;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: reduce, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(gl ? 40000 : 8000);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => page.errors.push(`failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) page.errors.push(`${r.status()}: ${r.url()}`); });
  if (config) await page.route('**/site.config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.SLOTIFY_SITE=${JSON.stringify(config)};` }));
  if (init) await page.addInitScript(init);
  if (media) await page.emulateMedia(media);
  await page.goto(base + (url ?? (gl ? '?gl=soft&debug' : '?fx=0')));
  await page.waitForFunction(() => document.documentElement.classList.contains('fx') || document.documentElement.classList.contains('lite'));
  if (gl) {
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('fx')), '3D stage did not start');
    await page.waitForFunction(() => window.__slotify && window.__slotify.stage());
  }
  return page;
}
async function withPage(opts, fn) {
  const p = await open(opts);
  try { return await fn(p); } finally { await p.context().close(); }
}
const frames = (p, n = 6) => p.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const jump = async (p, y) => { await p.evaluate((y) => { scrollTo({ top: y, behavior: 'instant' }); if (window.__slotify) window.__slotify.settle(); }, y); await frames(p, 8); };
const secTop = (p, id, fraction = 0, offset = 0) => p.evaluate(([id, f, o]) => {
  const r = document.getElementById(id).getBoundingClientRect();
  return r.top + scrollY + f * Math.max(0, r.height - innerHeight) + o;
}, [id, fraction, offset]);
const activeIndex = (p, sel, cls) => p.evaluate(([sel, cls]) => [...document.querySelectorAll(sel)].findIndex((n) => n.classList.contains(cls)), [sel, cls]);
const coverage = (p) => p.evaluate(() => {
  const s = window.__slotify.stage(); s.render();
  const c = document.createElement('canvas'); c.width = s.canvas.width; c.height = s.canvas.height;
  const g = c.getContext('2d'); g.drawImage(s.canvas, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0, tot = 0;
  for (let i = 3; i < d.length; i += 68) { tot++; if (d[i] > 20) n++; }
  return n / tot;
});
const runAxe = async (p, label) => {
  await p.addScriptTag({ path: process.env.AXE_CORE });
  const r = await p.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
  const bad = r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  assert.deepEqual(bad, [], label);
};
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// ------------------------------------------------------------------ the files
await step('every in-page link has a target, every local file exists, ARIA references resolve', async () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href="#([^"]*)"/g)) if (m[1]) assert.ok(ids.has(m[1]), `no element with id "${m[1]}"`);
  for (const m of html.matchAll(/(?:src|href)="((?!#|https?:|mailto:)[^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, m[1])), `missing file ${m[1]}`);
  for (const m of html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)) for (const id of m[1].split(' ')) assert.ok(ids.has(id), `aria reference to missing id ${id}`);
  for (const m of html.matchAll(/data-for="([^"]+)"/g)) assert.ok(ids.has(m[1]), `ruler link to missing section ${m[1]}`);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, 'exactly one h1');
  assert.equal((html.match(/<img\b(?![^>]*\balt=)[^>]*>/g) || []).length, 0, 'every image has alt text');
  for (const f of ['robots.txt', 'site.config.js', 'site.config.example.js', 'assets/og.png', 'assets/favicon.png']) assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
});

await step('search and sharing basics: title, description, language, theme colour, social card', async () => {
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  assert.ok(title.length >= 20 && title.length <= 70, `title length ${title.length}`);
  const desc = html.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.ok(desc.length >= 80 && desc.length <= 160, `description length ${desc.length}`);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/);
  for (const k of ['og:title', 'og:description', 'og:image', 'og:image:alt', 'twitter:card']) assert.ok(html.includes(`"${k}"`), k);
  assert.match(fs.readFileSync(path.join(root, 'robots.txt'), 'utf8'), /User-agent: \*/);
});

await step('structured data is valid JSON and the FAQ matches the visible questions exactly', async () => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 2);
  const faq = blocks.find((b) => b['@type'] === 'FAQPage');
  const visible = [...html.matchAll(/<summary>([^<]+)<\/summary>/g)].map((m) => m[1].replace(/&rsquo;/g, '’').replace(/&amp;/g, '&'));
  assert.equal(faq.mainEntity.length, visible.length, 'same number of questions');
  for (const q of faq.mainEntity) assert.ok(visible.includes(q.name), `FAQ schema question not shown: ${q.name}`);
});

await step('size budget: the page, its styles and its scripts stay small', async () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const gz = (f) => zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length;
  const parts = {
    html: gz(path.join(root, 'index.html')),
    css: gz(path.join(root, 'styles.css')) + gz(path.join(root, 'app.css')),
    js: walk(path.join(root, 'js')).reduce((s, f) => s + gz(f), 0) + gz(path.join(root, 'site.js')),
  };
  const total = parts.html + parts.css + parts.js;
  assert.ok(total <= 110 * 1024, `html+css+js is ${(total / 1024).toFixed(1)} KB gzipped (budget 110 KB): ${JSON.stringify(parts)}`);
  const fonts = ['Inter-Regular.woff2', 'Inter-SemiBold.woff2'].reduce((s, f) => s + fs.statSync(path.join(root, 'fonts', f)).size, 0);
  assert.ok(fonts <= 90 * 1024, `preloaded fonts are ${(fonts / 1024).toFixed(0)} KB`);
  for (const f of walk(path.join(root, 'assets'))) assert.ok(fs.statSync(f).size <= 160 * 1024, `${path.relative(root, f)} is larger than 160 KB`);
});

await step('no secrets or private keys ship with the site', async () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() && e.name !== 'node_modules' ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(root).filter((f) => /\.(html|css|js|mjs|json|txt|md|py)$/.test(f) && !f.endsWith('.test.mjs'))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/service_role|sk_live_|sk_test_|BEGIN (RSA |EC )?PRIVATE KEY|rzp_live_|AIza[0-9A-Za-z_-]{30}/.test(src), `secret-looking text in ${path.relative(root, f)}`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(src), `token-looking text in ${path.relative(root, f)}`);
  }
});

// ------------------------------------------------------------------ the simulator's rules, in node
await step('rules engine: hours, break, notice, gap, step, daily limit and conflicts behave like the app', async () => {
  const { computeDay, DAY, fmt } = await import(pathToFileURL(path.join(root, 'js/sim/engine.js')).href);
  const base = { dayOffset: 1, now: 600, hours: { start: 540, end: 1020 }, brk: { on: true, start: 780, end: 840 }, existing: [], duration: 30, gap: 0, step: 30, notice: 0, perDay: 0 };
  const at = (r) => r.open.map((m) => m - r.day);
  let r = computeDay(base);
  assert.equal(r.open.length, 14, '9:00 to 5:00 in half hours is 16 starts, minus the two in the break');
  assert.ok(at(r).every((m) => m < 780 || m >= 840), 'nothing starts in the break');
  assert.equal(computeDay({ ...base, brk: { ...base.brk, on: false } }).open.length, 16, 'without the break every half hour is offered');
  r = computeDay({ ...base, duration: 90 });
  assert.equal(Math.max(...at(r)), 930, 'the last start still leaves room for the whole service before 5:00 PM');
  assert.equal(Math.max(...at(r).filter((m) => m < 780)), 690, 'and a service may not run into the break');
  r = computeDay({ ...base, dayOffset: 0, now: 600, notice: 120 });
  assert.equal(Math.min(...r.open), 720, 'the first start is now plus the minimum notice');
  r = computeDay({ ...base, existing: [{ start: DAY + 600, end: DAY + 630 }], gap: 15 });
  assert.deepEqual([570, 600, 630].filter((m) => at(r).includes(m)), [], 'a booking, and the gap kept around it, block those starts');
  assert.ok(at(r).includes(540) && at(r).includes(660), 'and the rest of the day stays open');
  r = computeDay({ ...base, dayOffset: 0, now: 0, perDay: 2, existing: [{ start: 540, end: 570 }, { start: 600, end: 630 }] });
  assert.equal(r.limited, true); assert.equal(r.open.length, 0, 'at the daily limit nothing is offered');
  r = computeDay({ ...base, dayOffset: 0, now: 0, perDay: 3, existing: [{ start: 540, end: 570 }, { start: 600, end: 630 }] });
  assert.equal(r.limited, false); assert.ok(r.open.length > 0, 'below the limit times are offered');
  r = computeDay({ ...base, step: 60 });
  assert.ok(at(r).every((m) => m % 60 === 0), 'starts follow the step');
  assert.equal(fmt(DAY + 570), '9:30 AM'); assert.equal(fmt(780), '1:00 PM'); assert.equal(fmt(0), '12:00 AM');
});

// ------------------------------------------------------------------ the plain page
await step('the plain page loads with no errors or failed requests, in dark and light', async () => {
  for (const scheme of ['dark', 'light']) {
    await withPage({ scheme }, async (p) => {
      await p.waitForTimeout(400);
      assert.deepEqual(p.errors, [], scheme);
      assert.equal(await p.locator('h1').count(), 1);
      assert.equal(await p.evaluate(() => document.documentElement.classList.contains('lite')), true);
      assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('stage')).display), 'none', 'no canvas on the plain page');
    });
  }
});

await step('the plain page is also what you get with no WebGL, reduced motion, forced colours or the ?fx=0 opt-out', async () => {
  const noGl = () => { HTMLCanvasElement.prototype.getContext = function () { return null; }; };
  for (const [label, opts] of [
    ['no WebGL', { init: noGl, url: '?gl=soft' }],
    ['reduced motion', { reduce: 'reduce', url: '?gl=soft' }],
    ['forced colours', { media: { forcedColors: 'active' }, url: '?gl=soft' }],
    ['?fx=0', { url: '?fx=0' }],
  ]) {
    await withPage(opts, async (p) => {
      assert.equal(await p.evaluate(() => document.documentElement.classList.contains('lite')), true, label);
      assert.equal(await p.evaluate(() => document.documentElement.classList.contains('fx')), false, label);
      assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('stage')).display), 'none', label);
      await p.waitForTimeout(300);
      assert.deepEqual(p.errors, [], label);
      assert.equal(await p.locator('.sim-presets').count(), 1, `${label}: the simulator is there`);
      assert.equal(await p.locator('#phone-j .screen.is-on').count(), 1, `${label}: the phone shows a screen`);
    });
  }
  await withPage({ reduce: 'reduce', url: '?gl=soft' }, async (p) => {
    await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await frames(p, 4);
    const hidden = await p.evaluate(() => [...document.querySelectorAll('h1, h2, .rise')].filter((n) => !n.classList.contains('in') && getComputedStyle(n).opacity === '0').length);
    assert.equal(hidden, 0, 'with reduced motion nothing waits for an animation to be readable');
  });
});

for (const [name, w, h] of [['desktop', 1440, 900], ['laptop', 1280, 720], ['tablet', 820, 1100], ['phone', 390, 844], ['small phone', 320, 640]]) {
  await step(`layout ${name} (${w}px): no horizontal scroll, readable text, both themes`, async () => {
    for (const scheme of ['dark', 'light']) {
      await withPage({ w, h, scheme }, async (p) => {
        await p.evaluate(() => document.querySelectorAll('.reveal, .rise').forEach((n) => n.classList.add('in')));
        assert.equal(await noOverflow(p), true, `${scheme} overflows at ${w}px`);
        const small = await p.evaluate(() => [...document.querySelectorAll('main p, main li, main dd, main dt, main summary, main button')]
          .filter((n) => n.closest('.phone3d, .al-labels') === null && n.offsetParent !== null && parseFloat(getComputedStyle(n).fontSize) < 13.5).map((n) => n.className || n.tagName));
        assert.deepEqual(small, [], 'text below 13.5px outside the app preview');
        const wide = await p.evaluate(() => [...document.querySelectorAll('main *')].filter((n) => n.getBoundingClientRect().right > innerWidth + 1 && n.closest('.phone3d, .sim-strip') === null && getComputedStyle(n).position !== 'fixed').map((n) => n.className || n.tagName));
        assert.deepEqual(wide, [], 'elements poking out of the viewport');
      });
    }
  });
}

await step('the colour theme toggle switches, persists and starts from the system setting', async () => {
  await withPage({ scheme: 'dark' }, async (p) => {
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(8, 8, 10)');
    await p.click('#theme');
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(247, 247, 249)');
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.logo-on-light')).display), 'block');
    await p.reload();
    assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'light');
  });
  await withPage({ scheme: 'light' }, async (q) => {
    assert.equal(await q.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(247, 247, 249)');
  });
});

await step('hero ruler (plain page): one slot is selected, the choice moves, only open times are chosen', async () => {
  await withPage({}, async (p) => {
    await p.locator('#ruler').scrollIntoViewIfNeeded();
    await p.waitForSelector('.ruler.in');
    const picked = () => p.evaluate(() => [...document.querySelectorAll('.slot')].map((s, i) => (s.classList.contains('is-pick') ? i : -1)).filter((i) => i >= 0));
    const first = await picked();
    assert.equal(first.length, 1);
    await p.waitForFunction((f) => [...document.querySelectorAll('.slot')].findIndex((s) => s.classList.contains('is-pick')) !== f, first[0], { timeout: 6000 });
    const seen = new Set(first);
    for (let i = 0; i < 6; i++) { await p.waitForTimeout(2300); seen.add((await picked())[0]); }
    for (const i of seen) assert.ok(![1, 2, 5, 8, 9, 11, 13].includes(i), `slot ${i} is booked or a break`);
    assert.match(await p.textContent('#ruler-pick'), /^Selected /);
  });
});

await step('reduced motion: nothing cycles on the hero ruler', async () => {
  await withPage({ reduce: 'reduce' }, async (p) => {
    const a = await p.evaluate(() => document.querySelector('.slot.is-pick')?.dataset.i);
    await p.waitForTimeout(2800);
    assert.equal(await p.evaluate(() => document.querySelector('.slot.is-pick')?.dataset.i), a);
  });
});

await step('How it works: each step is a button that shows its own screen of the app', async () => {
  await withPage({}, async (p) => {
    const steps = p.locator('.j-step');
    assert.equal(await steps.count(), 5);
    const btn = (i) => steps.nth(i).locator('.j-head button');
    assert.equal(await btn(0).getAttribute('aria-current'), 'step');
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      await btn(i).scrollIntoViewIfNeeded();
      await btn(i).click();
      assert.equal(await activeIndex(p, '.j-step', 'is-active'), i, `step ${i + 1} becomes active`);
      assert.equal(await btn(i).getAttribute('aria-current'), 'step');
      assert.equal(await p.locator('.j-step [aria-current="step"]').count(), 1, 'one current step');
      const want = await steps.nth(i).getAttribute('data-screen');
      assert.equal(await p.locator('#phone-j .screen.is-on').count(), 1, 'one screen on the phone');
      assert.equal(await p.locator('#phone-j .screen.is-on').getAttribute('data-screen'), want);
      assert.equal(await btn(i).getAttribute('aria-controls'), `j-body-${i}`);
      assert.equal(await p.locator(`#j-body-${i}`).count(), 1);
      seen.add(want);
    }
    assert.ok(seen.size >= 4, 'the phone shows different screens along the way');
    await btn(2).focus(); await p.keyboard.press('Enter');
    assert.equal(await activeIndex(p, '.j-step', 'is-active'), 2, 'the keyboard works');
    assert.deepEqual(p.errors, []);
  });
});

await step('The app, layer by layer: each layer is a button, and the preview theme switches', async () => {
  await withPage({}, async (p) => {
    const items = p.locator('#anat-list li');
    assert.equal(await items.count(), 6);
    for (let i = 0; i < 6; i++) {
      const b = items.nth(i).locator('b button');
      await b.scrollIntoViewIfNeeded(); await b.click();
      assert.equal(await activeIndex(p, '#anat-list li', 'is-on'), i);
      assert.equal(await b.getAttribute('aria-current'), 'true');
      assert.equal(await p.locator('#anat-list [aria-current="true"]').count(), 1);
    }
    await p.click('[data-app-theme="light"]');
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.phone3d')].map((n) => n.dataset.app)), ['light', 'light']);
    assert.equal(await p.getAttribute('[data-app-theme="light"]', 'aria-pressed'), 'true');
    assert.equal(await p.getAttribute('[data-app-theme="dark"]', 'aria-pressed'), 'false');
    await p.click('[data-app-theme="dark"]');
    assert.equal(await p.getAttribute('#phone-a', 'data-app'), 'dark');
  });
});

await step('Try the rules: presets, options (with arrow keys), switches, booking, undo and reset all work', async () => {
  await withPage({}, async (p) => {
    await p.locator('#sim-root').scrollIntoViewIfNeeded();
    const times = () => p.locator('.tchip').allTextContents();
    assert.equal(await p.getAttribute('.sim-presets [data-preset="start"]', 'aria-pressed'), 'true');
    const n0 = (await times()).length;
    assert.ok(n0 > 0, 'times are offered to start with');
    assert.match(await p.textContent('.sim-status'), /start time/);

    // presets change the rules and the explanation
    const note0 = await p.textContent('.sim-note');
    const presets = await p.locator('.sim-presets [data-preset]').evaluateAll((n) => n.map((x) => x.dataset.preset));
    assert.ok(presets.length >= 3);
    const last = presets[presets.length - 1];
    await p.click(`.sim-presets [data-preset="${last}"]`);
    assert.equal(await p.getAttribute(`.sim-presets [data-preset="${last}"]`, 'aria-pressed'), 'true');
    assert.notEqual(await p.textContent('.sim-note'), note0);
    await p.click('.sim-presets [data-preset="start"]');

    // an option group behaves like radio buttons: one checked, arrow keys move it
    const dur = p.locator('[role=radiogroup][aria-label="Duration"]');
    assert.equal(await dur.locator('[aria-checked=true]').count(), 1);
    const before = await dur.locator('[aria-checked=true]').textContent();
    await dur.locator('[aria-checked=true]').focus();
    await p.keyboard.press('ArrowRight');
    assert.notEqual(await dur.locator('[aria-checked=true]').textContent(), before);
    assert.equal(await dur.locator('[aria-checked=true]').count(), 1);
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute('aria-checked')), 'true', 'focus follows the choice');
    await p.keyboard.press('ArrowLeft');
    assert.equal(await dur.locator('[aria-checked=true]').textContent(), before);

    // switching the daily break off offers the break's own hour
    const brk = p.locator('[role=switch][aria-label="Daily break"]');
    const withBreak = (await times()).length;
    await brk.click();
    assert.equal(await brk.getAttribute('aria-checked'), 'false');
    assert.ok((await times()).length > withBreak, 'more times without a break');
    await brk.click();
    assert.equal((await times()).length, withBreak);

    // booking: the time is taken, the result says who is told, and it is not offered again
    const all = await times(), pick = all[Math.min(2, all.length - 1)];
    await p.locator('.tchip', { hasText: new RegExp(`^${pick}$`) }).click();
    assert.equal(await p.locator('.sim-result').isVisible(), true);
    assert.match(await p.textContent('.sim-result'), /Confirmed|Pending/);
    assert.match(await p.textContent('.sim-result'), /notified/);
    assert.ok(!(await times()).includes(pick), 'a booked time is not offered again');
    await p.locator('.sim-result button', { hasText: 'Undo' }).click();
    assert.equal(await p.locator('.sim-result').isVisible(), false);
    assert.ok((await times()).includes(pick), 'undo gives the time back');
    await p.locator('.tchip').first().click();
    await p.locator('.tchip').first().click();
    await p.locator('.sim-result button', { hasText: 'Reset the day' }).click();
    assert.equal(await p.locator('.sim-result').isVisible(), false);
    assert.equal((await times()).length, withBreak, 'reset restores the day');

    // tomorrow
    await p.click('[role=radiogroup][aria-label="Which day to look at"] >> text=Tomorrow');
    assert.equal(await p.locator('[role=radiogroup][aria-label="Which day to look at"] [aria-checked=true]').textContent(), 'Tomorrow');
    assert.match(await p.textContent('.sim-status'), /tomorrow/);
    assert.deepEqual(p.errors, []);
  });
});

await step('mobile menu opens, closes with Escape and navigates', async () => {
  await withPage({ w: 390, h: 844 }, async (p) => {
    assert.equal(await p.locator('#nav').isVisible(), false);
    await p.click('#menu');
    assert.equal(await p.getAttribute('#menu', 'aria-expanded'), 'true');
    assert.equal(await p.locator('#nav').isVisible(), true);
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('#nav').isVisible(), false);
    assert.equal(await p.evaluate(() => document.activeElement.id), 'menu');
    await p.click('#menu');
    await p.click('#nav a[href="#faq"]');
    assert.equal(await p.locator('#nav').isVisible(), false);
    await p.waitForFunction(() => location.hash === '#faq');
  });
});

await step('FAQ answers open and close', async () => {
  await withPage({}, async (p) => {
    const d = p.locator('.faq details').first();
    assert.equal(await d.evaluate((n) => n.open), false);
    await d.locator('summary').click();
    assert.equal(await d.evaluate((n) => n.open), true);
    await d.locator('summary').click();
    assert.equal(await d.evaluate((n) => n.open), false);
    assert.equal(await p.locator('.faq details').count(), 9);
  });
});

await step('with no addresses configured, no dead control is shown', async () => {
  await withPage({}, async (p) => {
    for (const sel of ['#get-app', '#get-mail', '#foot-mail', '#foot-privacy', '#foot-terms']) assert.equal(await p.locator(sel).isVisible(), false, sel);
    assert.equal(await p.getAttribute('[data-cta-label]', 'href'), '#get');
  });
});

await step('configured addresses appear, open safely, and unsafe ones are ignored', async () => {
  await withPage({ config: { appUrl: 'https://example.com/get', supportEmail: 'hello@example.com', privacyUrl: 'https://example.com/privacy', termsUrl: 'javascript:alert(1)' } }, async (p) => {
    assert.equal(await p.getAttribute('#get-app', 'href'), 'https://example.com/get');
    assert.equal(await p.getAttribute('#get-app', 'rel'), 'noopener noreferrer');
    assert.equal(await p.getAttribute('.hero [data-cta-label]', 'href'), 'https://example.com/get');
    assert.equal(await p.getAttribute('#get-mail', 'href'), 'mailto:hello@example.com');
    assert.equal(await p.locator('#foot-privacy').isVisible(), true);
    assert.equal(await p.locator('#foot-terms').isVisible(), false);
  });
});

await step('the skip link works, focus is always visible, and the progress bar follows the page', async () => {
  await withPage({}, async (p) => {
    await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(() => document.activeElement.className), 'skip');
    await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => location.hash), '#main');
    const outline = await p.evaluate(() => { document.querySelector('.nav a').focus(); return getComputedStyle(document.querySelector('.nav a')).outlineStyle; });
    assert.notEqual(outline, 'none');
    await p.evaluate(() => scrollTo({ top: document.getElementById('faq').getBoundingClientRect().top + scrollY, behavior: 'instant' }));
    await frames(p, 6);
    assert.ok(parseFloat(await p.evaluate(() => document.getElementById('progress').style.getPropertyValue('--p'))) > 0.5, 'progress bar advances');
  });
});

// ------------------------------------------------------------------ the pinned chapters fit short windows
await step('pinned chapters fit the window: short laptops, desktops and large monitors', async () => {
  for (const [w, h] of [[1280, 640], [1366, 657], [1366, 768], [1280, 720], [1024, 768], [1440, 900], [1920, 1080]]) {
    await withPage({ w, h }, async (p) => {
      await p.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });      // measure each step as it settles, not half way through its accordion
      await p.evaluate(() => document.documentElement.classList.add('fx', 'pin'));
      await p.waitForTimeout(150);
      const fit = await p.evaluate(() => {
        const out = {};
        for (const [name, pinSel, copySel, itemSel, cls] of [['journey', '.journey-pin', '.journey-copy', '.j-step', 'is-active'], ['anatomy', '.anat-pin', '.anat-copy', '#anat-list li', 'is-on']]) {
          const pin = document.querySelector(pinSel), pr = pin.getBoundingClientRect(), items = [...pin.querySelectorAll(itemSel)];
          let top = 1e9, bottom = 0;
          items.forEach((_, k) => {
            items.forEach((li, j) => li.classList.toggle(cls, j === k));
            for (const el of [pin.querySelector(copySel), pin.querySelector('.phone3d')]) { const r = el.getBoundingClientRect(); top = Math.min(top, r.top - pr.top); bottom = Math.max(bottom, r.bottom - pr.top); }
          });
          out[name] = { top: Math.round(top), bottom: Math.round(bottom), height: Math.round(pr.height) };
        }
        return out;
      });
      for (const [name, f] of Object.entries(fit)) {
        assert.ok(f.top >= 60, `${w}x${h} ${name}: content starts under the header (${f.top}px)`);
        assert.ok(f.bottom <= f.height, `${w}x${h} ${name}: content runs off the bottom (${f.bottom} of ${f.height}px)`);
      }
    });
  }
});

// ------------------------------------------------------------------ axe, plain page
if (WITH_AXE) {
  await step('axe-core finds no accessibility violations on the plain page (dark and light, desktop and phone)', async () => {
    for (const [scheme, w] of [['dark', 1280], ['light', 1280], ['dark', 390], ['light', 390]]) {
      await withPage({ w, h: 900, scheme }, async (p) => {
        await p.evaluate(() => document.querySelectorAll('.reveal, .rise').forEach((n) => n.classList.add('in')));
        await p.waitForTimeout(700);
        await runAxe(p, `${scheme} ${w}`);
        await p.click('.j-step:nth-child(3) .j-head button'); await p.click('#anat-list li:nth-child(3) b button'); await p.click('[data-app-theme="light"]');
        await p.click('.tchip >> nth=0');
        await p.mouse.move(0, 0); await p.waitForTimeout(600);        // let the colour transitions finish: axe would read the colours half way
        await runAxe(p, `${scheme} ${w} after interacting`);
      });
    }
  });
} else {
  results.push('skip axe-core (set AXE_CORE to axe.min.js to run it)');
}

// ------------------------------------------------------------------ the 3D page (software WebGL)
if (WITH_GL) {
  await step('3D desktop: the stage starts and draws, the chapters pin, and their buttons scroll to the right step', async () => {
    await withPage({ w: 1440, h: 900, gl: true }, async (p) => {
      assert.equal(await p.evaluate(() => window.__slotify.mode), 'fx+pin');
      assert.equal(await p.evaluate(() => document.documentElement.classList.contains('pin')), true);
      await frames(p, 10);
      const lit = await coverage(p);
      assert.ok(lit > 0.03, `the canvas has something on it (${(lit * 100).toFixed(1)}% of pixels)`);
      assert.equal(await p.evaluate(() => document.getElementById('h1').getAttribute('aria-label')), 'Appointments, without the back‑and‑forth.', 'the split heading keeps one name');

      // scrolling walks through the journey
      const y0 = await secTop(p, 'how'), span = await p.evaluate(() => document.getElementById('how').getBoundingClientRect().height - innerHeight);
      const seen = [];
      for (let i = 0; i < 5; i++) { await jump(p, y0 + span * ((i + 0.5) / 5)); seen.push(await activeIndex(p, '.j-step', 'is-active')); }
      assert.deepEqual(seen, [0, 1, 2, 3, 4]);
      assert.equal(await p.locator('#phone-j .screen.is-on').getAttribute('data-screen'), await p.locator('.j-step').nth(4).getAttribute('data-screen'));
      // a button scrolls to its step
      await p.locator('.j-step').nth(1).locator('.j-head button').click();
      await p.waitForFunction(() => [...document.querySelectorAll('.j-step')].findIndex((n) => n.classList.contains('is-active')) === 1, null, { timeout: 20000 });

      // the anatomy chapter pulls the layers apart, names them, and a button scrolls to its layer
      const a0 = await secTop(p, 'app'), aspan = await p.evaluate(() => document.getElementById('app').getBoundingClientRect().height - innerHeight);
      await jump(p, a0 + aspan * 0.5);
      assert.ok(parseFloat(await p.evaluate(() => document.getElementById('phone-a').style.getPropertyValue('--ex'))) > 0.95, 'layers are apart');
      assert.ok(parseFloat(await p.evaluate(() => getComputedStyle(document.querySelector('#al-labels li')).opacity)) > 0.3, 'layer names are shown beside the phone');
      await p.locator('#anat-list li').nth(4).locator('b button').click();
      await p.waitForFunction(() => [...document.querySelectorAll('#anat-list li')].findIndex((n) => n.classList.contains('is-on')) === 4, null, { timeout: 20000 });
      assert.deepEqual(p.errors, []);
    });
  });

  await step('3D hero: tapping a pill selects it, tapping a booked one says so, and the label stays off the text', async () => {
    await withPage({ w: 1440, h: 900, gl: true }, async (p) => {
      await frames(p, 12);
      // the pointer maths: a point on the screen must map back to the place on the field it was drawn from (the glow under the cursor and taps rely on it)
      const trip = await p.evaluate(() => {
        const s = window.__slotify.stage(), f = s.F.field; let worst = 0, n = 0;
        for (let id = 0; id < f.pos.length / 3; id += 7) {
          const x = f.pos[id * 3], z = f.pos[id * 3 + 2], [px, py, vis] = s.project(x, 0.1, z);
          if (!vis) continue;
          const q = s._floorPoint(px / s.w * 2 - 1, -(py / s.h * 2 - 1), 0.1);
          worst = Math.max(worst, Math.hypot(q[0] - x, q[1] - z)); n++;
        }
        return { worst, n };
      });
      assert.ok(trip.n > 20 && trip.worst < 0.05, `the pointer maths round-trips (${trip.n} points, worst error ${trip.worst.toFixed(3)})`);
      const pickAt = (kind) => p.evaluate((kind) => {
        const s = window.__slotify.stage(), info = s.F.field.info, W = innerWidth, H = innerHeight;
        let best = null;
        for (let id = 0; id < info.length; id++) {
          if (info[id].kind !== kind) continue;
          const a = s.fieldAnchor(id), [x, y, vis] = s.project(a[0], 0.1, a[2]);
          if (!vis || x < 80 || x > W - 120 || y < H * 0.45 || y > H * 0.8) continue;
          const el = document.elementFromPoint(x, y);                                   // only places a tap can reach the field from
          if (!el || el.closest('a, button, nav, summary, label, input, select, textarea, [role="radio"], [role="switch"], #sim-root')) continue;
          const score = Math.abs(x - W / 2);
          if (!best || score > best.score) best = { id, x, y, score };
        }
        return best;
      }, kind);
      const open = await pickAt('open');
      assert.ok(open, 'an open pill is on screen');
      await p.mouse.click(open.x, open.y);
      await frames(p, 4);
      const picked = await p.evaluate(() => { const s = window.__slotify.stage(), d = s.describe(s.sel); return { id: s.sel, label: `Selected ${d.day} ${d.time}` }; });
      assert.equal(picked.id, open.id, 'the pill that was tapped is the selected one');
      assert.equal(await p.textContent('#ruler-pick'), picked.label, 'the key under the field names the selected time');
      const booked = await pickAt('booked');
      assert.ok(booked, 'a booked pill is on screen');
      await p.mouse.click(booked.x, booked.y);
      await frames(p, 1);                                  // the answer stays up for 1.7 s: read it at once (the software renderer is slow)
      const said = await p.evaluate(() => { const c = document.getElementById('pick-chip'); return { text: c.textContent, opacity: parseFloat(getComputedStyle(c).opacity) }; });
      assert.match(said.text, /Booked/);
      assert.ok(said.opacity > 0.5, 'the answer is shown');
      await p.waitForTimeout(2600); await frames(p, 4);
      const clash = await p.evaluate(() => {
        const chip = document.getElementById('pick-chip');
        if (parseFloat(getComputedStyle(chip).opacity) < 0.05) return false;
        const c = chip.getBoundingClientRect();
        return ['h1', '.hero .lede', '.hero-cta', '.hero .meta'].some((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return c.left < r.right && c.right > r.left && c.top < r.bottom && c.bottom > r.top; });
      });
      assert.equal(clash, false, 'the label overlaps hero text');
      assert.deepEqual(p.errors, []);
    });
  });

  await step('3D short laptop (1366x657): the demonstration row sits in the clear band under the buttons', async () => {
    await withPage({ w: 1366, h: 657, gl: true }, async (p) => {
      assert.equal(await p.evaluate(() => window.__slotify.mode), 'fx+pin');
      await frames(p, 12);
      const band = await p.evaluate(() => {
        const s = window.__slotify.stage(), meta = document.querySelector('.hero .meta').getBoundingClientRect(), foot = document.querySelector('.hero-foot').getBoundingClientRect();
        const a = s.fieldAnchor(s.sel), [, y] = s.project(a[0], a[1], a[2]);
        return { y, metaBottom: meta.bottom, footTop: foot.top };
      });
      assert.ok(band.y > band.metaBottom + 20, `the selected pill (${Math.round(band.y)}) is below the buttons and note (${Math.round(band.metaBottom)})`);
      assert.ok(band.y < Math.min(band.footTop, 657) - 6, `and above the key (${Math.round(band.footTop)})`);
    });
  });

  await step('3D theme: the stage follows the page theme and keeps drawing', async () => {
    await withPage({ w: 1280, h: 800, gl: true, scheme: 'dark' }, async (p) => {
      await frames(p, 6);
      await p.click('#theme');
      await p.waitForFunction(() => window.__slotify.stage().themeT > 0.95, null, { timeout: 30000 });
      assert.equal(await p.evaluate(() => window.__slotify.stage().themeName), 'light');
      assert.ok((await coverage(p)) > 0.03, 'still drawing in light');
      assert.deepEqual(p.errors, []);
    });
  });

  await step('3D phone (390x844): the page flows, steps and layers are buttons, the ring sits on its box', async () => {
    await withPage({ w: 390, h: 844, gl: true, touch: true }, async (p) => {
      assert.equal(await p.evaluate(() => window.__slotify.mode), 'fx');
      assert.equal(await p.evaluate(() => document.documentElement.classList.contains('pin')), false);
      assert.equal(await noOverflow(p), true, 'no horizontal scroll');
      assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('pick-chip')).opacity), '0', 'the hero label stays out of the way on a phone');
      // the day dial: the 3D ring is drawn where its box is
      await jump(p, await secTop(p, 'dial', 0, -300));
      const where = await p.evaluate(() => {
        const s = window.__slotify.stage(), b = document.getElementById('dial').getBoundingClientRect(), c = s.project(0, 0.2, 0);
        return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, rx: c[0], ry: c[1] };
      });
      assert.ok(Math.abs(where.rx - where.cx) < 40, `ring centre x ${Math.round(where.rx)} vs box ${Math.round(where.cx)}`);
      assert.ok(Math.abs(where.ry - where.cy) < 60, `ring centre y ${Math.round(where.ry)} vs box ${Math.round(where.cy)}`);
      // text-only stretches do not render the stage at all
      await jump(p, await secTop(p, 'know'));
      assert.equal(await p.evaluate(() => document.getElementById('stage').style.visibility), 'hidden');
      // steps and layers are buttons
      for (const i of [3, 1]) {
        const b = p.locator('.j-step').nth(i).locator('.j-head button');
        await b.scrollIntoViewIfNeeded(); await b.click();
        assert.equal(await activeIndex(p, '.j-step', 'is-active'), i);
        assert.equal(await p.locator('#phone-j .screen.is-on').getAttribute('data-screen'), await p.locator('.j-step').nth(i).getAttribute('data-screen'));
      }
      const lb = p.locator('#anat-list li').nth(2).locator('b button');
      await lb.scrollIntoViewIfNeeded(); await lb.click();
      assert.equal(await activeIndex(p, '#anat-list li', 'is-on'), 2);
      assert.equal(await noOverflow(p), true, 'still no horizontal scroll');
      assert.deepEqual(p.errors, []);
    });
  });

  await step('3D small phone (320x568): no horizontal scroll anywhere with the stage running', async () => {
    await withPage({ w: 320, h: 568, gl: true, touch: true }, async (p) => {
      for (const id of ['top', 'about', 'how', 'app', 'rules', 'features', 'faq', 'get']) { await jump(p, await secTop(p, id)); assert.equal(await noOverflow(p), true, `overflow at #${id}`); }
      assert.deepEqual(p.errors, []);
    });
  });

  await step('3D: if the graphics context is lost for good, the page quietly becomes the plain page and keeps working', async () => {
    await withPage({ w: 1280, h: 800, gl: true }, async (p) => {
      await frames(p, 6);
      await p.evaluate(() => window.__slotify.stage().gl.getExtension('WEBGL_lose_context').loseContext());
      await p.waitForFunction(() => document.documentElement.classList.contains('lite'), null, { timeout: 20000 });
      assert.equal(await p.evaluate(() => document.documentElement.classList.contains('fx') || document.documentElement.classList.contains('pin')), false);
      assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('stage')).display), 'none');
      const b = p.locator('.j-step').nth(2).locator('.j-head button');
      await b.scrollIntoViewIfNeeded(); await b.click();
      assert.equal(await activeIndex(p, '.j-step', 'is-active'), 2);
      await p.locator('.tchip').first().scrollIntoViewIfNeeded();
      await p.locator('.tchip').first().click();
      assert.equal(await p.locator('.sim-result').isVisible(), true);
      assert.deepEqual(p.errors, []);
    });
  });

  if (WITH_AXE) {
    await step('3D: axe-core finds no accessibility violations with the stage running (dark and light, desktop and phone)', async () => {
      for (const [scheme, w, h, touch] of [['dark', 1280, 800, false], ['light', 1280, 800, false], ['dark', 390, 844, true]]) {
        await withPage({ w, h, scheme, gl: true, touch }, async (p) => {
          await frames(p, 8);
          await p.evaluate(() => document.querySelectorAll('.rise').forEach((n) => n.classList.add('in')));
          await runAxe(p, `3D ${scheme} ${w}`);
        });
      }
    });
  }
} else {
  results.push('skip 3D steps (GL=0)');
}

await browser.close();
if (glBrowser) await glBrowser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
