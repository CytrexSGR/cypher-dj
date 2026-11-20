// Plan live-module task 4: the page side of the live modules. Pure parts of public/live_module.js: the model of the live container slots (empty,
// separating, ready, failed), the key distance and the open-with-confirmation flow. (The panel markup and its calls left with the module panel.)
// The wiring in app.js and index.html is checked by reading both files (the screenshots of the task cover the rest).
import { liesApp, APP_DATEIEN } from './helpers/app_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neuesProjekt } from '../project/model.ts';
import { baueModul, baueNeuePfade, liveSlots } from '../project/live.ts';
import { modulAnsicht, oeffneLive, tonartAnsicht, kanalAnsicht } from '../public/live_module.js';
const importVon = (datei, vor = './') => new RegExp(`from '${(vor + datei).replace(/[.]/g, '\\.')}'`);   // the file name stays a plain literal so the export's file renaming rewrites it too (a regex literal escapes the dot and escapes the rewrite)

const HIER = path.dirname(fileURLToPath(import.meta.url));
const HASH = 'c'.repeat(64), D = (n) => ({ sha256: n.repeat(64), pfad: `/x/${n}.wav` });
const herkunft = (extra = {}) => ({ quelle_sha256: HASH, titel: 'Night <Drive>', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 126,
  tonart: '8A', datum: '2026-11-12', ...extra });
const LOOP = { ...D('e'), beats: 16, frames: 16 * 24000 };
const live = () => { const p = neuesProjekt('live'); p.live = true; return p; };
const vier = () => ({ drums: D('1'), bass: D('2'), other: D('3'), vocals: D('4') });

test('no open project, or a production project: the panel is closed (offen false), no slot cards', () => {
  assert.equal(modulAnsicht(null, {}, null).offen, false);
  assert.equal(modulAnsicht(neuesProjekt('prod'), {}, null).offen, false);
});

test('the live container without modules renders two empty slots A and B', () => {
  const a = modulAnsicht(live(), { A: null, B: null }, null);
  assert.equal(a.offen, true);
  assert.deepEqual(a.slots.map((s) => [s.slot, s.zustand.art, s.leer]), [['A', 'leer', true], ['B', 'leer', true]]);
});

test('a module with four stems: title (escaped), origin, module fader, one original fader per stem, clear button, state ready', () => {
  const p = baueModul(live(), 'A', LOOP, vier(), herkunft());
  const stand = { A: { gruppe_id: liveSlots(p).A, titel: 'Night <Drive>', stems: { stems: 'fertig' } }, B: null };
  const a = modulAnsicht(p, stand, null);
  const s = a.slots[0];
  assert.equal(s.zustand.art, 'bereit');
  assert.equal(s.titel, 'Night <Drive>');
  assert.equal(s.faderDb, 0);
  assert.deepEqual(s.stems.map((x) => [x.name, x.faderDb]), [['Drums', 0], ['Bass', 0], ['Other', 0], ['Vocals', 0]]);
  assert.ok(s.stems.every((x) => /^s\d+$/.test(x.spurId)), 'the original track of each stem is the fader target');
  assert.equal(a.slots[1].leer, true);
});

test('separation progress: waiting, running with percent from the proj_stems state of the same job, failed with its reason and a retry', () => {
  const p = baueModul(live(), 'B', LOOP, {}, herkunft());
  const id = liveSlots(p).B;
  const mit = (st, stems) => modulAnsicht(p, { A: null, B: { gruppe_id: id, stems: st } }, stems).slots[1];
  assert.deepEqual(mit({ stems: 'wartet' }, null).zustand, { art: 'trennt', text: 'SEPARATING', prozent: null });
  assert.deepEqual(mit({ stems: 'laeuft', auftrag_id: 7 }, { auftrag_id: 7, zustand: 'laeuft', prozent: 41.6 }).zustand, { art: 'trennt', text: 'SEPARATING 42 %', prozent: 42 });
  assert.equal(mit({ stems: 'laeuft', auftrag_id: 7 }, { auftrag_id: 6, zustand: 'laeuft', prozent: 90 }).zustand.prozent, null, 'another job is not ours');
  const f = mit({ stems: 'fehler', grund: 'gpu_belegt', text: 'not enough free memory on the GPU' }, null);
  assert.equal(f.zustand.art, 'fehler');
  assert.equal(f.zustand.text, 'not enough free memory on the GPU');
  assert.equal(f.stems.length, 0);
});

