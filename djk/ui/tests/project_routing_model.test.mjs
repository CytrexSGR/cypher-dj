// 1.10 Slice 1: Projektmodell /2 (gruppen, master, Spur.ausgang), Migration von /1, Sicht der Wiedergabe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FORMAT, MAX_GRUPPEN, insertVorgabe, neuesProjekt, pruefeProjekt, pruefeFehler, kanonisch, wiedergabeSicht, spurSicht } from '../project/model.ts';
import { Projekte } from '../project/storage.ts';
import { specProjekt, kopie, tmpOrdner } from './support/project.mjs';

const gruppe = (nr, extra = {}) => ({ id: `g${nr}`, nr, name: `Group ${nr}`, farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false, ...extra });
const mitGruppe = () => {
  const p = pruefeProjekt(specProjekt()).projekt;
  p.gruppen.push(gruppe(1, { name: 'Music' }));
  p.spuren[1].ausgang = { art: 'gruppe', id: 'g1' };
  return p;
};

test('1.10 Modell: neues Projekt ist /2 mit leeren Gruppen und PM bei 0 dB; Gruppen-Zähler startet bei 1', () => {
  const p = neuesProjekt('T');
  assert.equal(p.format, FORMAT); assert.equal(FORMAT, 'cypherdj-projekt/2');
  assert.deepEqual(p.gruppen, []); assert.deepEqual(p.master, { fader_db: 0 }); assert.equal(p.naechste_id.gruppe, 1);
  assert.equal(pruefeFehler(p), null);
});

test('1.10 Modell: ein /1-Projekt öffnet, wird im Speicher /2 (ohne rev-Schritt), Spuren unverändert; zweimal gehoben ändert nichts', () => {
  const alt = specProjekt();
  assert.equal(alt.format, 'cypherdj-projekt/1');
  const g = pruefeProjekt(alt);
  assert.ok(g.projekt, JSON.stringify(g));
  assert.equal(g.projekt.format, 'cypherdj-projekt/2'); assert.equal(g.projekt.rev, 17); assert.equal(g.projekt.wiedergabe_rev, 15);
  assert.deepEqual(g.projekt.gruppen, []); assert.deepEqual(g.projekt.master, { fader_db: 0 });
  assert.deepEqual(g.projekt.spuren.map((s) => s.id), ['s1', 's2', 's3']);
  assert.equal(kanonisch(pruefeProjekt(g.projekt).projekt), kanonisch(g.projekt), 'idempotent (A8)');
  assert.equal(alt.format, 'cypherdj-projekt/1', 'Eingabe unberührt');
});

test('1.10 Modell: Format und Pflichtfelder (Fehlerfälle und Negativ-Kontrolle)', () => {
  const p = mitGruppe();
  assert.equal(pruefeFehler(p), null);
  const ohneGruppen = kopie(p); delete ohneGruppen.gruppen;
  assert.match(pruefeFehler(ohneGruppen), /gruppen/);
  const ohneMaster = kopie(p); delete ohneMaster.master;
  assert.match(pruefeFehler(ohneMaster), /master/);
  const alt = kopie(specProjekt()); alt.gruppen = [];
  assert.match(pruefeFehler(alt), /gruppen/, '/1 kennt keine Gruppen');
  const alt2 = kopie(specProjekt()); alt2.spuren[0].ausgang = { art: 'gruppe', id: 'g1' };
  assert.match(pruefeFehler(alt2), /ausgang/, '/1 kennt kein Ziel');
  const fremd = kopie(p); fremd.format = 'cypherdj-projekt/3';   // trägt gruppen und master: darf nicht als „unbekanntes Feld“ scheitern (Prüfung 2, C1)
  assert.match(pruefeFehler(fremd), /^format/);
  const fremd1 = kopie(specProjekt()); fremd1.format = 'cypherdj-projekt/3';   // /1-förmig, aber fremdes Format
  assert.match(pruefeFehler(fremd1), /^format/);
  const ohneFormat = kopie(p); delete ohneFormat.format;
  assert.match(pruefeFehler(ohneFormat), /format.*fehlt/, 'ein fehlendes Format bleibt „fehlt“');
  const zwei = kopie(specProjekt()); zwei.format = 'cypherdj-projekt/2';   // /2 ohne gruppen und master (altes Literal aus project_model.test.mjs:25)
  assert.match(pruefeFehler(zwei), /gruppen.*fehlt/, '/2 verlangt gruppen');
});

