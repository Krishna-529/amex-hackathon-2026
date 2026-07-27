/**
 * Team ZKD — static host for the three built sites.
 *
 * Zero dependencies: plain node:http. Run with `node serve.js`.
 *
 * The one thing a naive file server gets wrong here is SPA fallback. Proof pages
 * live at /proof/:id and are client-routed — there is no file on disk at that
 * path. Any request without a file extension therefore falls back to index.html
 * so the router can pick it up. Without this, every proof link 404s.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SITES = [
  { dir: 'design', port: 5173, label: 'System design' },
  { dir: 'metrics', port: 5174, label: 'Success metrics' },
  { dir: 'personas', port: 5175, label: 'Personas' },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function lanAddress() {
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    if (/WSL|Loopback|vEthernet/i.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        return a.address;
      }
    }
  }
  return null;
}

function serveSite({ dir, port, label }) {
  const root = path.join(__dirname, dir);
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    console.error(`  ! ${label}: no index.html in ${root} — did the build run?`);
    return;
  }

  http
    .createServer((req, res) => {
      let urlPath;
      try {
        // Normalise AFTER decoding. The WHATWG URL parser collapses `..` and even
        // `%2e%2e`, but `..%2f` is a single opaque segment to it — it only becomes
        // a real `../` once decoded, which used to be after the containment check.
        urlPath = path.posix.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      } catch {
        res.writeHead(400).end('Bad request');
        return;
      }

      let file = path.resolve(root, '.' + urlPath);
      // Never escape the site root. The trailing separator is load-bearing:
      // without it, root `/site/design` also prefix-matches `/site/design-notes`.
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      // SPA fallback. Only a KNOWN static extension counts as a file request —
      // testing for "has any extension" sends `/proof/v1.2` (extname `.2`) to a
      // 404 when it is a client route.
      const isAsset = Object.prototype.hasOwnProperty.call(TYPES, path.extname(file).toLowerCase());
      if (!isAsset) {
        file = path.join(root, 'index.html');
      } else if (!fs.existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }

      fs.readFile(file, (err, buf) => {
        if (err) {
          res.writeHead(500).end('Read error');
          return;
        }
        const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
        const cache = /\/assets\//.test(urlPath)
          ? 'public, max-age=31536000, immutable'   // hashed filenames
          : 'no-cache';
        res.writeHead(200, { 'content-type': type, 'cache-control': cache });
        res.end(buf);
      });
    })
    .listen(port, '0.0.0.0', () => {
      console.log(`  ${label.padEnd(16)} port ${port}`);
    })
    .on('error', (e) => {
      console.error(`  ! ${label} could not bind ${port}: ${e.code}`);
      if (e.code === 'EADDRINUSE') {
        console.error(`    Something is already on ${port} — stop the dev servers first.`);
      }
    });
}

console.log('\n  Team ZKD — three sites, production build\n  ' + '-'.repeat(46));
SITES.forEach(serveSite);

const ip = lanAddress();
setTimeout(() => {
  // derived from SITES so adding a site cannot leave this line stale
  const ports = SITES.map((s) => s.port);
  const tail = ports.slice(1).join('  ·  ');
  console.log(`\n  This machine :  http://localhost:${ports[0]}  ·  ${tail}`);
  if (ip) console.log(`  On your LAN  :  http://${ip}:${ports[0]}  ·  ${tail}`);
  console.log('\n  Ctrl+C to stop.\n');
}, 250);
