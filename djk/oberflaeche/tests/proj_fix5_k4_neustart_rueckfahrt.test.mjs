// D1 S2-Integration, fünfte Fix-Runde K4 (Bedenken der vierten Runde, Spec 6.21 mit 6.36): Startet der Server mitten in einer Rückfahrt neu
// (innerhalb der Abonnenten-Frist des Kerns, also ohne Hallo-Stand, aber mit den laufenden /e/regler der Rampe), übernahm der Wiederanlauf den
// Zwischenwert der Cypher-Spur als Andreas' Änderung ins Projekt (gemessen Fix5, k4_probe_vorher: −54,2 in project.json, Kern danach −3).
// Eine laufende Rückfahrt ist keine Hand: ihr Halter heißt plan:ki_rueck (§4.3), ihr Zwischenwert kommt nicht ins Projekt; sie endet ohnehin
// auf dem Projektwert.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { neustart, arrNr } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';
import { Oberflaeche } from '../server.ts';

const regler = (s, pfad, wert, halter) => s.ereignis('/e/regler', { pfad, wert, halter, sample: 0n, beat: 0 });
async function fall(t, halter) {
  const { e, z, nr } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(nr)); z.s.ereignis('/zustand/kern', { ki_gestoppt: 0 });
  regler(z.s, 'spur/1/fader', 0, 'frei'); regler(z.s, 'spur/2/fader', -54.2, halter);
  const r = await z.s.oeffnen('wa', 'andreas');
  assert.equal(r.j.kern.wiederanlauf, true);
  return { projekt: r.j.projekt.spuren[1].fader_db, datei: JSON.parse(fs.readFileSync(path.join(e.wurzel, 'wa', 'project.json'), 'utf8')).spuren[1].fader_db };
}

test('K4 Einheit: Wiederanlauf, Cyphers Fader mitten in der Rückfahrt (Halter plan:ki_rueck) → nicht ins Projekt', async (t) => {
  const r = await fall(t, 'plan:ki_rueck');
  console.log(`K4 einheit rueckfahrt ${JSON.stringify(r)}`);
  assert.deepEqual(r, { projekt: 0, datei: 0 });
});

test('K4 Einheit, Negativ-Kontrollen: derselbe Wert in Andreas\' Hand (mensch) oder frei → ins Projekt wie bisher (6.21)', async (t) => {
  const m = await fall(t, 'mensch'), f = await fall(t, 'frei');
  console.log(`K4 einheit hand ${JSON.stringify({ mensch: m, frei: f })}`);
  assert.deepEqual(m, { projekt: -54.2, datei: -54.2 });
  assert.deepEqual(f, { projekt: -54.2, datei: -54.2 });
});

// Stapel: Tempo 60 (die Rückfahrt dauert 4 s), Stopp, Freigabe; sobald die Rückfahrt läuft, Server beenden und sofort neu starten, Öffnen.
test('K4 Stapel: Server-Neustart mitten in der Rückfahrt → Wiederanlauf schreibt keinen Zwischenwert, Kern und Projekt enden auf −3', async (t) => {
  const st = await stapel(t);
  const { o, url } = st;
  const slug = (await ruf(url, 'POST', '/proj/neu', { name: 'Frei' })).j.slug;
  let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }] });
  const wert = (x, pfad) => innen(x).stand.regler[pfad];
  assert.ok(await bis(() => wert(o, 'spur/1/fader') === -3));
  assert.equal((await ruf(url, 'POST', '/tempo', { bpm: 60 })).code, 200);
  await warte(4500);                                                   // die Tempo-Rampe des Masters abwarten
  assert.equal((await ruf(url, 'GET', '/lage')).j.uhr.bpm, 60);
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert(o, 'spur/1/fader') === -200, 8000), 'Ausblende durch');
  const datei = path.join(st.optionen.proj.wurzel, slug, 'project.json');
  const vorher = fs.readFileSync(datei, 'utf8');
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert(o, 'spur/1/fader') > -60 && wert(o, 'spur/1/fader') < -20, 8000), 'die Rückfahrt läuft');
  await o.stoppe();
  const o2 = new Oberflaeche(st.optionen);
  t.after(() => o2.stoppe());
  await o2.starte();
  assert.ok(await bis(() => o2.kern.zustand === 'verbunden', 3000));
  assert.ok(await bis(() => wert(o2, 'spur/1/fader') !== undefined, 3000));
  const istBeimOeffnen = wert(o2, 'spur/1/fader');
  const neu = await ruf(url, 'POST', '/proj/oeffnen', { slug });
  assert.ok(await bis(() => wert(o2, 'spur/1/fader') === -3, 6000), 'die Rückfahrt endet im Kern auf dem Projektwert');
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  console.log(`K4 stapel ${JSON.stringify({ ist_beim_oeffnen: istBeimOeffnen, wiederanlauf: neu.j.kern?.wiederanlauf, mixer_uebernommen: neu.j.kern?.mixer_uebernommen,
    projekt: p.spuren[0].fader_db, datei_unveraendert: fs.readFileSync(datei, 'utf8') === vorher, kern_ende: wert(o2, 'spur/1/fader') })}`);
  assert.ok(istBeimOeffnen > -120 && istBeimOeffnen < -3, `beim Öffnen kannte der Server einen Zwischenwert (${istBeimOeffnen}); sonst wäre der Test leer`);
  assert.equal(neu.j.kern.wiederanlauf, true);
  assert.equal(p.spuren[0].fader_db, -3);
  assert.equal(fs.readFileSync(datei, 'utf8'), vorher, 'project.json unverändert');
});
