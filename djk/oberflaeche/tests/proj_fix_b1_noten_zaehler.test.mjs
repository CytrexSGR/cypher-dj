// D1 S2-Integration, Fix-Runde B1 (Spec 6.26, Nachsatz in 6.28, 6.30): der Noten-Zähler liegt im Projekt (naechste_noten_id, einer für alle
// Clips), nicht im Clip, und in keinem Patch. Ein Clip ist Teil der Undo-Patches: ein Redo, das einen Clip neu anlegt, brachte seinen Zählerstand
// von damals mit, und die nächste neue Note bekam eine schon vergebene ID. Fehlt der Zähler, gilt das Maximum aller Noten-IDs plus 1; alte
// Projekte mit Clip-Zählern werden beim Laden übernommen (Maximum). Eine ausdrücklich mitgegebene ID unter dem Zähler war schon vergeben: id_belegt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fuehreAus, BefehlFehler } from '../projekt/befehle.ts';
import { pruefeProjekt } from '../projekt/modell.ts';
import { Projekte } from '../projekt/ablage.ts';
import { Verlauf, rueckgaengig } from '../projekt/verlauf.ts';
import { specProjekt, kopie, tmpOrdner } from './hilfen/projekt.mjs';
import { sitzung } from './hilfen/proj_kontext.mjs';

const N = (beat) => ({ beat, laenge: 1, ton: 60, vel: 100 });
const clipVon = (p, i = 0) => p.spuren[0].clips[i];
const ids = (c) => c.noten.map((n) => n.id);
async function aufbau(t) {
  const { s, wurzel } = sitzung(t, { arrFristMs: 30 });
  await s.neu('I', 'andreas');
  let rev = 0;
  const ae = async (befehle) => { const r = await s.aendern({ rev, label: 'x', befehle }, 'andreas'); rev = r.j.rev; return r.j.projekt; };
  const um = async (art) => { const r = await s.umkehr(art, { rev }, 'andreas'); rev = r.j.rev; return r.j.projekt; };
  const grund = async (befehle) => { try { await ae(befehle); return null; } catch (e) { return e.grund ?? e.fehler; } };
  return { s, ae, um, grund, wurzel };
}

test('B1 Spec 6.28: Clip anlegen, Noten anlegen, bis vor das Anlegen rückgängig, alles wiederholen, neue Note → neue ID', async (t) => {
  const { ae, um } = await aufbau(t);
  await ae([{ befehl: 'spur_neu', art: 'instrument' }]);
  let p = await ae([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4 }]);
  const cid = clipVon(p).id;
  p = await ae([{ befehl: 'noten_neu', clip_id: cid, noten: [N(0), N(1)] }]);
  p = await ae([{ befehl: 'noten_neu', clip_id: cid, noten: [N(2)] }]);
  const vergeben = ids(clipVon(p));
  assert.deepEqual(vergeben, ['n1', 'n2', 'n3']);
  for (let i = 0; i < 3; i++) p = await um('undo');
  assert.equal(p.spuren[0].clips.length, 0, 'bis vor das Anlegen des Clips');
  for (let i = 0; i < 3; i++) p = await um('redo');
  assert.deepEqual(ids(clipVon(p)), vergeben);
  p = await ae([{ befehl: 'noten_neu', clip_id: cid, noten: [N(3)] }]);
  const neu = ids(clipVon(p)).at(-1);
  assert.ok(!vergeben.includes(neu), `neue Note ${neu} hat eine schon vergebene ID (${vergeben})`);
  assert.equal(neu, 'n4');
  assert.equal(p.naechste_noten_id, 5, 'der Zähler steht im Projekt');
  assert.ok(p.spuren.every((s) => s.clips.every((c) => !('naechste_noten_id' in c))), 'kein Zähler im Clip');
});

