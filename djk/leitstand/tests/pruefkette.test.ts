// Die Prüfkette der Abnahme gegen den Taktgeber (480 BPM, ein Takt = 0,5 s): Leitstand und Prüf-Client als
// eigene Prozesse, Auswertung wie in der Abnahme. Dazu die Probe, dass die Auswertung Fehler sieht.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { werte, type Ergebnis } from '../pruef/auswertung.ts';
import { beende, freierTcpPort, freierUdpPort, LEITSTAND, starte, type Kind } from './hilfen/prozess.ts';

const SET = '2026-09-23_0002';
const kinder: Kind[] = [];
after(async () => { for (const k of kinder) await beende(k); });
let e: Ergebnis;
let j: Record<string, unknown>[];

test('Prüfkette gegen den Taktgeber: alle Abnahmepunkte bestehen', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-kette-'));
  const [kern, verm, abo, aboL, ws] = [await freierUdpPort(), await freierUdpPort(), await freierUdpPort(),
    await freierUdpPort(), await freierTcpPort()];
  const konfig = path.join(tmp, 'leitstand.toml');
  fs.writeFileSync(konfig, `version = 1\nws_port = ${ws}\nabo_port = ${aboL}\nsets = "${tmp}/sets"\n`);
  const tg = await starte('tests/hilfen/taktgeber.ts', ['--port', String(kern), '--bpm', '480'], 'taktgeber:');
  kinder.push(tg);
  const ls = await starte('src/leitstand.ts', ['--konfig', konfig, '--kern-port', String(verm), '--set-id', SET], 'leitstand:');
  kinder.push(ls);
  const erg = path.join(tmp, 'ergebnis.json');
  execFileSync(process.execPath, [path.join(LEITSTAND, 'pruef/pruefclient.ts'), '--kern-port', String(kern),
    '--vermittler-port', String(verm), '--abo-port', String(abo), '--ws-port', String(ws), '--takte', '12',
    '--klicks', '3', '--kern-pid', String(tg.p.pid), '--stopp-ms', '400', '--aus', erg], { stdio: 'pipe', timeout: 50000 });
  await beende(ls, 'SIGTERM');
  e = JSON.parse(fs.readFileSync(erg, 'utf8'));
  j = fs.readFileSync(path.join(tmp, 'sets', SET, 'journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const p = werte(e, j);
  for (const x of p) process.stdout.write(`# ${x.ok ? 'OK  ' : 'FEHL'} ${x.name}: ${x.wert}\n`);
  assert.deepEqual(p.filter((x) => !x.ok).map((x) => x.name), []);
  assert.equal(j.at(-1)!.typ, '/k/tschuess'); // sauberes Ende nach SIGTERM
});

test('Fehlerfall für das Instrument: jede Verfälschung färbt genau ihren Punkt rot; unverändert alles grün', () => {
  const rot = (x: Ergebnis, jj = j) => werte(x, jj).filter((p) => !p.ok).map((p) => p.name.slice(0, 2));
  const takte = e.ws_pruefstand.filter((x) => x.n.typ === 'takt');
  // a) ein takt fehlt → A1 und A3
  assert.deepEqual(rot({ ...e, ws_pruefstand: e.ws_pruefstand.filter((x) => x !== takte[3]) }), ['A1', 'A2', 'A3']);
  // b) ein takt 200 ms später → A2 (bei 12 Werten ist p99 das Maximum)
  const spaet = structuredClone(e);
  spaet.ws_pruefstand.filter((x) => x.n.typ === 'takt')[5].t += 200e6;
  assert.deepEqual(rot(spaet), ['A2']);
  // c) eine Journalzeile /takt fehlt → A4
  assert.deepEqual(rot(e, j.filter((z) => !(z.typ === '/takt' && (z.daten as { takt: number }).takt === e.erster_takt + 3))), ['A4']);
  // d) ein zusätzliches hallo im Hauptlauf → A6
  const mehr = structuredClone(e);
  const beginn = mehr.takt_abo.find((x) => x.takt === mehr.erster_takt)!.t;
  mehr.vermittelt.push({ t: (beginn + mehr.haupt_ende) / 2, adresse: '/k/hallo' });
  mehr.vermittelt.sort((x, y) => x.t - y.t);
  assert.deepEqual(rot(mehr), ['A6']);
  // e) eine Nachricht verletzt das Schema → A7
  const kaputt = structuredClone(e);
  kaputt.ws_pruefstand.find((x) => x.n.typ === 'takt')!.n.von = 'irgendwer';
  assert.deepEqual(rot(kaputt), ['A7']);
  // f) Uhr des Prüf-Clients liefe vor dem Kern → A0
  assert.deepEqual(rot({ ...e, uhr_versatz_ms: { ...e.uhr_versatz_ms, min: -3 } }), ['A0']);
  // h) ein takt 20 ms vor seinem Taktanfang (Bezug falsch) → A2
  const frueher = structuredClone(e);
  const tk = frueher.ws_pruefstand.filter((x) => x.n.typ === 'takt')[4];
  const an = frueher.takt_abo.find((x) => x.takt === tk.n.daten.takt)!;
  tk.t = an.mono_anfang! - 20e6;
  assert.deepEqual(rot(frueher), ['A2']);
  // i) die Suche verliert das Raster: jedes hallo ab dem dritten 20 ms später → A5
  const lahm = structuredClone(e);
  const s0 = lahm.stopp!;
  const such = lahm.vermittelt.filter((v) => v.adresse === '/k/hallo' && v.t >= s0.uhr_letzte + 95e6 && v.t < s0.t_weiter);
  such.slice(2).forEach((v) => { v.t += 20e6; });
  assert.deepEqual(rot(lahm), ['A5']);
  // g) ein hallo 30 ms nach der letzten /uhr (Suche zu früh) → A5
  const frueh = structuredClone(e);
  frueh.vermittelt.push({ t: frueh.stopp!.uhr_letzte + 30e6, adresse: '/k/hallo' });
  frueh.vermittelt.sort((x, y) => x.t - y.t);
  assert.deepEqual(rot(frueh), ['A5']);
  // Negativ-Kontrolle: unverändert bestehen alle
  assert.deepEqual(rot(e), []);
});