test('1.10 Modell: Gruppen und Ziele werden geprüft', () => {
  const schlecht = (aendere, muster) => { const p = mitGruppe(); aendere(p); assert.match(pruefeFehler(p), muster); };
  schlecht((p) => { p.spuren[1].ausgang = { art: 'gruppe', id: 'g9' }; }, /ausgang/);                    // unbekannte Gruppe
  schlecht((p) => { p.spuren[1].ausgang = { art: 'master' }; }, /ausgang/);                              // master wird nie gespeichert
  schlecht((p) => { p.spuren[1].ausgang = { art: 'gruppe', id: 'g1', extra: 1 }; }, /unbekanntes Feld/);
  schlecht((p) => { p.gruppen.push(gruppe(1, { id: 'g2' })); }, /nr/);                                     // nr doppelt
  schlecht((p) => { p.gruppen.push(gruppe(2, { id: 'g1' })); }, /id/);                                     // id doppelt
  schlecht((p) => { p.gruppen[0].nr = MAX_GRUPPEN + 1; }, /nr/);
  schlecht((p) => { p.gruppen[0].name = ''; }, /name/);
  schlecht((p) => { p.gruppen[0].fader_db = 7; }, /fader_db/);
  schlecht((p) => { p.gruppen[0].ausgang = { art: 'master' }; }, /ausgang/);                              // master wird nie gespeichert
  schlecht((p) => { p.gruppen[0].ausgang = { art: 'gruppe', id: 'g9' }; }, /ausgang/);                    // unbekannte Gruppe
  schlecht((p) => { p.gruppen[0].ausgang = { art: 'gruppe', id: 'g1' }; }, /ausgang/);                    // a group into itself
  schlecht((p) => { p.gruppen.push(gruppe(2, { ausgang: { art: 'gruppe', id: 'g1' } })); p.gruppen[0].ausgang = { art: 'gruppe', id: 'g2' }; }, /Zyklus|cycle/i);
  schlecht((p) => { p.master.extra = 1; }, /unbekanntes Feld/);
  schlecht((p) => { p.master.fader_db = -201; }, /fader_db/);
  schlecht((p) => { p.gruppen = Array.from({ length: MAX_GRUPPEN + 1 }, (_, i) => gruppe(i + 1)); }, /gruppen|nr/);
  // Negativ-Kontrolle: 16 Gruppen, 32 Spuren verteilt, werden angenommen
  const p = pruefeProjekt(specProjekt()).projekt;
  p.gruppen = Array.from({ length: MAX_GRUPPEN }, (_, i) => gruppe(i + 1));
  p.spuren[0].ausgang = { art: 'gruppe', id: 'g16' };
  assert.equal(pruefeFehler(p), null);
});

test('1.10 Modell: Wiedergabe-Sicht trägt die Topologie nur, wenn es welche gibt (neutral: wie vorher)', () => {
  const neutral = pruefeProjekt(specProjekt()).projekt;
  assert.deepEqual(Object.keys(wiedergabeSicht(neutral)), ['spuren']);
  assert.ok(!('ausgang' in spurSicht(neutral.spuren[0])));
  const m = mitGruppe();
  assert.deepEqual(wiedergabeSicht(m).gruppen, [{ id: 'g1', nr: 1 }]);
  assert.equal(spurSicht(m.spuren[1]).ausgang, 'g1');
  assert.ok(!('ausgang' in spurSicht(m.spuren[1], false)), 'die Freeze-Sicht kennt kein Ziel: ein Ziel-Wechsel verwirft keinen Freeze');
  const umbenannt = kopie(m); umbenannt.gruppen[0].name = 'Other'; umbenannt.gruppen[0].fader_db = -3;
  assert.equal(kanonisch(wiedergabeSicht(umbenannt)), kanonisch(wiedergabeSicht(m)), 'Name und Pegel einer Gruppe sind keine Wiedergabe');
});

