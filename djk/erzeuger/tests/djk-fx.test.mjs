// Beat-FX (zwei Einheiten, 2026-09-28): djk-fx für die Welle. Gegen einen falschen Kern (UDP) und eine falsche Seite (HTTP, GET /fx).
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kodiere, dekodiere } from '../../vertrag/attrappe_kern/osc.mjs';

const WERKZEUG = path.join(path.dirname(fileURLToPath(import.meta.url)), '../djk-fx');

async function kern() {
  const s = dgram.createSocket('udp4');
  await new Promise((r) => s.bind(0, '127.0.0.1', r));
  const empfangen = [];
  s.on('message', (b, rinfo) => {
    const m = dekodiere(b);
    empfangen.push(m);
    if (m.adresse === '/k/hallo') s.send(kodiere('/k/willkommen', 'iihdds', [1, 1, 0n, 0, 128, '']), m.werte[1], '127.0.0.1');
    else if (m.adresse === '/k/fx') {
      const [id, quelle, einheit, art, beats, wet, p1, p2, p3, an] = m.werte;
      const ok = einheit === 1 || einheit === 2;
      s.send(kodiere('/q', 'hsihds', [id, quelle, ok ? 1 : 6, 0n, 0, ok ? '' : 'ausserhalb_bereich']), rinfo.port, '127.0.0.1');
      if (ok) s.send(kodiere('/e/fx', 'iidddddi', [einheit, art, beats, wet, p1, p2, p3, an]), rinfo.port, '127.0.0.1');
    } else if (m.adresse === '/k/fx/zuweisung') {
      const [id, quelle, einheit, kanal, an] = m.werte;
      s.send(kodiere('/q', 'hsihds', [id, quelle, 1, 0n, 0, '']), rinfo.port, '127.0.0.1');
      s.send(kodiere('/e/fx/zuweisung', 'isi', [einheit, kanal, an]), rinfo.port, '127.0.0.1');
    }
  });
  return { s, empfangen, port: s.address().port };
}

async function seite(fx) {
  const srv = http.createServer((q, a) => { a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify(fx)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port };
}

function lauf(args, ordner) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [WERKZEUG, '--erzeuger-ordner', ordner, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let aus = '', fehler = '';
    p.stdout.on('data', (d) => { aus += d; });
    p.stderr.on('data', (d) => { fehler += d; });
    p.on('exit', (rc) => ok({ rc, aus, fehler }));
  });
}
const ordner = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fx-erz-'));

test('djk-fx: Einheit 2, drei Parameter, Quelle cypher, Quittung und /e/fx → Rückgabe 0, fx_von je Einheit', async (t) => {
  const k = await kern();
  t.after(() => k.s.close());
  const d0 = ordner();
  fs.writeFileSync(path.join(d0, 'fx_von.json'), JSON.stringify({ von: 'andreas', zeit: 1 }));   // altes flaches Format
  const r = await lauf(['--kern-port', String(k.port), '--einheit', '2', 'echo', '0.5', '0.8', '0.3', '0.2', '0.1'], d0);
  assert.equal(r.rc, 0, r.fehler);
  const von = JSON.parse(fs.readFileSync(path.join(d0, 'fx_von.json'), 'utf8'));
  assert.equal(von['2'].von, 'cypher');
  assert.equal(von.von, undefined, 'altes Format ersetzt');
  const fx = k.empfangen.find((m) => m.adresse === '/k/fx');
  assert.deepEqual(fx.werte.slice(1), ['cypher', 2, 1, 0.5, 0.8, 0.3, 0.2, 0.1, 1]);
  assert.match(r.aus, /FX2 ECHO an/);
  assert.ok(k.empfangen.some((m) => m.adresse === '/k/tschuess'));
});

