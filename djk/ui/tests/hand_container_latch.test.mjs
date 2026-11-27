// Container core M8: the hearing guard of /regler by container type (table D3 of the M plan), one test row per cell.
// Cypher opens a closed container strip: track needs a Hörschein of the player with the container's number, SEQ is free only while no track is
// loaded (F10 R2), strudel and leer are free, loops and stems are free (strand 11; the ramp rule guards them). Andreas's hand is never gated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz } from './support/instance.mjs';
import { containerFrei, containerVonPfad, seqDeckFrei, oeffnet } from '../hand_operation.ts';

belegeTestInstanz();
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const teile = (s) => s.log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil');
const ack = (o, f) => o.vomKern({ adresse: '/q', felder: { id: f.id, quelle: f.quelle, status: 2, ist_sample: 0, ist_beat: 0, grund: '' } });

async function regler(s, pfad, kopf) {
  const n0 = teile(s).length;
  const p = s.post('/regler', { pfad, nach: -6, takte: 0 }, kopf);
  let fertig = false;
  void p.then(() => { fertig = true; });
  for (let i = 0; i < 250 && !fertig; i++) {
    if (teile(s).length > n0) { ack(s.o, teile(s).at(-1).felder); break; }
    await warte(20);
  }
  return p;
}
const schein = (deck) => ({
  hs_id: `ohr-${deck}-t`, kanal: `deck/${deck}`, inhalt: '', deck, bpm: 128, gemessen_von_beat: 0, gemessen_bis_beat: 16, gueltig_bis_beat: 1e9, quell_von: 0, quell_bis: 16,
  erneuerung: 0, sync_ms: 0, deck_gegen_deck_ms: 0, lufs_kurz: -20, pegel_diff_db: 0, baender_db: [-20, -20, -20, -20, -20, -20], urteil: 'ok', gruende: [],
  laufend_baender_db: [-20, -20, -20, -20, -20, -20], ueberdeckung: { sub: 0, tief: 0, tiefmitte: 0, mitte: 0, praesenz: 0, hoerch: 0 }, summe_spitze_db: -6, clip_anteil: 0,
  eq_vorschlag: { tief: 0, mitte: 0, hoch: 0 },
});
const CONTAINER = ['deck/1', 'deck/2', 'pad/1', 'pad/2'];

test('pure table: containerFrei by place type and loaded track; containerVonPfad; seqDeckFrei on container paths; oeffnet knows container strips only', () => {
  assert.deepEqual(['track', 'seq', 'strudel', 'leer', 'loops', 'stems'].map((t) => containerFrei(t, false)), ['hoerschein', 'frei', 'frei', 'frei', 'frei', 'frei']);
  assert.equal(containerFrei('seq', true), 'hoerschein', 'F10 R2: a SEQ deck is free only while no track is loaded');
  assert.equal(containerFrei('strudel', true), 'frei');
  assert.equal(containerFrei(undefined, false), 'hoerschein', 'no project places: the old deck rule');
  assert.deepEqual(CONTAINER.map((p) => containerVonPfad(`${p}/fader`)), [1, 2, 3, 4]);
  for (const p of ['deck/3/fader', 'deck/4/trim', 'erz/1/fader', 'pad/1/eq/tief', 'spur/9/fader']) assert.equal(containerVonPfad(p), null, p);
  assert.equal(seqDeckFrei('pad/1/fader', new Set([3]), new Set()), true, 'place 3 is container C = pad/1');
  assert.equal(seqDeckFrei('pad/1/fader', new Set([3]), new Set([3])), false);
  assert.equal(seqDeckFrei('deck/3/fader', new Set([3]), new Set()), false, 'deck/3 has no strip any more');
  assert.equal(oeffnet({}, 'deck/3/fader', -6), false);
  assert.equal(oeffnet({}, 'erz/2/fader', -6), false);
  assert.equal(oeffnet({}, 'pad/2/fader', -6), true);
});

