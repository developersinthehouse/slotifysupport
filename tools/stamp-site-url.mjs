// Usage: node tools/stamp-site-url.mjs https://your-domain.example
// Writes absolute addresses into both pages (canonical, og:url, og:image) and creates
// a sitemap.xml entry for each page plus the Sitemap line in robots.txt. Safe to re-run.
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
const pages = [
  { file: 'index.html', url: `${site}/` },
  { file: 'download.html', url: `${site}/download.html` },
];
for (const page of pages) {
  const file = path.join(root, page.file);
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/\s*<link rel="canonical"[^>]*>/g, '').replace(/\s*<meta property="og:url"[^>]*>/g, '');
  html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${site}/assets/og.png$2`);
  html = html.replace('<link rel="icon"', `<link rel="canonical" href="${page.url}">\n  <meta property="og:url" content="${page.url}">\n  <link rel="icon"`);
  fs.writeFileSync(file, html);
}

const sitemapUrls = pages.map((page) => `  <url><loc>${page.url}</loc></url>`).join('\n');
fs.writeFileSync(path.join(root, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`);
fs.writeFileSync(path.join(root, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);
console.log(`Stamped ${site}`);
