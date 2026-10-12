// Local server: serves public/ and the API on one port, storing data in .data/home-hub.json.
// Good for trying everything on your computer, and for pointing the frame at your computer over
// Wi-Fi before anything is deployed:  npm run dev  ->  http://<your-computer's-ip>:5173
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createApi } from '../lib/api.js';
import { demoFeed, seedDemo } from './demo.js';

var PORT = Number(process.env.PORT) || 5173;
var ROOT = new URL('../public/', import.meta.url).pathname;
var TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
var DATA_FILE = process.env.DATA_FILE || '.data/home-hub.json';
if (process.argv.indexOf('--demo') > -1) {
  // Separate file so the demo never overwrites your real local data.
  DATA_FILE = '.data/demo.json';
  await seedDemo(DATA_FILE, PORT);
  console.log('Seeded demo data (people, to-dos, two calendars) into ' + DATA_FILE);
}
var handle = createApi(Object.assign({}, process.env, { DATA_FILE: DATA_FILE }));

createServer(async function (req, res) {
  try {
    var url = new URL(req.url, 'http://localhost');
    var demo = /^\/dev\/demo-(\w+)\.ics$/.exec(url.pathname);
    if (demo) {
      res.writeHead(200, { 'content-type': 'text/calendar' });
      res.end(demoFeed(demo[1]));
      return;
    }
    if (url.pathname.indexOf('/api/') === 0) {
      var chunks = [];
      for await (var c of req) chunks.push(c);
      var request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks)
      });
      var response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    var file = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
    if (file.indexOf(ROOT) !== 0) { res.writeHead(403); res.end(); return; }
    var data = await readFile(file).catch(function () { return null; });
    if (!data) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end(String(e.message || e));
  }
}).listen(PORT, '0.0.0.0', function () {
  var ips = [];
  Object.values(networkInterfaces()).forEach(function (list) {
    list.forEach(function (i) { if (i.family === 'IPv4' && !i.internal) ips.push(i.address); });
  });
  console.log('Home Hub on http://localhost:' + PORT + (ips.length ? '  (on your network: http://' + ips[0] + ':' + PORT + ')' : ''));
  if (!process.env.ACCESS_KEY) console.log('No ACCESS_KEY set: the API is open. Fine on your laptop; set one before exposing it.');
});
