/* Slotify website: the parts that must work even when the module scripts do not run (file:// or a blocked module):
   configured buttons, the theme switch, the mobile menu, reveal-on-scroll and the 2D hero ruler. Everything else lives in js/. */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(s, c) { return (c || document).querySelector(s); }
  function $all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  // ---------- configuration (site.config.js): a control appears only when its value is set
  var cfg = window.SLOTIFY_SITE || {};
  function webUrl(v) { return typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v.trim()) ? v.trim() : ''; }
  function email(v) { return typeof v === 'string' && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v.trim()) ? v.trim() : ''; }
  var appUrl = webUrl(cfg.appUrl), mail = email(cfg.supportEmail), privacy = webUrl(cfg.privacyUrl), terms = webUrl(cfg.termsUrl);

  function external(a, url) { a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.hidden = false; }
  if (appUrl) {
    $all('[data-cta-label]').forEach(function (a) { external(a, appUrl); });
    external($('#get-app'), appUrl);
  }
  if (mail) {
    var m = $('#get-mail'); m.href = 'mailto:' + mail; m.hidden = false;
    var fm = $('#foot-mail'); fm.hidden = false; $('a', fm).href = 'mailto:' + mail; $('a', fm).textContent = 'Contact';
  }
  if (privacy) { var fp = $('#foot-privacy'); fp.hidden = false; external($('a', fp), privacy); }
  if (terms) { var ft = $('#foot-terms'); ft.hidden = false; external($('a', ft), terms); }
  $('#year').textContent = String(new Date().getFullYear());

  // ---------- theme (website). js/main.js listens for 'slotify:theme' to recolour the 3D stage.
  var themeBtn = $('#theme');
  function effectiveTheme() {
    return root.dataset.theme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function labelTheme() {
    themeBtn.setAttribute('aria-label', effectiveTheme() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
  }
  labelTheme();
  themeBtn.addEventListener('click', function () {
    var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('slotify-site-theme', next); } catch (e) { /* storage can be blocked */ }
    labelTheme();
    document.dispatchEvent(new CustomEvent('slotify:theme', { detail: next }));
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', labelTheme);

  // ---------- mobile menu
  var menu = $('#menu'), nav = $('#nav');
  function setMenu(open) { nav.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); menu.textContent = open ? 'Close' : 'Menu'; }
  menu.addEventListener('click', function () { setMenu(!nav.classList.contains('open')); });
  nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menu.focus(); } });

  // ---------- reveal on scroll
  var reveals = $all('.reveal');
  if (!('IntersectionObserver' in window) || reduce) {
    reveals.forEach(function (n) { n.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (n) { io.observe(n); });
  }

  // ---------- hero ruler: the 2D version of the day, shown when the 3D stage is not running
  var ruler = $('#ruler');
  var slots = $all('.slot', ruler);
  var pickLabel = $('#ruler-pick');
  var open = [0, 3, 4, 6, 7, 10, 12, 14, 15]; // indexes that are neither booked nor in the break
  slots.forEach(function (s, i) { s.style.setProperty('--i', String(i)); });
  function timeOf(i) {
    var mins = 9 * 60 + i * 30, h = Math.floor(mins / 60), mm = mins % 60;
    var h12 = h > 12 ? h - 12 : h;
    return h12 + ':' + (mm ? '30' : '00') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  var current = 4;
  function pick(i) {
    slots.forEach(function (s) { s.classList.remove('is-pick'); });
    slots[i].classList.add('is-pick');
    pickLabel.textContent = 'Selected ' + timeOf(i);
    current = i;
  }
  var timer = null;
  function cycle() { pick(open[(open.indexOf(current) + 1) % open.length]); }
  function start() { if (!timer && !reduce && !document.hidden) timer = setInterval(cycle, 2200); }
  function stop() { clearInterval(timer); timer = null; }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { ruler.classList.add('in'); start(); } else { stop(); }
      });
    }, { threshold: 0.05 }).observe(ruler);
  } else {
    ruler.classList.add('in');
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (ruler.classList.contains('in')) start(); });

  // ---------- opened as a plain file: browsers refuse module scripts there, so say why the demonstration is missing
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (root.classList.contains('fx') || root.classList.contains('lite')) return;
      var box = $('#sim-root');
      if (!box) return;
      var p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'The interactive demonstration needs this page to be opened from a web address (http or https). Browsers block it when the page is opened as a plain file, or when the server labels scripts with the wrong type.';
      box.appendChild(p);
      box.hidden = false;
    }, 1500);
  });
})();
