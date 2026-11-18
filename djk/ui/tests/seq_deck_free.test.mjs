// Plan seq-fader-frei (card t_150d0c09), T1: a place that carries a SEQ deck and NO loaded track has an empty deck player; the channel strip deck/N
// then carries only Cypher's own patterns, so Cypher opens its fader/trim without a hearing pass (like erz/*). A loaded track keeps the lock.
// Real page server on the test instance (no core: the log entries of type an_kern are the sent core messages); the core half is the I3a exemption
// in signalbox/src/i3.cpp (T2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { seqDeckFrei } from '../hand_operation.ts';

belegeTestInstanz();
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const CYPHER = { 'x-djk-quelle': 'cypher' };
const ANDREAS = { 'x-djk-quelle': 'andreas' };
const FASSUNG = { material_id: 'f0000000000000a1', basis_bpm: 120, fassung: 1 };

async function stapel(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const huellen = path.join(tmp('sdf-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = { inst: process.env.CYPHERDJ_INSTANZ };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('sdf-bestand-'), arbeitsbestand: tmp('sdf-ab-'),
    mutationen: [], loops: tmp('sdf-loops-'), kits: tmp('sdf-kits-'), welleCache: tmp('sdf-welle-'), musterOrdner: tmp('sdf-muster-'), hotcueOrdner: tmp('sdf-hc-'),
    rasterOrdner: tmp('sdf-raster-'), huellen, wirtOrdner: tmp('sdf-wirt-'), sammlungen: tmp('sdf-sets-'), musterBibliothek: tmp('sdf-mb-'), musterSets: tmp('sdf-ms-'),
    mediathek: path.join(tmp('sdf-med-'), 'nix.sqlite'), katalog: path.join(tmp('sdf-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('sdf-do-'), 'nix'),
    proj: { wurzel: path.join(tmp('sdf-proj-'), 'projekte'), arbeitsordner: path.join(tmp('sdf-arr-'), 'arr') },   // own project folder: the live container of the instance stays untouched
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('sdf-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('sdf-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
  });
  const url = `http://127.0.0.1:${47300 + K}`;
  const post = (pfad, daten, kopf = {}) => hol(`${url}${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
  const kern = (adresse, felder) => o.vomKern({ adresse, felder });
  // the page server reads the clock from its kern connection (o.kern.uhr), which no /uhr event of vomKern feeds: set it as graphs.test.mjs does
  const uhr = (beat) => { o.kern.uhr = { beat, bpm: 128, mono_ns: 0 }; };
  const deckZustand = (deck, status) => kern('/zustand/deck', { deck, status, ...FASSUNG, quell_beat: 0, beats_bis_ende: status ? 64 : 0, faktor: 1, vorlauf_ms: 0 });
  const regler = (pfad, wert) => kern('/e/regler', { pfad, wert });
  const an = (adresse) => log.filter((z) => z.typ === 'an_kern' && z.adresse === adresse);
  const teile = (pfad) => an('/k/teil').filter((z) => z.felder.pfad === pfad);
  const entladen = () => an('/k/deck/entladen');
  // POST /regler as a source; the core is not there, so the receipt comes from the test (status 2 = started) as soon as the part has left
  async function setze(pfad, nach, kopf, takte = 0) {
    const n0 = teile(pfad).length;
    const p = post('/regler', { pfad, nach, takte, ab: takte ? 'phrase' : 'jetzt' }, kopf);
    const r = await Promise.race([p, bis(() => teile(pfad).length > n0).then(() => null)]);
    if (r) return r;
    const s = teile(pfad).at(-1);
    kern('/q', { id: s.felder.id, quelle: s.felder.quelle, status: 2, ist_sample: 0, ist_beat: 0, grund: '' });
    return p;
  }
  const seqAn = async (platz = 2) => {
    assert.equal((await post('/live/oeffnen', {})).code, 200);
    const r = await post('/seq/anlegen', { platz }, ANDREAS);
    assert.equal(r.code, 200, JSON.stringify(r.j));
  };
  return { o, url, log, post, hol, kern, uhr, deckZustand, regler, an, teile, entladen, setze, seqAn };
}

test('pure rule: seqDeckFrei only for deck fader/trim of a SEQ place without a loaded track', () => {
  const seq = new Set([2]), leer = new Set();
  assert.equal(seqDeckFrei('deck/2/fader', seq, leer), true);
  assert.equal(seqDeckFrei('deck/2/trim', seq, leer), true);
  for (const pfad of ['erz/1/fader', 'deck/2/eq/tief', 'pad/1/fader', 'deck/5/fader', 'deck/0/fader', 'deck/2/pfl', 'deck/2/filter', 'bus/1/fader', 'spur/1/fader']) {
    assert.equal(seqDeckFrei(pfad, new Set([0, 1, 2, 3, 4, 5]), leer), false, pfad);
  }
  assert.equal(seqDeckFrei('deck/3/fader', seq, leer), false, 'no SEQ deck on place 3');
  assert.equal(seqDeckFrei('deck/2/fader', seq, new Set([2])), false, 'a loaded track on place 2');
  assert.equal(seqDeckFrei('deck/2/trim', seq, new Set([2])), false);
  assert.equal(seqDeckFrei('deck/2/fader', seq, new Set([1, 3])), true, 'a track on another place does not matter');
  assert.equal(seqDeckFrei('deck/2/fader', new Set(), leer), false, 'no SEQ deck at all');
});

test('SEQ deck without track: /regler deck/2/fader and trim open for cypher, /k/teil carries hoerschein ""', async (t) => {
  const { post, uhr, regler, teile, log, setze, seqAn } = await stapel(t);
  uhr(16);
  await seqAn();
  const r = await setze('deck/2/fader', 0, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(teile('deck/2/fader').length, 1);
  assert.equal(teile('deck/2/fader')[0].felder.hoerschein, '');
  assert.equal(teile('deck/2/fader')[0].felder.quelle, 'cypher');
  assert.equal(log.filter((z) => z.typ === 'seq_frei').length, 1);
  // trim: the fader is already up, the trim sits at -60 (closed); moving it to 0 is the opening move (trim + fader > -26)
  regler('deck/2/fader', 0); regler('deck/2/trim', -60);
  const r2 = await setze('deck/2/trim', 0, CYPHER);
  assert.equal(r2.code, 200, JSON.stringify(r2.j));
  assert.equal(teile('deck/2/trim').length, 1);
  assert.equal(teile('deck/2/trim')[0].felder.hoerschein, '');
  assert.equal(log.filter((z) => z.typ === 'seq_frei').length, 2);
  assert.ok(post);
});

test('the same on a place without a SEQ deck stays 409 kein_hoerschein; an andreas call is unchanged', async (t) => {
  const { post, uhr, teile, log, setze, seqAn, o } = await stapel(t);
  uhr(16);
  await seqAn();
  const n = o.gesendet;
  const r = await post('/regler', { pfad: 'deck/3/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_hoerschein'], JSON.stringify(r.j));
  assert.equal(teile('deck/3/fader').length, 0);
  assert.equal(o.gesendet, n, 'nothing was sent');
  assert.equal(log.filter((z) => z.typ === 'seq_frei').length, 0);
  // andreas: deck 2 (SEQ) and deck 3 (no SEQ) go through as before, the core decides, never a seq_frei log
  for (const pfad of ['deck/2/fader', 'deck/3/fader']) {
    const a = await setze(pfad, 0, ANDREAS);
    assert.equal(a.code, 200, JSON.stringify(a.j));
    assert.equal(teile(pfad).at(-1).felder.quelle, 'andreas');
    assert.equal(teile(pfad).at(-1).felder.hoerschein, '');
  }
  assert.equal(log.filter((z) => z.typ === 'seq_frei').length, 0);
});

test('a loaded PLAYING track ends the exemption: clock set, /zustand/deck status 2 on deck 2 -> 409 kein_hoerschein, nothing sent (fader and trim)', async (t) => {
  const { post, uhr, deckZustand, regler, teile, log, o, seqAn } = await stapel(t);
  uhr(16);
  await seqAn();
  deckZustand(2, 2);   // a stopped track (status 1) would be ejected by the lazy path, see the studio replay test below
  const n = o.gesendet;
  const r = await post('/regler', { pfad: 'deck/2/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_hoerschein'], JSON.stringify(r.j));
  regler('deck/2/fader', 0); regler('deck/2/trim', -60);
  const r2 = await post('/regler', { pfad: 'deck/2/trim', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r2.code, r2.j.fehler], [409, 'kein_hoerschein'], JSON.stringify(r2.j));
  assert.equal(o.gesendet, n, 'nothing was sent');
  assert.equal(teile('deck/2/fader').length + teile('deck/2/trim').length, 0);
  assert.equal(log.filter((z) => z.typ === 'seq_frei').length, 0);
  // the same call on a place whose track is gone again (status 0, what the core sends after an unload) opens
  deckZustand(2, 0);
  regler('deck/2/fader', -200); regler('deck/2/trim', 0);
});

test('without the clock feed deckStand is null: the page lets the request through (documented: the core is the stricter side)', async (t) => {
  const { uhr, deckZustand, teile, setze, seqAn } = await stapel(t);
  await seqAn();
  deckZustand(2, 1);   // no /uhr: deckStand() is null for every deck
  const r = await setze('deck/2/fader', 0, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(teile('deck/2/fader').length, 1);
  assert.ok(uhr);
});

test('no SEQ deck at all (no /live/oeffnen): 409 kein_hoerschein', async (t) => {
  const { post, uhr, teile, o } = await stapel(t);
  uhr(16);
  const n = o.gesendet;
  const r = await post('/regler', { pfad: 'deck/2/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_hoerschein'], JSON.stringify(r.j));
  assert.equal(teile('deck/2/fader').length, 0);
  assert.equal(o.gesendet, n);
});

test('/spur on deck/2/fader stays 409 kein_hoerschein with a SEQ deck and no track (automation tracks do not open decks)', async (t) => {
  const { post, uhr, teile, seqAn } = await stapel(t);
  uhr(16);
  await seqAn();
  const r = await post('/spur', { spur: { name: 'sdf', fahrten: [{ ziel: 'deck/2/fader', ab_takt: 1, nach: 0 }] } }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_hoerschein'], JSON.stringify(r.j));
  assert.equal(teile('deck/2/fader').length, 0);
});

// D4 of the plan: a part of Cypher that is still acting on deck/N/fader|trim (a running or planned ramp, opened under the empty-deck exemption) must not meet
// a track that arrives on that place by Cypher's own /laden. Andreas' load and a place without a SEQ deck are not gated.
test('/laden guard: cypher /laden onto a SEQ place during a cypher ramp on deck/2/fader is 409 kanal_offen, nothing sent; after the ramp, andreas and other places are not gated', async (t) => {
  const { post, uhr, teile, an, o, seqAn, setze } = await stapel(t);
  uhr(16);
  await seqAn();
  const ramp = await setze('deck/2/fader', 0, CYPHER, 4);   // 4 bars from the next phrase: planned at beat 32, until beat 48
  assert.equal(ramp.code, 200, JSON.stringify(ramp.j));
  assert.equal(teile('deck/2/fader').length, 1);
  const laden = (deck, kopf) => post('/laden', { deck, material_id: 'f0000000000000a1' }, kopf);
  const n = o.gesendet;
  const r = await laden(2, CYPHER);
  assert.deepEqual([r.code, r.j.fehler, r.j.kanal], [409, 'kanal_offen', 'deck/2'], JSON.stringify(r.j));
  assert.equal(o.gesendet, n, 'nothing was sent');
  assert.equal(an('/k/deck/laden').length, 0);
  // not gated: andreas on the same place, cypher on a place without a SEQ deck (the track is not in the index: the answer is the index one, never kanal_offen)
  for (const [deck, kopf] of [[2, ANDREAS], [3, CYPHER]]) {
    const x = await laden(deck, kopf);
    assert.deepEqual([x.code, x.j.fehler], [400, 'nicht_im_index'], `deck ${deck} ${JSON.stringify(kopf)}: ${JSON.stringify(x.j)}`);
  }
  // after the end of the ramp (beat 48 passed) the same call is not gated either
  uhr(60);
  const y = await laden(2, CYPHER);
  assert.deepEqual([y.code, y.j.fehler], [400, 'nicht_im_index'], JSON.stringify(y.j));
});

test('/laden guard: a ramp on the trim of the SEQ place counts too; a ramp on another place does not', async (t) => {
  const { post, uhr, regler, seqAn, setze } = await stapel(t);
  uhr(16);
  await seqAn();
  regler('deck/2/fader', 0); regler('deck/2/trim', -60);
  assert.equal((await setze('deck/2/trim', 0, CYPHER, 2)).code, 200);
  const r = await post('/laden', { deck: 2, material_id: 'f0000000000000a1' }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'kanal_offen'], JSON.stringify(r.j));
  const x = await post('/laden', { deck: 1, material_id: 'f0000000000000a1' }, CYPHER);
  assert.deepEqual([x.code, x.j.fehler], [400, 'nicht_im_index'], 'place 1 has no SEQ deck and no ramp');
});

// T3 (D6, D9): a place that becomes a SEQ deck and still holds a STOPPED track with a closed channel ejects the track (the core refuses nothing there);
// never a playing track, never with an open channel.
test('eject: anlegen on a place with a stopped loaded track sends /k/deck/entladen once; a second anlegen (seq_belegt) does not send again', async (t) => {
  const { post, uhr, deckZustand, entladen, log, o } = await stapel(t);
  uhr(16);
  deckZustand(2, 1);
  assert.equal((await post('/live/oeffnen', {})).code, 200);
  const r = await post('/seq/anlegen', { platz: 2 }, ANDREAS);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(entladen().length, 1);
  assert.equal(entladen()[0].felder.deck, 2);
  assert.equal(entladen()[0].felder.quelle, 'andreas');
  assert.equal(log.filter((z) => z.typ === 'seq_aufgeraeumt').length, 1);
  const n = o.gesendet;
  const b = await post('/seq/anlegen', { platz: 2 }, ANDREAS);
  assert.deepEqual([b.code, b.j.fehler], [409, 'seq_belegt']);
  assert.equal(entladen().length, 1);
  assert.equal(o.gesendet, n);
});

test('eject: nothing is sent for a playing track (deck_laeuft), an open channel (kanal_offen) or a place with no track', async (t) => {
  const { post, uhr, deckZustand, regler, entladen } = await stapel(t);
  uhr(16);
  assert.equal((await post('/live/oeffnen', {})).code, 200);
  deckZustand(2, 2);
  const a = await post('/seq/anlegen', { platz: 2 }, ANDREAS);
  assert.deepEqual([a.code, a.j.fehler], [409, 'deck_laeuft'], JSON.stringify(a.j));
  deckZustand(3, 1); regler('deck/3/trim', 0); regler('deck/3/fader', -6);
  const b = await post('/seq/anlegen', { platz: 3 }, ANDREAS);
  assert.deepEqual([b.code, b.j.fehler], [409, 'kanal_offen'], JSON.stringify(b.j));
  const c = await post('/seq/anlegen', { platz: 4 }, ANDREAS);   // nothing loaded on place 4
  assert.equal(c.code, 200, JSON.stringify(c.j));
  assert.equal(entladen().length, 0, 'no unload for any of the three places');
});

test('eject, studio replay 2026-11-18: SEQ deck AND a stopped track on place 2: the first cypher open is 409 with seq_geleert and one unload, the next one (track gone) opens', async (t) => {
  const { post, uhr, deckZustand, regler, entladen, teile, log, setze, seqAn } = await stapel(t);
  uhr(16);
  await seqAn();                       // the SEQ deck came first, the stopped track is on the deck player (status 1, channel closed)
  deckZustand(2, 1);
  const r1 = await post('/regler', { pfad: 'deck/2/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r1.code, r1.j.fehler, r1.j.seq_geleert], [409, 'kein_hoerschein', true], JSON.stringify(r1.j));
  assert.equal(entladen().length, 1);
  assert.deepEqual([entladen()[0].felder.deck, entladen()[0].felder.quelle], [2, 'cypher']);
  assert.equal(teile('deck/2/fader').length, 0);
  // the unload is not answered yet: a second call does not send it again
  const r2 = await post('/regler', { pfad: 'deck/2/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r2.code, r2.j.fehler, r2.j.seq_geleert], [409, 'kein_hoerschein', undefined], JSON.stringify(r2.j));
  assert.equal(entladen().length, 1);
  // what the core sends after the unload: the deck is empty again, the same call opens without a pass
  deckZustand(2, 0);
  const r3 = await setze('deck/2/fader', 0, CYPHER);
  assert.equal(r3.code, 200, JSON.stringify(r3.j));
  assert.equal(teile('deck/2/fader').length, 1);
  assert.equal(teile('deck/2/fader')[0].felder.hoerschein, '');
  assert.equal(log.filter((z) => z.typ === 'seq_aufgeraeumt').length, 1);
  assert.ok(regler);
});

// Review finding (D9 says "becomes a SEQ deck"): the lazy path must not eject a track that Andreas loaded after the SEQ deck existed, nor a track
// with a start that Andreas planned (the core's /zustand/deck has no "start planned" status: it still reads 1, and the unload cancels the start).
test('eject lazily: a track loaded AFTER the SEQ deck existed (empty deck seen first, then status 1) is not ejected, the lock stays', async (t) => {
  const { post, uhr, deckZustand, entladen, log, seqAn } = await stapel(t);
  uhr(16);
  deckZustand(2, 0);                   // the page server has seen the empty deck player of place 2
  await seqAn();
  deckZustand(2, 1);                   // Andreas loads a track onto the SEQ place afterwards
  const r = await post('/regler', { pfad: 'deck/2/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler, r.j.seq_geleert], [409, 'kein_hoerschein', undefined], JSON.stringify(r.j));
  assert.equal(entladen().length, 0, 'the track of Andreas stays on the deck');
  assert.equal(log.filter((z) => z.typ === 'seq_aufgeraeumt').length, 0);
  // a track that was there before the SEQ deck is still ejected by anlegen (creation path), whatever the page server saw before
  deckZustand(2, 0); deckZustand(3, 0); deckZustand(3, 1);
  assert.equal((await post('/seq/anlegen', { platz: 3 }, ANDREAS)).code, 200);
  assert.equal(entladen().length, 1);
  assert.equal(entladen()[0].felder.deck, 3);
});

test('eject: a planned start of Andreas (status still 1) is not cancelled, neither lazily nor at anlegen; it ends with the planned beat', async (t) => {
  const { post, uhr, deckZustand, entladen, seqAn, an, o } = await stapel(t);
  uhr(16);
  await seqAn();
  deckZustand(2, 1);                   // first sighting: a track that predates the page server (the studio case, ejectable)
  const p = post('/deck/start', { deck: 2, ab: 'phrase' }, ANDREAS);   // answers only when the planned beat has passed
  assert.ok(await bis(() => an('/k/deck/start').length === 1), 'the start has left');
  const r = await post('/regler', { pfad: 'deck/2/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler, r.j.seq_geleert], [409, 'kein_hoerschein', undefined], JSON.stringify(r.j));
  assert.equal(entladen().length, 0, 'the unload would cancel the start of Andreas');
  const ab = an('/k/deck/start')[0].felder.ab_beat;
  uhr(ab + 2);                         // the planned beat passed and the deck still reads 1: the start did not happen, the track is stopped
  const r2 = await post('/regler', { pfad: 'deck/2/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r2.code, r2.j.seq_geleert], [409, true], JSON.stringify(r2.j));
  assert.equal(entladen().length, 1);
  await p;
  // creation path: a stopped track with a planned start on a place that becomes a SEQ deck is not unloaded
  uhr(16); deckZustand(3, 1);
  const p3 = post('/deck/start', { deck: 3, ab: 'phrase' }, ANDREAS);
  assert.ok(await bis(() => an('/k/deck/start').length === 2));
  const n = entladen().length;
  assert.equal((await post('/seq/anlegen', { platz: 3 }, ANDREAS)).code, 200);
  assert.equal(entladen().length, n, 'no unload of a track with a planned start');
  uhr(1000);
  await p3;
  assert.ok(o);
});

test('eject lazily: a playing track is never ejected (409 without seq_geleert); a place without a SEQ deck is not touched; andreas is not touched', async (t) => {
  const { post, uhr, deckZustand, entladen, seqAn } = await stapel(t);
  uhr(16);
  await seqAn();
  deckZustand(2, 2);
  const a = await post('/regler', { pfad: 'deck/2/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([a.code, a.j.fehler, a.j.seq_geleert], [409, 'kein_hoerschein', undefined], JSON.stringify(a.j));
  deckZustand(3, 1);   // place 3 has no SEQ deck
  const b = await post('/regler', { pfad: 'deck/3/fader', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([b.code, b.j.fehler, b.j.seq_geleert], [409, 'kein_hoerschein', undefined], JSON.stringify(b.j));
  assert.equal(entladen().length, 0);
});

test('a refused or failing core unload is no error of the SEQ write (anlegen stays 200, the failure is logged)', async (t) => {
  const { post, uhr, deckZustand, entladen, log, o } = await stapel(t);
  uhr(16);
  assert.equal((await post('/live/oeffnen', {})).code, 200);
  deckZustand(2, 1);
  const senden = o.kern.sende.bind(o.kern);
  o.kern.sende = (adresse, felder) => { if (adresse === '/k/deck/entladen') throw new Error('send failed'); return senden(adresse, felder); };
  const r = await post('/seq/anlegen', { platz: 2 }, ANDREAS);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(entladen().length, 0);
  assert.deepEqual(log.filter((z) => z.typ === 'seq_aufraeumen_fehler').map((z) => z.deck), [2]);
  assert.equal(log.filter((z) => z.typ === 'seq_aufgeraeumt').length, 0);
});