// Nachzug N2 (I08): das Feld `aufnahme` einer Audio-Spur bleibt beim Heben von /1 nach /2 erhalten; die Wiedergabe-Sicht kennt es weiterhin nicht.
test('1.10 Modell N2: ein /1-Projekt mit aufnahme wird geladen, gehoben, gespeichert und wieder geladen; aufnahme bleibt gleich', (t) => {
  const aufnahme = { scharf: true, eingang: { art: 'intern', name: 'erz/1' } };
  const alt = specProjekt();
  alt.spuren[0].aufnahme = kopie(aufnahme);                               // s1 ist die Audio-Spur
  assert.equal(alt.format, 'cypherdj-projekt/1');
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('N2');
  fs.writeFileSync(path.join(w, slug, 'project.json'), JSON.stringify(alt));   // so liegt es von der Vorgängerfassung auf der Platte
  const geladen = pr.lies(slug);                                           // laden + heben
  assert.equal(geladen.format, 'cypherdj-projekt/2');
  assert.deepEqual(geladen.spuren[0].aufnahme, aufnahme);
  pr.speichere(slug, geladen);                                             // speichern
  const roh = JSON.parse(fs.readFileSync(path.join(w, slug, 'project.json'), 'utf8'));
  assert.equal(roh.format, 'cypherdj-projekt/2', 'gespeichert wird /2');
  assert.deepEqual(roh.spuren[0].aufnahme, aufnahme);
  const nochmal = pr.lies(slug);                                           // wieder laden
  assert.deepEqual(nochmal.spuren[0].aufnahme, aufnahme);
  assert.equal(kanonisch(nochmal), kanonisch(geladen));
  // die Wiedergabe-Sicht kennt aufnahme nicht: Arm und Eingang laden keine Wiedergabe neu
  const ohne = kopie(geladen); delete ohne.spuren[0].aufnahme;
  assert.equal(kanonisch(wiedergabeSicht(geladen)), kanonisch(wiedergabeSicht(ohne)));
  // Negativ-Kontrolle: ein unbekanntes Feld an derselben Spur bleibt ein Fehler
  const fremd = kopie(geladen); fremd.spuren[0].aufnahmee = aufnahme;
  assert.match(pruefeFehler(fremd), /aufnahmee.*unbekanntes Feld/);
});

// ---- 1.10 slice 3: returns, sends, hall values ----------------------------------------------------------------------------------
import { MAX_RETURNS, HALL_VORGABE, neueId } from '../project/model.ts';

const ret = (nr, extra = {}) => ({ id: `r${nr}`, nr, name: `Return ${nr}`, farbe: '#d08a2e', fader_db: 0, pan: 0, mute: false, solo: false, hall: { ...HALL_VORGABE }, ...extra });
const mitReturn = () => {
  const p = mitGruppe();
  p.returns = [ret(1, { name: 'Hall' })];
  p.spuren[0].sends = [{ id: 'r1', db: -6 }];
  p.gruppen[0].sends = [{ id: 'r1', db: -199 }];
  return p;
};

test('slice 3 model: a valid project with returns and sends passes; the Hall defaults are the stellwerk defaults', () => {
  const p = mitReturn();
  assert.equal(pruefeFehler(p), null);
  assert.equal(MAX_RETURNS, 4);
  assert.deepEqual(HALL_VORGABE, { an: true, pre: 0.04, decay: 0.5252, groesse: 0.282, tief: 0.5658, highcut: 0.8039, fahne: 0.66667 });
  const g = pruefeProjekt(p);
  assert.ok(g.projekt, JSON.stringify(g));
  assert.equal(kanonisch(pruefeProjekt(g.projekt).projekt), kanonisch(g.projekt), 'idempotent (A8)');
  const vier = mitGruppe();
  vier.returns = Array.from({ length: MAX_RETURNS }, (_, i) => ret(i + 1));
  vier.spuren[0].sends = vier.returns.map((r) => ({ id: r.id, db: 0 }));
  assert.equal(pruefeFehler(vier), null, 'negative control: four returns and four sends are accepted');
});

