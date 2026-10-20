// D1 S2-Integration, siebte Fix-Runde U3 (Spec 6.37, Andreas 16.10.: „Cypher stoppt nur einen Transport, den sie selbst gestartet hat“):
// Cyphers Stopp über /proj/transport (Quelle cypher) stoppte jeden laufenden Transport, auch Andreas' Lauf. Jetzt antwortet der Server mit
// Quelle cypher 409 transport_laeuft mit englischem text, solange der Transport läuft oder wartet (status 1 oder 2) und ihn nicht Cypher
// gestartet hat (Seite, Hand-Taste am Gerät oder unbekannt, etwa nach einem Server-Neustart); nichts wird gestoppt. Andreas' Stopp stoppt immer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, arrNr } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { bis, ruf, CYPHER } from './hilfen/proj_stapel.mjs';

const arr = (nr, status) => ({ ...arrNr(nr), status });
const stopps = (z) => z.k.an('/k/arr/stopp').map((x) => x.felder.quelle);
// ein Projekt offen, Transport gestartet von starter ('andreas', 'cypher', 'hand': Andreas am Gerät, null: unbekannt), Status status
async function lauf(t, starter, status = 2) {
  const z = sitzung(t, { arrFristMs: 30 });
  await z.s.neu('Eins', 'andreas');
  const nr = z.s.aktuell().j.projekt.wiedergabe_rev;
  if (starter === 'andreas' || starter === 'cypher') await z.s.transport({ aktion: 'start' }, starter);
  if (starter === 'hand') z.s.ereignis('/e/hand', { pfad: 'arr/start_stopp', wert: 1, sample: 0n, beat: 0 });
  z.s.ereignis('/zustand/arr', arr(nr, status));
  z.k.leere();
  return z;
}
const stoppe = async (z, quelle) => {
  try { return await z.s.transport({ aktion: 'stopp' }, quelle); } catch (e) { return { code: e.code, j: { fehler: e.fehler, ...e.extra } }; }
};

for (const status of [2, 1]) {
  for (const starter of ['andreas', 'hand', null]) {
    test(`U3 Einheit: Cypher stoppt Andreas' Transport (Start: ${starter ?? 'unbekannt'}, status ${status}) → 409 transport_laeuft, nichts gestoppt`, async (t) => {
      const z = await lauf(t, starter, status);
      const r = await stoppe(z, 'cypher');
      console.log(`U3 ${starter} ${status} ${JSON.stringify({ code: r.code, fehler: r.j?.fehler, text: r.j?.text, arr_stopp: stopps(z) })}`);
      assert.equal(r.code, 409);
      assert.equal(r.j.fehler, 'transport_laeuft');
      assert.match(r.j.text ?? '', /^[\x20-\x7e]+$/, 'englischer text');
      assert.match(r.j.text, /Andreas/);
      assert.deepEqual(stopps(z), [], 'nichts gestoppt');
    });
  }
}

test('U3 Einheit: Cypher startet, Andreas drückt die Hand-Taste (Stopp und neuer Start am Gerät) → sein Lauf, Cyphers Stopp 409', async (t) => {
  const z = await lauf(t, 'cypher');
  z.s.ereignis('/e/hand', { pfad: 'arr/start_stopp', wert: 1, sample: 0n, beat: 0 });
  z.s.ereignis('/e/hand', { pfad: 'arr/start_stopp', wert: 1, sample: 0n, beat: 0 });
  const r = await stoppe(z, 'cypher');
  assert.equal(r.code, 409);
  assert.deepEqual(stopps(z), []);
});

test('U3 Einheit, Negativ-Kontrollen: Cypher stoppt ihren eigenen Lauf; Andreas stoppt jeden Lauf; ohne Lauf geht Cyphers Stopp durch', async (t) => {
  let z = await lauf(t, 'cypher');
  let r = await stoppe(z, 'cypher');
  assert.equal(r.code, 200, 'Cyphers eigener Lauf');
  assert.deepEqual(stopps(z), ['cypher']);
  for (const starter of ['cypher', 'andreas', 'hand', null]) {
    z = await lauf(t, starter);
    r = await stoppe(z, 'andreas');
    assert.equal(r.code, 200, `Andreas stoppt (Start: ${starter})`);
    assert.deepEqual(stopps(z), ['andreas']);
  }
  z = await lauf(t, 'andreas', 0);
  r = await stoppe(z, 'cypher');
  assert.equal(r.code, 200, 'kein Lauf (status 0): der Stopp ist ohne Wirkung und wird nicht abgelehnt');
  assert.deepEqual(stopps(z), ['cypher']);
  z = await lauf(t, 'cypher');
  r = await stoppe(z, 'cypher');                                      // gestoppt: transportQuelle null
  // Fix8 V2 (Spec 6.37 Nachtrag): erst der Stand nach dem Stopp (status 0), dann Cyphers neuer Start, dann ihr Lauf (status 2). Vorher kam
  // status 2 VOR dem Start, bei unbekanntem Starter; Cyphers Start dort lehnt der Server jetzt mit 409 transport_laeuft ab (V2-Test).
  z.s.ereignis('/zustand/arr', arr(z.s.aktuell().j.projekt.wiedergabe_rev, 0));
  await z.s.transport({ aktion: 'start' }, 'cypher');                 // Cypher startet wieder: wieder ihr Lauf
  z.s.ereignis('/zustand/arr', arr(z.s.aktuell().j.projekt.wiedergabe_rev, 2));
  z.k.leere();
  r = await stoppe(z, 'cypher');
  assert.equal(r.code, 200, 'nach Cyphers neuem Start wieder ihr Lauf');
});

async function aufbau(t, starterKopf) {
  const st = await stapel(t);
  const { o, url } = st;
  await ruf(url, 'POST', '/proj/neu', { name: 'Eins' });
  let status = null;
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/zustand/arr') status = Number(d.felder.status); alt(d); };
  const r = await ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, starterKopf);
  assert.equal(r.code, 200);
  assert.ok(await bis(() => status === 2, 3000), 'Transport läuft');
  return { ...st, status: () => status };
}

test('U3 Stapel: Cypher stoppt Andreas\' Transport → 409 transport_laeuft mit text, der Transport läuft weiter; Andreas stoppt ihn dann', async (t) => {
  const { url, status } = await aufbau(t, {});
  const r = await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  await new Promise((ok) => setTimeout(ok, 500));
  const nachCypher = status();
  const a = await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' });
  const steht = await bis(() => status() === 0, 2000);
  console.log(`U3 stapel ${JSON.stringify({ cypher: [r.code, r.j?.fehler, r.j?.text], status_nach_cypher: nachCypher, andreas: a.code, steht })}`);
  assert.equal(r.code, 409);
  assert.equal(r.j.fehler, 'transport_laeuft');
  assert.ok(typeof r.j.text === 'string' && r.j.text.length > 10);
  assert.equal(nachCypher, 2, 'Andreas\' Transport läuft weiter');
  assert.equal(a.code, 200);
  assert.ok(steht, 'Andreas\' Stopp stoppt');
});

test('U3 Stapel, Negativ-Kontrolle: Cypher stoppt ihren eigenen Lauf → 200, der Transport steht', async (t) => {
  const { url, status } = await aufbau(t, CYPHER);
  const r = await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  const steht = await bis(() => status() === 0, 2000);
  console.log(`U3 stapel kontrolle ${JSON.stringify({ code: r.code, status: status() })}`);
  assert.equal(r.code, 200);
  assert.ok(steht);
});
