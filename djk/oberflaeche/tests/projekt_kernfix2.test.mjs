// D1 S2-Integration, Slice 1: offene Befunde des Re-Reviews S2-Kern (quadratischer Patch-Pfad, Verlauf nach schliesse, Mutationslücken
// X1 X3 X4 X5 X10, verlauf()+lies-Weg) und Spur-Fader bis +6 dB (Spec 6.16). Jeder Test hier war vor dem Fix rot (Belege:
// ~/messungen/2026-10-15-d1-s2-integration/slice1/).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as PATCH from '../projekt/patch.ts';
import { fuehreAus, fuehreListeAus } from '../projekt/befehle.ts';
import { Verlauf, VerlaufFehler, aendere, rueckgaengig, wiederholen } from '../projekt/verlauf.ts';
import { Projekte, AblageFehler } from '../projekt/ablage.ts';
import { kanonisch, neuesProjekt, pruefeProjekt } from '../projekt/modell.ts';
import { tmpOrdner, specProjekt, kopie, zufall } from './hilfen/projekt.mjs';

const A = { quelle: 'andreas', label: 'Test' };
const istLog = (fd) => { try { return fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith('undo.jsonl'); } catch { return false; } };

function mitNoten(n) {
  let p = fuehreListeAus(neuesProjekt('G'), [{ befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 64 }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'noten_neu', clip_id: 'c1',
    noten: Array.from({ length: n }, (_, i) => ({ beat: (i % 256) / 4, laenge: 0.25, ton: 36 + (i % 40), vel: 100 })) }]).projekt;
  return p;
}
function haelfteLoeschenUndoRedo(t, n) {
  const p = mitNoten(n), d = tmpOrdner(t), v = new Verlauf(path.join(d, 'undo.jsonl'), { zeitgeber: false });
  t.after(() => v.schliesse());
  const ids = p.spuren[0].clips[0].noten.slice(0, n / 2).map((x) => x.id);
  const zeit = (f) => { const t0 = performance.now(); const r = f(); return [performance.now() - t0, r]; };
  const [tl, r1] = zeit(() => aendere(v, p, [{ befehl: 'noten_loeschen', clip_id: 'c1', ids }], A));
  const [tu, r2] = zeit(() => rueckgaengig(v, r1.projekt, A));
  const [tr, r3] = zeit(() => wiederholen(v, r2.projekt, A));
  assert.equal(r3.projekt.spuren[0].clips[0].noten.length, n / 2);
  assert.equal(kanonisch(r2.projekt.spuren[0].clips[0].noten), kanonisch(p.spuren[0].clips[0].noten), 'Undo stellt Reihenfolge und Inhalt her');
  return { tl, tu, tr };
}

// ---------------------------------------------------------------------------------------------------------------------
// Quadratischer Pfad (Re-Review: findLastIndex je remove, find/includes je Note)
test('Leistung: vordere Hälfte von 60000 Noten löschen, Undo, Redo je unter 1500 ms (vorher 4201, 1694, 12547 ms)', { timeout: 300_000 }, (t) => {
  const z = haelfteLoeschenUndoRedo(t, 60000);
  assert.ok(z.tl < 1500 && z.tu < 1500 && z.tr < 1500, `löschen ${z.tl.toFixed(0)} ms, Undo ${z.tu.toFixed(0)} ms, Redo ${z.tr.toFixed(0)} ms`);
});

test('Leistung: dieselbe Folge wächst linear (60000 gegen 15000 Noten: Faktor unter 8, quadratisch wäre 16)', { timeout: 300_000 }, (t) => {
  const summe = (z) => z.tl + z.tu + z.tr;
  const klein = Math.min(summe(haelfteLoeschenUndoRedo(t, 15000)), summe(haelfteLoeschenUndoRedo(t, 15000)));
  const gross = summe(haelfteLoeschenUndoRedo(t, 60000));
  assert.ok(gross / klein < 8, `Verhältnis ${(gross / klein).toFixed(1)} (${gross.toFixed(0)} / ${klein.toFixed(0)} ms)`);
});

