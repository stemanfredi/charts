// Tiny static server (repo root as web root) with caching off, so the browser always runs the
// current files. Used by the browser tests, and by `npm run serve` for development:
//   npm run serve                 http://<this machine>:8000/ on all interfaces, like python3 -m http.server
//   npm run serve -- --port 8080 --host 127.0.0.1
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function serve({ port = 0, host = '127.0.0.1' } = {}) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html', 'cache-control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end(); }
  }).listen(port, host);
  await new Promise((r) => server.once('listening', r));
  return { url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}/`, close: () => server.close() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
  const { url } = await serve({ port: +arg('port', 8000), host: arg('host', '0.0.0.0') });
  console.log(`serving ${ROOT} at ${url} (no caching; Ctrl+C stops)`);
}

export const chromeOptions = () => ({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
