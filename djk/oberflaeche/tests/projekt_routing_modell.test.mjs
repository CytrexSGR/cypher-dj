// 1.10 Slice 1: Projektmodell /2 (gruppen, master, Spur.ausgang), Migration von /1, Sicht der Wiedergabe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FORMAT, MAX_GRUPPEN, neuesProjekt, pruefeProjekt, pruefeFehler, kanonisch, wiedergabeSicht, spurSicht } from '../projekt/modell.ts';
import { Projekte } from '../projekt/ablage.ts';
import { specProjekt, kopie, tmpOrdner } from './hilfen/projekt.mjs';

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
  const zwei = kopie(specProjekt()); zwei.format = 'cypherdj-projekt/2';   // /2 ohne gruppen und master (altes Literal aus projekt_modell.test.mjs:25)
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
  schlecht((p) => { p.gruppen[0].ausgang = { art: 'master' }; }, /unbekanntes Feld/);                     // Tiefe 1: Gruppen haben (noch) kein Ziel
  schlecht((p) => { p.master.extra = 1; }, /unbekanntes Feld/);
  schlecht((p) => { p.master.fader_db = -201; }, /fader_db/);
  schlecht((p) => { p.gruppen = Array.from({ length: MAX_GRUPPEN + 1 }, (_, i) => gruppe(i + 1)); }, /gruppen|nr/);
  // Negativ-Kontrolle: acht Gruppen, 32 Spuren verteilt, werden angenommen
  const p = pruefeProjekt(specProjekt()).projekt;
  p.gruppen = Array.from({ length: MAX_GRUPPEN }, (_, i) => gruppe(i + 1));
  p.spuren[0].ausgang = { art: 'gruppe', id: 'g8' };
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
