// Project versions B10, task 2: named versions and the storage-level restore (stelleWiederHer).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pruefeProjekt, neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { Projekte, AblageFehler, normalisiere } from '../project/storage.ts';
import { Versionen, VERSIONEN_ORDNER } from '../project/versionen.ts';
import { wende } from '../project/patch.ts';
import { tmpOrdner, specProjekt, kopie } from './support/project.mjs';

const T0 = Date.UTC(2026, 10, 23, 10, 0, 0, 0);
const MIN = 60000;
function aufbau(t) {
  const w = tmpOrdner(t); const pr = new Projekte(w);
  const uhr = { t: T0 };
  pr.versionen = new Versionen(w, { jetzt: () => uhr.t });
  const { slug } = pr.lege('Zurueck');
  return { w, pr, slug, uhr, ord: path.join(w, slug, VERSIONEN_ORDNER), datei: path.join(w, slug, 'project.json') };
}
const mitName = (p, n) => { const q = kopie(p); q.name = n; return q; };
const code = (c) => (e) => e instanceof AblageFehler && e.fehler === c;
// a project edited after a version: open (so the log exists), edit through the storage layer, close
function bearbeite(a, name) {
  const o = a.pr.oeffne(a.slug, { zeitgeber: false });
  a.pr.speichere(a.slug, mitName(o.projekt, name));
  o.verlauf.schliesse();
}

test('sichereBenannt: file name, list entry, empty name refused, same name twice gives two ids', (t) => {
  const a = aufbau(t);
  const id = a.pr.versionen.sichereBenannt(a.slug, 'Vor dem Drop');
  assert.match(id, /^\d{8}T\d{9}Z--Vor dem Drop$/);
  assert.ok(fs.existsSync(path.join(a.ord, `${id}.json`)));
  const e = a.pr.versionen.liste(a.slug).find((x) => x.id === id);
  assert.equal(e.auto, false); assert.equal(e.name, 'Vor dem Drop');
  for (const n of ['', '   ', '/\\:*?"<>|', '\u0001\u0002', undefined]) assert.throws(() => a.pr.versionen.sichereBenannt(a.slug, n), code('version_name_leer'), String(n));
  assert.equal(a.pr.versionen.sichereBenannt(a.slug, 'x'.repeat(100)).split('--')[1].length, 60);
  assert.equal(a.pr.versionen.sichereBenannt(a.slug, '  a   /b  ').split('--')[1], 'a b');
  const b1 = a.pr.versionen.sichereBenannt(a.slug, 'same'), b2 = a.pr.versionen.sichereBenannt(a.slug, 'same');
  assert.notEqual(b1, b2);
  assert.ok(fs.existsSync(path.join(a.ord, `${b1}.json`)) && fs.existsSync(path.join(a.ord, `${b2}.json`)));
});

test('a named version survives 30 automatic copies', (t) => {
  const a = aufbau(t);
  const id = a.pr.versionen.sichereBenannt(a.slug, 'keep');
  for (let i = 0; i < 30; i++) { a.uhr.t += 6 * MIN; a.pr.speichere(a.slug, mitName(specProjekt(), `n${i}`)); }
  const l = a.pr.versionen.liste(a.slug);
  assert.equal(l.filter((x) => x.auto).length, 20);
  assert.ok(l.some((x) => x.id === id));
});

test('stelleWiederHer: content back except rev (greater) and wiedergabe_rev 0; the safety version holds the pre-restore bytes', (t) => {
  const a = aufbau(t);
  a.pr.speichere(a.slug, mitName(specProjekt(), 'alt'));
  const id = a.pr.versionen.sichereBenannt(a.slug, 'v1');
  const vBytes = a.pr.versionen.lies(a.slug, id);
  a.uhr.t += MIN; bearbeite(a, 'neu');
  const vorher = fs.readFileSync(a.datei); const revVor = JSON.parse(vorher).rev;
  assert.equal(JSON.parse(vorher).name, 'neu');
  const r = a.pr.stelleWiederHer(a.slug, id, 'andreas');
  const nach = JSON.parse(fs.readFileSync(a.datei, 'utf8'));
  const soll = JSON.parse(JSON.stringify(normalisiere(pruefeProjekt(JSON.parse(vBytes)).projekt))); soll.rev = nach.rev; soll.wiedergabe_rev = 0;   // a /1 version is lifted like lies() does
  assert.deepEqual(nach, soll);
  assert.ok(nach.rev > revVor); assert.equal(nach.wiedergabe_rev, 0);
  const s = a.pr.versionen.liste(a.slug).find((x) => x.id === r.gesichert_als);
  assert.equal(s.name, 'before restore'); assert.equal(s.auto, false);
  assert.deepEqual(a.pr.versionen.lies(a.slug, r.gesichert_als), vorher);
});

test('the restore is ONE undo entry that brings back the pre-restore content', (t) => {
  const a = aufbau(t);
  a.pr.speichere(a.slug, mitName(specProjekt(), 'alt'));
  const id = a.pr.versionen.sichereBenannt(a.slug, 'v1');
  a.uhr.t += MIN; bearbeite(a, 'neu');
  const vorher = a.pr.lies(a.slug);
  a.pr.stelleWiederHer(a.slug, id, 'andreas');
  const o = a.pr.oeffne(a.slug, { zeitgeber: false });
  t.after(() => o.verlauf.schliesse());
  assert.equal(o.projekt.name, 'alt');
  const z = o.verlauf.naechstesUndo();
  assert.equal(z.label, 'version zurueck');
  assert.deepEqual(o.verlauf.zeiger().undo.at(-1), z.rev);
  const zurueck = wende(o.projekt, z.zurueck);
  assert.equal(zurueck.name, 'neu');
  assert.equal(zurueck.name, vorher.name);
});

