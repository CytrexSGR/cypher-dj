// Tracker stage 4, task 22: the templates 8-BIT · 4 CHANNELS and CHIP, POST /proj/neu with tracker, the listing flag, the refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt, pruefeProjekt, pruefeFehler } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { TRACKER_VORLAGEN, trackerVorlageVon, trackerVorlageBefehle, trackerVorlagenListe } from '../project/tracker.ts';
import { uebersetze } from '../project/playback.ts';
import { liesBereich } from '../project/tracker_text.ts';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';
import { sitzung } from './support/proj_context.mjs';
import { kopie } from './support/project.mjs';

process.env.CYPHERDJ_BK_ORDNER = path.resolve(import.meta.dirname, '../../instruments/modular_dsp/demos');

const frisch = () => { const p = neuesProjekt('T'); p.tracker = { schema: 1 }; return p; };
const bau = (id) => fuehreListeAus(kopie(frisch()), trackerVorlageBefehle(trackerVorlageVon(id)), { quelle: 'andreas' }).projekt;
const ROLLEN = (graph) => (graph === 'amiga' ? { stufig: true, rollen: { slot: 1, start: 2, rueckwaerts: 3 } } : { stufig: true, rollen: {} });
const spiel = (p) => uebersetze(p, { nr: 1, audioOrdner: '@A@', frames: () => 400000, geraetFx: ROLLEN });

test('the template list: ids, names, order', () => {
  assert.deepEqual(trackerVorlagenListe().map((v) => [v.id, v.name]), [['8bit-4kanal', '8-BIT · 4 CHANNELS'], ['chip', 'CHIP']]);
  assert.equal(trackerVorlageVon('nope'), null);
  assert.equal(trackerVorlageVon(7), null);
});

test('8-BIT · 4 CHANNELS: a valid project with four amiga tracks panned -1 +1 +1 -1, 125 BPM, marker without defaults', () => {
  const p = bau('8bit-4kanal');
  assert.equal(pruefeFehler(p), null);
  assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(p))));
  assert.deepEqual(p.spuren.map((s) => [s.name, s.geraet.graph, s.pan]), [['Ch 1', 'amiga', -1], ['Ch 2', 'amiga', 1], ['Ch 3', 'amiga', 1], ['Ch 4', 'amiga', -1]]);
  assert.equal(p.tempo_bpm, 125);
  assert.deepEqual(p.tracker, { schema: 1, abschnitte: [{ id: 'a1', laenge_beats: 16 }] });   // no lpb, no ticks (defaults 4 and 6)
  assert.deepEqual(p.spuren.map((s) => s.clips.length), [1, 1, 1, 1]);
  assert.ok(p.spuren.every((s) => s.clips[0].start_beat === 0 && s.clips[0].laenge_beats === 16));
  assert.equal(p.werkbank, undefined);
  assert.equal(p.live, undefined);
});

test('8-BIT: every track plays its own slot, the arpeggio carries ARP, the melody VIB, SLU and GLD, the drums are short notes', () => {
  const p = bau('8bit-4kanal');
  const c = p.spuren.map((s) => s.clips[0]);
  assert.deepEqual(c.map((x) => [...new Set(x.noten.map((n) => n.platz))]), [[3], [1], [2], [4]]);
  assert.deepEqual([...new Set(c[1].fx.map((e) => e.code + e.wert.toString(16)))].sort(), ['ARP37', 'ARP47']);
  assert.equal(c[1].fx.length, 64);
  assert.deepEqual([...new Set(c[2].fx.map((e) => e.code))].sort(), ['GLD', 'SLU', 'VIB']);
  assert.ok(c[3].noten.every((n) => n.laenge <= 0.25) && c[3].noten.length > 20);
  assert.ok(c.every((x) => x.noten.every((n) => n.beat >= 0 && n.beat + n.laenge <= 16)));
  assert.equal(c[0].fx, undefined);
  assert.equal(c[3].fx, undefined);
});