test('slice 3 model: closed validation of returns and sends (error cases)', () => {
  const schlecht = (aendere, muster) => { const p = mitReturn(); aendere(p); assert.match(pruefeFehler(p), muster); };
  schlecht((p) => { p.returns = Array.from({ length: MAX_RETURNS + 1 }, (_, i) => ret(i + 1)); }, /returns|nr/);   // more than 4
  schlecht((p) => { p.returns.push(ret(1, { id: 'r2' })); }, /nr/);                                              // nr twice
  schlecht((p) => { p.returns.push(ret(2, { id: 'r1' })); }, /id/);                                              // id twice
  schlecht((p) => { p.returns[0].nr = MAX_RETURNS + 1; }, /nr/);
  schlecht((p) => { p.returns[0].nr = 0; }, /nr/);
  schlecht((p) => { p.returns = []; }, /returns/);                                                                // absent instead of empty
  schlecht((p) => { p.spuren[0].sends = [{ id: 'r9', db: -6 }]; }, /unbekannter Return/);                         // send without a return
  schlecht((p) => { p.gruppen[0].sends = [{ id: 'r9', db: -6 }]; }, /unbekannter Return/);
  schlecht((p) => { p.spuren[0].sends = [{ id: 'r1', db: -6 }, { id: 'r1', db: -3 }]; }, /doppelt/);              // one send per return
  schlecht((p) => { p.spuren[0].sends = [{ id: 'r1', db: 6.5 }]; }, /db/);                                        // above +6
  schlecht((p) => { p.spuren[0].sends = [{ id: 'r1', db: -200 }]; }, /db/);                                       // -200 is "absent", never stored
  schlecht((p) => { p.spuren[0].sends = [{ id: 'r1', db: -201 }]; }, /db/);
  schlecht((p) => { p.spuren[0].sends = []; }, /sends/);
  schlecht((p) => { p.spuren[0].sends = [{ id: 'r1', db: -6, extra: 1 }]; }, /unbekanntes Feld/);
  schlecht((p) => { p.returns[0].hall.decay = 1.5; }, /decay/);                                                   // hall value outside 0..1
  schlecht((p) => { p.returns[0].hall.pre = -0.1; }, /pre/);
  schlecht((p) => { p.returns[0].hall.an = 1; }, /an/);
  schlecht((p) => { p.returns[0].hall.mix = 0.5; }, /unbekanntes Feld/);                                          // no such hall field
  schlecht((p) => { delete p.returns[0].hall.fahne; }, /fahne.*fehlt/);
  schlecht((p) => { p.returns[0].extra = 1; }, /unbekanntes Feld/);
  schlecht((p) => { p.returns[0].fader_db = 7; }, /fader_db/);
  schlecht((p) => { p.returns[0].farbe = 'red'; }, /farbe/);
});

test('slice 3 migration: an existing /2 file without returns opens, saves byte-identical and renders the same view; /1 stays; returns in /1 is an error', (t) => {
  const zwei = mitGruppe();                                   // a /2 project as written since slice 1
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('M3');
  pr.speichere(slug, zwei);                                   // the file exactly as the writer produces it
  const vorher = fs.readFileSync(path.join(w, slug, 'project.json'), 'utf8');
  const geladen = pr.lies(slug);
  assert.ok(!('returns' in geladen), 'no returns field is invented');
  assert.ok(!('return' in (geladen.naechste_id ?? {})), 'no return counter is invented');
  pr.speichere(slug, geladen);
  assert.equal(fs.readFileSync(path.join(w, slug, 'project.json'), 'utf8'), vorher, 'byte-identical after open and save');
  assert.equal(kanonisch(wiedergabeSicht(geladen)), kanonisch(wiedergabeSicht(zwei)));
  assert.deepEqual(Object.keys(wiedergabeSicht(geladen)).sort(), ['gruppen', 'spuren']);
  const alt = kopie(specProjekt()); alt.returns = [ret(1)];
  assert.match(pruefeFehler(alt), /returns.*unbekanntes Feld/, 'returns in /1');
  const alt2 = kopie(specProjekt()); alt2.spuren[0].sends = [{ id: 'r1', db: -6 }];
  assert.match(pruefeFehler(alt2), /sends.*unbekanntes Feld/, 'sends in /1');
  assert.ok(pruefeProjekt(specProjekt()).projekt, '/1 opens as before');
});

