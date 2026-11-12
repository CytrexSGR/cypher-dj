// S17 task 3: capture the sound snapshot (bkMerken, bkLage) and the routes /proj/bk, /proj/bk/merken, /proj/bk/laden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefKontext, sitzung, ist } from './support/proj_context.mjs';
import { BK_KANAELE, setzeVorgabenQuelle } from '../project/modular.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { stapel } from './support/media_library.mjs';
import { ruf, CYPHER } from './support/proj_stack.mjs';

const HASH = 'b'.repeat(64);
const acht = (x) => Array(8).fill(x);
const alle = (x) => Array(64).fill(x);
const werte = (s, kanal, w) => w.forEach((x, i) => ist(s, `${kanal}/bk/${i + 1}`, x));
async function offenMit(t, opt = {}) {
  const e = sitzung(t, {}, pruefKontext({ baukasten: true, ...opt }));
  setzeVorgabenQuelle(() => Array(64).fill(0.5));   // the session wires the real graph folder; these graph names are fixtures: known, without vorgabe
  await e.s.neu('P', 'andreas');
  return e;
}
// session methods throw ProjFehler (the routes turn it into an answer)
const antwort = async (p) => { try { return await p; } catch (e) { if (e.fehler === undefined) throw e; return { code: e.code, j: { fehler: e.fehler, ...e.extra } }; } };
const baukasten = (e) => e.s.aktuell().j.projekt.baukasten;