test('CHIP: Pulse 1, Pulse 2, Triangle, Noise on the chip devices, no slots, no pan', () => {
  const p = bau('chip');
  assert.equal(pruefeFehler(p), null);
  assert.deepEqual(p.spuren.map((s) => [s.name, s.geraet.graph, s.pan]), [['Pulse 1', 'chip-puls', 0], ['Pulse 2', 'chip-puls', 0],
    ['Triangle', 'chip-dreieck', 0], ['Noise', 'chip-rauschen', 0]]);
  assert.equal(p.tempo_bpm, 125);
  assert.deepEqual(p.tracker, { schema: 1, abschnitte: [{ id: 'a1', laenge_beats: 16 }] });
  const c = p.spuren.map((s) => s.clips[0]);
  assert.ok(c.every((x) => x.noten.every((n) => n.platz === undefined)));
  assert.deepEqual([...new Set(c[1].fx.map((e) => e.code))], ['ARP']);
  assert.deepEqual([...new Set(c[0].fx.map((e) => e.code))].sort(), ['GLD', 'SLU', 'VIB']);
  assert.ok(Math.min(...c[2].noten.map((n) => n.ton)) < Math.min(...c[0].noten.map((n) => n.ton)), 'the bass lies below the lead');
});

test('the playback file can be made: bend events for the ARP track, the slot lane for the slots', () => {
  const w = spiel(bau('8bit-4kanal'));
  const [bass, arp, lead, schlag] = [1, 2, 3, 4].map((nr) => w.spuren.find((s) => s.nr === nr));
  assert.ok(arp.bend.length > 64, 'ARP: a jump per tick');
  assert.ok(lead.bend.length > 0);
  assert.equal(bass.bend, undefined);
  for (const s of [bass, arp, lead, schlag]) assert.ok(s.auto.some((l) => l.ziel === 'geraet.k1'), `slot lane of track ${s.nr}`);
  const chip = spiel(bau('chip'));
  assert.ok(chip.spuren.find((s) => s.nr === 2).bend.length > 64);
  assert.ok(chip.spuren.every((s) => !(s.auto ?? []).some((l) => l.ziel === 'geraet.k1')));
});

test('the start patterns read as tracker text: one section of 64 rows, every track present', () => {
  for (const id of ['8bit-4kanal', 'chip']) {
    const text = liesBereich(bau(id), { abschnitt_id: 'a1' }, ROLLEN);
    assert.match(text, /^section \d\d "[^"]*"  rows 64  lpb 4  ticks 6/);
    assert.equal(text.split('\n').length, 64 + 3);   // header, legend, 64 rows, trailing newline
    assert.match(text, /ARP 37/);
  }
});

test('POST /proj/neu with tracker and vorlage creates the project in one history step after the open; the list carries the flag', async (t) => {
  const { url } = await stapel(t);
  const r = await ruf(url, 'POST', '/proj/neu', { name: 'Chip Tune', tracker: true, vorlage: '8bit-4kanal' });
  assert.equal(r.code, 200);
  const p = r.j.projekt;
  assert.deepEqual([p.tempo_bpm, p.tracker, p.werkbank], [125, { schema: 1, abschnitte: [{ id: 'a1', laenge_beats: 16 }] }, undefined]);
  assert.deepEqual(p.spuren.map((s) => [s.name, s.pan]), [['Ch 1', -1], ['Ch 2', 1], ['Ch 3', 1], ['Ch 4', -1]]);
  const v = await ruf(url, 'GET', '/proj/verlauf');
  assert.equal(v.j.filter((e) => String(e.label).startsWith('Template')).length, 1);
  assert.ok(v.j.some((e) => e.label === 'Template 8-BIT · 4 CHANNELS'));
  const l = await ruf(url, 'GET', '/proj/liste');
  const e = l.j.find((x) => x.slug === r.j.slug);
  assert.deepEqual([e.tracker, 'werkbank' in e], [true, false]);
  const chip = await ruf(url, 'POST', '/proj/neu', { name: 'Chip 2', tracker: true, vorlage: 'chip' });
  assert.deepEqual(chip.j.projekt.spuren.map((s) => s.name), ['Pulse 1', 'Pulse 2', 'Triangle', 'Noise']);
});

