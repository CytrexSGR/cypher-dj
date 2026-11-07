// The production page against the project stub, without the whole test stack (slice 4a T7): a minimal static server for oeffentlich/ ("above" the stub:
// everything the page asks that is not /proj/*, /attrappe/* answers 404), the project stub in front of it (it computes the commands with the real S2 core,
// pruef/proj_attrappe.mjs), and a headless Chrome over the DevTools protocol (pruef/cdp.mjs, no window, no sound). Ports are free (0).
// Usage in tests: const s = await starteSeite(); await s.saat(projekt); ... s.b.klick(...); s.projekt(); await s.stoppe();
//   node pruef/seite_attrappe.mjs [port]   keeps the page and the stub running for a real look (chrome-devtools), Ctrl+C stops.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteProjAttrappe, neuesProjekt } from './proj_attrappe.mjs';
import { starteBrowser } from './cdp.mjs';

export { neuesProjekt };
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OEFFENTLICH = path.join(WURZEL, 'oeffentlich');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
export const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function statisch() {
  const srv = http.createServer((q, a) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/strom') { a.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); a.write(': open\n\n'); return; }   // the stub mixes its events in
    if (u.pathname === '/bestand' || u.pathname === '/loops') { a.writeHead(200, { 'content-type': 'application/json' }); a.end('[]'); return; }
    const f = path.join(OEFFENTLICH, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    if (f.startsWith(OEFFENTLICH + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      a.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); a.end(fs.readFileSync(f));
    } else { a.writeHead(404, { 'content-type': 'application/json' }); a.end('{"fehler":"nicht_da"}'); }
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

// browser: false starts only the page and the stub (for a real look with another browser)
export async function starteSeite({ breite = 1280, hoehe = 900, browser = true, port = 0 } = {}) {
  const oben = await statisch();
  const at = await starteProjAttrappe({ oben: `http://127.0.0.1:${oben.address().port}/`, port });
  const b = browser ? await starteBrowser({ breite, hoehe }) : null;
  const w = (x) => b.werte(x);
  const post = (weg, d) => fetch(at.url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => r.json());
  const projekt = async () => (await (await fetch(at.url + 'proj/aktuell')).json()).projekt;
  const s = {
    b, at, url: at.url, w, post, projekt,
    // seed a project into the stub and make the page show it
    async saat(p) {
      const r = await post('/attrappe/saat', { projekt: p });
      await post('/attrappe/sse', { a: 'proj', f: { slug: r.slug, rev: p.rev, label: 'seed', quelle: 'cypher' } });
      for (let i = 0; i < 80 && (await w('window.djkProd.slug')) !== r.slug; i++) await warte(50);
      await warte(150);
      return r.slug;
    },
    // waits until fn() (async, in the test) is true
    async bis(fn, ms = 4000) { for (let t = 0; t < ms; t += 40) { if (await fn()) return true; await warte(40); } return false; },
    async oeffne() {
      await b.oeffne(at.url);
      await warte(1500);
      await b.klick('[data-ansicht="produktion"]');
      await warte(1000);
    },
    async stoppe() { if (b) await b.zu(); await at.stoppe(); await new Promise((r) => { oben.closeAllConnections(); oben.close(r); }); },
  };
  return s;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await starteSeite({ browser: false, port: Number(process.argv[2] ?? 0) });
  process.stdout.write(`page and stub at ${s.url}\n`);
  process.on('SIGINT', async () => { await s.stoppe(); process.exit(0); });
  process.on('SIGTERM', async () => { await s.stoppe(); process.exit(0); });
}