test('B1 Review p8 b: Redo über die Clip-Anlage (5 Noten, n5 gelöscht, 3x undo, 3x redo) → die neue Note ist nicht n5', async (t) => {
  const { ae, um } = await aufbau(t);
  await ae([{ befehl: 'spur_neu', art: 'instrument' }]);
  let p = await ae([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4 }]);
  const cid = clipVon(p).id;
  await ae([{ befehl: 'noten_neu', clip_id: cid, noten: [N(0), N(0.5), N(1), N(1.5), N(2)] }]);
  await ae([{ befehl: 'noten_loeschen', clip_id: cid, ids: ['n5'] }]);
  for (let i = 0; i < 3; i++) await um('undo');
  for (let i = 0; i < 3; i++) await um('redo');
  p = await ae([{ befehl: 'noten_neu', clip_id: cid, noten: [N(3)] }]);
  assert.deepEqual(ids(clipVon(p)), ['n1', 'n2', 'n3', 'n4', 'n6']);
});

test('B1 Review p8 a: ausdrückliche ID einer gelöschten Note → id_belegt; auch eine ID unter dem Zähler aus einem anderen Clip', async (t) => {
  const { ae, grund, s } = await aufbau(t);
  await ae([{ befehl: 'spur_neu', art: 'instrument' }]);
  let p = await ae([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [N(0), N(1)] }]);
  const cid = clipVon(p).id;
  await ae([{ befehl: 'noten_loeschen', clip_id: cid, ids: ['n2'] }]);
  assert.equal(await grund([{ befehl: 'noten_neu', clip_id: cid, noten: [{ id: 'n2', ...N(2) }] }]), 'id_belegt');
  p = await ae([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 8, laenge_beats: 4 }]);
  const zweiter = clipVon(p, 1).id;
  assert.equal(await grund([{ befehl: 'noten_neu', clip_id: zweiter, noten: [{ id: 'n1', ...N(0) }] }]), 'id_belegt', 'n1 ist projektweit vergeben');
  assert.equal(s.aktuell().j.projekt.rev, 4, 'abgelehnt: nichts gespeichert');
});

test('B1 Negativ-Kontrolle: löschen und neu ohne Undo, eine frische ausdrückliche ID über dem Zähler geht durch und hebt ihn', async (t) => {
  const { ae } = await aufbau(t);
  await ae([{ befehl: 'spur_neu', art: 'instrument' }]);
  let p = await ae([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [N(0), N(1)] }]);
  const cid = clipVon(p).id;
  await ae([{ befehl: 'noten_loeschen', clip_id: cid, ids: ['n2'] }]);
  p = await ae([{ befehl: 'noten_neu', clip_id: cid, noten: [N(2)] }]);
  assert.deepEqual(ids(clipVon(p)), ['n1', 'n3']);
  p = await ae([{ befehl: 'noten_neu', clip_id: cid, noten: [{ id: 'n10', ...N(3) }, { id: 'kick', ...N(3.5) }, N(4)] }]);
  assert.deepEqual(ids(clipVon(p)), ['n1', 'n3', 'n10', 'kick', 'n11']);
  assert.equal(p.naechste_noten_id, 12);
});

test('B1 einer für alle Clips: die Nummern laufen über Clips weiter, der Zähler steht in keinem Patch', () => {
  const p = specProjekt();                                                       // c2 trägt n1, kein Zähler
  const a = fuehreAus(p, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 16, laenge_beats: 4, noten: [N(0)] });
  assert.equal(a.projekt.spuren[1].clips[1].noten[0].id, 'n2', 'fehlt der Zähler: Maximum aller Noten-IDs plus 1');
  const b = fuehreAus(a.projekt, { befehl: 'noten_neu', clip_id: 'c2', noten: [N(1)] });
  assert.equal(b.projekt.spuren[1].clips[0].noten[1].id, 'n3');
  assert.equal(b.projekt.naechste_noten_id, 4);
  for (const r of [a, b]) assert.ok(!JSON.stringify([r.vor, r.zurueck]).includes('naechste'), JSON.stringify(r.vor));
  const t1 = fuehreAus(b.projekt, { befehl: 'clip_teilen', clip_id: 'c2', beat: 0.25 });   // n1 (0..0.5) wird geteilt: der Rest bekommt eine neue ID
  assert.deepEqual(t1.projekt.spuren[1].clips[1].noten.map((n) => n.id), ['n3', 'n4']);
  assert.equal(t1.projekt.naechste_noten_id, 5);
});

