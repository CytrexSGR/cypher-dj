import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kodiere, dekodiere } from '../../vertrag/attrappe_kern/osc.mjs';

const WERKZEUG = path.join(path.dirname(fileURLToPath(import.meta.url)), '../djk-loop');

async function kern(antwort) {
  const s = dgram.createSocket('udp4');
  await new Promise((r) => s.bind(0, '127.0.0.1', r));
  const empfangen = [];
  s.on('message', (b, rinfo) => {
    const m = dekodiere(b);
    empfangen.push(m);
    if (m.adresse === '/k/hallo') s.send(kodiere('/k/willkommen', 'iihdds', [1, 1, 0n, 0, 128, '']), m.werte[1], '127.0.0.1');
    else if (m.adresse.startsWith('/k/loop/')) for (const b2 of antwort(m)) s.send(b2, rinfo.port, '127.0.0.1');
  });
  return { s, empfangen, port: s.address().port };
}

function lauf(port, args) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [WERKZEUG, '--kern-port', String(port), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let aus = '', fehler = '';
    p.stdout.on('data', (d) => { aus += d; });
    p.stderr.on('data', (d) => { fehler += d; });
    p.on('exit', (rc) => ok({ rc, aus, fehler }));
  });
}

test('start: angemeldet, Quelle cypher, Quittung und /e/loop, Rückgabe 0, abgemeldet', async (t) => {
  const k = await kern((m) => [kodiere('/q', 'hsihds', [m.werte[0], 'cypher', 1, 0n, 0, '']),
    kodiere('/e/loop', 'iisiidf', [1, 2, 'gut', 4, 0, 1, 0])]);
  t.after(() => k.s.close());
  const r = await lauf(k.port, ['start', '1']);
  assert.equal(r.rc, 0, r.fehler);
  assert.match(r.aus, /Box 1: wartet \(gut, 4 Beat/);
  const cmd = k.empfangen.find((m) => m.adresse === '/k/loop/start');
  assert.deepEqual([cmd.werte[1], cmd.werte[2]], ['cypher', 1]);
  assert.ok(k.empfangen.some((m) => m.adresse === '/k/tschuess'));
});

test('laden abgelehnt: Grund genannt, Rückgabe 1', async (t) => {
  const k = await kern((m) => [kodiere('/q', 'hsihds', [m.werte[0], 'cypher', 6, 0n, 0, 'pruefung'])]);
  t.after(() => k.s.close());
  const r = await lauf(k.port, ['laden', '1', 'fehlt']);
  assert.equal(r.rc, 1);
  assert.match(r.fehler, /\/k\/loop\/laden abgelehnt: pruefung/);
});

test('rec: angemeldet, Quittung und /e/mitschnitt, Rückgabe 0, abgemeldet', async (t) => {
  const k = await kern((m) => [kodiere('/q', 'hsihds', [m.werte[0], 'andreas', 1, 0n, 0, '']),
    kodiere('/e/mitschnitt', 'siid', ['c-143012-4b', 4, 0, 4.0])]);
  t.after(() => k.s.close());
  const r = await lauf(k.port, ['--quelle', 'andreas', 'rec', '4', 'c-143012-4b']);
  assert.equal(r.rc, 0, r.fehler);
  assert.match(r.aus, /Mitschnitt c-143012-4b: fertig geschrieben \(4 Beat\(s\), ab Beat 4\)/);
  const cmd = k.empfangen.find((m) => m.adresse === '/k/loop/rec');
  assert.deepEqual([cmd.werte[1], cmd.werte[2], cmd.werte[3]], ['andreas', 4, 'c-143012-4b']);
  assert.ok(k.empfangen.some((m) => m.adresse === '/k/tschuess'));
});

test('rec abgelehnt (ueberlappung): Rückgabe 1', async (t) => {
  const k = await kern((m) => [kodiere('/q', 'hsihds', [m.werte[0], 'andreas', 6, 0n, 0, 'ueberlappung'])]);
  t.after(() => k.s.close());
  const r = await lauf(k.port, ['--quelle', 'andreas', 'rec', '1', 'x']);
  assert.equal(r.rc, 1);
  assert.match(r.fehler, /\/k\/loop\/rec abgelehnt: ueberlappung/);
});

test('rec falscher Aufruf: Beats ausserhalb 1, 2, 4, 8, 16, 32 -> Rückgabe 2', async () => {
  const r = await lauf(1, ['rec', '3', 'x']);
  assert.equal(r.rc, 2);
  assert.match(r.fehler, /Beats 3: 1, 2, 4, 8, 16 oder 32/);
});

test('kein Kern: Rückgabe 1 nach der Frist; falscher Aufruf: 2; liste liest den Ordner', async () => {
  const leer = dgram.createSocket('udp4');
  await new Promise((r) => leer.bind(0, '127.0.0.1', r));
  const port = leer.address().port;
  leer.close();
  assert.equal((await lauf(port, ['stopp', '2'])).rc, 1);
  assert.equal((await lauf(port, ['start'])).rc, 2);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'loops-'));
  fs.mkdirSync(path.join(d, 'gut'));
  fs.writeFileSync(path.join(d, 'gut', 'loop.json'), JSON.stringify({ schema: 1, takte: 2, quelle: 'x' }));  // alte Datei
  fs.mkdirSync(path.join(d, 'neu'));
  fs.writeFileSync(path.join(d, 'neu', 'loop.json'), JSON.stringify({ schema: 1, beats: 1, quelle: 'x' }));
  fs.mkdirSync(path.join(d, '.halb.neu'));
  const r = await lauf(port, ['--ordner', d, 'liste']);
  assert.equal(r.rc, 0);
  assert.match(r.aus, /^gut\t8 Beat/m);
  assert.match(r.aus, /^neu\t1 Beat/m);
  assert.doesNotMatch(r.aus, /halb/);
});

