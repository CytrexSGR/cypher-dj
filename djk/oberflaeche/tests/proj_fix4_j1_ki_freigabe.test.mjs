// D1 S2-Integration, vierte Fix-Runde J1 (Spec 6.35, Nebenbefund N4; Andreas 16.10.: „Zurück, über 4 Beats“): Nach der KI-Freigabe fahren die
// Spuren, die der Stopp gesenkt hat (Cyphers Spuren, Maske aus dem Feld von), über 4 Beats auf ihren Fader-Wert im Projekt zurück, Quelle andreas
// (Spiegel des Stopps). Ein Wiederanlauf nach 6.21 schreibt die Absenkung einer gestoppten Spur nie ins Projekt, auch nicht nach der Freigabe.
// Gemessen vor dem Bau (~/messungen/2026-10-15-d1-s2-integration/fix4/probe_ki_frei.txt, probe_attrappe_ki_frei.json): Kern und Attrappe melden
// bei der Freigabe nur /e/ki 0 (mit Sample), die Fader bleiben bei −200. Eine Rückfahrt (Dauer 4) wird angenommen, solange sie die Ausblende des
// Stopps nicht überlappt; ab jetzt während der Ausblende lehnen beide mit ueberlappung ab, ab deren Ende nimmt der Kern sie an.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sitzung, neustart, arrNr, ist, warteBis } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';
import { Oberflaeche } from '../server.ts';

const SR = 48000;
const uhr = (s, beat, bpm = 120) => s.ereignis('/uhr', { beat, bpm, sample: Math.round(beat * 60 / bpm * SR) });
const ki = (z, gestoppt, beat, bpm = 120) => { z.k.ki = gestoppt === 1; z.s.ereignis('/e/ki', { gestoppt, grund: gestoppt ? 'ki_stopp' : 'frei', sample: Math.round(beat * 60 / bpm * SR) }); };
// Projekt: s1 von andreas (Slot 1), s2 von cypher (Slot 2) mit Fader −3
async function aufbau(t, opt = {}) {
  const z = sitzung(t, { arrFristMs: 30, ...opt });
  await z.s.neu('Frei', 'andreas');
  let r = await z.s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  r = await z.s.aendern({ rev: r.j.rev, label: 'c', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'cypher');
  r = await z.s.aendern({ rev: r.j.rev, label: 'f', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -3 }] }, 'andreas');
  assert.equal(r.j.projekt.spuren[1].von, 'cypher');
  return z;
}
const rueck = (z) => z.k.teile(/^spur\/\d\/fader$/).map((x) => ({ pfad: x.felder.pfad, ab: x.felder.ab_beat, dauer: x.felder.dauer_beats, nach: x.felder.nach, quelle: x.felder.quelle }));

test('J1 Freigabe während der Ausblende: Cyphers Spur fährt über 4 Beats auf ihren Projektwert, ab dem Ende der Ausblende; Andreas\' Spur nicht', async (t) => {
  const z = await aufbau(t);
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 101); z.k.leere(); ki(z, 0, 101);
  assert.ok(await warteBis(() => rueck(z).length > 0, 1000), 'eine Rückfahrt wurde gesendet');
  await warte(30);
  const r = rueck(z);
  console.log(`J1 waehrend ${JSON.stringify(r)}`);
  assert.equal(r.length, 1);
  assert.deepEqual({ ...r[0], ab: undefined }, { pfad: 'spur/2/fader', ab: undefined, dauer: 4, nach: -3, quelle: 'andreas' });
  assert.ok(r[0].ab >= 104 && r[0].ab < 104.5, `ab ${r[0].ab}: frühestens am Ende der Ausblende (Stopp bei Beat 100 plus 4)`);
});

test('J1 Freigabe nach der Ausblende: Rückfahrt ab jetzt', async (t) => {
  const z = await aufbau(t);
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 130); z.k.leere(); ki(z, 0, 130);
  assert.ok(await warteBis(() => rueck(z).length > 0, 1000));
  const r = rueck(z);
  assert.equal(r.length, 1);
  assert.ok(r[0].ab >= 130 && r[0].ab < 131, `ab ${r[0].ab}`);
});

