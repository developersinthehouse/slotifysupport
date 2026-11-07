// Small page effects that do not depend on the 3D stage: headings that rise word by word, the reading-progress bar,
// the section ruler on the right edge, and buttons that lean towards the pointer.
import { clamp } from './util.js';

function splitWords(el) {
  if (el.classList.contains('is-split') || el.children.length) return;       // only plain-text headings are split
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  if (!text) return;
  el.setAttribute('aria-label', text);                                   // one name for assistive technology, not one per word
  el.textContent = '';
  text.split(' ').forEach((word, i, all) => {
    const w = document.createElement('span');
    const wi = document.createElement('span');
    w.className = 'w'; w.setAttribute('aria-hidden', 'true');
    wi.className = 'wi'; wi.style.setProperty('--k', String(i)); wi.textContent = word;
    w.append(wi); el.append(w);
    if (i < all.length - 1) el.append(document.createTextNode(' '));
  });
  el.classList.add('is-split');
}

/** @param {{reduce:boolean, fine:boolean}} env */
export function initFx({ reduce, fine }) {
  // ---- headings
  const rises = Array.from(document.querySelectorAll('.rise'));
  try {
    rises.forEach(splitWords);
    if (reduce || !('IntersectionObserver' in window)) {
      rises.forEach((el) => el.classList.add('in'));
    } else {
      const io = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.2 });
      rises.forEach((el) => io.observe(el));
    }
  } catch (err) {
    rises.forEach((el) => el.classList.add('in'));                      // never leave a heading hidden
  }

  // ---- magnetic buttons: a few pixels of lean, only with a real pointer
  if (fine && !reduce) {
    for (const el of document.querySelectorAll('[data-magnet]')) {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width, dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        el.style.transform = `translate(${(dx * 12).toFixed(1)}px, ${(dy * 9).toFixed(1)}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    }
  }

  // ---- progress bar and section ruler
  const bar = document.getElementById('progress');
  const links = Array.from(document.querySelectorAll('.dayrule a[data-for]'));
  let marks = [], maxY = 1, active = -1, lastP = -1;

  function measure() {
    const y = window.scrollY || 0;
    marks = links.map((a) => {
      const el = document.getElementById(a.dataset.for);
      return el ? el.getBoundingClientRect().top + y : Infinity;
    });
    maxY = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  function update(y, vh) {
    const p = clamp(y / maxY);
    if (Math.abs(p - lastP) > 0.0004) { bar.style.setProperty('--p', p.toFixed(4)); lastP = p; }
    if (!links.length) return;
    let k = 0;
    const ref = y + vh * 0.42;
    for (let i = 0; i < marks.length; i++) if (marks[i] <= ref) k = i;
    if (p > 0.995) k = links.length - 1;
    if (k !== active) {
      links.forEach((a, i) => {
        a.classList.toggle('is-active', i === k);
        if (i === k) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
      active = k;
    }
  }

  return { measure, update };
}
