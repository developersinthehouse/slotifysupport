# Slotify website

The public product site for Slotify, built by DEVELOPERS. It is a static site: one HTML page, two stylesheets, plain JavaScript modules and bundled fonts. No build step, no runtime dependencies, no tracking, no cookies, and no network requests beyond its own files. It stores one value in the browser (`slotify-site-theme`) only when a visitor uses the theme button.

## What it is

One long page with one 3D scene behind it. The scene is made of the thing the app is made of, half-hour time slots, and it changes shape as you scroll:

| Chapter | What happens on the page |
| --- | --- |
| Hero | A field of slots: sixteen days of half-hour pills. Move over it and the slots under the pointer rise and catch a little light. Tap an open pill to select a time; tap a booked one and it says so. |
| The idea | The slots bend into a ring, a day on a dial. |
| How it works | Pinned on wide screens: scrolling (or the step buttons) walks through five steps while the slots become one row and a 3D phone shows each step's screen. |
| The app, layer by layer | The phone is pulled apart in depth into six named layers; scroll or press a layer's name to light it. |
| Try the rules | A working simulator of the app's booking rules (hours, break, notice, gap, step, daily limit, existing bookings). Change a rule and the open times change. |
| What it does, Good to know, FAQ, Get Slotify | Plain content, with the FAQ also published as structured data. |

## What it says, and where each statement comes from