test('J1 Stopp-Beat unbekannt (Stopp nur aus /zustand/kern) und Kern lehnt mit ueberlappung ab: ein zweiter Versuch nach dem spätesten Ende der Ausblende', async (t) => {
  const z = await aufbau(t);
  let erst = true;
  const regel = z.k.regel;
  z.k.regel = (adr, f) => (adr === '/k/teil' && f.pfad === 'spur/2/fader' && f.dauer_beats === 4 && erst ? ((erst = false), { status: 6, grund: 'ueberlappung' }) : regel(adr, f));
  uhr(z.s, 200); z.k.ki = true; z.s.ereignis('/zustand/kern', { ki_gestoppt: 1 });
  uhr(z.s, 201); z.k.leere(); z.k.ki = false; z.s.ereignis('/e/ki', { gestoppt: 0, grund: 'frei', sample: 0 });
  assert.ok(await warteBis(() => rueck(z).length > 1, 1000), 'zweiter Versuch');
  const r = rueck(z);
  console.log(`J1 ueberlappung ${JSON.stringify(r)}`);
  assert.equal(r.length, 2);
  assert.ok(r[0].ab < 202 && r[1].ab >= 205, `erst ab jetzt (${r[0].ab}), dann nach dem spätesten Ende (${r[1].ab})`);
});

test('J1 Negativ-Kontrollen: ohne Freigabe keine Rückfahrt; /e/ki 0 ohne vorherigen Stopp nichts; ohne Cyphers Spuren nichts', async (t) => {
  const z = await aufbau(t);
  uhr(z.s, 100); z.k.leere(); ki(z, 1, 100);
  await warte(50);
  assert.equal(rueck(z).length, 0, 'nur Stopp');
  const y = await aufbau(t);
  uhr(y.s, 100); y.s.ereignis('/zustand/kern', { ki_gestoppt: 0 }); y.k.leere(); ki(y, 0, 100);
  await warte(50);
  assert.equal(rueck(y).length, 0, 'Freigabe ohne Stopp');
  const x = sitzung(t, { arrFristMs: 30 });
  await x.s.neu('Nur', 'andreas');
  await x.s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  uhr(x.s, 100); ki(x, 1, 100); uhr(x.s, 110); x.k.leere(); ki(x, 0, 110);
  await warte(50);
  assert.equal(rueck(x).length, 0, 'keine Spur von cypher');
});

test('J1 Wiederanlauf ohne Stopp, Fader einer Cypher-Spur im Kern stumm (Freigabe ohne Server): nicht ins Projekt; Andreas\' stummer Fader schon', async (t) => {
  const { e, z, nr } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(nr));
  ist(z.s, 'spur/1/fader', -200); ist(z.s, 'spur/2/fader', -200);
  const r = await z.s.oeffnen('wa', 'andreas');
  assert.equal(r.j.kern.wiederanlauf, true);
  const sp = r.j.projekt.spuren;
  console.log(`J1 wiederanlauf ${JSON.stringify({ andreas: sp[0].fader_db, cypher: sp[1].fader_db, uebernommen: r.j.kern.mixer_uebernommen })}`);
  assert.equal(sp[1].fader_db, 0, 'die Absenkung der Cypher-Spur kommt nicht ins Projekt');
  assert.equal(sp[0].fader_db, -200, 'Negativ-Kontrolle: Andreas\' Spur ist keine Absenkung des Stopps, ihr Wert wird übernommen');
  assert.equal(JSON.parse(fs.readFileSync(path.join(e.wurzel, 'wa', 'project.json'), 'utf8')).spuren[1].fader_db, 0);
});