test('B1 alte Projekte: Clip-Zähler werden beim Laden übernommen (Maximum), danach steht kein Zähler mehr im Clip', (t) => {
  const alt = specProjekt();
  alt.spuren[1].clips[0].naechste_noten_id = 9;                                  // Stand des ersten S2int-Baus: Zähler am Clip
  const g = pruefeProjekt(alt);
  assert.ok('projekt' in g, g.fehler);
  assert.equal(g.projekt.naechste_noten_id, 9);
  assert.ok(!('naechste_noten_id' in g.projekt.spuren[1].clips[0]));
  const r = fuehreAus(g.projekt, { befehl: 'noten_neu', clip_id: 'c2', noten: [N(1)] });
  assert.equal(r.projekt.spuren[1].clips[0].noten[1].id, 'n9');
  const hoch = specProjekt(); hoch.naechste_noten_id = 4; hoch.spuren[1].clips[0].naechste_noten_id = 2;
  assert.equal(pruefeProjekt(hoch).projekt.naechste_noten_id, 4, 'der höhere gewinnt (Projekt)');
  const noten = specProjekt(); noten.spuren[1].clips[0].noten[0].id = 'n7'; noten.spuren[1].clips[0].naechste_noten_id = 3;
  assert.equal(pruefeProjekt(noten).projekt.naechste_noten_id, 8, 'der höhere gewinnt (Noten-IDs)');
  // über die Ablage: Datei mit Clip-Zähler öffnen
  const w = tmpOrdner(t), pr = new Projekte(w), { slug } = pr.lege('Alt');
  fs.writeFileSync(path.join(w, slug, 'project.json'), JSON.stringify(alt));
  const o = pr.oeffne(slug, { zeitgeber: false });
  t.after(() => o.verlauf.schliesse());
  assert.equal(o.projekt.naechste_noten_id, 9);
});

test('B1 die Datei prüft den Projekt-Zähler (ganze Zahl ab 1)', () => {
  for (const w of [0, 'x', 2.5, null]) {
    const x = kopie(specProjekt()); x.naechste_noten_id = w;
    const g = pruefeProjekt(x);
    assert.match(g.fehler ?? '', /naechste_noten_id/, String(w));
  }
  const ok = kopie(specProjekt()); ok.naechste_noten_id = 3;
  assert.ok('projekt' in pruefeProjekt(ok));
});

test('B1 BefehlFehler am reinen Befehl: ausdrückliche ID unter dem Zähler', () => {
  const p = specProjekt(); p.naechste_noten_id = 5;
  assert.throws(() => fuehreAus(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'n4', ...N(1) }] }), (e) => e instanceof BefehlFehler && e.grund === 'id_belegt');
  assert.equal(fuehreAus(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'n5', ...N(1) }] }).projekt.naechste_noten_id, 6);
});

test('B1 Undo aus einem Log des ersten S2int-Baus: ein Clip mit Clip-Zähler kommt zurück → der Zähler geht ins Projekt (Maximum)', (t) => {
  const p = specProjekt(); p.rev = 18; p.naechste_noten_id = 2;                  // c2 trägt n1
  const clip = { id: 'c9', art: 'midi', name: 'alt', start_beat: 20, laenge_beats: 4, naechste_noten_id: 7, noten: [{ id: 'n6', beat: 0, laenge: 1, ton: 40, vel: 90 }] };
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { zeitgeber: false });
  t.after(() => v.schliesse());
  v.haengeAn({ rev: 18, quelle: 'andreas', label: 'Clip weg', vor: [{ op: 'remove', pfad: '/spuren/s2/clips/c9' }],
    zurueck: [{ op: 'add', pfad: '/spuren/s2/clips/c9', wert: clip, index: 1 }] });
  const u = rueckgaengig(v, p, { quelle: 'andreas' });
  assert.equal(u.projekt.naechste_noten_id, 7);
  assert.ok(!('naechste_noten_id' in u.projekt.spuren[1].clips[1]));
  assert.equal(fuehreAus(u.projekt, { befehl: 'noten_neu', clip_id: 'c2', noten: [N(1)] }).projekt.spuren[1].clips[0].noten[1].id, 'n7');
});