test('djk-fx: Einheit 1 als Vorgabe, param2/param3 Vorgabe 0,5', async (t) => {
  const k = await kern();
  t.after(() => k.s.close());
  const r = await lauf(['--kern-port', String(k.port), 'filter', '4', '1', '0.7'], ordner());
  assert.equal(r.rc, 0, r.fehler);
  assert.deepEqual(k.empfangen.find((m) => m.adresse === '/k/fx').werte.slice(1), ['cypher', 1, 4, 4, 1, 0.7, 0.5, 0.5, 1]);
});

test('djk-fx zuweisen: Kurzname → /k/fx/zuweisung, /e/fx/zuweisung → Rückgabe 0', async (t) => {
  const k = await kern();
  t.after(() => k.s.close());
  const r = await lauf(['--kern-port', String(k.port), '--einheit', '2', 'zuweisen', 'M', 'an'], ordner());
  assert.equal(r.rc, 0, r.fehler);
  assert.deepEqual(k.empfangen.find((m) => m.adresse === '/k/fx/zuweisung').werte.slice(1), ['cypher', 2, 'master', 1]);
  assert.match(r.aus, /FX2 an master/);
  const r2 = await lauf(['--kern-port', String(k.port), 'zuweisen', 'A', 'aus'], ordner());
  assert.equal(r2.rc, 0, r2.fehler);
  assert.match(r2.aus, /FX1 ab deck\/1/);
});

test('djk-fx: AUTO aus → Rückgabe 4, nichts an den Kern; AUTO an → 0 (Negativ-Kontrolle)', async (t) => {
  const k = await kern();
  t.after(() => k.s.close());
  const d = ordner();
  fs.writeFileSync(path.join(d, 'autonom.json'), JSON.stringify({ an: false, zeit: Date.now() }));
  const r = await lauf(['--kern-port', String(k.port), 'flanger', '4', '0.5', '0.5'], d);
  assert.equal(r.rc, 4);
  assert.match(r.fehler, /AUTO ist aus/);
  assert.equal(k.empfangen.filter((m) => m.adresse.startsWith('/k/fx')).length, 0);
  fs.writeFileSync(path.join(d, 'autonom.json'), JSON.stringify({ an: true, zeit: Date.now() }));
  assert.equal((await lauf(['--kern-port', String(k.port), 'flanger', '4', '0.5', '0.5'], d)).rc, 0);
});

test('djk-fx aus: Stand der Einheit von der Seite, gleiche Werte mit an 0', async (t) => {
  const k = await kern();
  const w = await seite([null, { einheit: 2, art: 3, beats: 2, wet: 0.7, param1: 0.2, param2: 0.4, param3: 0.6, an: 1 }]);
  t.after(() => { k.s.close(); w.srv.close(); });
  const r = await lauf(['--kern-port', String(k.port), '--seite-port', String(w.port), '--einheit', '2', 'aus'], ordner());
  assert.equal(r.rc, 0, r.fehler);
  assert.deepEqual(k.empfangen.find((m) => m.adresse === '/k/fx').werte.slice(1), ['cypher', 2, 3, 2, 0.7, 0.2, 0.4, 0.6, 0]);
  const r1 = await lauf(['--kern-port', String(k.port), '--seite-port', String(w.port), 'aus'], ordner());
  assert.equal(r1.rc, 0);
  assert.match(r1.aus, /FX1 ist schon aus/);
});

test('djk-fx: falscher Aufruf → 2', async (t) => {
  const k = await kern();
  t.after(() => k.s.close());
  for (const args of [['hall', '1', '0.5', '0.5'], ['echo', '3', '0.5', '0.5'], ['echo', '1', '1.5', '0.5'], ['echo', '1', '0.5', '0.5', '1.2'],
    ['--einheit', '3', 'echo', '1', '0.5', '0.5'], ['zuweisen', 'X', 'an'], ['zuweisen', 'A', 'ja'], ['A', 'echo', '1', '0.5', '0.5']]) {
    assert.equal((await lauf(['--kern-port', String(k.port), ...args], ordner())).rc, 2, args.join(' '));
  }
});