// Am Stapel mit der Kern-Attrappe: Stopp, Freigabe, Rückfahrt im Kern gemessen. Dann (Fix5 K5) ein zweiter Stopp, Server-Neustart, die Freigabe
// kommt, während der neue Server noch kein Projekt offen hat: Cyphers Fader steht im Kern stumm, ohne Stopp. Öffnen mit gleicher Nummer
// (Wiederanlauf 6.21) → project.json unverändert; ohne den Schutz in uebernimmMixer stünde dort −200 (Mutation MA, Re-Review Fix4).
// Der neue Server meldet sich nach dem Ende der Abonnenten-Frist (5 s) und bekommt den Regler-Stand des Kerns (Hallo-Stand, wie netz.cpp).
test('J1 Stapel: Stopp, Freigabe → Fader zurück auf den Projektwert (Rampe); Stopp, Server-Neustart, Freigabe ohne offenes Projekt, Wiederanlauf → project.json unverändert', async (t) => {
  const st = await stapel(t);
  const { o, url } = st;
  const slug = (await ruf(url, 'POST', '/proj/neu', { name: 'Frei' })).j.slug;
  let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Andreas', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }] });
  assert.equal(r.code, 200);
  const wert = (x, pfad) => innen(x).stand.regler[pfad];
  assert.ok(await bis(() => wert(o, 'spur/1/fader') === -3), 'Cyphers Spur steht auf −3');
  const verlauf = [];
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/e/regler' && d.felder.pfad === 'spur/1/fader') verlauf.push(Number(d.felder.wert)); alt(d); };
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert(o, 'spur/1/fader') === -200, 4000), 'die Ausblende ist durch');
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  const zurueck = await bis(() => wert(o, 'spur/1/fader') === -3, 4000);
  const zwischen = verlauf.filter((w) => w > -60.5 && w < -3.5).length;
  console.log(`J1 stapel ${JSON.stringify({ zurueck, ende: wert(o, 'spur/1/fader'), zwischenwerte: zwischen, andreas: wert(o, 'spur/2/fader') })}`);
  assert.ok(zurueck, 'nach der Freigabe klingt Cyphers Spur wieder mit dem Projektwert');
  assert.ok(zwischen >= 3, 'über eine Rampe, nicht als Sprung');
  assert.equal(wert(o, 'spur/2/fader'), 0, 'Andreas\' Spur war nie gesenkt');
  const datei = path.join(st.optionen.proj.wurzel, slug, 'project.json');
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert(o, 'spur/1/fader') === -200, 4000), 'zweiter Stopp: die Ausblende ist durch');
  const vorher = fs.readFileSync(datei, 'utf8');
  assert.equal(JSON.parse(vorher).spuren[0].fader_db, -3, 'im Projekt steht Cyphers Fader auf −3');
  await o.stoppe();
  await warte(5600);                                                   // Abonnenten-Frist des Kerns: der neue Server ist ein neuer Abonnent
  const o2 = new Oberflaeche(st.optionen);
  t.after(() => o2.stoppe());
  await o2.starte();
  assert.ok(await bis(() => o2.kern.zustand === 'verbunden', 3000));
  assert.ok(await bis(() => wert(o2, 'spur/1/fader') === -200 && innen(o2).kiGestoppt === true, 3000), 'der neue Server kennt Fader und Stopp des Kerns');
  const ctx2 = o2.bereichKontext();
  await ctx2.warteQuittung(ctx2.sende('/k/ki/frei', { quelle: 'andreas' }));   // Freigabe, während kein Projekt offen ist
  assert.ok(await bis(() => innen(o2).kiGestoppt === false, 2000), 'die Freigabe ist beim Server angekommen');
  const beimOeffnen = wert(o2, 'spur/1/fader');
  const neu = await ruf(url, 'POST', '/proj/oeffnen', { slug });
  console.log(`J1 stapel neustart ${JSON.stringify({ code: neu.code, kern: neu.j.kern, beim_oeffnen: beimOeffnen, projekt: neu.j.projekt?.spuren?.[0]?.fader_db })}`);
  assert.equal(beimOeffnen, -200, 'beim Öffnen steht Cyphers Fader im Kern stumm, ohne Stopp (sonst wäre der Test leer)');
  assert.equal(neu.code, 200);
  assert.equal(neu.j.kern.wiederanlauf, true, 'gleiche Nummer: Wiederanlauf nach 6.21');
  assert.equal(neu.j.projekt.spuren[0].fader_db, -3, 'die Absenkung kommt nicht ins Projekt');
  assert.equal(fs.readFileSync(datei, 'utf8'), vorher, 'project.json unverändert');
});
