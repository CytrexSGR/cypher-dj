// Plan live-module task 4: the page side of the live modules. Pure parts of public/live_module.js: the export button state, the model and markup of
// the live container panel (two slots: empty, separating, ready, failed), the fader commands, the open-with-confirmation flow and the export calls.
// The wiring in app.js and index.html is checked by reading both files (the screenshots of the task cover the rest).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neuesProjekt } from '../project/model.ts';
import { baueModul, baueNeuePfade, liveSlots } from '../project/live.ts';
import { modulAnsicht, modulHtml, exportKnopf, faderBefehl, oeffneLive, exportiere, leere, trenneNeu, LEER_TAKTE, setzeBlend, passeTonartAn, tonartAnsicht, cueGriff, cueGriffe, cueAn } from '../public/live_module.js';

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
  assert.equal(modulHtml(modulAnsicht(null, {}, null)), '');
});

test('the live container without modules renders two empty slots A and B', () => {
  const a = modulAnsicht(live(), { A: null, B: null }, null);
  assert.equal(a.offen, true);
  assert.deepEqual(a.slots.map((s) => [s.slot, s.zustand.art, s.leer]), [['A', 'leer', true], ['B', 'leer', true]]);
  const h = modulHtml(a);
  assert.equal((h.match(/data-slot="/g) ?? []).length, 2);
  assert.match(h, /data-slot="A"[^>]*class="[^"]*\bleer\b/);
  assert.match(h, /data-slot="B"[^>]*class="[^"]*\bleer\b/);
  assert.match(h, /EMPTY/);
  assert.doesNotMatch(h, /data-leeren|data-modul-fader/, 'an empty slot has nothing to clear or fade');
});

test('a module with four stems: title (escaped), origin, module fader, one original fader per stem, clear button, state ready', () => {
  const p = baueModul(live(), 'A', LOOP, vier(), herkunft());
  const stand = { A: { gruppe_id: liveSlots(p).A, titel: 'Night <Drive>', stems: { stems: 'fertig' } }, B: null };
  const a = modulAnsicht(p, stand, null);
  const s = a.slots[0];
  assert.equal(s.zustand.art, 'bereit');
  assert.equal(s.titel, 'Night <Drive>');
  assert.equal(s.faderDb, -200);
  assert.deepEqual(s.stems.map((x) => [x.name, x.faderDb]), [['Drums', 0], ['Bass', 0], ['Other', 0], ['Vocals', 0]]);
  assert.ok(s.stems.every((x) => /^s\d+$/.test(x.spurId)), 'the original track of each stem is the fader target');
  assert.equal(a.slots[1].leer, true);
  const h = modulHtml(a);
  assert.match(h, /Night &lt;Drive&gt;/);
  assert.doesNotMatch(h, /Night <Drive>/);
  assert.match(h, /126 BPM/); assert.match(h, /8A/); assert.match(h, /Art/);
  assert.equal((h.match(/data-stem-fader/g) ?? []).length, 4);
  assert.equal((h.match(/data-modul-fader/g) ?? []).length, 1);
  assert.equal((h.match(/ data-leeren /g) ?? []).length, 1);
  assert.match(h, /READY/);
  for (const n of ['Drums', 'Bass', 'Other', 'Vocals']) assert.match(h, new RegExp(n));
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
  const h = modulHtml(modulAnsicht(p, { A: null, B: { gruppe_id: id, stems: { stems: 'fehler', grund: 'gpu_belegt', text: 'not enough free memory on the GPU' } } }, null));
  assert.match(h, /LOOP ONLY/); assert.match(h, /not enough free memory on the GPU/); assert.match(h, /data-trennen/);
  const h2 = modulHtml(modulAnsicht(p, { A: null, B: { gruppe_id: id, stems: { stems: 'laeuft', auftrag_id: 7 } } }, { auftrag_id: 7, zustand: 'laeuft', prozent: 42 }));
  assert.match(h2, /SEPARATING 42 %/); assert.match(h2, /style="[^"]*--fortschritt:\s*42%/); assert.doesNotMatch(h2, /data-trennen/);
});

test('fader commands: the module fader is the fader of the top group, an original fader the fader of the original track', () => {
  assert.deepEqual(faderBefehl('modul', 'g5', -12), { befehl: 'gruppenspur_aendern', gruppe_id: 'g5', fader_db: -12 });
  assert.deepEqual(faderBefehl('stem', 's9', -200), { befehl: 'spur_aendern', spur_id: 's9', fader_db: -200 });
});

