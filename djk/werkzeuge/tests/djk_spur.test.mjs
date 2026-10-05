// Studio S6 Task 3: djk-spur gegen einen Stub der Seite (Kopf, Körper, Ausgabe, Rückgabecodes)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'djk-spur');
// asynchron: der Stub-Server läuft im selben Prozess, spawnSync würde ihn blockieren
const lauf = (args) => new Promise((fertig) => {
  const k = spawn(process.execPath, [CLI, ...args]);
  let stdout = '', stderr = '';
  k.stdout.on('data', (b) => { stdout += b; }); k.stderr.on('data', (b) => { stderr += b; });
  k.on('close', (status) => fertig({ status, stdout, stderr }));
});

async function stub(t, antworten) {
  const gesehen = [];
  const srv = http.createServer(async (q, a) => {
    let b = ''; for await (const x of q) b += x;
    gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'] ?? null, typ: q.headers['content-type'] ?? null, koerper: b ? JSON.parse(b) : null });
    const [code, j] = antworten[`${q.method} ${q.url}`] ?? [404, { fehler: 'x' }];
    a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { url: `http://127.0.0.1:${srv.address().port}`, gesehen };
}

test('djk-spur start schickt die Datei als cypher, zeigt den Anker; --als-andreas ohne Kopf', async (t) => {
  const s = await stub(t, { 'POST /spur': [200, { ok: true, name: 'aus-2', anker_takt: 17, ende_beat: 80, teile: 2, wirt: 0, muster: 0 }] });
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-spur-')), 'a.json');
  fs.writeFileSync(datei, JSON.stringify({ name: 'aus-2', fahrten: [{ ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: -200 }] }));
  const r = await lauf(['--seite', s.url, 'start', datei, '--ab', 'phrase']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /aus-2 starts at bar 17/);
  assert.deepEqual(s.gesehen[0], { methode: 'POST', pfad: '/spur', quelle: 'cypher', typ: 'application/json',
    koerper: { spur: { name: 'aus-2', fahrten: [{ ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: -200 }] }, ab: 'phrase' } });
  await lauf(['--seite', s.url, '--als-andreas', 'start', datei]);
  assert.equal(s.gesehen[1].quelle, null); assert.equal(s.gesehen[1].koerper.ab, 'takt');
});

test('djk-spur: Ablehnung der Seite → Rückgabe 1 mit Grund; stop und show', async (t) => {
  const s = await stub(t, {
    'POST /spur': [409, { fehler: 'kein_hoerschein', pfad: 'erz/2/fader', text: 'this track opens a closed channel' }],
    'POST /spur/stopp': [200, { ok: true, name: 'aus-2' }],
    'GET /spur': [200, [{ name: 'aus-2', quelle: 'cypher', anker_beat: 64, ende_beat: 80 }]],
  });
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-spur-')), 'a.json');
  fs.writeFileSync(datei, '{"name":"aus-2","fahrten":[]}');
  const r = await lauf(['--seite', s.url, 'start', datei]);
  assert.equal(r.status, 1); assert.match(r.stderr, /kein_hoerschein.*erz\/2\/fader/);
  assert.equal((await lauf(['--seite', s.url, 'stop', 'aus-2'])).status, 0);
  assert.deepEqual(s.gesehen.at(-1).koerper, { name: 'aus-2' });
  const z = await lauf(['--seite', s.url, 'show']);
  assert.equal(z.status, 0); assert.match(z.stdout, /aus-2\tcypher\tbar 17 to bar 21/);
  assert.equal((await lauf(['--seite', s.url, 'kaputt'])).status, 2);
});

test('djk-spur robust: Nicht-JSON-Antwort, show mit Nicht-Liste, unbekannte Option', async (t) => {
  const srv = http.createServer((q, a) => {
    if (q.url === '/spur' && q.method === 'GET') { a.writeHead(200, { 'content-type': 'application/json' }); a.end('{"nicht":"liste"}'); }
    else { a.writeHead(502); a.end('<html>bad gateway</html>'); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const seite = `http://127.0.0.1:${srv.address().port}`;
  const r = await lauf(['--seite', seite, 'stop', 'x']);
  assert.equal(r.status, 1); assert.match(r.stderr, /djk-spur: 502 non-JSON answer/); assert.doesNotMatch(r.stderr, /at .*\.js|SyntaxError/);
  const z = await lauf(['--seite', seite, 'show']);
  assert.equal(z.status, 1); assert.match(z.stderr, /djk-spur: .*not a list/);
  const u = await lauf(['--seite', seite, '--gibtsnicht', 'show']);
  assert.equal(u.status, 2); assert.match(u.stderr, /usage: djk-spur/);
});

test('djk-spur Final-Review F3: start druckt abgelehnte Teile und endet mit 1, show druckt sie je Spur; Negativ-Kontrolle ohne', async (t) => {
  const ab = [{ teil: 1, pfad: 'xfader', status: 6, grund: 'nur_hand' }];
  const s = await stub(t, {
    'POST /spur': [200, { ok: true, name: 'schlecht', anker_takt: 3, ende_beat: 16, teile: 2, wirt: 0, muster: 0, abgelehnt: ab }],
    'GET /spur': [200, [{ name: 'schlecht', quelle: 'cypher', anker_beat: 8, ende_beat: 16, abgelehnt: ab },
      { name: 'gut', quelle: 'cypher', anker_beat: 8, ende_beat: 16, abgelehnt: [] }]],
  });
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-spur-')), 'a.json');
  fs.writeFileSync(datei, '{"name":"schlecht","fahrten":[]}');
  const r = await lauf(['--seite', s.url, 'start', datei]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /part 1 xfader rejected: nur_hand/);
  const z = await lauf(['--seite', s.url, 'show']);
  assert.equal(z.status, 0);
  assert.match(z.stdout, /schlecht\tcypher\tbar 3 to bar 5\npart 1 xfader rejected: nur_hand\ngut\tcypher/);
  assert.equal(z.stdout.match(/rejected/g).length, 1, 'die gute Spur zeigt nichts');
  // Negativ-Kontrolle: ohne abgelehnt endet start mit 0
  const s2 = await stub(t, { 'POST /spur': [200, { ok: true, name: 'gut', anker_takt: 3, ende_beat: 16, teile: 1, wirt: 0, muster: 0, abgelehnt: [] }] });
  const g = await lauf(['--seite', s2.url, 'start', datei]);
  assert.equal(g.status, 0); assert.doesNotMatch(g.stdout, /rejected/);
});
