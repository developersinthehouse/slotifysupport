(function () {
  'use strict';
  var root = document.documentElement;
  var themeButton = document.getElementById('theme');
  var downloadLink = document.getElementById('download-link');
  var setupMessage = document.getElementById('download-setup');
  var cfg = window.SLOTIFY_SITE || {};
  var url = typeof cfg.appUrl === 'string' && /^https?:\/\/[^\s]+$/i.test(cfg.appUrl.trim()) ? cfg.appUrl.trim() : '';

  if (url) {
    downloadLink.href = url;
    downloadLink.target = '_blank';
    downloadLink.rel = 'noopener noreferrer';
    downloadLink.hidden = false;
    setupMessage.hidden = true;
  }

  function effectiveTheme() {
    return root.dataset.theme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function labelTheme() {
    themeButton.setAttribute('aria-label', effectiveTheme() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
  }
  labelTheme();
  themeButton.addEventListener('click', function () {
    var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('slotify-site-theme', next); } catch (e) { /* storage can be blocked */ }
    labelTheme();
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', labelTheme);
})();
