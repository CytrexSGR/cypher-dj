// D1 S2-Integration, fünfte Fix-Runde K3 (Spec 6.36): Kommt die KI-Freigabe, während kein Projekt offen ist oder kein Server läuft, verfiel sie
// still: Cyphers Spur blieb im Kern stumm, das Projekt zeigte ihren Wert. Jetzt fährt der Server beim nächsten Öffnen oder Wiederanlauf die
// Cypher-Spuren, die im Kern stumm stehen, obwohl kein Stopp gilt, über 4 Beats auf ihren Projektwert (die Rückfahrt aus K1, Plan ki_rueck).
// Eine Spur, deren Fader auch im Projekt stumm steht, bleibt stumm; während eines Stopps bleibt jede Cypher-Spur stumm.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sitzung, neustart, arrNr, ist } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';
import { Oberflaeche } from '../server.ts';

const kiStand = (z, gestoppt) => { z.k.ki = gestoppt === 1; z.s.ereignis('/zustand/kern', { ki_gestoppt: gestoppt }); };
const fader = (z, nr) => z.k.teile(new RegExp(`^spur/${nr}/fader$`)).map((x) => ({ nach: x.felder.nach, dauer: x.felder.dauer_beats, plan: x.felder.plan, quelle: x.felder.quelle }));

// --- Einheit: Wiederanlauf (gleiche Nummer) ------------------------------------------------------------------------------------------------
test('K3 Einheit Wiederanlauf: Cyphers Fader im Kern stumm, kein Stopp → Rückfahrt über 4 Beats auf den Projektwert; Projekt unverändert', async (t) => {
  const { e, z, nr } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(nr)); kiStand(z, 0);
  ist(z.s, 'spur/1/fader', 0); ist(z.s, 'spur/2/fader', -200);
  const r = await z.s.oeffnen('wa', 'andreas');
  console.log(`K3 wiederanlauf ${JSON.stringify({ wiederanlauf: r.j.kern.wiederanlauf, s2: fader(z, 2), s1: fader(z, 1), projekt: r.j.projekt.spuren.map((s) => s.fader_db) })}`);
  assert.equal(r.j.kern.wiederanlauf, true);
  assert.deepEqual(fader(z, 2), [{ nach: 0, dauer: 4, plan: 'ki_rueck', quelle: 'andreas' }]);
  assert.deepEqual(fader(z, 1), [], 'Andreas\' Spur: nichts');
  assert.equal(JSON.parse(fs.readFileSync(path.join(e.wurzel, 'wa', 'project.json'), 'utf8')).spuren[1].fader_db, 0, 'Projekt unverändert');
});

test('K3 Einheit Wiederanlauf, Negativ-Kontrollen: im Stopp, Projektwert stumm, Kern nicht stumm, Stopp-Stand unbekannt → keine Rückfahrt', async (t) => {
  const fall = async (vor) => {
    const { z, nr } = neustart(t);
    z.s.ereignis('/zustand/arr', arrNr(nr));
    ist(z.s, 'spur/1/fader', 0); ist(z.s, 'spur/2/fader', -200);
    vor(z);
    await z.s.oeffnen('wa', 'andreas');
    return fader(z, 2);
  };
  assert.deepEqual(await fall((z) => kiStand(z, 1)), [], 'während eines Stopps bleibt sie stumm');
  assert.deepEqual(await fall((z) => { kiStand(z, 0); ist(z.s, 'spur/2/fader', -50); }), [], 'Kern nicht stumm: keine Rückfahrt');
  assert.deepEqual(await fall(() => {}), [], 'Stopp-Stand unbekannt (kein /zustand/kern, kein /e/ki): sichere Richtung, stumm');
  const { z, nr, e } = neustart(t);
  const pr = path.join(e.wurzel, 'wa', 'project.json');
  const p = JSON.parse(fs.readFileSync(pr, 'utf8')); p.spuren[1].fader_db = -200; fs.writeFileSync(pr, JSON.stringify(p));
  z.s.ereignis('/zustand/arr', arrNr(nr)); kiStand(z, 0);
  ist(z.s, 'spur/1/fader', 0); ist(z.s, 'spur/2/fader', -200);
  await z.s.oeffnen('wa', 'andreas');
  assert.deepEqual(fader(z, 2), [], 'im Projekt stumm: bleibt stumm');
});