test('slice 3 ids: the prefixes of neueId are pairwise different; the return counter arises with the first return and only rises', () => {
  const p = neuesProjekt('P');
  const ids = ['spur', 'clip', 'gruppe', 'lane', 'return'].map((a) => neueId(p, a));
  assert.deepEqual(ids, ['s1', 'c1', 'g1', 'a1', 'r1']);
  assert.equal(new Set(ids.map((i) => i[0])).size, 5);
  const q = neuesProjekt('Q');
  assert.ok(!('return' in q.naechste_id), 'a new project has no return counter');
  q.returns = [ret(1)];
  assert.equal(neueId(q, 'return'), 'r2', 'the live id r1 is skipped');
  q.returns = [];
  assert.equal(neueId(q, 'return'), 'r3', 'the counter never reuses an id');
  assert.match(pruefeFehler({ ...neuesProjekt('R'), naechste_id: { return: 0 } }), /naechste_id\.return/);
});

test('slice 3 view: returns:[{id,nr}] only when there are returns; sends and hall values are not part of the view', () => {
  const m = mitReturn();
  assert.deepEqual(wiedergabeSicht(m).returns, [{ id: 'r1', nr: 1 }]);
  const anders = kopie(m);
  anders.spuren[0].sends = [{ id: 'r1', db: -20 }]; anders.returns[0].hall.decay = 0.9; anders.returns[0].fader_db = -8; anders.returns[0].name = 'x'; anders.returns[0].hall.an = false;
  assert.equal(kanonisch(wiedergabeSicht(anders)), kanonisch(wiedergabeSicht(m)), 'level and hall are controls, not playback');
  const ohne = kopie(m); delete ohne.returns; delete ohne.spuren[0].sends; delete ohne.gruppen[0].sends;
  assert.ok(!('returns' in wiedergabeSicht(ohne)), 'negative control: no returns, no key');
  assert.notEqual(kanonisch(wiedergabeSicht(ohne)), kanonisch(wiedergabeSicht(m)));
});

test('nested groups: a group target round-trips; a flat project stays byte-identical (file and both playback forms)', () => {
  const flach = pruefeProjekt(specProjekt()).projekt;
  const vorher = kanonisch(flach), sichtVorher = kanonisch(wiedergabeSicht(flach));
  assert.ok(!vorher.includes('"ausgang"'), 'a flat project file has no ausgang');
  const m = mitGruppe(); m.gruppen.push(gruppe(2));
  const bytesFlach = kanonisch(m);
  assert.ok(!bytesFlach.includes('"art":"master"'));
  m.gruppen[0].ausgang = { art: 'gruppe', id: 'g2' };
  assert.equal(pruefeFehler(m), null);
  assert.deepEqual(wiedergabeSicht(m).gruppen.map((g) => g.ausgang ?? null), ['g2', null]);
  assert.equal(kanonisch(pruefeProjekt(JSON.parse(kanonisch(m))).projekt), kanonisch(m), 'round trip');
  assert.equal(kanonisch(wiedergabeSicht(pruefeProjekt(specProjekt()).projekt)), sichtVorher);
});

test('nested groups: a loaded file whose stage key is a cycle or too late for its group tree is reported', () => {
  const baue = (ziel) => {
    const p = mitGruppe(); p.gruppen.push(gruppe(2));
    p.gruppen[0].inserts = [{ id: 'i1', art: 'komp', slot: 1, an: true, werte: insertVorgabe('komp'), key: { quelle: 'grp', nr: 2, punkt: 'pre' } }];
    if (ziel) p.gruppen[0].ausgang = { art: 'gruppe', id: ziel };
    return p;
  };
  const gut = pruefeProjekt(baue(null)); assert.equal(gut.fehler, undefined, JSON.stringify(gut));
  const e = pruefeFehler(baue('g2'));
  assert.match(e, /sidechain_zyklus/, e);
});
