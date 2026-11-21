// SEQ deck v2, task 1: the deck marker on a live group (Gruppe.seq = {schema: 2, platz}), the view descriptor of a clip (MidiClip.seq),
// the reader conversion of a v1 document and the helpers seqGruppe and seqFolgen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { Projekte } from '../project/storage.ts';
import { seqPruefung, seqSichtPruefung, seqGruppe, seqFolgen, seqV1Wandeln } from '../project/seq.ts';
import { tmpOrdner } from './support/project.mjs';

const kopie = (x) => JSON.parse(JSON.stringify(x));
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const LEER = () => [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }];
const BK = { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} };

// the v1 document, as project/seq.ts of commit 6bd45190 defined it: two voices, six lanes in the first pattern, 16 slots
const schritte = (an = []) => Array.from({ length: 16 }, (_, i) => (an.includes(i) ? { an: true, vel: 110 } : { an: false }));
const zeileV1 = (id, stimme, ton, an) => ({ id, stimme, name: id.toUpperCase(), ton, laenge: 16, teiler: 0.25, schritte: schritte(an) });
const dokumentV1 = (platz, s1, s2) => ({
  schema: 1, platz, aktiv: 0, saat: platz, swing: 0.1,
  stimmen: [{ id: 's1', spur_id: s1, art: 'trommel', name: 'Drums' }, { id: 's2', spur_id: s2, art: 'ton', name: 'Bass' }],
  folgen: [{ zeilen: [zeileV1('kick', 's1', 36, [0, 4, 8, 12]), zeileV1('snare', 's1', 38, [4, 12]), zeileV1('clap', 's1', 39, []),
    zeileV1('chh', 's1', 42, [2, 6, 10, 14]), zeileV1('ohh', 's1', 46, [7]), { ...zeileV1('bass', 's2', 36, [0, 8]), stumm: true }] },
  ...Array.from({ length: 15 }, () => null)],
});
// a live project with a v1 deck: two voice tracks with explicit-note clips of 64 beats (what v1 wrote), grouped under one top group
const projektV1 = (platz = 2) => {
  let p = neuesProjekt('v1'); p.live = true; p.plaetze = LEER();
  for (const name of ['Drums', 'Bass']) {
    p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name, geraet: BK });
    p = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren.at(-1).id, art: 'midi', start_beat: 0, laenge_beats: 64, name: 'SEQ',
      noten: [0, 4, 8, 12].map((b) => ({ beat: b, laenge: 0.125, ton: 36, vel: 110 })) });
  }
  p = lauf(p, { befehl: 'gruppenspur_neu', name: `SEQ ${platz}`, mitglieder: [p.spuren[0].id, p.spuren[1].id] });
  const roh = kopie(p);
  roh.format = 'cypherdj-projekt/2'; delete roh.plaetze;   // a stored /2 file: no places yet
  roh.gruppen[0].seq = dokumentV1(platz, p.spuren[0].id, p.spuren[1].id);
  return roh;
};
const fehlerVon = (p) => { const u = pruefeProjekt(kopie(p)); return 'fehler' in u ? u.fehler : null; };

// a live project with one deck group and the tracks given (default: none)
const deck = (platz = 1) => {
  let p = neuesProjekt('seq'); p.live = true; p.plaetze = LEER();
  p = lauf(p, { befehl: 'gruppenspur_neu', name: `SEQ ${platz}` });
  p.gruppen[0].seq = { schema: 2 };
  p.plaetze[platz - 1] = { typ: 'seq', gruppe: p.gruppen[0].id };
  return p;
};

test('schema 2 deck marker passes seqPruefung and the project check on a top group of a live project', () => {
  assert.equal(seqPruefung({ schema: 2 }), null);
  assert.equal(seqPruefung({ schema: 2, lpb: 4, ticks: 12 }), null);
  const u = pruefeProjekt(kopie(deck(3)));
  assert.ok('projekt' in u, JSON.stringify(u));
  assert.deepEqual(u.projekt.gruppen[0].seq, { schema: 2 });
  assert.equal(seqGruppe(u.projekt, 3)?.id, u.projekt.gruppen[0].id);
  assert.equal(seqGruppe(u.projekt, 1), undefined, 'a place without a deck');
});

