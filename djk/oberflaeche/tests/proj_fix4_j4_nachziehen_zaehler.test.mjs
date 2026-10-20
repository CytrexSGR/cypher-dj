// D1 S2-Integration, vierte Fix-Runde J4 (Spec 6.35 zu 6.7 und 6.26, Nebenbefund N6, Probe I1 aus ~/messungen/2026-10-15-p118-spec/proben-3/e3_3.mts):
// Das Nachziehen aus dem Log hebt die Zähler über jede ID, die ein nachgezogener Eintrag vergeben hat. Die Zähler stehen in keinem Patch
// (patch.ts ZAEHLER); zieheNach wandte nur Patches an, und nach einem Absturz mit veraltetem project.json kam eine angelegte und wieder
// gelöschte ID zurück. Geprüft mit einer echten Log-Datei der Sitzung, nicht über wende.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjSitzung } from '../bereiche/proj/sitzung.ts';
import { pruefKontext } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const N = (beat) => ({ beat, laenge: 0.5, ton: 40, vel: 90 });
function ordner(t) {
  const d = tmpOrdner(t, 'djk-j4-');
  return { wurzel: path.join(d, 'p'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 };
}
const neueSitzung = (t, opt) => { const s = new ProjSitzung(pruefKontext(), opt); t.after(() => s.schliesse()); return s; };
async function schreiber(s) {
  let rev = 0;
  const ae = async (befehle) => { const r = await s.aendern({ rev, label: 'x', befehle }, 'andreas'); assert.equal(r.code, 200); rev = r.j.rev; return r.j.projekt; };
  const undo = async () => { const r = await s.umkehr('undo', { rev }, 'andreas'); assert.equal(r.code, 200); rev = r.j.rev; return r.j.projekt; };
  return { ae, undo };
}
// Stand A (rev 3): Spur s1, Clip c1, Noten n1 n2. Danach im Log: Note n3 an und weg, Clip c2 an und weg, Spur s2 an und per Undo weg.
async function lauf(t, { absturz, nurMixer = false }) {
  const opt = ordner(t);
  const s1 = neueSitzung(t, opt);
  const slug = (await s1.neu('N', 'andreas')).j.slug;
  const json = path.join(opt.wurzel, slug, 'project.json');
  const { ae, undo } = await schreiber(s1);
  await ae([{ befehl: 'spur_neu', art: 'instrument' }]);
  await ae([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4 }]);
  await ae([{ befehl: 'noten_neu', clip_id: 'c1', noten: [N(0), N(1)] }]);
  const standA = fs.readFileSync(json, 'utf8');
  if (nurMixer) {
    await ae([{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }]);
    await ae([{ befehl: 'spur_aendern', spur_id: 's1', pan: 0.25 }]);
  } else {
    await ae([{ befehl: 'noten_neu', clip_id: 'c1', noten: [N(2)] }]);
    await ae([{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n3'] }]);
    await ae([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 4, laenge_beats: 4 }]);
    await ae([{ befehl: 'clip_loeschen', clip_id: 'c2' }]);
    await ae([{ befehl: 'spur_neu', art: 'audio' }]);
    await undo();
  }
  s1.schliesse();
  if (absturz) fs.writeFileSync(json, standA);                       // Strom weg: die Platte hat nur Stand A behalten, das Log alles
  const vorher = JSON.parse(fs.readFileSync(json, 'utf8'));
  const s2 = neueSitzung(t, opt);
  const o = await s2.oeffnen(slug, 'andreas');
  assert.equal(o.code, 200);
  const z = { naechste_id: o.j.projekt.naechste_id, naechste_noten_id: o.j.projekt.naechste_noten_id, rev: o.j.projekt.rev };
  const gespeichert = JSON.parse(fs.readFileSync(json, 'utf8'));
  let rev = o.j.projekt.rev;
  const ae2 = async (befehle) => { const r = await s2.aendern({ rev, label: 'y', befehle }, 'andreas'); rev = r.j.rev; return r.j.projekt; };
  let p = await ae2([{ befehl: 'noten_neu', clip_id: 'c1', noten: [N(3)] }]);
  const note = p.spuren[0].clips[0].noten.at(-1).id;
  p = await ae2([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 8, laenge_beats: 4 }]);
  const clip = p.spuren[0].clips.at(-1).id;
  p = await ae2([{ befehl: 'spur_neu', art: 'audio' }]);
  const spur = p.spuren.at(-1).id;
  return { vorher_rev: vorher.rev, zaehler_offen: z, zaehler_gespeichert: { naechste_id: gespeichert.naechste_id, naechste_noten_id: gespeichert.naechste_noten_id }, neu: { note, clip, spur } };
}

test('J4 Probe I1 mit echter Log-Datei: angelegt, gelöscht, project.json veraltet, neu öffnen → die nächsten IDs sind neu', async (t) => {
  const r = await lauf(t, { absturz: true });
  console.log(`J4 absturz ${JSON.stringify(r)}`);
  assert.equal(r.vorher_rev, 3, 'project.json stand auf rev 3, das Log auf rev 9');
  assert.equal(r.zaehler_offen.rev, 9, 'nachgezogen bis rev 9');
  assert.deepEqual(r.neu, { note: 'n4', clip: 'c3', spur: 's3' }, 'keine ID aus dem Log kommt zurück (vorher: n3, c2, s2)');
  assert.deepEqual(r.zaehler_gespeichert, { naechste_id: { spur: 3, clip: 3 }, naechste_noten_id: 4 }, 'der nachgezogene Stand trägt die gehobenen Zähler');
});

test('J4 Negativ-Kontrolle ohne Absturz: dieselben IDs wie nach dem Nachziehen', async (t) => {
  const r = await lauf(t, { absturz: false });
  assert.equal(r.vorher_rev, 9);
  assert.deepEqual(r.neu, { note: 'n4', clip: 'c3', spur: 's3' });
});

test('J4 Negativ-Kontrolle: ein Log ohne neue IDs (nur Mixer) hebt keinen Zähler', async (t) => {
  const r = await lauf(t, { absturz: true, nurMixer: true });
  assert.equal(r.zaehler_offen.rev, 5);
  assert.deepEqual(r.zaehler_gespeichert, { naechste_id: { spur: 2, clip: 2 }, naechste_noten_id: 3 });
  assert.deepEqual(r.neu, { note: 'n3', clip: 'c2', spur: 's2' }, 'n3, c2, s2 gab es nie: sie sind frei');
});
