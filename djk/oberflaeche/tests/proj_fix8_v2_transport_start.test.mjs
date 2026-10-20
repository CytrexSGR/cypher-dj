// D1 S2-Integration, achte Fix-Runde V2 (Spec 6.37 Nachtrag, Re-Review Fix7 RR7-2, rr7 T_start): Cyphers Start über Andreas' laufenden Transport
// ging durch. Der Kern beendet beim Start einen laufenden Lauf (kern_arr.cpp:97) und der Server führte Cypher als Starterin; ihr Stopp ging danach
// durch, die U3-Sperre war in zwei Aufrufen umgangen. Jetzt: Start mit Quelle cypher, solange der Transport läuft oder wartet (status 1 oder 2)
// und ihn nicht Cypher gestartet hat (Seite, Hand-Taste, unbekannt), antwortet 409 transport_laeuft mit englischem text; nichts wird gesendet
// (keine Tempo-Rampe, kein /k/arr/start).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, arrNr } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

const arr = (nr, status) => ({ ...arrNr(nr), status });
const transportBefehle = (z) => z.k.gesendet.filter((x) => /^\/k\/(arr\/(start|stopp)|tempo\/rampe)$/.test(x.adresse)).map((x) => `${x.adresse} ${x.felder.quelle}`);
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
const transport = async (z, aktion, quelle, beat) => {
  try { return await z.s.transport(beat === undefined ? { aktion } : { aktion, beat }, quelle); } catch (e) { return { code: e.code, j: { fehler: e.fehler, ...e.extra } }; }
};

for (const status of [2, 1]) {
  for (const starter of ['andreas', 'hand', null]) {
    test(`V2 Einheit: Cypher startet über Andreas' Transport (Start: ${starter ?? 'unbekannt'}, status ${status}) → 409 transport_laeuft, nichts gesendet`, async (t) => {
      const z = await lauf(t, starter, status);
      const r = await transport(z, 'start', 'cypher', 8);
      console.log(`V2 ${starter} ${status} ${JSON.stringify({ code: r.code, fehler: r.j?.fehler, text: r.j?.text, gesendet: transportBefehle(z) })}`);
      assert.equal(r.code, 409);
      assert.equal(r.j.fehler, 'transport_laeuft');
      assert.match(r.j.text ?? '', /^[\x20-\x7e]+$/, 'englischer text');
      assert.match(r.j.text, /Andreas/);
      assert.deepEqual(transportBefehle(z), [], 'nichts gesendet');
      const s = await transport(z, 'stopp', 'cypher');
      assert.equal(s.code, 409, 'sein Lauf bleibt seiner: Cyphers Stopp danach weiter 409');
    });
  }
}

test('V2 Einheit, Negativ-Kontrollen: Cypher startet ohne Lauf; über ihren eigenen Lauf; Andreas startet über Cyphers Lauf (danach seiner)', async (t) => {
  let z = await lauf(t, 'andreas', 0);
  let r = await transport(z, 'start', 'cypher', 8);
  assert.equal(r.code, 200, 'kein Lauf (status 0)');
  assert.deepEqual(transportBefehle(z), ['/k/arr/start cypher']);
  z = await lauf(t, 'cypher', 2);
  r = await transport(z, 'start', 'cypher', 8);
  assert.equal(r.code, 200, 'über ihren eigenen Lauf');
  assert.deepEqual(transportBefehle(z), ['/k/arr/start cypher']);
  z = await lauf(t, 'cypher', 2);
  r = await transport(z, 'start', 'andreas', 8);
  assert.equal(r.code, 200, 'Andreas startet immer');
  assert.deepEqual(transportBefehle(z), ['/k/arr/start andreas']);
  z.k.leere();
  r = await transport(z, 'stopp', 'cypher');
  assert.equal(r.code, 409, 'danach ist es sein Lauf');
  assert.deepEqual(transportBefehle(z), []);
  for (const starter of ['andreas', 'hand', null]) {
    z = await lauf(t, starter, 2);
    r = await transport(z, 'start', 'andreas', 8);
    assert.equal(r.code, 200, `Andreas startet über seinen Lauf (Start: ${starter ?? 'unbekannt'})`);
    assert.deepEqual(transportBefehle(z), ['/k/arr/start andreas']);
  }
});

