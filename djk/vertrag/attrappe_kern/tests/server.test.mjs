// node --test tests/server.test.mjs: die Attrappe als Prozess über UDP in Echtzeit: Anmeldung, /uhr-Rate, Quittungen
// einer Tempo-Rampe, Abschuss mit kill -9 und Fortsetzen auf dem Anker, belegter Port. Braucht nur die Maschine
// (kern.mjs); jeder gestartete Prozess wird im finally beendet, sonst hielte er node --test offen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kodiere, dekodiere } from '../osc.mjs';
import { Karte, llround } from '../uhr.mjs';

const PROG = fileURLToPath(new URL('../../attrappe_kern.mjs', import.meta.url));
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zustandDatei = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-')), 'zustand.json');

function starte(zustand, extra = []) {
  const p = spawn(process.execPath, [PROG, '--udp-port', '0', '--zustand', zustand, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  let aus = '';
  const port = new Promise((ok, nein) => {
    p.stdout.on('data', (d) => { aus += d; const m = /port=(\d+)/.exec(aus); if (m) ok(Number(m[1])); });
    p.on('exit', (c) => nein(new Error(`beendet mit ${c}: ${aus}`)));
  });
  port.catch(() => {});
  return { p, port };
}

async function empfaenger() {
  const s = dgram.createSocket('udp4');
  const log = [];
  s.on('message', (b) => log.push({ ...dekodiere(b), t: Date.now() }));
  await new Promise((r) => s.bind(0, '127.0.0.1', r));
  return { s, log, port: s.address().port };
}

// Ende-Sample einer Tempo-Rampe nach §1.3 (dieselbe Karte, die die Attrappe benutzt; uhr.test.mjs prüft sie gegen §1.3)
function rampenEnde(ab, ziel, dauer) {
  const k = new Karte(128);
  k.rampe(ab, ziel, dauer);
  return llround(k.sample(ab + dauer));
}

test('Anmeldung, /uhr je Zyklus in Echtzeit, Quittungen einer Tempo-Rampe über UDP', async () => {
  const { p, port } = starte(zustandDatei());
  const e = await empfaenger();
  try {
    const kp = await port;
    const an = (a, t, w) => e.s.send(kodiere(a, t, w), kp, '127.0.0.1');
    an('/k/hallo', 'sii', ['test', e.port, 1]);
    await warte(300);
    an('/k/set/neu', 'hsd', [1n, 'leitstand', 128]);
    await warte(100);
    an('/k/tempo/rampe', 'hsddd', [2n, 'leitstand', 2, 130, 2]);   // Beat 2 = Sample 45 000 bei 128 BPM
    await warte(2200);
    const q = e.log.filter((m) => m.adresse === '/q').map((m) => [Number(m.werte[0]), m.werte[2], Number(m.werte[3])]);
    assert.ok(e.log.some((m) => m.adresse === '/k/willkommen' && m.werte[0] === 1));
    assert.deepEqual(q.filter((x) => x[0] === 1).map((x) => x[1]), [1, 2, 3]);
    assert.deepEqual(q.filter((x) => x[0] === 2).map((x) => x.slice(1)).slice(1), [[2, 45000], [3, rampenEnde(2, 130, 2)]]);
    const t0 = Date.now();
    await warte(1000);
    const n = e.log.filter((m) => m.adresse === '/uhr' && m.t > t0).length;
    assert.ok(n >= 150 && n <= 200, `/uhr je Sekunde: ${n} (Soll 187,5)`);
  } finally {
    p.kill('SIGTERM');
    e.s.close();
  }
});

test('kill -9 mitten in einer Tempo-Rampe: /e/neustart an den gespeicherten Abonnenten, /q/stand nach /k/hallo, Ende am Beat', async () => {
  const z = zustandDatei();
  const a = starte(z);
  const e = await empfaenger();
  let b = null;
  try {
    const kp = await a.port;
    e.s.send(kodiere('/k/hallo', 'sii', ['test', e.port, 1]), kp, '127.0.0.1');
    await warte(200);
    e.s.send(kodiere('/k/tempo/rampe', 'hsddd', [7n, 'leitstand', 4, 130, 8]), kp, '127.0.0.1');
    await warte(3000);                                   // Beat 4 bei 1,875 s ist vorbei, Ende bei Beat 12 (rund 5,6 s)
    a.p.kill('SIGKILL');
    await warte(300);
    b = starte(z, ['--udp-port', String(kp)]);
    await b.port;
    await warte(300);
    const ns = e.log.find((m) => m.adresse === '/e/neustart');
    assert.ok(ns, 'kein /e/neustart');
    assert.equal(ns.werte[0], 1);
    e.s.send(kodiere('/k/hallo', 'sii', ['test', e.port, 1]), kp, '127.0.0.1');
    await warte(300);
    const stand = e.log.find((m) => m.adresse === '/q/stand');
    assert.ok(stand && Number(stand.werte[0]) === 7 && stand.werte[2] === 2, JSON.stringify(stand?.werte, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
    await warte(3000);
    const fertig = e.log.find((m) => m.adresse === '/q' && Number(m.werte[0]) === 7 && m.werte[2] === 3);
    assert.ok(fertig, 'Rampe nicht fertig');
    assert.equal(Number(fertig.werte[3]), rampenEnde(4, 130, 8));
  } finally {
    a.p.kill('SIGKILL');
    if (b) b.p.kill('SIGTERM');
    e.s.close();
  }
});

test('Port belegt: eine zweite Attrappe auf demselben Port endet mit Rückgabewert 3', async () => {
  const z = zustandDatei();
  const a = starte(z);
  try {
    const kp = await a.port;
    const b = spawn(process.execPath, [PROG, '--udp-port', String(kp), '--zustand', `${z}.2`], { stdio: 'ignore' });
    const code = await new Promise((r) => b.on('exit', r));
    assert.equal(code, 3);
  } finally {
    a.p.kill('SIGTERM');
  }
});
