// Serves the renderer in a normal browser with a mock OS bridge, so modules
// can be built and styled without launching the app.
//   npm run preview  →  http://localhost:5179

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, 'ui');
const PORT = Number(process.env.PORT) || 5179;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};

function listModules() {
  const dir = path.join(RENDERER, 'modules');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(dir, d.name, 'index.js')))
    .map((d) => d.name);
}

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/modules/index.json') {
    res.writeHead(200, { 'content-type': TYPES['.json'] });
    return res.end(JSON.stringify(listModules()));
  }
  const file = path.join(RENDERER, url === '/' ? 'index.html' : url);
  if (!file.startsWith(RENDERER)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`usagi preview → http://localhost:${PORT}`));