test('Läufe: wende und kehreUm ergeben dasselbe wie der Einzelweg (Fuzz 400: remove-Läufe in beliebiger Folge, add-Läufe steigend und nicht)', () => {
  const r = zufall(4711);
  for (let fall = 0; fall < 400; fall++) {
    const n = 1 + Math.floor(r() * 40);
    const wurzel = { l: Array.from({ length: n }, (_, k) => ({ id: `e${k}`, w: k })) };
    const ops = [];
    const weg = Array.from({ length: n }, (_, k) => `e${k}`).filter(() => r() < 0.6).sort(() => r() - 0.5);
    for (const id of weg) ops.push({ op: 'remove', pfad: `/l/${id}` });
    let laenge = n - weg.length;
    const neu = Math.floor(r() * 20), steigend = r() < 0.7;
    let idx = 0;
    for (let k = 0; k < neu; k++) {
      idx = steigend ? idx + Math.floor(r() * 2) : Math.floor(r() * (laenge + 1));
      if (idx > laenge) idx = laenge;
      ops.push({ op: 'add', pfad: `/l/x${k}`, wert: { id: `x${k}`, w: -k }, index: idx });
      laenge++; idx++;
    }
    const einzeln = PATCH.wendeEinzeln(wurzel, ops);
    assert.deepEqual(PATCH.wende(wurzel, ops), einzeln.stand, `Fall ${fall}: Stand`);
    assert.deepEqual(PATCH.kehreUm(ops, wurzel), einzeln.umkehr, `Fall ${fall}: Umkehr`);
    assert.deepEqual(PATCH.wende(einzeln.stand, einzeln.umkehr), wurzel, `Fall ${fall}: Umkehr führt zurück`);
  }
});