test('kit: Loop wird Klang rec0 im Zusatz-Kit, zweimal derselbe Name wird abgelehnt (rc 1)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loop-kit-'));
  fs.mkdirSync(path.join(d, 'kits/battery'), { recursive: true });
  fs.writeFileSync(path.join(d, 'kits/battery/kit.json'), JSON.stringify({ schema: 1, name: 'battery',
    klaenge: [{ note: 0, name: 'bd:0', datei: 'bd_0.f32', frames: 1 }] }));
  fs.mkdirSync(path.join(d, 'loops/c-1'), { recursive: true });
  fs.writeFileSync(path.join(d, 'loops/c-1/loop.f32'), Buffer.alloc(80));
  fs.writeFileSync(path.join(d, 'loops/c-1/loop.json'), JSON.stringify({ schema: 1, name: 'c-1', frames: 10, datei: 'loop.f32' }));
  const a = ['--ordner', path.join(d, 'loops'), '--kits-ordner', path.join(d, 'kits'), 'kit', 'c-1'];
  const r1 = await lauf(1, a);
  assert.equal(r1.rc, 0, r1.fehler);
  assert.match(r1.aus, /ist jetzt Klang rec0 \(Kit rec, Note 1\)/);
  const r2 = await lauf(1, [...a, 'rec0']);
  assert.equal(r2.rc, 1);
  assert.match(r2.fehler, /rec0 gibt es im Kit rec schon/);
});

// Scheibe 3 (E4, Review Scheibe 2 Fund 6 und Plan-Review Fund 3): Status 4 (verspätet verworfen) ist ein Scheitern,
// die echte Folge 1, 3, /e/loop beim Laden bleibt ein Erfolg.
test('Quittung Status 4 → Rückgabe 1; Laden mit Quittung 1, dann 3, dann /e/loop → Rückgabe 0', async (t) => {
  const k4 = await kern((m) => [kodiere('/q', 'hsihds', [m.werte[0], 'cypher', 4, 0n, 0, 'verspaetet'])]);
  t.after(() => k4.s.close());
  const r4 = await lauf(k4.port, ['start', '1']);
  assert.equal(r4.rc, 1, r4.aus);
  assert.match(r4.fehler, /nicht ausgeführt \(Status 4\)/);
  const k = await kern((m) => [kodiere('/q', 'hsihds', [m.werte[0], 'cypher', 1, 0n, 0, '']),
    kodiere('/q', 'hsihds', [m.werte[0], 'cypher', 3, 0n, 0, '']), kodiere('/e/loop', 'iisiidf', [1, 1, 'gut', 4, 0, 1, 0])]);
  t.after(() => k.s.close());
  const r = await lauf(k.port, ['laden', '1', 'gut']);
  assert.equal(r.rc, 0, r.fehler);
  assert.match(r.aus, /Box 1: bereit \(gut, 4 Beat/);
});

// Abschluss-Review Scheibe 3 Fund 1: der Kern streicht Abonnenten nach 5 s ohne /k/hallo (netz.h frist_ns). Ein
// langer REC (ab ~8 Beats) muss sich daher selbst am Leben halten, sonst kommt /e/mitschnitt nie an.
test('langer rec: djk-loop wiederholt /k/hallo, solange es wartet', { timeout: 20000 }, async (t) => {
  const k = await kern((m) => {
    setTimeout(() => k.s.send(kodiere('/e/mitschnitt', 'siid', ['lang', 16, 0, 16.0]), k.empfangen.find((x) => x.adresse === '/k/hallo').werte[1], '127.0.0.1'), 5500);
    return [kodiere('/q', 'hsihds', [m.werte[0], 'andreas', 1, 0n, 0, ''])];
  });
  t.after(() => k.s.close());
  const r = await lauf(k.port, ['--quelle', 'andreas', 'rec', '16', 'lang']);
  assert.equal(r.rc, 0, r.fehler);
  const hallo = k.empfangen.filter((m) => m.adresse === '/k/hallo').length;
  assert.ok(hallo >= 3, `nur ${hallo} /k/hallo in 5,5 s`);
});
