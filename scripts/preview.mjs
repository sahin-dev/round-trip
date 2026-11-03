/* Serves dist/ with the same headers as production, so CSP and offline mode can be tried locally. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 4173;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
const headers = {};
let rule = '';
readFileSync(join(dist, '_headers'), 'utf8').split('\n').forEach((line) => {
  if (!line.trim()) return;
  if (!line.startsWith(' ')) { rule = line.trim(); return; }
  if (rule !== '/*') return;
  const i = line.indexOf(':');
  headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
});
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const file = join(dist, path || 'index.html');
    if (!file.startsWith(dist)) throw new Error('outside dist');
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
