// Usage: node tools/stamp-site-url.mjs https://your-domain.example
// Writes the absolute address into index.html (canonical, og:url, og:image) and creates
// sitemap.xml and the Sitemap line in robots.txt. Run it once before you deploy; it is safe to re-run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2] || '';
let url;
try { url = new URL(arg); } catch { /* handled below */ }
if (!url || !/^https?:$/.test(url.protocol)) {
  console.error('Give the full public address, for example: node tools/stamp-site-url.mjs https://slotify.example');
  process.exit(1);
}
const site = url.origin + (url.pathname.replace(/\/$/, ''));
const file = path.join(root, 'index.html');
let html = fs.readFileSync(file, 'utf8');

html = html.replace(/\s*<link rel="canonical"[^>]*>/g, '').replace(/\s*<meta property="og:url"[^>]*>/g, '');
html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${site}/assets/og.png$2`);
html = html.replace('<link rel="icon"', `<link rel="canonical" href="${site}/">\n  <meta property="og:url" content="${site}/">\n  <link rel="icon"`);
fs.writeFileSync(file, html);

fs.writeFileSync(path.join(root, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${site}/</loc></url>\n</urlset>\n`);
fs.writeFileSync(path.join(root, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);
console.log(`Stamped ${site}`);
