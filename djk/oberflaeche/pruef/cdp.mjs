// Kopfloser Chrome über das DevTools-Protokoll (Scheibe 60m, Prüfung). Immer --headless=new: kein Fenster auf
// irgendeinem Bildschirm (der chrome-devtools-MCP startet sichtbar, darum hier eigener Start). Kein Ton: --mute-audio.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function starteBrowser({ breite = 1920, hoehe = 1080 } = {}) {
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'djk60m-chrome-'));
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const p = spawn('google-chrome', ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', `--user-data-dir=${profil}`, '--remote-debugging-port=0', `--window-size=${breite},${hoehe}`,
    '--force-device-scale-factor=1', 'about:blank'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((ok, fehler) => {
    let aus = '';
    p.stderr.on('data', (d) => { aus += d; const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(aus); if (m) ok(Number(m[1])); });
    p.once('exit', (c) => fehler(new Error(`chrome endete ${c}: ${aus}`)));
  });
  const ziel = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(ziel.webSocketDebuggerUrl);
  await new Promise((ok) => { ws.onopen = ok; });
  let id = 0;
  const offen = new Map();
  const konsole = [];
  const ereignisse = [];
  ws.onmessage = (m) => {
    const n = JSON.parse(m.data);
    if (n.id && offen.has(n.id)) { const { ok, fehler } = offen.get(n.id); offen.delete(n.id); if (n.error) fehler(new Error(n.error.message)); else ok(n.result); return; }
    if (n.method === 'Runtime.consoleAPICalled') konsole.push({ typ: n.params.type, text: n.params.args.map((a) => a.value ?? a.description).join(' ') });
    if (n.method === 'Runtime.exceptionThrown') konsole.push({ typ: 'exception', text: n.params.exceptionDetails.exception?.description ?? n.params.exceptionDetails.text });
    if (n.method === 'Log.entryAdded') konsole.push({ typ: n.params.entry.level, text: n.params.entry.text, url: n.params.entry.url });
    ereignisse.push(n);
  };
  const sende = (method, params = {}) => new Promise((ok, fehler) => { const i = ++id; offen.set(i, { ok, fehler }); ws.send(JSON.stringify({ id: i, method, params })); });
  await sende('Runtime.enable');
  await sende('Log.enable');
  await sende('Page.enable');
  await sende('Emulation.setDeviceMetricsOverride', { width: breite, height: hoehe, deviceScaleFactor: 1, mobile: false });
  const b = {
    konsole,
    ereignisse,   // D1 V1: rohe CDP-Ereignisse (Input.dragIntercepted für zieheDnD)
    sende,
    // zeitlimitMs: nach so vielen ms aufgeben und false liefern statt ewig zu warten (A1 hing am 17.10. 19 min hier).
    async oeffne(url, zeitlimitMs = Infinity) {
      const bis = Date.now() + zeitlimitMs;
      const geladen = new Promise((ok) => { const f = () => { if (ereignisse.some((e) => e.method === 'Page.loadEventFired')) ok(true); else if (Date.now() >= bis) ok(false); else setTimeout(f, 20); }; ereignisse.length = 0; f(); });
      await sende('Page.navigate', { url });
      return geladen;
    },
    async werte(ausdruck) {
      const r = await sende('Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async maus(type, x, y, extra = {}) {
      await sende('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
    },
    async mitte(selektor) {
      return b.werte(`(() => { const r = document.querySelector(${JSON.stringify(selektor)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
    },
    async klick(selektor) {
      const m = await b.mitte(selektor);
      await b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
      await b.maus('mousePressed', m.x, m.y);
      await b.maus('mouseReleased', m.x, m.y);
    },
    // Zieht vom Mittelpunkt um (dx, dy) Pixel in Schritten, wie eine Hand
    async ziehe(selektor, dx, dy, schritte = 8) {
      const m = await b.mitte(selektor);
      await b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
      await b.maus('mousePressed', m.x, m.y);
      for (let i = 1; i <= schritte; i++) await b.maus('mouseMoved', m.x + (dx * i) / schritte, m.y + (dy * i) / schritte);
      await b.maus('mouseReleased', m.x + dx, m.y + dy);
    },
    // D1 V1: echtes HTML5-Ziehen (dragstart der Seite liefert die Daten): Maus drücken und bewegen bei abgefangenem Drag,
    // dann dragEnter/dragOver/drop am Ziel (x, y) mit den abgefangenen Daten. Gemessen 2026-10-15, Chrome 155 headless.
    async zieheDnD(selektor, x, y) {
      const m = await b.mitte(selektor);
      await sende('Input.setInterceptDrags', { enabled: true });
      const n0 = ereignisse.length;
      await b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
      await b.maus('mousePressed', m.x, m.y);
      await b.maus('mouseMoved', m.x + 10, m.y + 4);
      await b.maus('mouseMoved', m.x + 30, m.y + 10);
      let ev = null;
      for (let i = 0; i < 50 && !ev; i++) { ev = ereignisse.slice(n0).find((e) => e.method === 'Input.dragIntercepted'); if (!ev) await new Promise((r) => setTimeout(r, 20)); }
      await sende('Input.setInterceptDrags', { enabled: false });
      if (!ev) { await b.maus('mouseReleased', m.x + 30, m.y + 10); return false; }
      for (const type of ['dragEnter', 'dragOver', 'drop']) await sende('Input.dispatchDragEvent', { type, x, y, data: ev.params.data });
      await b.maus('mouseReleased', x, y);
      return true;
    },
    async bild(datei) {
      const r = await sende('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(datei, Buffer.from(r.data, 'base64'));
    },
    async zu() {
      ws.close();
      const e = new Promise((r) => p.once('exit', r));
      p.kill('SIGTERM');
      await e;
      await new Promise((r) => setTimeout(r, 300)); try { fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Chrome-Reste, egal */ }
    },
  };
  return b;
}