test('export button: off without a running loop or a loaded track, on with both; the title says why', () => {
  assert.equal(exportKnopf({ loop: false, geladen: true, live: true }).aus, true);
  assert.match(exportKnopf({ loop: false, geladen: true, live: true }).titel, /loop/i);
  assert.equal(exportKnopf({ loop: true, geladen: false, live: true }).aus, true);
  assert.deepEqual(exportKnopf({ loop: true, geladen: true, live: true }).aus, false);
  assert.equal(exportKnopf({ loop: true, geladen: true, live: false }).aus, false, 'a closed container is told on the click, the button stays on');
  assert.match(exportKnopf({ loop: true, geladen: true, live: false }).titel, /open the live container/i);
});

test('export posts deck only (the server takes A, else B); a refusal gives the text of the reason', async () => {
  const ruf = [];
  const ok = await exportiere(3, async (w, k) => { ruf.push([w, k]); return { status: 200, j: { slot: 'B' } }; });
  assert.deepEqual(ruf, [['/modul/export', { deck: 3 }]]);
  assert.deepEqual(ok, { ok: true, slot: 'B', text: 'Exported to slot B' });
  const nein = await exportiere(1, async () => ({ status: 409, j: { fehler: 'slot_belegt', text: 'both live slots hold a module' } }));
  assert.deepEqual(nein, { ok: false, text: 'Export refused: both live slots hold a module' });
  const ohne = await exportiere(1, async () => ({ status: 409, j: { fehler: 'kein_loop' } }));
  assert.equal(ohne.text, 'Export refused: kein_loop');
});