// --- Einheit: Öffnen (andere Nummer, das Projekt gewinnt) -------------------------------------------------------------------------------
test('K3 Einheit Öffnen: Cyphers Fader im Kern stumm, kein Stopp → Rückfahrt über 4 Beats statt Sprung; Andreas\' Spur gesetzt wie bisher', async (t) => {
  const { z } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(99)); kiStand(z, 0);
  ist(z.s, 'spur/1/fader', -200); ist(z.s, 'spur/2/fader', -200);
  const r = await z.s.oeffnen('wa', 'andreas');
  console.log(`K3 oeffnen ${JSON.stringify({ wiederanlauf: r.j.kern.wiederanlauf ?? false, s2: fader(z, 2), s1: fader(z, 1) })}`);
  assert.notEqual(r.j.kern.wiederanlauf, true);
  assert.deepEqual(fader(z, 2), [{ nach: 0, dauer: 4, plan: 'ki_rueck', quelle: 'andreas' }], 'Rückfahrt, kein Setzen');
  assert.deepEqual(fader(z, 1).map((f) => [f.nach, f.dauer]), [[0, 0]], 'Andreas\' Spur: Setzen wie bisher');
});

test('K3 Einheit Öffnen, Negativ-Kontrollen: im Stopp bleibt Cyphers Spur stumm; Kern nicht stumm → Setzen wie bisher', async (t) => {
  const { z } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(99)); kiStand(z, 1);
  ist(z.s, 'spur/1/fader', -200); ist(z.s, 'spur/2/fader', -200);
  await z.s.oeffnen('wa', 'andreas');
  console.log(`K3 oeffnen stopp ${JSON.stringify({ s2: fader(z, 2), s1: fader(z, 1) })}`);
  assert.ok(fader(z, 2).every((f) => f.nach <= -120), `im Stopp nie hörbar: ${JSON.stringify(fader(z, 2))}`);
  assert.deepEqual(fader(z, 1).map((f) => [f.nach, f.dauer]), [[0, 0]]);
  const { z: y } = neustart(t);
  y.s.ereignis('/zustand/arr', arrNr(99)); kiStand(y, 0);
  ist(y.s, 'spur/2/fader', -6);
  await y.s.oeffnen('wa', 'andreas');
  assert.deepEqual(fader(y, 2).map((f) => [f.nach, f.dauer]), [[0, 0]], 'Kern nicht stumm: Setzen');
});

// --- Stapel mit der Kern-Attrappe -----------------------------------------------------------------------------------------------------
// Zwei Projekte, je eine Spur von Cypher auf Slot 1 mit Fader −3; zuletzt ist A offen. KI-Stopp, die Ausblende senkt spur/1/fader auf −200.
async function zweiProjekte(t) {
  const st = await stapel(t);
  const { o, url } = st;
  const projekt = async (name) => {
    const slug = (await ruf(url, 'POST', '/proj/neu', { name })).j.slug;
    let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
    r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }] });
    assert.equal(r.code, 200);
    return slug;
  };
  const b = await projekt('Bravo');
  const a = await projekt('Alpha');
  const wert = (x, pfad) => innen(x).stand.regler[pfad];
  assert.ok(await bis(() => wert(o, 'spur/1/fader') === -3), 'Cyphers Spur auf −3');
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert(o, 'spur/1/fader') === -200, 4000), 'Ausblende durch');
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  return { ...st, a, b, wert, ctx, bpm };
}
// Server-Neustart (nach der Abonnenten-Frist, damit der neue Server den Regler-Stand bekommt), dann Freigabe über den neuen Server, kein Projekt offen
async function neustartUndFreigabe(t, st) {
  await st.o.stoppe();
  await warte(5600);
  const o2 = new Oberflaeche(st.optionen);
  t.after(() => o2.stoppe());
  await o2.starte();
  assert.ok(await bis(() => o2.kern.zustand === 'verbunden', 3000));
  assert.ok(await bis(() => st.wert(o2, 'spur/1/fader') === -200 && innen(o2).kiGestoppt === true, 3000), 'neuer Server kennt Fader und Stopp');
  const ctx2 = o2.bereichKontext();
  await ctx2.warteQuittung(ctx2.sende('/k/ki/frei', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(o2).kiGestoppt === false, 2000));
  const verlauf = [];
  const alt = o2.vomKern.bind(o2);
  o2.vomKern = (d) => { if (d.adresse === '/e/regler' && d.felder.pfad === 'spur/1/fader') verlauf.push(Number(d.felder.wert)); alt(d); };
  return { o2, verlauf };
}