test('an extra field (also the old platz) is argument_unbekannt, limits are argument_ungueltig, schema 1 is refused by the check', () => {
  assert.equal(seqPruefung({ schema: 2, extra: 1 })?.grund, 'argument_unbekannt');
  assert.equal(seqPruefung({ schema: 2, platz: 1 })?.grund, 'argument_unbekannt', 'the place is stored in plaetze now');
  assert.equal(seqPruefung({ schema: 2, tonart: '8A' })?.grund, 'argument_unbekannt');
  for (const x of [{ schema: 3 }, { schema: 2, lpb: 5 }, { schema: 2, ticks: 1.5 }, {}, null, [], 'x']) {
    assert.equal(seqPruefung(x)?.grund, 'argument_ungueltig', JSON.stringify(x));
  }
  const v1 = seqPruefung(dokumentV1(1, 'a', 'b'));
  assert.ok(v1 !== null, 'a v1 document is refused by the check');
  assert.match(fehlerVon({ ...deck(), gruppen: [{ ...deck().gruppen[0], seq: dokumentV1(1, 'a', 'b') }] }) ?? '', /seq/);
});

test('the project check keeps its rules: live container only, one place per deck, top group, not together with a module', () => {
  const p = deck(2);
  assert.equal(fehlerVon(p), null);
  const ohneLive = kopie(p); delete ohneLive.live; delete ohneLive.plaetze;
  assert.match(fehlerVon(ohneLive) ?? '', /live container/);
  let zwei = lauf(p, { befehl: 'gruppenspur_neu', name: 'zweite' });
  zwei.gruppen[1].seq = { schema: 2 };
  assert.equal(fehlerVon(zwei), null, 'a second deck with no place is parked');
  zwei.plaetze[2] = { typ: 'seq', gruppe: zwei.gruppen[0].id };
  assert.match(fehlerVon(zwei) ?? '', /already sits in another place/);
  zwei.plaetze[2] = { typ: 'seq', gruppe: zwei.gruppen[1].id };
  assert.equal(fehlerVon(zwei), null);
  const innen = lauf(p, { befehl: 'gruppenspur_neu', name: 'aussen' });
  innen.gruppen[0].ausgang = { art: 'gruppe', id: innen.gruppen[1].id };
  assert.match(fehlerVon(innen) ?? '', /nested|top group/);
  const mod = kopie(p);
  mod.gruppen[0].modul = { quelle_sha256: 'c'.repeat(64), titel: 'T', fassung: 'f', basis_bpm: 120, von_beat: 0, laenge_beats: 16, bpm: 120, datum: '2026-11-14' };
  assert.match(fehlerVon(mod) ?? '', /seq|module/);
});

test('seqV1Wandeln: a v1 group becomes {schema: 2, platz} (the lift moves the place into plaetze), clips and tracks stay byte-equal, the converted project passes the check', () => {
  const roh = projektV1(2);
  assert.match(fehlerVon(roh) ?? '', /seq/, 'a v1 document alone is refused');
  const vorher = JSON.stringify({ spuren: roh.spuren, rest: { ...roh, gruppen: undefined, spuren: undefined } });
  const gruppeVorher = JSON.stringify({ ...roh.gruppen[0], seq: undefined });
  assert.equal(seqV1Wandeln(roh), true);
  assert.deepEqual(roh.gruppen[0].seq, { schema: 2, platz: 2 });
  assert.equal(JSON.stringify({ ...roh.gruppen[0], seq: undefined }), gruppeVorher);
  assert.equal(JSON.stringify({ spuren: roh.spuren, rest: { ...roh, gruppen: undefined, spuren: undefined } }), vorher);
  assert.equal(roh.spuren[0].clips[0].noten.length, 4);
  assert.equal(fehlerVon(roh), null, 'a /2 file is checked as its lift');
  assert.equal(seqV1Wandeln(roh), false, 'a second call changes nothing');
});

test('seqV1Wandeln leaves a v2 deck, a group without a deck and foreign input alone', () => {
  const p = kopie(deck(1));
  const vorher = JSON.stringify(p);
  assert.equal(seqV1Wandeln(p), false);
  assert.equal(JSON.stringify(p), vorher);
  for (const x of [null, 5, 'x', [], {}, { gruppen: 'x' }, { gruppen: [null, 3, { seq: null }] }]) assert.equal(seqV1Wandeln(x), false, JSON.stringify(x));
  assert.equal(seqV1Wandeln({ gruppen: [{ id: 'g', seq: { schema: 1, platz: 4 } }] }), true);
});

test('Projekte.lies converts a stored v1 project before the check, speichere writes the converted form', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('Seq', { live: true });
  const datei = path.join(w, slug, 'project.json');
  const roh = projektV1(2);
  const basis = pr.lies(slug);
  roh.name = basis.name; roh.rev = basis.rev; roh.wiedergabe_rev = basis.wiedergabe_rev; roh.loop = basis.loop;
  fs.writeFileSync(datei, JSON.stringify(roh, null, 1) + '\n');
  assert.ok(fs.readFileSync(datei, 'utf8').includes('"stimmen"'));
  const gelesen = pr.lies(slug);
  assert.deepEqual(gelesen.gruppen[0].seq, { schema: 2 });
  assert.deepEqual(gelesen.plaetze[1], { typ: 'seq', gruppe: gelesen.gruppen[0].id }, 'the v1 place became place 2');
  assert.equal(JSON.stringify(gelesen.spuren[0].clips), JSON.stringify(roh.spuren[0].clips));
  pr.speichere(slug, gelesen);
  const text = fs.readFileSync(datei, 'utf8');
  assert.ok(!text.includes('"stimmen"') && !text.includes('"folgen"'));
  assert.deepEqual(pr.lies(slug).gruppen[0].seq, { schema: 2 });
});