test('unknown id and path traversal: version_unbekannt', (t) => {
  const a = aufbau(t);
  a.pr.speichere(a.slug, specProjekt());
  for (const id of ['nix', '../project', '..', 'a/b', '', '20260101T000000000Z/../..']) assert.throws(() => a.pr.stelleWiederHer(a.slug, id, 'andreas'), code('version_unbekannt'), id);
  assert.throws(() => a.pr.stelleWiederHer(a.slug, 5, 'andreas'), code('version_unbekannt'));
});

test('an invalid version (not JSON, fails the check, newer format) is refused: no safety version, project.json unchanged', (t) => {
  const a = aufbau(t);
  a.pr.speichere(a.slug, specProjekt());
  const gut = JSON.parse(fs.readFileSync(a.datei, 'utf8'));
  const neuer = { ...gut, format: 'cypherdj-projekt/99' };
  const kaputt = { ...gut, tempo_bpm: 5 };
  fs.mkdirSync(a.ord, { recursive: true });
  const faelle = { '20260101T000000001Z--text': '{nein', '20260101T000000002Z--kaputt': JSON.stringify(kaputt), '20260101T000000003Z--neuer': JSON.stringify(neuer) };
  for (const [n, inhalt] of Object.entries(faelle)) fs.writeFileSync(path.join(a.ord, `${n}.json`), inhalt);
  const vorher = fs.readFileSync(a.datei); const anzahl = a.pr.versionen.liste(a.slug).length;
  for (const n of Object.keys(faelle)) {
    assert.throws(() => a.pr.stelleWiederHer(a.slug, n, 'andreas'), code('version_ungueltig'), n);
    assert.deepEqual(fs.readFileSync(a.datei), vorher);
    assert.equal(a.pr.versionen.liste(a.slug).length, anzahl, 'no safety version');
  }
});

// the v1 step document of commit 6bd45190 (as tests/project_seq.test.mjs builds it): a stored /2 file whose group carries seq.schema 1
const BK = { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} };
function rohV1() {
  const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
  let p = neuesProjekt('v1'); p.live = true; p.plaetze = [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }];
  for (const name of ['Drums', 'Bass']) {
    p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name, geraet: BK });
    p = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren.at(-1).id, art: 'midi', start_beat: 0, laenge_beats: 64, name: 'SEQ',
      noten: [0, 4, 8, 12].map((b) => ({ beat: b, laenge: 0.125, ton: 36, vel: 110 })) });
  }
  p = lauf(p, { befehl: 'gruppenspur_neu', name: 'SEQ 2', mitglieder: [p.spuren[0].id, p.spuren[1].id] });
  const roh = kopie(p);
  roh.format = 'cypherdj-projekt/2'; delete roh.plaetze;
  roh.gruppen[0].seq = { schema: 1, platz: 2, aktiv: 0, saat: 2, swing: 0.1, stimmen: [], folgen: [null] };
  return roh;
}

test('RESTORE of a version holding a raw SEQ v1 document goes through seqV1Wandeln and succeeds', (t) => {
  const a = aufbau(t);
  a.pr.speichere(a.slug, specProjekt());
  const roh = rohV1();
  assert.equal('fehler' in pruefeProjekt(kopie(roh)), true, 'without the lift the check refuses the raw document');
  fs.mkdirSync(a.ord, { recursive: true });
  const id = '20260101T000000000Z--v1';
  fs.writeFileSync(path.join(a.ord, `${id}.json`), JSON.stringify(roh));
  const r = a.pr.stelleWiederHer(a.slug, id, 'andreas');
  assert.ok(a.pr.versionen.liste(a.slug).some((x) => x.id === r.gesichert_als));
  const nach = JSON.parse(fs.readFileSync(a.datei, 'utf8'));
  assert.equal(nach.name, 'v1'); assert.equal(nach.gruppen[0].seq.schema, 2);
});

test('restore of the version equal to the current state: safety version made, no undo entry, bytes unchanged', (t) => {
  const a = aufbau(t);
  a.pr.speichere(a.slug, specProjekt());
  const id = a.pr.versionen.sichereBenannt(a.slug, 'gleich');
  const vorher = fs.readFileSync(a.datei);
  const r = a.pr.stelleWiederHer(a.slug, id, 'andreas');
  assert.ok(a.pr.versionen.liste(a.slug).some((x) => x.id === r.gesichert_als));
  assert.deepEqual(fs.readFileSync(a.datei), vorher);
  const o = a.pr.oeffne(a.slug, { zeitgeber: false });
  t.after(() => o.verlauf.schliesse());
  assert.equal(o.verlauf.kannUndo(), false);
});

test('restore right after open (project never changed) works', (t) => {
  const a = aufbau(t);
  const o = a.pr.oeffne(a.slug, { zeitgeber: false }); o.verlauf.schliesse();
  const id = a.pr.versionen.liste(a.slug)[0].id;
  assert.doesNotThrow(() => a.pr.stelleWiederHer(a.slug, id, 'andreas'));
});

test('restore while the project is open: projekt_busy, nothing written', (t) => {
  const a = aufbau(t);
  a.pr.speichere(a.slug, specProjekt());
  const id = a.pr.versionen.sichereBenannt(a.slug, 'v');
  const o = a.pr.oeffne(a.slug, { zeitgeber: false });
  t.after(() => o.verlauf.schliesse());
  const vorher = fs.readFileSync(a.datei); const anzahl = a.pr.versionen.liste(a.slug).length;
  assert.throws(() => a.pr.stelleWiederHer(a.slug, id, 'andreas'), code('projekt_busy'));
  assert.deepEqual(fs.readFileSync(a.datei), vorher);
  assert.equal(a.pr.versionen.liste(a.slug).length, anzahl);
});
