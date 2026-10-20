// D1 S2-Integration, vierte Fix-Runde J3 (Spec 6.35 zu 6.26, Nebenbefund N5, Probe B6 aus ~/messungen/2026-10-15-p118-spec/proben-3/e3_3.mts):
// Fehlen einem älteren Projekt die Zähler (naechste_id, naechste_noten_id), setzt sie schon das Öffnen auf das Maximum der vorhandenen IDs plus 1,
// nicht erst das erste Anlegen. Vorher rechnete neueId beim Anlegen mit den LEBENDEN IDs: war die höchste vorher gelöscht, kam ihre ID wieder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Projekte } from '../projekt/ablage.ts';
import { neuesProjekt, pruefeProjekt } from '../projekt/modell.ts';
import { sitzung } from './hilfen/proj_kontext.mjs';

const N = (id, beat) => ({ id, beat, laenge: 0.5, ton: 36, vel: 100 });
// Projekt aus der Zeit vor 6.26: zwei Spuren, ein MIDI-Clip mit zwei Noten, keine Zähler
function altProjekt(zaehler) {
  const p = neuesProjekt('Alt');
  delete p.naechste_id; delete p.naechste_noten_id;                                  // neuesProjekt führt sie seit 6.35, ein älteres nicht
  p.spuren = [
    { id: 's1', von: 'andreas', nr: 1, name: 'Bass', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} },
      fader_db: 0, pan: 0, mute: false, solo: false,
      clips: [{ id: 'c1', art: 'midi', name: 'b', start_beat: 0, laenge_beats: 4, noten: [N('n1', 0), N('n2', 1)] }] },
    { id: 's2', von: 'andreas', nr: 2, name: 'Audio 2', farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] },
  ];
  if (zaehler) { p.naechste_id = zaehler.id; p.naechste_noten_id = zaehler.noten; }
  return p;
}
async function oeffneAlt(t, zaehler) {
  const e = sitzung(t, { arrFristMs: 30 });
  const pr = new Projekte(e.wurzel);
  const { slug } = pr.lege('Alt');
  fs.writeFileSync(path.join(e.wurzel, slug, 'project.json'), JSON.stringify(altProjekt(zaehler)));   // so liegt ein älteres Projekt auf der Platte
  const o = await e.s.oeffnen(slug, 'andreas');
  assert.equal(o.code, 200);
  let rev = o.j.projekt.rev;
  const ae = async (befehle) => { const r = await e.s.aendern({ rev, label: 'x', befehle }, 'andreas'); rev = r.j.rev; return r.j.projekt; };
  return { ...e, slug, offen: o.j.projekt, ae };
}

test('J3 Probe B6: Projekt ohne Zähler öffnen, höchste Spur, Clip und Note löschen, neu anlegen → neue IDs (nicht s2, c1, n2)', async (t) => {
  const { offen, ae } = await oeffneAlt(t, null);
  console.log(`J3 offen ${JSON.stringify({ naechste_id: offen.naechste_id, naechste_noten_id: offen.naechste_noten_id })}`);
  await ae([{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n2'] }]);
  let p = await ae([{ befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 2, laenge: 0.5, ton: 40, vel: 90 }] }]);
  const note = p.spuren[0].clips[0].noten.at(-1).id;
  await ae([{ befehl: 'spur_loeschen', spur_id: 's2' }]);
  p = await ae([{ befehl: 'spur_neu', art: 'audio' }]);
  const spur = p.spuren.at(-1).id;
  await ae([{ befehl: 'clip_loeschen', clip_id: 'c1' }]);
  p = await ae([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4 }]);
  const clip = p.spuren[0].clips[0].id;
  console.log(`J3 B6 ${JSON.stringify({ note, spur, clip })}`);
  assert.deepEqual({ note, spur, clip }, { note: 'n3', spur: 's3', clip: 'c2' });
  assert.deepEqual(offen.naechste_id, { spur: 3, clip: 2 }, 'das Öffnen setzt naechste_id (Maximum plus 1)');
  assert.equal(offen.naechste_noten_id, 3, 'und den Noten-Zähler');
});

test('J3 Negativ-Kontrolle: vorhandene Zähler bleiben beim Öffnen stehen (höher als das Maximum plus 1, nie gesenkt)', async (t) => {
  const { offen, ae } = await oeffneAlt(t, { id: { spur: 9, clip: 7 }, noten: 12 });
  assert.deepEqual([offen.naechste_id, offen.naechste_noten_id], [{ spur: 9, clip: 7 }, 12]);
  const p = await ae([{ befehl: 'spur_neu', art: 'audio' }]);
  assert.equal(p.spuren.at(-1).id, 's9');
});

test('J3 pruefeProjekt: setzt fehlende Zähler, ein vorhandener Teil-Zähler bleibt, ein leeres Projekt beginnt bei 1', () => {
  const g = pruefeProjekt(altProjekt(null));
  assert.deepEqual([g.projekt.naechste_id, g.projekt.naechste_noten_id], [{ spur: 3, clip: 2 }, 3]);
  const teil = altProjekt(null); teil.naechste_id = { spur: 5 };
  assert.deepEqual(pruefeProjekt(teil).projekt.naechste_id, { spur: 5, clip: 2 }, 'nur der fehlende Teil kommt dazu');
  const ohne = neuesProjekt('Leer'); delete ohne.naechste_id; delete ohne.naechste_noten_id;
  const leer = pruefeProjekt(ohne).projekt;
  assert.deepEqual([leer.naechste_id, leer.naechste_noten_id], [{ spur: 1, clip: 1 }, 1]);
});