// --- the view descriptor ---------------------------------------------------------------------------------------------------
const sicht = (...zeilen) => ({ schema: 1, zeilen });
const noten = (id, extra = {}) => ({ id, art: 'noten', teiler: 0.25, ...extra });
const werte = (id, ziel, extra = {}) => ({ id, art: 'werte', teiler: 0.25, ziel, ...extra });
const kurve = (id, ziel, extra = {}) => ({ id, art: 'kurve', ziel, ...extra });
const FORM = { art: 'sinus', von: 0.1, bis: 0.9, abdruck: 'ab12cd34ef56ab12' };

test('the list of envelope targets of a pattern is the model list without gain', async () => {
  const { HK_ZIELE } = await import('../project/envelope.ts');
  const { SEQ_HK_ZIELE } = await import('../project/seq.ts');
  assert.deepEqual([...SEQ_HK_ZIELE].sort(), HK_ZIELE.filter((z) => z !== 'gain').sort());
});

test('a descriptor with every kind of lane passes', () => {
  const s = sicht(noten('kick', { ton: 36, name: 'Kick' }), noten('hat', { ton: 42, teiler: 0.125 }), noten('bass'),
    werte('vel', 'vel', { von: 'kick' }), werte('len', 'laenge', { von: 'bass', teiler: 0.5 }), werte('cut', 'geraet.k3', { teiler: 1 }),
    kurve('res', 'geraet.k4', { form: FORM }), kurve('tr', 'transpose'), kurve('fad', 'spur_fader'), kurve('pan', 'spur_pan'));
  assert.equal(seqSichtPruefung(s), null, JSON.stringify(seqSichtPruefung(s)));
  assert.equal(seqSichtPruefung(sicht(noten('a'))), null);
  for (const art of ['sinus', 'dreieck', 'saege', 'saege_ab', 'rechteck', 'rampe', 'zufall']) {
    assert.equal(seqSichtPruefung(sicht(kurve('k', 'geraet.k1', { form: { ...FORM, art, phase: 0.25, saat: 7, stufen: 8 } }))), null, art);
  }
});

test('descriptor limits: each rule is refused with argument_ungueltig and a text that names the lane', () => {
  const faelle = [
    ['zero lanes', sicht()],
    ['33 lanes', sicht(...Array.from({ length: 33 }, (_, i) => noten(`l${i}`, { ton: i })))],
    ['schema 2', { schema: 2, zeilen: [noten('a')] }],
    ['zeilen not a list', { schema: 1, zeilen: 'x' }],
    ['id upper case', sicht(noten('Kick'))],
    ['id starts with a digit', sicht(noten('1a'))],
    ['id of nine characters', sicht(noten('abcdefghi'))],
    ['id used twice', sicht(noten('a', { ton: 1 }), noten('a', { ton: 2 }))],
    ['teiler 0.2', sicht(noten('a', { teiler: 0.2 }))],
    ['teiler 2', sicht(werte('a', 'geraet.k1', { teiler: 2 }))],
    ['two pitched lanes', sicht(noten('a'), noten('b'))],
    ['ton 128', sicht(noten('a', { ton: 128 }))],
    ['ton negative', sicht(noten('a', { ton: -1 }))],
    ['ton not an integer', sicht(noten('a', { ton: 36.5 }))],
    ['ton twice among trigger lanes', sicht(noten('a', { ton: 36 }), noten('b', { ton: 36 }))],
    ['an envelope target twice', sicht(werte('a', 'geraet.k1'), kurve('b', 'geraet.k1'))],
    ['an envelope target twice (curve, curve)', sicht(kurve('a', 'transpose'), kurve('b', 'transpose'))],
    ['von names no lane', sicht(noten('a', { ton: 1 }), werte('v', 'vel', { von: 'zz' }))],
    ['von names a werte lane', sicht(noten('a', { ton: 1 }), werte('w', 'geraet.k1'), werte('v', 'vel', { von: 'w' }))],
    ['vel without von next to two note lanes', sicht(noten('a', { ton: 1 }), noten('b', { ton: 2 }), werte('v', 'vel'))],
    ['vel without any note lane', sicht(werte('v', 'vel'))],
    ['an unknown target', sicht(werte('a', 'geraet.k65'))],
    ['target gain', sicht(kurve('a', 'gain'))],
    ['a lane that is no object', sicht('x')],
    ['unknown lane art', sicht({ id: 'a', art: 'pad', teiler: 0.25 })],
    ['name too long', sicht(noten('a', { name: 'x'.repeat(81) }))],
    ['form value missing', sicht(kurve('a', 'geraet.k1', { form: { art: 'sinus', von: 0, abdruck: 'ab' } }))],
    ['form art unknown', sicht(kurve('a', 'geraet.k1', { form: { ...FORM, art: 'dreiviertel' } }))],
    ['form without abdruck', sicht(kurve('a', 'geraet.k1', { form: { art: 'sinus', von: 0, bis: 1 } }))],
    ['form saat negative', sicht(kurve('a', 'geraet.k1', { form: { ...FORM, saat: -1 } }))],
    ['form stufen 0', sicht(kurve('a', 'geraet.k1', { form: { ...FORM, stufen: 0 } }))],
    ['not an object', 'x'],
  ];
  for (const [name, x] of faelle) {
    const r = seqSichtPruefung(x);
    assert.equal(r?.grund, 'argument_ungueltig', `${name}: ${JSON.stringify(r)}`);
  }
  assert.match(seqSichtPruefung(sicht(noten('a', { ton: 1 }), noten('kick', { ton: 1 }))).text, /kick/);
  assert.match(seqSichtPruefung(sicht(noten('a'), noten('bass'))).text, /bass/);
});