test('V2 Einheit: Cypher startet über Andreas\' Lauf, Master-Tempo weicht ab → abgelehnt vor der Tempo-Rampe (keine Rampe gesendet)', async (t) => {
  const z = await lauf(t, 'andreas', 2);
  z.s.ereignis('/uhr', { beat: 0, bpm: 100, sample: 0 });              // Master 100, Projekt 120: ein Start rampte erst
  const r = await transport(z, 'start', 'cypher', 0);
  console.log(`V2 vor_rampe ${JSON.stringify({ code: r.code, gesendet: transportBefehle(z) })}`);
  assert.equal(r.code, 409);
  assert.deepEqual(transportBefehle(z), [], 'weder Rampe noch Start');
});

test('V2 Einheit: Andreas startet während Cyphers Tempo-Rampe → Cyphers Start wird unmittelbar vor /k/arr/start abgelehnt', async (t) => {
  const z = sitzung(t, { arrFristMs: 30, rampeWarteMs: 2000, uhrStillMs: 2000 });
  await z.s.neu('Eins', 'andreas');
  const nr = z.s.aktuell().j.projekt.wiedergabe_rev;
  z.s.ereignis('/zustand/arr', arr(nr, 0));
  z.s.ereignis('/uhr', { beat: 0, bpm: 100, sample: 0 });              // Master 100, Projekt 120: der Start rampt erst
  z.k.leere();
  const p = transport(z, 'start', 'cypher', 0);
  assert.ok(await bis(() => z.k.an('/k/tempo/rampe').length > 0, 1000), 'Rampe gesendet');
  z.s.ereignis('/e/hand', { pfad: 'arr/start_stopp', wert: 1, sample: 0n, beat: 0 });   // Andreas startet am Gerät
  z.s.ereignis('/zustand/arr', arr(nr, 2));
  const rampe = z.k.an('/k/tempo/rampe')[0].felder;
  for (let b = 0.5; b <= 16; b += 0.5) z.s.ereignis('/uhr', { beat: b, bpm: b >= rampe.ab_beat + rampe.dauer_beats ? 120 : 110, sample: 0 });
  const r = await p;
  console.log(`V2 rampe ${JSON.stringify({ code: r.code, fehler: r.j?.fehler, gesendet: transportBefehle(z) })}`);
  assert.equal(r.code, 409);
  assert.equal(r.j.fehler, 'transport_laeuft');
  assert.deepEqual(z.k.an('/k/arr/start'), [], 'kein /k/arr/start');
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

test('V2 Stapel T_start: Andreas startet, Cypher startet neu (beat 8) → 409, sein Lauf läuft weiter; Cyphers Stopp danach 409', async (t) => {
  const { url, status } = await aufbau(t, {});
  const s1 = await ruf(url, 'POST', '/proj/transport', { aktion: 'start', beat: 8 }, CYPHER);
  await warte(600);
  const nachStart = status();
  const c = await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  await warte(600);
  const nachStopp = status();
  const a = await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' });
  const steht = await bis(() => status() === 0, 2000);
  console.log(`V2 stapel T_start ${JSON.stringify({ cypher_start: [s1.code, s1.j?.fehler ?? null, s1.j?.text ?? null], status_nach_cypher_start: nachStart,
    cypher_stopp: [c.code, c.j?.fehler ?? null], status_nach_cypher_stopp: nachStopp, andreas_stopp: a.code, steht })}`);
  assert.equal(s1.code, 409);
  assert.equal(s1.j.fehler, 'transport_laeuft');
  assert.equal(nachStart, 2);
  assert.equal(c.code, 409, 'Cypher ist nicht Eigentümerin geworden');
  assert.equal(nachStopp, 2);
  assert.equal(a.code, 200);
  assert.ok(steht);
});

test('V2 Stapel, Negativ-Kontrolle: Cypher startet, startet über ihren eigenen Lauf neu (beat 8) → 200; ihr Stopp 200', async (t) => {
  const { url, status } = await aufbau(t, CYPHER);
  const s1 = await ruf(url, 'POST', '/proj/transport', { aktion: 'start', beat: 8 }, CYPHER);
  await warte(600);
  const c = await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  const steht = await bis(() => status() === 0, 2000);
  console.log(`V2 stapel kontrolle ${JSON.stringify({ start: s1.code, stopp: c.code, steht })}`);
  assert.equal(s1.code, 200);
  assert.equal(c.code, 200);
  assert.ok(steht);
});
