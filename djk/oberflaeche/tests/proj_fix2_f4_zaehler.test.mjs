// D1 S2-Integration, zweite Fix-Runde F4 (Spec 6.31): Wird ein Arbeitsordner ausdrücklich übergeben, heißt die Zählerdatei
// `<arbeitsordner>.zaehler`; so teilen sich Test-Server nie eine Datei (vorher dirname/wiedergabe-zaehler: zwei Sitzungen mit
// Geschwister-Ordnern unter /tmp teilten /tmp/wiedergabe-zaehler). Die Datei wird haltbar geschrieben (fsync auf Datei und Ordner wie
// project.json). Belege: Quality-Probe p2 Z1 (A [1,2], B [1], Datei 1) und Z2 (leere Datei nach Stromausfall ohne fsync).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjSitzung } from '../bereiche/proj/sitzung.ts';
import { WiedergabeZaehler } from '../projekt/wiedergabe.ts';
import { pruefKontext } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

test('F4 Z1: zwei Sitzungen mit Geschwister-Arbeitsordnern haben getrennte Zählerdateien; A vergibt nach einem Neustart keine Nummer zweimal', (t) => {
  const eltern = tmpOrdner(t, 'djk-f4z1-');
  const a = path.join(eltern, 'arr-a'), b = path.join(eltern, 'arr-b');
  const sA = new ProjSitzung(pruefKontext(), { wurzel: path.join(eltern, 'pa'), arbeitsordner: a });
  const sB = new ProjSitzung(pruefKontext(), { wurzel: path.join(eltern, 'pb'), arbeitsordner: b });
  const nA = [sA.naechsteNummer(), sA.naechsteNummer()], nB = [sB.naechsteNummer()];
  sA.schliesse(); sB.schliesse();
  const sA2 = new ProjSitzung(pruefKontext(), { wurzel: path.join(eltern, 'pa'), arbeitsordner: a });   // „Neustart“ von A
  t.after(() => sA2.schliesse());
  const nA2 = sA2.naechsteNummer();
  const lies = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null);
  const m = { nA, nB, nA2, a: lies(`${a}.zaehler`), b: lies(`${b}.zaehler`), geteilt: lies(path.join(eltern, 'wiedergabe-zaehler')) };
  console.log(`F4 Z1 ${JSON.stringify(m)}`);
  assert.equal(m.geteilt, null, 'keine geteilte Datei im Elternordner');
  // Spec 6.32: die Datei hält die obere Grenze des Blocks (A: zweiter Block nach dem Neustart, B: erster)
  assert.deepEqual([m.a, m.b], ['2048', '1024'], 'je Arbeitsordner eine Datei <arbeitsordner>.zaehler');
  assert.ok(!nA.includes(nA2), `A vergibt nach dem Neustart ${nA2}, schon vergeben waren ${nA}`);
});

// Haltbarkeit: welche Pfade fsync bekommen, über die Deskriptoren von openSync gezählt (wiedergabe.ts nutzt das Standard-Objekt von node:fs)
function fsyncPfade(f) {
  const offen = new Map(), pfade = [];
  const { openSync, fsyncSync } = fs;
  fs.openSync = (p, ...rest) => { const fd = openSync(p, ...rest); offen.set(fd, path.resolve(String(p))); return fd; };
  fs.fsyncSync = (fd) => { pfade.push(offen.get(fd) ?? `fd:${fd}`); return fsyncSync(fd); };
  try { f(); } finally { fs.openSync = openSync; fs.fsyncSync = fsyncSync; }
  return pfade;
}

test('F4 Z2: naechste() schreibt die Zählerdatei haltbar: fsync auf den Inhalt vor dem Umbenennen und auf den Ordner', (t) => {
  const d = tmpOrdner(t, 'djk-f4z2-');
  const arr = path.join(d, 'arr'), datei = path.join(d, 'zustand', 'zaehler');
  const z = new WiedergabeZaehler(arr, datei);
  let nr = 0;
  const pfade = fsyncPfade(() => { nr = z.naechste(); });
  console.log(`F4 Z2 ${JSON.stringify({ nr, fsync: pfade.map((p) => path.relative(d, p) || '.') })}`);
  assert.equal(fs.readFileSync(datei, 'utf8').trim(), String(nr - 1 + 1024), 'Spec 6.32: die erste Nummer reserviert den Block, die Datei hält seine Grenze');
  assert.ok(pfade.some((p) => p.startsWith(`${datei}.`) && p.endsWith('.teil')), 'fsync auf die Temp-Datei vor dem rename');
  assert.ok(pfade.includes(path.dirname(datei)), 'fsync auf den Ordner nach dem rename');
  assert.deepEqual(fs.readdirSync(path.dirname(datei)), ['zaehler'], 'keine Temp-Datei bleibt liegen');
});

test('F4 Negativ-Kontrolle: ohne Zustandsdatei (nur Arbeitsordner) kein fsync, Nummer aus dem Ordner wie bisher', (t) => {
  const d = tmpOrdner(t, 'djk-f4neg-');
  fs.mkdirSync(path.join(d, 'arr')); fs.writeFileSync(path.join(d, 'arr', 'wiedergabe-5.json'), '{}');
  const z = new WiedergabeZaehler(path.join(d, 'arr'));
  let nr = 0;
  const pfade = fsyncPfade(() => { nr = z.naechste(); });
  assert.equal(nr, 6);
  assert.deepEqual(pfade, []);
});

test('F4 Betrieb: ohne ausdrücklichen Arbeitsordner gilt die Vorgabe der Instanz (~/.local/state/cypherdj-<i>/wiedergabe-zaehler)', async () => {
  const { zaehlerDateiVorgabe } = await import('../bereiche/proj/konfig.ts');
  assert.match(zaehlerDateiVorgabe('c'), /\/\.local\/state\/cypherdj-c\/wiedergabe-zaehler$/);
});
