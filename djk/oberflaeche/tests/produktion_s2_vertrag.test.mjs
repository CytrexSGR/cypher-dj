// PRODUCTION V2 Nachzug (Slice 0b, Punkt 7e): drei Annahmen der Seite, bestätigt am integrierten Baum gegen den echten S2-Code statt gegen
// die Attrappe: (1) das Undo-Label kommt roh mit dem S2-Präfix „Undo: “ und die Seite setzt kein eigenes davor, (2) clip_neu nimmt den
// Namen aus dem Library-Titel (ziehen.js clipName), (3) der Fehlerkörper hat die Form {fehler, text, index?}, die fehlerText liest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Projekte } from '../projekt/ablage.ts';
import { fuehreAus, BefehlFehler } from '../projekt/befehle.ts';
import { alsAntwort } from '../bereiche/proj/bereich.ts';
import { specProjekt } from './hilfen/projekt.mjs';
import { sitzung, pruefKontext } from './hilfen/proj_kontext.mjs';
import { undoStand, verlaufZeilen } from '../oeffentlich/produktion/verlauf.js';
import { nutzlast, ablageBefehl } from '../oeffentlich/produktion/ziehen.js';
import { fehlerText, FEHLER_TEXT } from '../oeffentlich/produktion/produktion.js';

test('V2 Vertrag S2: Undo-Label kommt roh mit „Undo: “, die Seite zeigt es unverändert, der Undo-Stand stimmt', async (t) => {
  const { s, wurzel } = sitzung(t, { arrFristMs: 30 });
  const pr = new Projekte(wurzel), { slug } = pr.lege('Vertrag');
  const p = specProjekt(); p.rev = 0; p.wiedergabe_rev = 0;
  pr.speichere(slug, p);
  const o = await s.oeffnen(slug, 'andreas');
  const a = await s.aendern({ rev: o.j.projekt.rev, label: 'Tempo 128', befehle: [{ befehl: 'tempo_setzen', bpm: 128 }] }, 'andreas');
  await s.umkehr('undo', { rev: a.j.rev }, 'andreas');
  const log = s.verlaufListe().j;
  const undo = log.find((e) => e.art === 'undo');
  assert.equal(undo.label, 'Undo: Tempo 128', 'S2 schreibt das Präfix selbst');
  assert.equal(verlaufZeilen(log).find((z) => z.art === 'undo').text, 'Undo: Tempo 128', 'kein „Undo: Undo: …“');
  assert.deepEqual([undoStand(log).undo, undoStand(log).redo?.label], [null, 'Tempo 128'], 'der Stand aus dem echten Log');
});

test('V2 Vertrag S2: clip_neu nimmt den Namen aus dem Library-Titel', () => {
  const p = specProjekt();
  const zeile = { typ: 'oneshot', sha: 'a'.repeat(64), name: 'Kick 909 Hard', pfad_da: true, dauer_s: 0.5 };
  const b = ablageBefehl(p, nutzlast(zeile), 0, 4, 1);
  const neu = fuehreAus(p, b.befehl).projekt;
  assert.equal(neu.spuren[0].clips.at(-1).name, 'Kick 909 Hard');
  const ohne = fuehreAus(p, { ...b.befehl, name: undefined, pfad_hinweis: '/x/snare_12.wav' }).projekt;
  assert.equal(ohne.spuren[0].clips.at(-1).name, 'snare_12', 'Negativ-Kontrolle: ohne Titel nimmt S2 den Dateinamen');
});

test('V2 Vertrag S2: Fehlerkörper {fehler, text, index?}, die Seite liest fehler', () => {
  let fehler;
  try { fuehreAus(specProjekt(), { befehl: 'clip_aendern', clip_id: 'c99', start_beat: 1 }); } catch (e) { fehler = e; }
  assert.ok(fehler instanceof BefehlFehler);
  const r = alsAntwort(fehler, pruefKontext());
  assert.deepEqual([r.code, r.j.fehler, typeof r.j.text], [404, 'clip_unbekannt', 'string']);
  assert.equal(fehlerText({ status: r.code, j: r.j }), FEHLER_TEXT.clip_unbekannt);
  const intern = alsAntwort(new Error('kaputt'), pruefKontext());
  assert.deepEqual([intern.code, intern.j.fehler], [500, 'intern']);
  assert.equal(fehlerText({ status: 500, j: intern.j }), 'The project server hit an internal error: nothing was changed');
});