test('an empty tracker project carries only the marker {schema: 1}; a plain project and a module stay as they were', async (t) => {
  const { url } = await stapel(t);
  const leer = await ruf(url, 'POST', '/proj/neu', { name: 'Empty Tr', tracker: true });
  assert.deepEqual([leer.j.projekt.tracker, leer.j.projekt.spuren.length, leer.j.projekt.tempo_bpm, leer.j.projekt.loop.an], [{ schema: 1 }, 0, 120, false]);
  const plain = await ruf(url, 'POST', '/proj/neu', { name: 'Plain' });
  assert.equal('tracker' in plain.j.projekt, false);
  const mod = await ruf(url, 'POST', '/proj/neu', { name: 'Mod', werkbank: true, vorlage: 'techno-130-start' });
  assert.equal(mod.code, 200);
  assert.equal('tracker' in mod.j.projekt, false);
  assert.deepEqual(mod.j.projekt.spuren.map((s) => s.name), ['Drums', 'Bass']);
  const liste = (await ruf(url, 'GET', '/proj/liste')).j;
  assert.equal('tracker' in liste.find((x) => x.name === 'Plain'), false);
  assert.equal('tracker' in liste.find((x) => x.name === 'Mod'), false);
  assert.deepEqual((await ruf(url, 'GET', '/proj/werkbank/vorlagen')).j.vorlagen.map((v) => v.id), ['techno-130-start']);
});

test('refusals: tracker with werkbank, tracker not true, unknown or foreign template; nothing is created', async (t) => {
  const { url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Base' });
  const vorher = (await ruf(url, 'GET', '/proj/liste')).j.length;
  for (const [k, code, grund, text] of [
    [{ tracker: true, werkbank: true }, 400, 'argument_ungueltig', /exclude each other/],
    [{ tracker: true, werkbank: true, vorlage: 'chip' }, 400, 'argument_ungueltig', /exclude each other/],
    [{ tracker: false }, 400, 'argument_ungueltig', /tracker: true or absent/],
    [{ tracker: 'ja' }, 400, 'argument_ungueltig', /tracker: true or absent/],
    [{ tracker: true, vorlage: 'nope' }, 400, 'vorlage_unbekannt', /8bit-4kanal \| chip/],
    [{ tracker: true, vorlage: 'techno-130-start' }, 400, 'vorlage_unbekannt', /8bit-4kanal \| chip/],
    [{ werkbank: true, vorlage: 'chip' }, 400, 'vorlage_unbekannt', /techno-130-start/],
    [{ vorlage: 'chip' }, 400, 'argument_ungueltig', /vorlage needs werkbank/]]) {
    const x = await ruf(url, 'POST', '/proj/neu', { name: 'X', ...k });
    assert.deepEqual([x.code, x.j.fehler], [code, grund], JSON.stringify(k));
    assert.match(x.j.text, text, JSON.stringify(k));
  }
  assert.equal((await ruf(url, 'GET', '/proj/liste')).j.length, vorher, 'a refusal creates no folder');
});

test('a template while a deck plays is refused before anything is created; an empty tracker project opens anyway', async (t) => {
  const { s } = sitzung(t);
  await s.neu('Open', 'andreas');
  const vorher = s.liste().j.length;
  s.ereignis('/zustand/deck', { deck: 2, status: 2 });
  let e = null;
  try { await s.neu('Tr', 'andreas', false, { tracker: true, vorlage: 'chip' }); } catch (x) { e = x; }
  assert.deepEqual([e?.code, e?.fehler], [409, 'deck_laeuft']);
  assert.equal(s.liste().j.length, vorher);
  const leer = await s.neu('Empty', 'andreas', false, { tracker: true });
  assert.deepEqual(leer.j.projekt.tracker, { schema: 1 });
});

test('TRACKER_VORLAGEN: both templates have four tracks and a text', () => {
  assert.deepEqual(TRACKER_VORLAGEN.map((v) => v.spuren.length), [4, 4]);
  assert.ok(TRACKER_VORLAGEN.every((v) => v.text.length > 10 && v.tempo_bpm === 125));
});

test('track level: the 8-BIT template sits at -9 dB per track (offline render: the master limiter took 2.0 dB off at -6 and nothing at -9), CHIP stays at -6', () => {
  const pegel = (id) => bau(id).spuren.map((s) => s.fader_db);
  assert.deepEqual(pegel('8bit-4kanal'), [-9, -9, -9, -9]);
  assert.deepEqual(pegel('chip'), [-6, -6, -6, -6]);
});
