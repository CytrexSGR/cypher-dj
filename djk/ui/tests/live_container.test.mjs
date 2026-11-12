// Plan live-module, task 1: the live container. One permanent project (slug `live`, flag `live: true`) on the project channel erz/4:
// opening or creating it never sends an erz/4 row, its loop region is on (0..64), opening another project while its transport runs and a deck
// plays is refused (409 live_laeuft; Andreas only with bestaetigt), and a project without the flag is written byte for byte as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sitzung, arrNr } from './support/proj_context.mjs';
import { stapel } from './support/media_library.mjs';
import { bis, ruf, CYPHER } from './support/proj_stack.mjs';
import { bauFlach } from './support/flach_golden.mjs';
import { pruefeProjekt, neuesProjekt, kanonisch } from '../project/model.ts';
import { liveSlots } from '../project/live.ts';
import { GRUND_TEXT } from '../http/reasons.ts';

const erz4 = (k) => k.teile(/^erz\/4\//).map((x) => x.felder.pfad);
const arr = (nr, status) => ({ ...arrNr(nr), status });
const HASH = 'c'.repeat(64);
const modul = (slot, extra = {}) => ({ quelle_sha256: HASH, titel: 'T', kuenstler: 'K', fassung: 'f1', basis_bpm: 124, von_beat: 32, laenge_beats: 16,
  bpm: 124, tonart: '8A', datum: '2026-11-12', slot, ...extra });
const gruppe = (id, nr, extra = {}) => ({ id, nr, name: id, farbe: '#aabbcc', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false, ...extra });
const mitGruppen = (gruppen) => { const p = neuesProjekt('x'); p.gruppen = gruppen; return p; };

test('live container: opening and creating it sends no erz/4 row; a flat project still sends erz4Soll (compared with and without the flag)', async (t) => {
  const flach = sitzung(t, { arrFristMs: 30 });
  await flach.s.neu('Flat', 'andreas');
  const mit = erz4(flach.k);
  assert.ok(mit.length >= 24, `the flat project sends the erz/4 rows (${mit.length})`);
  assert.ok(mit.includes('erz/4/fader') && mit.includes('erz/4/ziel'));
  for (const quelle of ['andreas', 'cypher']) {
    const z = sitzung(t, { arrFristMs: 30 });
    const r = await z.s.liveOeffnen(quelle);
    assert.equal(r.code, 200, JSON.stringify(r.j));
    assert.deepEqual(erz4(z.k), [], `create (${quelle}): no erz/4 row`);
    assert.ok(z.k.teile(/^spur\//).length > 0, 'the other mixer rows are still sent (the flag only spares erz/4)');
    z.k.leere();
    await z.s.neu('Flat', 'andreas');   // leave the live container (not playing), then come back
    const b = await z.s.liveOeffnen(quelle);
    assert.equal(b.code, 200, JSON.stringify(b.j));
    const zeilen = erz4(z.k);
    assert.equal(zeilen.length, mit.length, 'the flat project in between sent erz/4 again');   // sanity: the rows of the flat open are in the log
    z.k.leere();
    await z.s.oeffnen('live', quelle);
    assert.deepEqual(erz4(z.k), [], `open (${quelle}): no erz/4 row`);
  }
});

test('live container: created with live true, loop region on 0..64, never written for a flat project', async (t) => {
  const z = sitzung(t, { arrFristMs: 30 });
  const r = await z.s.liveOeffnen('andreas');
  assert.equal(r.j.slug, 'live');
  assert.deepEqual(r.j.slots, { A: null, B: null });
  const datei = JSON.parse(fs.readFileSync(path.join(z.wurzel, 'live', 'project.json'), 'utf8'));
  assert.equal(datei.live, true);
  assert.deepEqual(datei.loop, { an: true, von_beat: 0, bis_beat: 64 });
  const loop = z.k.an('/k/arr/loop').at(-1);
  assert.deepEqual([loop.felder.an, loop.felder.von_beat, loop.felder.bis_beat], [1, 0, 64], 'the core got the loop region');
  const flach = await z.s.neu('Flat', 'andreas');
  assert.equal('live' in flach.j.projekt, false);
  assert.equal('live' in JSON.parse(fs.readFileSync(path.join(z.wurzel, 'flat', 'project.json'), 'utf8')), false);
});

test('live container: opening it again while it is open does not reopen it (idempotent)', async (t) => {
  const z = sitzung(t, { arrFristMs: 30 });
  await z.s.liveOeffnen('andreas');
  z.k.leere();
  const r = await z.s.liveOeffnen('cypher');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.slots, { A: null, B: null });
  assert.equal(z.k.gesendet.length, 0, 'nothing sent');
});

async function spielt(t, deck = true, transport = true) {
  const z = sitzung(t, { arrFristMs: 30 });
  await z.s.neu('Other', 'andreas');
  await z.s.liveOeffnen('andreas');
  const nr = z.s.aktuell().j.projekt.wiedergabe_rev;
  if (deck) z.s.ereignis('/zustand/deck', { deck: 1, status: 2 });
  if (transport) z.s.ereignis('/zustand/arr', arr(nr, 2));
  z.k.leere();
  return z;
}
const versuch = async (f) => { try { return await f(); } catch (e) { return { code: e.code, j: { fehler: e.fehler, ...e.extra } }; } };

for (const weg of ['oeffnen', 'neu']) {
  test(`live guard (${weg}): Cypher gets 409 live_laeuft with a text, even with bestaetigt; nothing stopped, nothing opened`, async (t) => {
    const z = await spielt(t);
    const f = () => (weg === 'oeffnen' ? z.s.oeffnen('other', 'cypher', true) : z.s.neu('Third', 'cypher', true));
    const r = await versuch(f);
    assert.equal(r.code, 409);
    assert.equal(r.j.fehler, 'live_laeuft');
    assert.match(r.j.text ?? GRUND_TEXT.live_laeuft, /^[\x20-\x7e]+$/);
    assert.equal(z.k.an('/k/arr/stopp').length, 0, 'nothing stopped');
    assert.equal(z.s.aktuell('rev').j.slug, 'live');
    assert.equal(fs.existsSync(path.join(z.wurzel, 'third')), false);
  });
  test(`live guard (${weg}): Andreas without bestaetigt is refused, with bestaetigt it opens`, async (t) => {
    let z = await spielt(t);
    const f = (b) => (weg === 'oeffnen' ? z.s.oeffnen('other', 'andreas', b) : z.s.neu('Third', 'andreas', b));
    const r = await versuch(() => f(undefined));
    assert.deepEqual([r.code, r.j.fehler], [409, 'live_laeuft']);
    assert.equal(z.s.aktuell('rev').j.slug, 'live');
    const ok = await f(true);
    assert.equal(ok.code, 200, JSON.stringify(ok.j));
    assert.equal(z.s.aktuell('rev').j.slug, weg === 'oeffnen' ? 'other' : 'third');
    assert.ok(z.k.an('/k/arr/stopp').length >= 1, 'the live transport was stopped by the confirmed switch');
  });
  test(`live guard (${weg}), negative controls: no deck, no transport, or a flat project open: the switch goes through`, async (t) => {
    for (const [deck, transport] of [[false, true], [true, false], [false, false]]) {
      const z = await spielt(t, deck, transport);
      const r = await (weg === 'oeffnen' ? z.s.oeffnen('other', 'andreas') : z.s.neu('Third', 'andreas'));   // Andreas: Cypher would meet the older transport_laeuft
      assert.equal(r.code, 200, `deck ${deck} transport ${transport}`);
    }
    // a flat project open while a deck plays: not guarded
    const z = sitzung(t, { arrFristMs: 30 });
    await z.s.neu('Other', 'andreas'); await z.s.neu('Flat2', 'andreas');
    z.s.ereignis('/zustand/deck', { deck: 1, status: 2 });
    assert.equal((await z.s.oeffnen('other', 'andreas')).code, 200);
  });
}

test('route: POST /live/oeffnen answers slug and slots; Cypher\'s open of another project during the set is 409 live_laeuft', async (t) => {
  const st = await stapel(t);
  const { o, url } = st;
  const r = await ruf(url, 'POST', '/live/oeffnen', {}, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j, { slug: 'live', slots: { A: null, B: null } });
  const zwei = (await ruf(url, 'POST', '/proj/neu', { name: 'Zwei' }, { ...CYPHER })).j;
  assert.equal(zwei.fehler, undefined);   // no deck, no transport: free
  assert.equal((await ruf(url, 'POST', '/live/oeffnen', {})).code, 200);
  let status = null, deck = false;
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/zustand/arr') status = Number(d.felder.status); alt(d); };
  assert.equal((await ruf(url, 'POST', '/proj/transport', { aktion: 'start' })).code, 200);
  assert.ok(await bis(() => status === 2, 3000), 'transport runs');
  o.vomKern({ adresse: '/zustand/deck', felder: { deck: 1, status: 2 } }); deck = true;
  const c = await ruf(url, 'POST', '/proj/oeffnen', { slug: 'zwei', bestaetigt: true }, CYPHER);
  assert.deepEqual([c.code, c.j.fehler], [409, 'live_laeuft']);
  assert.ok(typeof c.j.text === 'string' && c.j.text.length > 10);
  const a = await ruf(url, 'POST', '/proj/oeffnen', { slug: 'zwei' });
  assert.deepEqual([a.code, a.j.fehler], [409, 'live_laeuft'], 'the page without bestaetigt');
  const b = await ruf(url, 'POST', '/proj/oeffnen', { slug: 'zwei', bestaetigt: true });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  assert.ok(deck);
});

test('schema: Projekt.live and Gruppe.modul/blend are accepted when well formed, refused otherwise; absent fields stay absent', () => {
  const live = neuesProjekt('Live'); live.live = true;
  assert.ok('projekt' in pruefeProjekt(live));
  assert.equal('live' in pruefeProjekt(neuesProjekt('x')).projekt, false);
  for (const v of [false, 1, 'true', null]) assert.ok('fehler' in pruefeProjekt({ ...neuesProjekt('x'), live: v }), `live ${JSON.stringify(v)}`);
  const ok = mitGruppen([gruppe('g1', 1, { modul: modul('A'), blend: 0.5 }), gruppe('g2', 2, { modul: modul('B', { set: 'Friday' }) }), gruppe('g3', 3)]);
  const g = pruefeProjekt(ok).projekt.gruppen;
  assert.deepEqual(g[0].modul, modul('A')); assert.equal(g[0].blend, 0.5); assert.equal('modul' in g[2], false); assert.equal('blend' in g[2], false);
  for (const [name, extra] of [['slot C', { modul: modul('C') }], ['unknown module field', { modul: modul('A', { x: 1 }) }], ['bad sha', { modul: modul('A', { quelle_sha256: 'zz' }) }],
    ['laenge 0', { modul: modul('A', { laenge_beats: 0 }) }], ['blend 2', { blend: 2 }], ['blend string', { blend: '1' }], ['set empty', { modul: modul('A', { set: '' }) }]]) {
    assert.ok('fehler' in pruefeProjekt(mitGruppen([gruppe('g1', 1, extra)])), name);
  }
  // task 10: a module in a production project has no slot (its origin stays); the live container only counts groups with a slot
  const ohneSlot = mitGruppen([gruppe('g1', 1, { modul: (({ slot, ...r }) => r)(modul('A')) })]);
  assert.equal('slot' in pruefeProjekt(ohneSlot).projekt.gruppen[0].modul, false, 'slot missing is accepted and stays absent');
  assert.equal(kanonisch(pruefeProjekt(neuesProjekt('x')).projekt), kanonisch(neuesProjekt('x')), 'a project without the fields round-trips');
});

test('flat project without live: byte-identical to the golden', () => {
  const golden = JSON.parse(fs.readFileSync(new URL('./support/flach_golden.json', import.meta.url), 'utf8'));
  assert.equal(bauFlach().datei, golden.datei);
});

test('liveSlots reads modul.slot of top-level groups, not the name; nested and slotless groups do not count', () => {
  assert.deepEqual(liveSlots(neuesProjekt('x')), {});
  const p = mitGruppen([gruppe('g1', 1, { name: 'B', modul: modul('A') }), gruppe('g2', 2, { name: 'A', modul: modul('B') }),
    gruppe('g3', 3, { name: 'A' }), gruppe('g4', 4, { modul: modul('A'), ausgang: { art: 'gruppe', id: 'g1' } })]);
  assert.deepEqual(liveSlots(p), { A: 'g1', B: 'g2' });
  assert.deepEqual(liveSlots(mitGruppen([gruppe('g1', 1, { modul: modul('B') })])), { B: 'g1' });
});

test('live_laeuft has an English text', () => {
  assert.match(GRUND_TEXT.live_laeuft, /^[\x20-\x7e]+$/);
});

test('a project named live without the flag is not opened as the container: 409 kein_liveprojekt_flag, no regulator row sent', async (t) => {
  const z = sitzung(t, { arrFristMs: 30 });
  const n = await z.s.neu('Live', 'andreas');                 // slug `live`, no flag
  assert.equal(n.code, 200, JSON.stringify(n.j));
  await z.s.neu('Other', 'andreas');
  z.k.leere();
  await assert.rejects(z.s.liveOeffnen('andreas'), (e) => e.code === 409 && e.fehler === 'kein_liveprojekt_flag');
  assert.deepEqual(z.k.teile(/./).map((x) => x.felder.pfad), [], 'no row before the refusal');
  assert.equal(z.s.aktuell().j.slug, 'other', 'the open project stays');
});
