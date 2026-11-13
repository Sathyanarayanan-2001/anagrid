// Tiny static server for dist/, for local checks and the browser tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, normalize, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

export function serve(port = 0) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(dist, path === '' || path.endsWith('/') ? path + 'index.html' : path);
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return; } // never serve outside dist
    try {
      let body = await readFile(file);
      const head = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' };
      // GitHub Pages compresses text responses; do the same so local timings are comparable.
      if (/gzip/.test(req.headers['accept-encoding'] || '') && extname(file) !== '.png') { body = gzipSync(body); head['content-encoding'] = 'gzip'; }
      res.writeHead(200, head).end(body);
    } catch { res.writeHead(404).end('Not found'); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serve(Number(process.env.PORT) || 8080);
  console.log('Serving dist at ' + url);
}