// one live server; the type of a place is set in the open project for each row (the guard reads the project places)
const ZEILEN = [
  // type, path, container, expected for Cypher without any hearing check
  ['track', 'deck/1/fader', 1, 'kein_hoerschein'],
  ['track', 'deck/2/trim', 2, 'kein_hoerschein'],
  ['track', 'pad/1/fader', 3, 'kein_hoerschein'],
  ['track', 'pad/2/fader', 4, 'kein_hoerschein'],
  ['seq', 'deck/1/fader', 1, 'frei'],
  ['seq', 'pad/2/trim', 4, 'frei'],
  ['strudel', 'pad/1/fader', 3, 'frei'],
  ['strudel', 'deck/2/fader', 2, 'frei'],
  ['leer', 'deck/1/fader', 1, 'frei'],
  ['leer', 'pad/2/fader', 4, 'frei'],
  ['loops', 'deck/2/fader', 2, 'nur_rampe'],   // strand 11: loops and stems are free, but an unknown (closed) fader to -6 dB is a jump: ramp
  ['loops', 'pad/1/trim', 3, 'nur_rampe'],   // trim -30 -> -6 dB in one step is a raise of 24 dB: it needs a ramp
  ['stems', 'pad/2/fader', 4, 'nur_rampe'],
  ['stems', 'deck/1/fader', 1, 'nur_rampe'],
];
test('D3 table: container type x Cypher opening a closed strip without a hearing check', async (t) => {
  const s = await echterServer(t, 'hr', 0);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  for (const [typ, pfad, platz, erwartet] of ZEILEN) {
    const alt = s.projekt().plaetze[platz - 1];
    s.projekt().plaetze[platz - 1] = typ === 'track' || typ === 'leer' ? { typ } : { typ, gruppe: alt.gruppe ?? 'g-test' };
    const strip = pfad.replace(/\/(fader|trim)$/, '');
    if (pfad.endsWith('/trim')) Object.assign(s.o.stand.regler, { [`${strip}/fader`]: 0, [`${strip}/trim`]: -30 });   // closed by the trim: the move to -6 dB opens it
    const n0 = teile(s).length;
    const r = await regler(s, pfad, CYPHER);
    delete s.o.stand.regler[`${strip}/fader`]; delete s.o.stand.regler[`${strip}/trim`];
    if (erwartet === 'frei') {
      assert.equal(r.code, 200, `${typ} ${pfad}: ${JSON.stringify(r.j)}`);
      assert.equal(teile(s).length, n0 + 1, `${typ} ${pfad}: part sent`);
      assert.equal(teile(s).at(-1).felder.hoerschein, '', `${typ} ${pfad}: no hearing check carried`);
    } else {
      assert.deepEqual([r.code, r.j.fehler], [409, erwartet], `${typ} ${pfad}: ${JSON.stringify(r.j)}`);
      assert.equal(teile(s).length, n0, `${typ} ${pfad}: nothing sent`);
    }
    s.projekt().plaetze[platz - 1] = alt;
  }
});

test('a SEQ deck is free only without a track on its player (R2): a loaded track on the player puts the strip back under the hearing check', async (t) => {
  const s = await echterServer(t, 'hr', 1);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  s.projekt().plaetze[0] = { typ: 'seq', gruppe: 'g-test' };
  s.o.kern.uhr = { beat: 0, bpm: 128, mono_ns: 0 };
  assert.equal((await regler(s, 'deck/1/fader', CYPHER)).code, 200, 'no track loaded: free');
  s.o.vomKern({ adresse: '/zustand/deck', felder: { deck: 1, status: 1, material_id: 'f0000000000000a1', basis_bpm: 120, fassung: 1, quell_beat: 0, beats_bis_ende: 64, faktor: 1, vorlauf_ms: 0 } });
  assert.notEqual(s.o.deckStand(1), null, 'the track is loaded on player 1');
  const n0 = teile(s).length;
  const r = await regler(s, 'deck/1/fader', CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_hoerschein'], JSON.stringify(r.j));
  assert.equal(teile(s).length, n0);
});

test('track: a valid Hörschein of player 3 opens container C; a Hörschein of player 1 does not', async (t) => {
  const s = await echterServer(t, 'hr', 2);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  assert.equal(s.projekt().plaetze[2].typ, 'strudel');
  s.projekt().plaetze[2] = { typ: 'track' };
  s.o.kern.uhr = { beat: 0, bpm: 128, mono_ns: 0 };
  s.o.hoerscheine['deck/1'] = schein(1);
  const falsch = await regler(s, 'pad/1/fader', CYPHER);
  assert.deepEqual([falsch.code, falsch.j.fehler], [409, 'kein_hoerschein'], 'the check of player 1 is not the one of container C');
  s.o.hoerscheine['deck/3'] = schein(3);
  const r = await regler(s, 'pad/1/fader', CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(teile(s).at(-1).felder.hoerschein, 'ohr-3-t', 'the part carries the check of player 3');
});

test("Andreas's hand is never gated, whatever the type of the place", async (t) => {
  const s = await echterServer(t, 'hr', 3);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  for (const typ of ['track', 'seq', 'strudel', 'leer', 'loops', 'stems']) {
    s.projekt().plaetze[0] = typ === 'track' || typ === 'leer' ? { typ } : { typ, gruppe: 'g-test' };
    const r = await regler(s, 'deck/1/fader', {});
    assert.equal(r.code, 200, `${typ}: ${JSON.stringify(r.j)}`);
  }
});