test('Läufe: Fehler bleiben Fehler (doppeltes remove im Lauf, unbekannte ID, add auf vorhandene ID, Index außerhalb); Eingabe unberührt', () => {
  const wurzel = { l: Array.from({ length: 20 }, (_, k) => ({ id: `e${k}` })) }, vorher = kopie(wurzel);
  const rem = (ids) => ids.map((id) => ({ op: 'remove', pfad: `/l/${id}` }));
  assert.throws(() => PATCH.wende(wurzel, rem(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e1'])), (e) => e.grund === 'pfad_unbekannt');
  assert.throws(() => PATCH.wende(wurzel, rem(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'zz'])), (e) => e.grund === 'pfad_unbekannt');
  const add = (n, idx) => Array.from({ length: n }, (_, k) => ({ op: 'add', pfad: `/l/y${k}`, wert: { id: `y${k}` }, index: idx(k) }));
  assert.throws(() => PATCH.wende(wurzel, [...add(7, (k) => k), { op: 'add', pfad: '/l/e3', wert: { id: 'e3' }, index: 9 }]), (e) => e.grund === 'existiert_schon');
  assert.throws(() => PATCH.wende(wurzel, add(8, (k) => 30 + k)), (e) => e.grund === 'index_bereich');
  assert.deepEqual(wurzel, vorher);
});

// ---------------------------------------------------------------------------------------------------------------------
// Verlauf nach schliesse (Re-Review: nach schliesse beschreibbar, ohne Sperre)
test('Verlauf: nach schliesse wirft haengeAn und protokolliere verlauf_geschlossen, die Datei bleibt, zweites schliesse ist still', (t) => {
  const d = tmpOrdner(t), datei = path.join(d, 'undo.jsonl');
  const v = new Verlauf(datei, { zeitgeber: false });
  const r = aendere(v, neuesProjekt('S'), [{ befehl: 'tempo_setzen', bpm: 130 }], A);
  const ziel = v.naechstesUndo();
  v.schliesse();
  const vorher = fs.readFileSync(datei, 'utf8');
  assert.throws(() => aendere(v, r.projekt, [{ befehl: 'tempo_setzen', bpm: 131 }], A), (e) => e instanceof VerlaufFehler && e.grund === 'verlauf_geschlossen');
  assert.throws(() => v.protokolliere('undo', ziel, 2, 'andreas'), (e) => e instanceof VerlaufFehler && e.grund === 'verlauf_geschlossen');
  assert.equal(fs.readFileSync(datei, 'utf8'), vorher, 'nichts geschrieben');
  assert.doesNotThrow(() => v.schliesse());
});

test('Verlauf: Negativ-Kontrolle: ein offener Verlauf schreibt wie bisher', (t) => {
  const d = tmpOrdner(t), v = new Verlauf(path.join(d, 'undo.jsonl'), { zeitgeber: false });
  t.after(() => v.schliesse());
  const r = aendere(v, neuesProjekt('S'), [{ befehl: 'tempo_setzen', bpm: 130 }], A);
  assert.equal(r.eintrag.rev, 1); assert.deepEqual(v.zeiger(), { undo: [1], redo: [] });
});

// ---------------------------------------------------------------------------------------------------------------------
// verlauf()+lies-Weg (Re-Review; Spec 6.12): ohne Nachziehen darf ein vorauslaufendes Log nicht geöffnet werden
function logVoraus(t) {
  const w = tmpOrdner(t), pr = new Projekte(w), { slug, projekt } = pr.lege('Voraus');
  const o = pr.oeffne(slug, { zeitgeber: false });
  const r = aendere(o.verlauf, projekt, [{ befehl: 'tempo_setzen', bpm: 140 }], A, { speichere: (n) => pr.speichere(slug, n) });
  o.verlauf.schliesse();
  const roh = JSON.parse(fs.readFileSync(path.join(w, slug, 'project.json'), 'utf8')); roh.rev = 0; roh.tempo_bpm = 120;
  fs.writeFileSync(path.join(w, slug, 'project.json'), JSON.stringify(roh));       // Stromausfall: Log rev 1, Datei rev 0
  return { pr, slug, r };
}
test('verlauf(): läuft das Log der Datei voraus, 409 log_voraus und die Sperre ist frei (oeffne zieht danach nach)', (t) => {
  const { pr, slug } = logVoraus(t);
  assert.throws(() => pr.verlauf(slug, { zeitgeber: false }), (e) => e instanceof AblageFehler && e.code === 409 && e.fehler === 'log_voraus');
  const o = pr.oeffne(slug, { zeitgeber: false });
  t.after(() => o.verlauf.schliesse());
  assert.equal(o.nachgezogen, 1); assert.equal(o.projekt.tempo_bpm, 140);
});
test('verlauf(): Negativ-Kontrolle: Log und Datei gleich weit, verlauf() öffnet wie bisher', (t) => {
  const w = tmpOrdner(t), pr = new Projekte(w), { slug } = pr.lege('Gleich');
  const v = pr.verlauf(slug, { zeitgeber: false });
  t.after(() => v.schliesse());
  assert.deepEqual(v.zeiger(), { undo: [], redo: [] });
});

// ---------------------------------------------------------------------------------------------------------------------
// Mutationslücken des Re-Reviews (mut_eigen.py X1, X3, X4, X5, X10 überlebten)
test('X1: protokolliere mit einem Ziel, das nicht oben auf dem Stapel liegt, wirft verlauf_inkonsistent und schreibt nichts', (t) => {
  const d = tmpOrdner(t), datei = path.join(d, 'undo.jsonl'), v = new Verlauf(datei, { zeitgeber: false });
  t.after(() => v.schliesse());
  const r1 = aendere(v, neuesProjekt('X'), [{ befehl: 'tempo_setzen', bpm: 130 }], A);
  aendere(v, r1.projekt, [{ befehl: 'tempo_setzen', bpm: 131 }], A);
  const vorher = fs.readFileSync(datei, 'utf8');
  assert.throws(() => v.protokolliere('undo', r1.eintrag, 3, 'andreas'), (e) => e instanceof VerlaufFehler && e.grund === 'verlauf_inkonsistent');
  assert.equal(fs.readFileSync(datei, 'utf8'), vorher);
});

test('X3: scheitert der Verlauf-Konstruktor (kaputtes Log), ist die Sperre wieder frei; nach der Reparatur öffnet es', (t) => {
  const w = tmpOrdner(t), pr = new Projekte(w), { slug } = pr.lege('Kaputt');
  const log = path.join(w, slug, 'undo.jsonl');
  fs.writeFileSync(log, 'kein json\n{"auch":"nicht"}\n');
  assert.throws(() => pr.oeffne(slug, { zeitgeber: false }), (e) => e instanceof VerlaufFehler && e.grund === 'verlauf_kaputt');
  fs.writeFileSync(log, '');
  const o = pr.oeffne(slug, { zeitgeber: false });
  t.after(() => o.verlauf.schliesse());
  assert.deepEqual(o.verlauf.zeiger(), { undo: [], redo: [] }, 'nicht projekt_busy');
});

test('X4: Undo mit einem Projekt, das hinter dem Log steht, scheitert VOR dem Speichern (speichere nie gerufen)', (t) => {
  const d = tmpOrdner(t), v = new Verlauf(path.join(d, 'undo.jsonl'), { zeitgeber: false });
  t.after(() => v.schliesse());
  const r1 = aendere(v, neuesProjekt('X'), [{ befehl: 'tempo_setzen', bpm: 130 }], A);
  const alt = kopie(r1.projekt); alt.rev = 0;
  let gespeichert = 0;
  assert.throws(() => rueckgaengig(v, alt, A, { speichere: () => { gespeichert++; } }), (e) => e instanceof VerlaufFehler && e.grund === 'rev_nicht_steigend');
  assert.equal(gespeichert, 0);
});

test('X5: ein Unterschied nur im abgeleiteten Feld dekodiert ist kein Unterschied (leerer Patch)', () => {
  const p = specProjekt(), q = kopie(p); q.spuren[0].clips[0].dekodiert = 'laeuft';
  assert.deepEqual(PATCH.unterschied(p, q), []);
  q.spuren[0].clips[0].gain_db = -3;                                                   // Negativ-Kontrolle
  assert.deepEqual(PATCH.unterschied(p, q), [{ op: 'replace', pfad: '/spuren/s1/clips/c1/gain_db', wert: -3 }]);
});

test('X10: scheitert das Log beim Undo, steht project.json wieder auf dem alten Stand (Zurückschreiben)', (t) => {
  const w = tmpOrdner(t), pr = new Projekte(w), { slug, projekt } = pr.lege('Rueck');
  const o = pr.oeffne(slug, { zeitgeber: false });
  t.after(() => o.verlauf.schliesse());
  const haken = { speichere: (n) => pr.speichere(slug, n) };
  const r1 = aendere(o.verlauf, projekt, [{ befehl: 'tempo_setzen', bpm: 150 }], A, haken);
  const orig = fs.writeSync;
  fs.writeSync = (fd, ...rest) => { if (istLog(fd)) { const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; } return orig(fd, ...rest); };
  try { assert.throws(() => rueckgaengig(o.verlauf, r1.projekt, A, haken), /ENOSPC/); } finally { fs.writeSync = orig; }
  assert.equal(kanonisch(pr.lies(slug)), kanonisch(r1.projekt));
});

// ---------------------------------------------------------------------------------------------------------------------
// Spec 6.16: Spur-Fader −200..+6 dB
test('6.16 Spur-Fader: +6 geht, +6,5 nicht (Befehl und Datei)', () => {
  const p = specProjekt();
  assert.equal(fuehreAus(p, { befehl: 'spur_aendern', spur_id: 's1', fader_db: 6 }).projekt.spuren[0].fader_db, 6);
  assert.throws(() => fuehreAus(p, { befehl: 'spur_aendern', spur_id: 's1', fader_db: 6.5 }), (e) => e.grund === 'argument_ungueltig');
  const q = kopie(p); q.spuren[0].fader_db = 6.5;
  assert.ok('fehler' in pruefeProjekt(q));
});