Everything on the page describes something the app does today (see the main `README.md` and `CHANGELOG.md`). There are no statistics, testimonials, customer counts, ratings or prices. "Good to know" states the limits plainly (Android only, clients sign in, one professional per practice, payments need the professional's own Razorpay account).

The phones are **drawn in HTML and CSS** from the app's colour tokens (`lib/core/theme/app_colors.dart`), layout and wording, with sample data (a "Sample Practice", example numbers). They are not screenshots, because the app cannot be run where the site was written, and the page says "sample data" next to them. To use real screenshots later, replace the contents of a `.phone-in` element with an `<img>` taken from a device.

The field of slots in the hero is an illustration of how open times work and is labelled as one. The rules simulator uses a port of the app's availability rules (`js/sim/engine.js`), checked by `js/sim/engine.test.mjs` against hand-worked cases and an independent brute-force reading of the rules on 4000 random configurations.

## How the page runs

The same content is served three ways, chosen on load and on resize:

- **3D page** (`html.fx`): one fixed WebGL2 canvas draws all the slots as a single instanced mesh. On windows wider than 960 px and at least 640 px tall the two long chapters are pinned (`html.pin`) and scrolling drives them. On narrower or shorter windows nothing is pinned: the page flows, the steps and layers are buttons, and the phones tilt or come apart as they scroll past.
- **Plain page** (`html.lite`): the complete page without the canvas, with a still phone and a 2D version of the hero strip. It is used when WebGL2 is missing or only software-rendered, and with reduced motion, data saver, forced colours or `?fx=0`. If the graphics context is lost for good, a running 3D page falls back to it by itself.
- **Opened from disk**: browsers refuse module scripts on `file://`, so the page stays plain and the demonstration area says why. Serve the folder over http(s) (below).

Rendering is kept light: the canvas pauses when the tab is hidden, the pixel ratio is capped (2 on desktop, 1.5 on phones and narrow windows) and lowered automatically if frames run slow. All motion respects `prefers-reduced-motion`. Every control on the page is a real button or link and works by keyboard; the 3D canvas itself is an illustration and is hidden from assistive technology.

Query switches, mainly for testing: `?fx=0` forces the plain page; `?gl=soft` lets the 3D page start on a software renderer (it is refused by default because it is slow); `?debug` exposes `window.__slotify` (the stage, the chapters and their state).

## Before you publish

1. Edit `site.config.js` (all optional, all public):
   - `appUrl`: where people download the Android app. While empty, the "Get the app" buttons scroll to the Get Slotify section, which shows no download button.
   - `supportEmail`: shows a "Contact DEVELOPERS" button and a footer link.
   - `privacyUrl`, `termsUrl`: footer links, shown only when set. Only `http(s)` addresses are accepted.
2. Run `node tools/stamp-site-url.mjs https://your-domain.example` once. It writes the canonical address and absolute `og:image` into `index.html` and creates `sitemap.xml` and the Sitemap line in `robots.txt` (social previews need absolute addresses).
3. Upload the whole folder to any static host (Netlify, Vercel, Cloudflare Pages, Firebase Hosting, GitHub Pages, nginx) over HTTPS. Use a different address from the admin console, and do not link the admin console from this site.

Recommended headers:
```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Cache-Control: public, max-age=31536000, immutable   (for /fonts/* and /assets/*)
```
The page loads only its own files. It has one executable inline script (it sets the theme before first paint), two inline JSON-LD blocks (data, not executed), no inline `style` attributes, no `eval` and no third-party requests. If you add a Content-Security-Policy, allow `script-src 'self'` plus the hash of that one inline script (or `'unsafe-inline'`). The page has not been run under a CSP here, so check it in your browser's console after you add one.

Weight: HTML 9 KB, CSS 12 KB and JavaScript 39 KB gzipped (36 KB of the JavaScript is the 3D scene, the chapters and the simulator); four Inter weights 67 KB as woff2 (Latin subset); the wordmark 20 to 23 KB.

## Run it locally

```
python3 tools/serve.py 8081      # then open http://localhost:8081
```
On Windows, run `RUN_SITE.ps1` in this folder (or `RUN_WEBSITE.ps1` in the bundle). Use `tools/serve.py` rather than `python -m http.server`: on some Windows computers Python sends `.js` files as `text/plain`, and browsers refuse ES modules sent that way, so the 3D page would not start. Any real web host sends the right type. Add `--lan` to let a phone on the same Wi-Fi open the page. Add `?fx=0` to the address to see the plain page.

## Tests

```
PLAYWRIGHT_CORE=/path/to/playwright AXE_CORE=/path/to/axe.min.js node tests/site.test.mjs
```
Add `--plain` to skip the 3D steps, or set `ONLY=<regex>` to run the steps whose names match. The 3D steps start Chromium with a software WebGL renderer (`?gl=soft`), so they are slow.

Real Chromium against the real files:

- **Files:** links, anchors and ARIA references resolve; title, description, language, theme colour and social card; structured data valid and matching the visible FAQ; a size budget; no secrets or private keys; the rules engine.
- **Plain page:** no console errors or failed requests, in both colour schemes; the fallbacks (no WebGL, reduced motion, forced colours, `?fx=0`); no horizontal scroll and readable text at 1440, 1280, 820, 390 and 320 px in both themes; theme toggle; the hero strip only selects open times; the five steps, the six layers, the simulator (presets, options with arrow keys, switches, booking, undo, reset), the mobile menu, the FAQ; nothing shown for an unset address and unsafe addresses (`javascript:`) ignored; skip link, visible focus and the progress bar; the pinned chapters fit windows from 1024x768 to 1920x1080 and short laptops down to 1280x640; an axe-core scan (WCAG 2.1 AA and best practices) in both themes at desktop and phone width, also after interacting.
- **3D page:** the stage starts and draws; the chapters pin and their buttons scroll to the right step; the pointer maths maps a screen point back to the slot under it; tapping a pill selects it and a booked one says so; the hero label stays off the text, including on a 1366x657 laptop; the theme follows the page; the phone layout flows with the ring on its box; no horizontal scroll at 320 px; the plain page takes over after a lost graphics context; axe-core with the stage running.

Not run: Lighthouse, a real GPU (frame rate and the adaptive pixel ratio are untested on real hardware), real phones, Safari and Firefox, screen readers (axe is automated only), and a deployment behind a CSP.

## Files

- `index.html`: content and structured data.
- `styles.css`, `app.css`: tokens and layout; the phone previews and their 3D layers.
- `site.js`: theme, menu, reveal, the 2D hero strip, links from `site.config.js`.
- `js/main.js`: starts the 3D page or the plain one, runs the frame loop and the chapters. `js/chapters.js`, `js/journey.js`, `js/anatomy.js`: the scroll-driven chapters. `js/fx.js`: headings that rise word by word, the progress bar, the section ruler and buttons that lean towards the pointer. `js/gl/`: the WebGL2 stage, the slot formations, the camera poses and the shaders. `js/sim/`: the rules simulator.
- `site.config.js`, `site.config.example.js`: your addresses.
- `tools/stamp-site-url.mjs`: writes the canonical address, sitemap and robots line. `tools/serve.py`, `RUN_SITE.ps1`: a local server that sends the right file types. `tools/make-wordmark.py`: rebuilds `js/gl/wordmark-data.js` (the pills that spell Slotify at the end of the page) from `assets/logo-on-dark.webp`; needs `pillow` and `numpy`, and its result is already committed.
- `assets/`: wordmarks, icons, social image. `fonts/`: Inter, SIL Open Font License, subset to Latin.
- `tests/site.test.mjs`, `js/sim/engine.test.mjs`: the tests above.

Developed by DEVELOPERS.
