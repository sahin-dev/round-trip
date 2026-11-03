/* Builds dist/: one minified script and stylesheet with content hashes, plus the files a host needs. */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { transform } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB, ${(gzipSync(s).length / 1024).toFixed(0)} KB gzipped`;

let html = readFileSync(join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>\n?/g)];
if (!scripts.length) throw new Error('index.html lists no scripts');
const source = scripts.map((m) => readFileSync(join(root, m[1]), 'utf8')).join('\n;\n');
const { code: js } = await transform(source, { minify: true, target: 'es2020', charset: 'utf8', legalComments: 'none' });
const { code: css } = await transform(readFileSync(join(root, 'css/site.css'), 'utf8'), { loader: 'css', minify: true, target: 'chrome100', charset: 'utf8' });
const jsName = `assets/app.${hash(js)}.js`, cssName = `assets/site.${hash(css)}.css`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });
writeFileSync(join(dist, jsName), js);
writeFileSync(join(dist, cssName), css);
cpSync(join(root, 'public'), dist, { recursive: true });

scripts.slice(1).forEach((m) => { html = html.replace(m[0], ''); });
html = html.replace(scripts[0][0], `<script src="${jsName}"></script>\n`)
  .replace('<link rel="stylesheet" href="css/site.css">', `<link rel="stylesheet" href="${cssName}">\n<link rel="manifest" href="manifest.webmanifest">`)
  .replace('<html lang="en">', '<html lang="en" data-sw="sw.js">');
writeFileSync(join(dist, 'index.html'), html);

const sw = readFileSync(join(root, 'scripts/sw.template.js'), 'utf8')
  .replace('__VERSION__', hash(js + css + html))
  .replace('__FILES__', JSON.stringify(['./', jsName, cssName, 'icon.svg', 'manifest.webmanifest']));
writeFileSync(join(dist, 'sw.js'), sw);
console.log(`script ${kb(js)}\nstyles ${kb(css)}\nbuilt ${dist}`);