test('open the live container: a plain open, or the confirmation when the server says live_laeuft, and no second post when declined', async () => {
  const ruf = [];
  const einfach = await oeffneLive(async (w, k) => { ruf.push([w, k]); return { status: 200, j: { slug: 'live' } }; }, () => assert.fail('no question'));
  assert.deepEqual(einfach, { ok: true, text: 'Live container open' });
  assert.deepEqual(ruf, [['/live/oeffnen', {}]]);
  const laeuft = { status: 409, j: { fehler: 'live_laeuft' } };
  const f = [];
  const bestaetigt = await oeffneLive(async (w, k) => { f.push(k); return k.bestaetigt ? { status: 200, j: { slug: 'live' } } : laeuft; }, (t) => { assert.match(t, /stop/i); return true; });
  assert.deepEqual(f, [{}, { bestaetigt: true }]);
  assert.equal(bestaetigt.ok, true);
  const g = [];
  const nein = await oeffneLive(async (w, k) => { g.push(k); return laeuft; }, () => false);
  assert.equal(g.length, 1);
  assert.deepEqual(nein, { ok: false, text: 'Live container not opened', abgelehnt: true });
});

test('wiring: EXPORT button on decks 1 to 3 in the loop row, the loop deck containers instead of the module panel, SSE', () => {
  const app = liesApp();
  const html = fs.readFileSync(path.join(HIER, '..', 'public', 'index.html'), 'utf8');
  assert.match(app, importVon('live_module.js'));
  assert.match(app, /data-exportloop/);
  assert.doesNotMatch(html, /id="live-panel"|class="live-slot"|data-slot=/, 'the module panel is gone from the page');
  assert.deepEqual([...html.matchAll(/<div class="loopdeck" data-deck="(\d)"><\/div>/g)].map((m) => m[1]), ['1', '2'], 'two empty loop deck containers (the deck view fills them)');
  assert.match(app, /case 'modul'/);
});