test('descriptor unknown fields are argument_unbekannt', () => {
  const faelle = [
    ['descriptor', { schema: 1, zeilen: [noten('a')], extra: 1 }],
    ['lane', sicht(noten('a', { farbe: 'x' }))],
    ['werte lane with ton', sicht(werte('a', 'geraet.k1', { ton: 3 }))],
    ['kurve lane with teiler', sicht(kurve('a', 'geraet.k1', { teiler: 0.25 }))],
    ['form', sicht(kurve('a', 'geraet.k1', { form: { ...FORM, kurz: 1 } }))],
  ];
  for (const [name, x] of faelle) assert.equal(seqSichtPruefung(x)?.grund, 'argument_unbekannt', name);
});

test('the project check refuses a bad descriptor on a MIDI clip and accepts a good one', () => {
  let p = lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'instrument', name: 'T', geraet: BK });
  p = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 64 });
  const q = kopie(p);
  q.spuren[0].clips[0].seq = sicht(noten('a'));
  assert.equal(fehlerVon(q), null);
  q.spuren[0].clips[0].seq = sicht(noten('a'), noten('b'));
  assert.match(fehlerVon(q) ?? '', /seq/);
});

// --- seqFolgen -------------------------------------------------------------------------------------------------------------
test('seqFolgen lists every track of the group in track order; editierbar follows rule D8', () => {
  let p = deck(1);
  const g = p.gruppen[0];
  const mach = (name, art = 'instrument') => {
    p = lauf(p, { befehl: 'spur_neu', art, name, ...(art === 'instrument' ? { geraet: BK } : {}) });
    const id = p.spuren.at(-1).id;
    p = lauf(p, { befehl: 'ziel_setzen', strang_id: id, ausgang: { art: 'gruppe', id: g.id } });
    return id;
  };
  const clip = (id, start, laenge) => { p = lauf(p, { befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: start, laenge_beats: laenge }); };
  const fremd = (() => { p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'Fremd', geraet: BK }); return p.spuren.at(-1).id; })();
  const gut = mach('Gut'); clip(gut, 0, 64);
  const leer = mach('Leer');
  const versetzt = mach('Versetzt'); clip(versetzt, 4, 60);
  const kurz = mach('Kurz'); clip(kurz, 0, 32);
  const zwei = mach('Zwei'); clip(zwei, 0, 64); clip(zwei, 64, 4);
  const audio = mach('Audio', 'audio');
  const r = seqFolgen(p, p.gruppen[0]);
  assert.deepEqual(r.map((x) => x.spur.id), [gut, leer, versetzt, kurz, zwei, audio]);
  assert.ok(!r.some((x) => x.spur.id === fremd));
  assert.deepEqual(r.map((x) => x.editierbar), [true, true, false, false, false, false]);
  assert.deepEqual(r.map((x) => x.clip?.id ?? null), [p.spuren.find((s) => s.id === gut).clips[0].id, null, p.spuren.find((s) => s.id === versetzt).clips[0].id,
    p.spuren.find((s) => s.id === kurz).clips[0].id, null, null]);
  const q = lauf(p, { befehl: 'gruppenspur_neu', name: 'leer' });
  assert.deepEqual(seqFolgen(q, q.gruppen.at(-1)), [], 'a group without tracks has no patterns');
});
