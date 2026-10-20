// D1 S2-Integration, sechste Fix-Runde T5 (Spec 6.37, Andreas F13, 16.10.: Cypher wechselt das Projekt nicht, solange sein Transport läuft):
// Will Cypher ein Projekt öffnen oder anlegen, während Andreas' Transport läuft, antwortet der Server 409 transport_laeuft mit englischem text;
// nichts wird gestoppt, nichts geöffnet, nichts angelegt. Andreas' eigener Wechsel stoppt wie bisher; Cyphers Wechsel über ihren eigenen Lauf
// stoppt ihren Lauf. Vorher stoppte schliesseOffen jeden laufenden Transport mit der Quelle des Wechsels (REVIEW-5-opus M1,
// proben-5-opus/t_transport_eigentum.json T1a/T1b: 200 und /k/arr/stopp {quelle: cypher}).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sitzung, arrNr } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { bis, ruf, CYPHER } from './hilfen/proj_stapel.mjs';

const arr = (nr, status) => ({ ...arrNr(nr), status });
const stopps = (z) => z.k.an('/k/arr/stopp').map((x) => x.felder.quelle);
// zwei Projekte, "eins" offen, Transport gestartet von starter ('andreas', 'cypher', 'hand': Andreas am Gerät, null: unbekannt), Status 2
async function lauf(t, starter, status = 2) {
  const z = sitzung(t, { arrFristMs: 30 });
  await z.s.neu('Zwei', 'andreas');
  await z.s.neu('Eins', 'andreas');
  const nr = z.s.aktuell().j.projekt.wiedergabe_rev;
  if (starter === 'andreas' || starter === 'cypher') await z.s.transport({ aktion: 'start' }, starter);
  if (starter === 'hand') z.s.ereignis('/e/hand', { pfad: 'arr/start_stopp', wert: 1, sample: 0n, beat: 0 });
  z.s.ereignis('/zustand/arr', arr(nr, status));
  z.k.leere();
  return z;
}
const versuche = async (z, weg, quelle) => {
  try { return weg === 'oeffnen' ? await z.s.oeffnen('zwei', quelle) : await z.s.neu('Drei', quelle); } catch (e) { return { code: e.code, j: { fehler: e.fehler, ...e.extra } }; }
};

for (const weg of ['oeffnen', 'neu']) {
  for (const starter of ['andreas', 'hand', null]) {
    test(`T5 Einheit: Cypher ${weg} während Andreas' Transport (Start: ${starter ?? 'unbekannt'}) → 409 transport_laeuft, nichts gestoppt, nichts geöffnet`, async (t) => {
      const z = await lauf(t, starter);
      const r = await versuche(z, weg, 'cypher');
      console.log(`T5 ${weg} ${starter} ${JSON.stringify({ code: r.code, fehler: r.j?.fehler, text: r.j?.text, arr_stopp: stopps(z), offen: z.s.aktuell('rev').j.slug })}`);
      assert.equal(r.code, 409);
      assert.equal(r.j.fehler, 'transport_laeuft');
      assert.match(r.j.text ?? '', /^[\x20-\x7e]+$/, 'englischer text');
      assert.deepEqual(stopps(z), [], 'nichts gestoppt');
      assert.equal(z.s.aktuell('rev').j.slug, 'eins', 'nichts geöffnet');
      assert.equal(fs.existsSync(path.join(z.wurzel, 'drei')), false, 'nichts angelegt');
    });
  }
}

test('T5 Einheit, Negativ-Kontrollen: Andreas wechselt über seinen Lauf → stoppt wie bisher; Cypher über ihren eigenen Lauf → stoppt ihren; ohne Lauf → kein Stopp', async (t) => {
  for (const weg of ['oeffnen', 'neu']) {
    let z = await lauf(t, 'andreas');
    let r = await versuche(z, weg, 'andreas');
    assert.equal(r.code, 200, `Andreas ${weg}`);
    assert.deepEqual(stopps(z), ['andreas'], `Andreas ${weg}: sein Lauf stoppt`);
    z = await lauf(t, 'cypher');
    r = await versuche(z, weg, 'cypher');
    assert.equal(r.code, 200, `Cypher ${weg} über ihren Lauf`);
    assert.deepEqual(stopps(z), ['cypher'], `Cypher ${weg}: ihr Lauf stoppt`);
    z = await lauf(t, 'andreas', 0);
    r = await versuche(z, weg, 'cypher');
    assert.equal(r.code, 200, `Cypher ${weg} ohne Lauf`);
    assert.deepEqual(stopps(z), [], 'ohne Lauf kein Stopp');
  }
});

async function aufbau(t, starterKopf) {
  const st = await stapel(t);
  const { o, url } = st;
  const zwei = (await ruf(url, 'POST', '/proj/neu', { name: 'Zwei' })).j.slug;
  await ruf(url, 'POST', '/proj/neu', { name: 'Eins' });
  let status = null;
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/zustand/arr') status = Number(d.felder.status); alt(d); };
  const r = await ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, starterKopf);
  assert.equal(r.code, 200);
  assert.ok(await bis(() => status === 2, 3000), 'Transport läuft');
  return { ...st, zwei, status: () => status };
}

test('T5 Stapel: Cypher öffnet während Andreas\' Transport → 409 transport_laeuft mit text, der Transport läuft weiter, das Projekt bleibt', async (t) => {
  const { url, zwei, status } = await aufbau(t, {});
  const r = await ruf(url, 'POST', '/proj/oeffnen', { slug: zwei }, CYPHER);
  const n = await ruf(url, 'POST', '/proj/neu', { name: 'Drei' }, CYPHER);
  await new Promise((ok) => setTimeout(ok, 500));
  const offen = (await ruf(url, 'GET', '/proj/aktuell')).j.slug;
  console.log(`T5 stapel ${JSON.stringify({ oeffnen: [r.code, r.j?.fehler, r.j?.text], neu: [n.code, n.j?.fehler], status: status(), offen })}`);
  assert.equal(r.code, 409);
  assert.equal(r.j.fehler, 'transport_laeuft');
  assert.ok(typeof r.j.text === 'string' && r.j.text.length > 10);
  assert.equal(n.code, 409);
  assert.equal(n.j.fehler, 'transport_laeuft');
  assert.equal(status(), 2, 'Andreas\' Transport läuft weiter');
  assert.equal(offen, 'eins');
});

test('T5 Stapel, Negativ-Kontrolle: Cypher öffnet über ihren eigenen Lauf → 200, ihr Lauf stoppt', async (t) => {
  const { url, zwei, status } = await aufbau(t, CYPHER);
  const r = await ruf(url, 'POST', '/proj/oeffnen', { slug: zwei }, CYPHER);
  const steht = await bis(() => status() === 0, 2000);
  console.log(`T5 stapel kontrolle ${JSON.stringify({ code: r.code, status: status() })}`);
  assert.equal(r.code, 200);
  assert.ok(steht, 'ihr Lauf stoppt');
});