test('clear and separate post the slot (and the bars); LEER_TAKTE are the bars the server knows', async () => {
  assert.deepEqual(LEER_TAKTE, [0, 1, 2, 4, 8, 16]);
  const ruf = [];
  const h = async (w, k) => { ruf.push([w, k]); return { status: 200, j: {} }; };
  assert.equal((await leere('A', 4, h)).ok, true);
  assert.equal((await trenneNeu('B', h)).ok, true);
  assert.deepEqual(ruf, [['/modul/leeren', { slot: 'A', takte: 4 }], ['/modul/stems', { slot: 'B' }]]);
  assert.equal((await leere('A', 4, async () => ({ status: 409, j: { fehler: 'slot_leer', text: 'that live slot holds no module' } }))).text, 'Clear refused: that live slot holds no module');
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

test('wiring: EXPORT button on decks 1 to 3 in the loop row, LIVE button and the panel in the DJ view, SSE and styles', () => {
  const app = fs.readFileSync(path.join(HIER, '..', 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(HIER, '..', 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(HIER, '..', 'public', 'style.css'), 'utf8');
  assert.match(app, /from '\.\/live_modul\.js'/);
  assert.match(app, /data-exportloop/);
  assert.match(html, /data-liveoeffnen/);
  assert.match(html, /id="live-panel"/);
  assert.match(app, /case 'modul'/);
  assert.match(css, /#live-panel/);
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
  const h = modulHtml(a);
  assert.equal((h.match(/data-stem-fader/g) ?? []).length, 4, 'the original fader of every stem');
  assert.equal((h.match(/data-neu-fader/g) ?? []).length, 1, 'one new fader');
  assert.equal((h.match(/data-blend /g) ?? []).length, 1, 'one blend slider');
  assert.match(h, /data-blend data-stem="drums"/);
  assert.match(h, /BLEND/); assert.match(h, /NEW/);
  const mit = modulHtml(modulAnsicht({ ...p, gruppen: p.gruppen.map((g) => (g.name === 'Drums' ? { ...g, blend: 0.4 } : g)) }, standA(p), null));
  assert.match(mit, /data-blend[^>]*>|value="0.4"/); assert.match(mit, /40 %/);
  assert.doesNotMatch(modulHtml(modulAnsicht(baueModul(live(), 'A', LOOP, vier(), herkunft()), standA(p), null)), /data-blend|data-neu-fader/, 'no new path, no extra rows');
});

test('the new fader is a spur_aendern on the instrument track; blend posts /modul/blend without takte; a refusal gives its text', async () => {
  const p = mitPfad();
  const neu = modulAnsicht(p, standA(p), null).slots[0].stems[0].neu;
  assert.deepEqual(faderBefehl('stem', neu.spurId, -6), { befehl: 'spur_aendern', spur_id: neu.spurId, fader_db: -6 });
  assert.equal(p.spuren.find((x) => x.id === neu.spurId).art, 'instrument');
  const ruf = [];
  assert.deepEqual(await setzeBlend('A', 'drums', 0.5, async (w, k) => { ruf.push([w, k]); return { status: 200, j: {} }; }), { ok: true, text: 'Blend drums 50 %' });
  assert.deepEqual(ruf, [['/modul/blend', { slot: 'A', stem: 'drums', wert: 0.5 }]]);
  assert.equal((await setzeBlend('A', 'other', 1, async () => ({ status: 409, j: { fehler: 'kein_neuer_pfad', text: 'no new path' } }))).text, 'Blend refused: no new path');
});

test('CUE: one button per slot, the state follows the core row grp/<n>/cue of the top group, the click flips it on the hand path', () => {
  const p = mitPfad();
  const g = p.gruppen.find((x) => x.id === liveSlots(p).A);
  const aus = modulAnsicht(p, standA(p), null, {}).slots[0];
  assert.deepEqual(aus.cue, { nr: g.nr, an: false });
  const an = modulAnsicht(p, standA(p), null, { [`grp/${g.nr}/cue`]: 1 }).slots[0];
  assert.equal(an.cue.an, true);
  const h = modulHtml(modulAnsicht(p, standA(p), null, { [`grp/${g.nr}/cue`]: 1 }));
  assert.equal((h.match(/data-cue /g) ?? []).length, 1);
  assert.match(h, new RegExp(`data-cue data-nr="${g.nr}" aria-pressed="true"`));
  assert.match(h, /live-cue an/);
  assert.deepEqual(cueGriff(g.nr, false), { pfad: `grp/${g.nr}/cue`, u: 1 });
  assert.deepEqual(cueGriff(g.nr, true), { pfad: `grp/${g.nr}/cue`, u: 0 });
  assert.equal(cueAn({ 'grp/3/cue': 0.4 }, 3), false);
  // one click = priming value, then the target (the core swallows the first absolute value of a row as its knob position)
  assert.deepEqual(cueGriffe(g.nr, false).map((x) => x.u), [0, 1]);
  assert.deepEqual(cueGriffe(g.nr, true).map((x) => x.u), [1, 0]);
});

test('KEY: shows the distance from /modul/stand, off when 0 or unknown, posts the slot', async () => {
  assert.deepEqual(tonartAnsicht({ tonart_abstand: 3 }), { abstand: 3, aus: false, text: 'KEY +3', titel: 'Transpose this module by +3 semitones to the deck on the master' });
  assert.equal(tonartAnsicht({ tonart_abstand: -2 }).text, 'KEY −2');
  assert.equal(tonartAnsicht({ tonart_abstand: 0 }).aus, true);
  assert.equal(tonartAnsicht({ tonart_abstand: null, tonart_grund: 'kein_deck' }).aus, true);
  assert.match(tonartAnsicht({ tonart_abstand: null, tonart_grund: 'kein_deck' }).titel, /kein_deck/);
  const p = mitPfad();
  const h = modulHtml(modulAnsicht(p, standA(p, { tonart_abstand: 2 }), null));
  assert.match(h, /data-key title="[^"]*"[^>]*>KEY \+2</); assert.doesNotMatch(h, /data-key disabled/);
  assert.match(modulHtml(modulAnsicht(p, standA(p, { tonart_abstand: 0 }), null)), /data-key disabled/);
  const ruf = [];
  assert.equal((await passeTonartAn('A', async (w, k) => { ruf.push([w, k]); return { status: 200, j: {} }; })).ok, true);
  assert.deepEqual(ruf, [['/modul/tonart', { slot: 'A' }]]);
  assert.equal((await passeTonartAn('A', async () => ({ status: 409, j: { fehler: 'kein_deck', text: 'no deck' } }))).text, 'Key refused: no deck');
});

test('wiring: blend, cue and key handlers in app.js (cue through /griff via sende, blend double click = 0)', () => {
  const app = fs.readFileSync(path.join(HIER, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /closest\('\[data-cue\]'\)/); assert.match(app, /sende\(g\.pfad, g\.u, true\)/);
  assert.match(app, /live-blendregler/); assert.match(app, /r\.value = '0';\s+sendeBlend/);
  assert.match(app, /passeTonartAn\(slot, holeJson\)/);
  assert.match(app, /zeichneLive\(\);\s*\/\/ task 6|grp\\\/\\d\+\\\/cue/);
});