test('review fix 7: the production project choice confirms on live_laeuft and repeats with bestaetigt, no second post when declined', async () => {
  const { mitBestaetigung } = await import('../public/production/project_choice.js');
  const laeuft = { status: 409, j: { fehler: 'live_laeuft' } };
  for (const pfad of ['/proj/oeffnen', '/proj/neu']) {
    const f = [], fragen = [];
    const r = await mitBestaetigung(async (w, k) => { f.push([w, k]); return k.bestaetigt ? { status: 200, j: { slug: 'x', projekt: {} } } : laeuft; },
      pfad, { slug: 'x' }, (t) => { fragen.push(t); return true; });
    assert.equal(r.status, 200);
    assert.deepEqual(f, [[pfad, { slug: 'x' }], [pfad, { slug: 'x', bestaetigt: true }]]);
    assert.match(fragen[0], /Modules are playing in the live container\. Opening another project stops them\. Open anyway\?/);
    const g = [];
    const nein = await mitBestaetigung(async (w, k) => { g.push(k); return laeuft; }, pfad, { slug: 'x' }, () => false);
    assert.equal(g.length, 1);
    assert.equal(nein.abgelehnt, true);
  }
  const andere = await mitBestaetigung(async () => ({ status: 409, j: { fehler: 'beschaeftigt' } }), '/proj/oeffnen', { slug: 'x' },
    () => assert.fail('no question'));
  assert.equal(andere.j.fehler, 'beschaeftigt');
  const src = fs.readFileSync(path.join(HIER, '..', 'public', 'production', 'project_choice.js'), 'utf8');
  assert.equal((src.match(/mitBestaetigung\(ctx\.holeJson/g) ?? []).length, 2, 'both the open and the new path use it');
});

const NOTEN = [{ beat: 0, laenge: 0.25, ton: 36, vel: 100 }];
const mitPfad = () => baueNeuePfade(baueModul(live(), 'A', LOOP, vier(), herkunft()), 'A', { drums: NOTEN });
const standA = (p, extra = {}) => ({ A: { gruppe_id: liveSlots(p).A, stems: { stems: 'fertig' }, ...extra }, B: null });

test('a stem with a new path gets the rows original fader, new fader and blend; the others only the original fader', () => {
  const p = mitPfad();
  const a = modulAnsicht(p, standA(p), null);
  const [drums, bass] = a.slots[0].stems;
  assert.deepEqual([drums.stem, drums.neu.faderDb, drums.blend], ['drums', -200, 0]);
  assert.equal(bass.neu, undefined);
});

test('DJ view places: the slot row has no MODULE slider and no CUE button, shows its channel (Loop 1 on pad/1, Loop 2 on pad/2) open or closed', () => {
  const p = mitPfad();
  const g = p.gruppen.find((x) => x.id === liveSlots(p).A);
  const zu = modulAnsicht(p, standA(p), null, { 'pad/1/trim': 0, 'pad/1/fader': -200 }).slots[0];
  assert.deepEqual(zu.kanal, kanalAnsicht('A', { 'pad/1/trim': 0, 'pad/1/fader': -200 }));
  assert.deepEqual([zu.kanal.pfad, zu.kanal.name, zu.kanal.offen], ['pad/1', 'Loop 1', false]);
  assert.equal('cue' in zu, false, 'no cue state in the slot model');
  const offen = modulAnsicht(p, standA(p), null, { 'pad/1/trim': 0, 'pad/1/fader': -6 });
  assert.equal(offen.slots[0].kanal.offen, true);
  assert.equal(offen.slots[1].kanal.pfad, 'pad/2', 'slot B is Loop 2 on pad/2');
  assert.equal(offen.slots[1].kanal.offen, false);
  assert.ok(g.nr > 0);
  // the rule is the one of kanalOffen (hand_operation.ts): -26 dB is still closed, an unknown fader is closed, an unknown trim is 0
  assert.equal(kanalAnsicht('A', { 'pad/1/fader': -26 }).offen, false);
  assert.equal(kanalAnsicht('A', { 'pad/1/fader': -25.5 }).offen, true);
  assert.equal(kanalAnsicht('B', {}).offen, false);
  assert.equal(kanalAnsicht('B', { 'pad/2/trim': 12, 'pad/2/fader': -30 }).offen, true);
});

test('the live module helpers of the cue are gone from the page code', () => {
  for (const f of ['live_module.js', ...APP_DATEIEN]) {
    const t = fs.readFileSync(path.join(HIER, '..', 'public', f), 'utf8');
    assert.doesNotMatch(t, /cuePfad|cueAn|cueGriff|data-cue\b|closest\('\[data-cue\]'\)|data-modul-fader|modulFader/, f);
  }
});

test('KEY: shows the distance from /modul/stand, off when 0 or unknown, posts the slot', async () => {
  assert.deepEqual(tonartAnsicht({ tonart_abstand: 3 }), { abstand: 3, aus: false, text: 'KEY +3', titel: 'Transpose this module by +3 semitones to the deck on the master' });
  assert.equal(tonartAnsicht({ tonart_abstand: -2 }).text, 'KEY −2');
  assert.equal(tonartAnsicht({ tonart_abstand: 0 }).aus, true);
  assert.equal(tonartAnsicht({ tonart_abstand: null, tonart_grund: 'kein_deck' }).aus, true);
  assert.match(tonartAnsicht({ tonart_abstand: null, tonart_grund: 'kein_deck' }).titel, /kein_deck/);
});

test('wiring: the module panel handlers are gone; the L1/L2 strips write pad/N/fader; the channel state redraws on pad/N rows', () => {
  const app = liesApp();
  const kurven = fs.readFileSync(path.join(HIER, '..', 'public', 'curves.js'), 'utf8');
  assert.match(kurven, /LOOPBOXEN = \['pad\/1', 'pad\/2'\]/, 'the loop strips L1, L2 are the channels pad/1, pad/2');
  assert.match(app, /e\.dataset\.pfad = `\$\{k\}\/\$\{e\.dataset\.teil\}`/, 'every control of the L1/L2 strip (fader included) writes <channel>/<part>');
  assert.doesNotMatch(app, /live-blendregler|sendeBlend|passeTonartAn\(slot, holeJson\)|bindeLive\b|#live-panel/);
  assert.match(app, /pad\\\/\[12\]\\\/\(fader\|trim\)\$\/\.test\(f\.pfad\) && liveOffen\(\)/);
});