test('S17 T3.1 merken captures name, eight values and hash in ONE history entry', async (t) => {
  const { s, k } = await offenMit(t);
  k.bk.geladen['erz/2'] = 'juno-pad-dyn'; k.bk.hash['juno-pad-dyn'] = HASH;
  werte(s, 'erz/2', [0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5]);
  const n0 = s.verlaufListe().j.length;
  const r = await antwort(s.bkMerken({}, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(baukasten({ s }), [{ id: 'erz2', graph: 'juno-pad-dyn', regler: [0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5], sha256: HASH }]);
  const v = s.verlaufListe().j;
  assert.equal(v.length, n0 + 1, 'exactly one history entry');
  assert.equal(v.at(-1).label, 'Baukasten: save sound');
  assert.deepEqual(r.j.bk.gemerkt, ['erz/2']);
});

test('S17 T3.2 the default set is erz/2, erz/3, deck/1..4; named channels can add fx/3', async (t) => {
  const { s, k } = await offenMit(t);
  k.bk.geladen['erz/2'] = 'a'; k.bk.geladen['deck/1'] = 'fx-bandecho'; k.bk.geladen['fx/3'] = 'fx-hall';
  const n0 = s.verlaufListe().j.length;
  assert.equal((await s.bkMerken({}, 'andreas')).code, 200);
  assert.equal(s.verlaufListe().j.length, n0 + 1, 'two channels, still ONE history entry');
  assert.deepEqual(baukasten({ s }).map((e) => e.id), ['erz2', 'deck1'], 'fx3 is not in the default set');
  const r = await antwort(s.bkMerken({ kanaele: ['fx/3'] }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const fx = baukasten({ s }).find((e) => e.id === 'fx3');
  assert.deepEqual(fx, { id: 'fx3', graph: 'fx-hall', regler: acht(0.5) });
});

test('S17 T3.3 an unknown live value keeps the stored value (first capture 0.5) and is reported', async (t) => {
  const { s, k } = await offenMit(t);
  k.bk.geladen['erz/2'] = 'a';
  for (const n of [1, 2, 3, 4, 6, 7, 8]) ist(s, `erz/2/bk/${n}`, 0.3);   // knob 5 stays unknown
  for (let n = 9; n <= 64; n++) ist(s, `erz/2/bk/${n}`, 0.5);   // knobs 9..64 are known and untouched: the stored array stays at 8 numbers
  const r = await antwort(s.bkMerken({}, 'andreas'));
  assert.deepEqual(baukasten({ s })[0].regler, [0.3, 0.3, 0.3, 0.3, 0.5, 0.3, 0.3, 0.3]);
  assert.deepEqual(r.j.bk.unbekannt, ['erz/2/bk/5']);
  // second capture: the stored 0.5 of knob 5 stays when knob 5 is still unknown, known knobs are updated
  ist(s, 'erz/2/bk/1', 0.8);
  await s.bkMerken({}, 'andreas');
  assert.deepEqual(baukasten({ s })[0].regler, [0.8, 0.3, 0.3, 0.3, 0.5, 0.3, 0.3, 0.3]);
  // a known knob 5 is taken over
  ist(s, 'erz/2/bk/5', 0.1);
  const r3 = await s.bkMerken({}, 'andreas');
  assert.equal(baukasten({ s })[0].regler[4], 0.1); assert.deepEqual(r3.j.bk.unbekannt, []);
});

test('S17 T3.4 refusals', async (t) => {
  const { s, k } = await offenMit(t);
  const n0 = s.verlaufListe().j.length;
  let r = await antwort(s.bkMerken({ kanaele: ['erz/3'] }, 'andreas'));
  assert.deepEqual([r.code, r.j.fehler], [409, 'bk_nicht_geladen']);
  r = await antwort(s.bkMerken({}, 'andreas'));
  assert.deepEqual([r.code, r.j.fehler], [409, 'bk_nichts_geladen']);
  k.bk.geladen['erz/2'] = 'a';
  r = await antwort(s.bkMerken({ kanaele: ['erz/4'] }, 'andreas'));
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig']);
  r = await antwort(s.bkMerken({ kanaele: 'erz/2' }, 'andreas'));
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig']);
  k.ki = true;
  r = await antwort(s.bkMerken({}, 'cypher'));
  assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt']);
  k.ki = false;
  assert.equal(s.verlaufListe().j.length, n0, 'nothing written by any refusal');
  assert.equal(baukasten({ s }), undefined);
  assert.equal((await s.bkMerken({}, 'andreas')).code, 200, 'negative control: the same state saves');
  // no project
  const leer = sitzung(t, {}, pruefKontext({ baukasten: true }));
  r = await antwort(leer.s.bkMerken({}, 'andreas'));
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_projekt']);
  // no bridge
  const ohne = sitzung(t, {}, pruefKontext());
  await ohne.s.neu('Q', 'andreas');
  r = await antwort(ohne.s.bkMerken({}, 'andreas'));
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_baukasten']);
});

test('S17 T3.5 a plain merken never removes a saved entry', async (t) => {
  const { s, k } = await offenMit(t);
  k.bk.geladen['erz/3'] = 'x'; k.bk.geladen['erz/2'] = 'y';
  await s.bkMerken({}, 'andreas');
  assert.deepEqual(baukasten({ s }).map((e) => e.id), ['erz2', 'erz3']);
  delete k.bk.geladen['erz/3'];   // e.g. a stale map after a server restart
  await s.bkMerken({}, 'andreas');
  assert.deepEqual(baukasten({ s }).map((e) => e.id), ['erz2', 'erz3'], 'erz3 kept');
});

test('S17 T3.6 bkLage compares saved and live per channel', async (t) => {
  const { s, k } = await offenMit(t);
  k.bk.geladen['erz/2'] = 'juno-pad-dyn';
  werte(s, 'erz/2', alle(0.5)); ist(s, 'erz/2/bk/3', 0.9);
  await s.bkMerken({}, 'andreas');
  const zeile = (j, kanal) => j.kanaele.find((x) => x.kanal === kanal);
  let j = s.bkLage().j;
  assert.equal(j.kanaele.length, BK_KANAELE.length, 'every table row present');
  assert.equal(zeile(j, 'erz/2').gleich, true);
  assert.equal(zeile(j, 'erz/2').gespeichert, 'juno-pad-dyn'); assert.equal(zeile(j, 'erz/2').live, 'juno-pad-dyn');
  ist(s, 'erz/2/bk/3', 0.2);
  assert.equal(zeile(s.bkLage().j, 'erz/2').gleich, false, 'a changed knob differs');
  ist(s, 'erz/2/bk/3', 0.9);
  assert.equal(zeile(s.bkLage().j, 'erz/2').gleich, true, 'back to the saved value');
  k.bk.geladen['erz/2'] = 'other';
  assert.equal(zeile(s.bkLage().j, 'erz/2').gleich, false, 'another graph loaded differs');
  k.bk.geladen['erz/2'] = 'juno-pad-dyn';
  // a row without a saved entry
  j = s.bkLage().j;
  assert.equal(zeile(j, 'erz/3').gespeichert, null); assert.equal(zeile(j, 'erz/3').gleich, false);
  assert.equal(j.gespeichert.length, 1);
});

test('S17 T3.7 an unknown live value makes gleich null', async (t) => {
  const { s, k } = await offenMit(t);
  k.bk.geladen['erz/2'] = 'a';
  werte(s, 'erz/2', alle(0.5));
  await s.bkMerken({}, 'andreas');
  assert.equal(s.bkLage().j.kanaele.find((x) => x.kanal === 'erz/2').gleich, true);
  s.lage.regler.delete('erz/2/bk/5');   // the live value of one knob is unknown again
  const z = s.bkLage().j.kanaele.find((x) => x.kanal === 'erz/2');
  assert.equal(z.gleich, null); assert.equal(z.regler_live[4], null); assert.equal(z.regler_live[0], 0.5);
});

// --- routes on the real stack ------------------------------------------------------------------------------------------------------
test('S17 T3.8 routes answer like the session methods; a foreign origin is refused', async (t) => {
  const { o, url } = await stapel(t);
  const proj = o.routen().filter((e) => e.bereich === 'proj');
  for (const r of ['GET /proj/bk', 'POST /proj/bk/merken', 'POST /proj/bk/laden']) assert.ok(proj.some((e) => `${e.methode} ${e.pfad}` === r), r);
  assert.deepEqual(await ruf(url, 'GET', '/proj/bk'), { code: 409, j: { fehler: 'kein_projekt', text: GRUND_TEXT.kein_projekt } });
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'B' })).code, 200);
  const l = await ruf(url, 'GET', '/proj/bk');
  assert.equal(l.code, 200); assert.equal(l.j.kanaele.length, BK_KANAELE.length); assert.deepEqual(l.j.gespeichert, []);
  const m = await ruf(url, 'POST', '/proj/bk/merken', {});
  assert.deepEqual([m.code, m.j.fehler, m.j.text], [409, 'bk_nichts_geladen', GRUND_TEXT.bk_nichts_geladen]);
  const c = await ruf(url, 'POST', '/proj/bk/merken', {}, CYPHER);
  assert.equal(c.code, 409);
  const ld = await ruf(url, 'POST', '/proj/bk/laden', {});
  assert.deepEqual([ld.code, ld.j.baukasten], [200, []], 'nothing saved: nothing to apply');
  const fremd = await fetch(`${url}/proj/bk/merken`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://boese.example' }, body: '{}' });
  assert.equal(fremd.status, 403);
});

test('64 knobs: a touched knob 9 and 64 are captured, the array grows to 64; back to default shrinks it to 8', async (t) => {
  const { s, k } = await offenMit(t);
  k.bk.geladen['erz/2'] = 'a';
  werte(s, 'erz/2', alle(0.5)); ist(s, 'erz/2/bk/9', 0.7); ist(s, 'erz/2/bk/64', 0.2);
  await s.bkMerken({}, 'andreas');
  const r = baukasten({ s })[0].regler;
  assert.equal(r.length, 64); assert.equal(r[8], 0.7); assert.equal(r[63], 0.2);
  assert.equal(s.bkLage().j.kanaele.find((x) => x.kanal === 'erz/2').gleich, true);
  ist(s, 'erz/2/bk/64', 0.5);
  assert.equal(s.bkLage().j.kanaele.find((x) => x.kanal === 'erz/2').gleich, false, 'knob 64 moved away from the stored value');
  ist(s, 'erz/2/bk/9', 0.5);
  await s.bkMerken({}, 'andreas');
  assert.equal(baukasten({ s })[0].regler.length, 8);
});