test('K3 Stapel Wiederanlauf: Freigabe ohne offenes Projekt, dann Öffnen mit gleicher Nummer → Cyphers Spur fährt zurück auf −3; Projekt unverändert', async (t) => {
  const st = await zweiProjekte(t);
  const datei = path.join(st.optionen.proj.wurzel, st.a, 'project.json');
  const vorher = fs.readFileSync(datei, 'utf8');
  const { o2, verlauf } = await neustartUndFreigabe(t, st);
  const r = await ruf(st.url, 'POST', '/proj/oeffnen', { slug: st.a });
  const zurueck = await bis(() => st.wert(o2, 'spur/1/fader') === -3, 4000);
  const zwischen = verlauf.filter((w) => w > -60.5 && w < -3.5).length;
  console.log(`K3 stapel wiederanlauf ${JSON.stringify({ code: r.code, wiederanlauf: r.j.kern?.wiederanlauf, ende: st.wert(o2, 'spur/1/fader'), zwischenwerte: zwischen })}`);
  assert.equal(r.j.kern.wiederanlauf, true);
  assert.ok(zurueck, 'die Spur klingt wieder mit dem Projektwert');
  assert.ok(zwischen >= 3, 'über eine Rampe');
  assert.equal(fs.readFileSync(datei, 'utf8'), vorher, 'project.json unverändert');
});

test('K3 Stapel Öffnen: Freigabe ohne offenes Projekt, dann ein anderes Projekt öffnen → Cyphers Spur fährt über 4 Beats auf −3, kein Sprung', async (t) => {
  const st = await zweiProjekte(t);
  const { o2, verlauf } = await neustartUndFreigabe(t, st);
  const r = await ruf(st.url, 'POST', '/proj/oeffnen', { slug: st.b });
  const zurueck = await bis(() => st.wert(o2, 'spur/1/fader') === -3, 4000);
  const zwischen = verlauf.filter((w) => w > -60.5 && w < -3.5).length;
  console.log(`K3 stapel oeffnen ${JSON.stringify({ code: r.code, wiederanlauf: r.j.kern?.wiederanlauf ?? false, ende: st.wert(o2, 'spur/1/fader'), zwischenwerte: zwischen })}`);
  assert.notEqual(r.j.kern.wiederanlauf, true);
  assert.ok(zurueck);
  assert.ok(zwischen >= 3, 'über eine Rampe, nicht als Sprung');
});

test('K3 Stapel, Negativ-Kontrolle: im Stopp ein anderes Projekt öffnen und das alte wieder → Cyphers Spur bleibt stumm', async (t) => {
  const st = await zweiProjekte(t);
  const verlauf = [];
  const alt = st.o.vomKern.bind(st.o);
  st.o.vomKern = (d) => { if (d.adresse === '/e/regler' && d.felder.pfad === 'spur/1/fader') verlauf.push(Number(d.felder.wert)); alt(d); };
  const rb = await ruf(st.url, 'POST', '/proj/oeffnen', { slug: st.b });
  await warte(Math.round(6 * 60000 / st.bpm));
  const nachB = st.wert(st.o, 'spur/1/fader');
  const ra = await ruf(st.url, 'POST', '/proj/oeffnen', { slug: st.a });
  await warte(Math.round(6 * 60000 / st.bpm));
  const hoechster = Math.max(-200, ...verlauf);
  console.log(`K3 stapel stopp ${JSON.stringify({ code_b: rb.code, code_a: ra.code, wiederanlauf_a: ra.j.kern?.wiederanlauf ?? false, nach_b: nachB, ende: st.wert(st.o, 'spur/1/fader'), hoechster })}`);
  assert.equal(nachB, -200, 'Öffnen im Stopp');
  assert.equal(st.wert(st.o, 'spur/1/fader'), -200, 'wieder das alte Projekt im Stopp');
  assert.ok(hoechster <= -120, `nie hörbar (höchster Wert ${hoechster})`);
});
