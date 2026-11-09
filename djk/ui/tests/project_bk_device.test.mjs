// Baukasten S20 task 2: a Baukasten graph as the device of a project instrument track ({art: 'intern', name: 'bk', graph, parameter: k1..k8}).
// Model, commands, translation. Old projects stay byte-identical (golden literals taken on base aa95b5f9 before the change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { pruefeProjekt, pruefeFehler, kanonisch, wiedergabeSicht, BK_GRAPH_NAME, BK_PARAMETER, MAX_BK_SPUREN } from '../project/model.ts';
import { uebersetze } from '../project/playback.ts';
import { GRAPH_NAME } from '../graphs.ts';
import { specProjekt, kopie, SHA_A, SHA_B } from './support/project.mjs';

const AUDIO = '/arbeit/arr/audio';
const opt = (extra = {}) => ({ nr: 1, audioOrdner: AUDIO, frames: (sha) => (sha === SHA_A || sha === SHA_B ? 24000 : null), ...extra });
const GOLD_WIEDERGABE = "{\"format\":\"cypherdj-arr/1\",\"nr\":1,\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"clips\":[{\"id\":\"c1\",\"start_beat\":0,\"laenge_beats\":1,\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"datei\":\"/arbeit/arr/audio/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.f32\",\"frames\":24000,\"offset_frames\":0,\"gain_db\":0,\"ein_beats\":0,\"aus_beats\":0}]},{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{},\"noten\":[{\"id\":\"c2/n1\",\"beat\":0,\"laenge\":0.5,\"ton\":36,\"vel\":100}]},{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}]}";
const GOLD_PROJEKT = "{\"projekt\":{\"format\":\"cypherdj-projekt/2\",\"gruppen\":[],\"loop\":{\"an\":true,\"bis_beat\":32,\"von_beat\":0},\"master\":{\"fader_db\":0},\"metronom\":{\"an\":false,\"pegel_db\":-12,\"ziel\":\"master\"},\"naechste_id\":{\"clip\":3,\"gruppe\":1,\"spur\":4},\"naechste_noten_id\":2,\"name\":\"First Track\",\"rev\":17,\"spuren\":[{\"art\":\"audio\",\"clips\":[{\"art\":\"audio\",\"dekodiert\":\"fertig\",\"fade_aus_beats\":0,\"fade_ein_beats\":0,\"gain_db\":0,\"id\":\"c1\",\"laenge_beats\":1,\"name\":\"kick\",\"offset_s\":0,\"quelle\":{\"pfad_hinweis\":\"/abs/kick.wav\",\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},\"start_beat\":0}],\"fader_db\":0,\"farbe\":\"#e0563b\",\"id\":\"s1\",\"mute\":false,\"name\":\"Kick\",\"nr\":1,\"pan\":0,\"solo\":false,\"von\":\"andreas\"},{\"art\":\"instrument\",\"clips\":[{\"art\":\"midi\",\"id\":\"c2\",\"laenge_beats\":16,\"name\":\"bassline\",\"noten\":[{\"beat\":0,\"id\":\"n1\",\"laenge\":0.5,\"ton\":36,\"vel\":100}],\"start_beat\":0}],\"fader_db\":0,\"farbe\":\"#3b8de0\",\"geraet\":{\"art\":\"intern\",\"name\":\"rb338\",\"parameter\":{}},\"id\":\"s2\",\"mute\":false,\"name\":\"Bass\",\"nr\":2,\"pan\":0,\"solo\":false,\"von\":\"andreas\"},{\"art\":\"instrument\",\"clips\":[],\"fader_db\":0,\"farbe\":\"#9b59d0\",\"freeze\":null,\"geraet\":{\"art\":\"wirt\",\"name\":\"surge\",\"slot\":1},\"id\":\"s3\",\"mute\":false,\"name\":\"Lead\",\"nr\":3,\"pan\":0,\"solo\":false,\"von\":\"andreas\"}],\"taktart\":[4,4],\"tempo_bpm\":124,\"wiedergabe_rev\":15}}";
const bk = (graph = 'juno-pad', parameter = {}) => ({ art: 'intern', name: 'bk', graph, parameter });
// the spec project with the RB track's device replaced
const mitBk = (g) => { const p = specProjekt(); p.spuren[1].geraet = g; return p; };
const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const neu = (p, geraet, opts) => fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', geraet }], opts);

test('S20 model: an instrument track with a bk device is valid', () => {
  const r = pruefeProjekt(mitBk(bk('juno-pad', { k1: 0.2, k8: 1 })));
  assert.ok('projekt' in r, JSON.stringify(r));
  assert.deepEqual(r.projekt.spuren[1].geraet, bk('juno-pad', { k1: 0.2, k8: 1 }));
  assert.ok('projekt' in pruefeProjekt(mitBk(bk('a'.repeat(32)))), 'a 32 character name is the longest allowed');
  assert.deepEqual(BK_PARAMETER, ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
});

test('S20 model: refusals (graph missing or malformed, knobs, extra field, freeze, nine tracks)', () => {
  const g = bk();
  const faelle = [
    ['graph missing', (() => { const x = bk(); delete x.graph; return x; })(), /graph/],
    ['graph with capital letters', bk('Juno'), /graph/],
    ['graph of 33 characters', bk('a'.repeat(33)), /graph/],
    ['graph empty', bk(''), /graph/],
    ['graph not a string', { ...g, graph: 5 }, /graph/],
    ['knob k9', bk('juno-pad', { k9: 0.5 }), /k9/],
    ['knob k1 above 1', bk('juno-pad', { k1: 1.5 }), /k1/],
    ['knob k1 below 0', bk('juno-pad', { k1: -0.1 }), /k1/],
    ['rb parameter name cutoff', bk('juno-pad', { cutoff: 0.5 }), /cutoff/],
    ['extra field foo', { ...g, foo: 1 }, /foo/],
    ['unknown name', { art: 'intern', name: 'zz', parameter: {} }, /name/],
  ];
  for (const [was, geraet, muster] of faelle) {
    const f = pruefeFehler(mitBk(geraet));
    assert.ok(f !== null && muster.test(f), `${was}: ${f}`);
  }
  const mitFreeze = mitBk(bk()); mitFreeze.spuren[1].freeze = null;
  assert.notEqual(pruefeFehler(mitFreeze), null, 'freeze on a bk track');
  // nine bk tracks: the ninth is refused, eight pass
  const p = specProjekt(); p.spuren = [];
  for (let i = 1; i <= 9; i += 1) {
    p.spuren.push({ id: `b${i}`, nr: i, name: `b${i}`, farbe: '#3b8de0', art: 'instrument', geraet: bk(), fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
    const f = pruefeFehler(p);
    if (i <= MAX_BK_SPUREN) assert.equal(f, null, `track ${i}: ${f}`);
    else assert.match(f ?? '', /at most 8/, `track ${i}: ${f}`);
  }
  assert.equal(MAX_BK_SPUREN, 8);
});

test('S20 commands: spur_neu with a bk device stores it, the track is named after the graph, parameter defaults to {}', () => {
  const r = neu(specProjekt(), { art: 'intern', name: 'bk', graph: 'juno-pad' });
  const s = r.projekt.spuren.at(-1);
  assert.deepEqual([s.name, s.art, s.geraet], ['juno-pad', 'instrument', bk('juno-pad', {})]);
  assert.equal('freeze' in s, false, 'no freeze field on an intern device');
  assert.equal(r.betrifft_wiedergabe, true);
  const k = neu(specProjekt(), { art: 'intern', name: 'bk', graph: 'x', parameter: { k2: 0.25 } }).projekt.spuren.at(-1);
  assert.deepEqual(k.geraet.parameter, { k2: 0.25 });
  for (const schlecht of [
    { art: 'intern', name: 'bk' },                                   // graph missing
    { art: 'intern', name: 'bk', graph: 'Juno' },
    { art: 'intern', name: 'bk', graph: 'x', parameter: { k9: 0.5 } },
    { art: 'intern', name: 'bk', graph: 'x', parameter: { k1: 2 } },
    { art: 'intern', name: 'bk', graph: 'x', parameter: { cutoff: 0.5 } },
    { art: 'intern', name: 'bk', graph: 'x', extra: 1 },
    { art: 'intern', name: 'rb338', graph: 'x' },                    // graph belongs to bk only
  ]) assert.throws(() => neu(specProjekt(), schlecht), (e) => e instanceof BefehlFehler && /argument_/.test(e.grund), JSON.stringify(schlecht));
});

test('S20 commands: graphArt lookup refuses unknown and effect graphs; without it only the name rule applies', () => {
  const graphArt = (n) => ({ 'juno-pad': 'instrument', 'fx-bandecho': 'effekt' })[n] ?? null;
  const ok = neu(specProjekt(), { art: 'intern', name: 'bk', graph: 'juno-pad' }, { graphArt });
  assert.equal(ok.projekt.spuren.at(-1).geraet.graph, 'juno-pad');
  assert.throws(() => neu(specProjekt(), { art: 'intern', name: 'bk', graph: 'nix' }, { graphArt }),
    (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig' && /unknown graph/.test(e.message), 'unknown graph');
  assert.throws(() => neu(specProjekt(), { art: 'intern', name: 'bk', graph: 'fx-bandecho' }, { graphArt }),
    (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig' && /effect graph/.test(e.message), 'effect graph');
  assert.ok(neu(specProjekt(), { art: 'intern', name: 'bk', graph: 'nix' }).projekt, 'no lookup injected: the name rule only');
  // spur_aendern goes through the same check
  const p = specProjekt();
  lehntAb(() => fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: bk('nix') }], { graphArt }), 'argument_ungueltig');
});

test('S20 commands: spur_aendern switches rb338 to bk and back (one step); a knob-only change is a new playback', () => {
  const p0 = specProjekt();
  const a = fuehreListeAus(p0, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: bk('juno-pad', { k1: 0.3 }) }]);
  assert.deepEqual(a.projekt.spuren[1].geraet, bk('juno-pad', { k1: 0.3 }));
  assert.equal(a.betrifft_wiedergabe, true);
  const zurueck = fuehreListeAus(a.projekt, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'rb338' } }]);
  assert.deepEqual(zurueck.projekt.spuren[1].geraet, { art: 'intern', name: 'rb338', parameter: {} });
  // knob-only: same graph, other parameter
  const b = fuehreListeAus(a.projekt, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: bk('juno-pad', { k1: 0.9 }) }]);
  assert.notEqual(kanonisch(wiedergabeSicht(a.projekt)), kanonisch(wiedergabeSicht(b.projekt)), 'a knob change makes a new playback view');
  assert.equal(b.betrifft_wiedergabe, true);
  // negative control: the same device again changes nothing
  const gleich = fuehreListeAus(a.projekt, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: bk('juno-pad', { k1: 0.3 }) }]);
  assert.equal(kanonisch(wiedergabeSicht(a.projekt)), kanonisch(wiedergabeSicht(gleich.projekt)));
  assert.equal(gleich.vor.length, 0, 'no patch for an unchanged device');
});

test('S20 translation: the playback carries geraet bk, graph and parameter; format stays /1', () => {
  const p = mitBk(bk('juno-pad', { k1: 0.2 }));
  const w = uebersetze(p, opt());
  assert.deepEqual(w.spuren[1], { nr: 2, art: 'intern', geraet: 'bk', graph: 'juno-pad', parameter: { k1: 0.2 },
    noten: [{ id: 'c2/n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }] });
  assert.equal(w.format, 'cypherdj-arr/1');
  // negative control: an RB track carries no graph field
  assert.equal('graph' in uebersetze(specProjekt(), opt()).spuren[1], false);
});

test('S20 byte identity: the old translation and the checked old project are unchanged (golden from the base commit)', () => {
  assert.equal(JSON.stringify(uebersetze(specProjekt(), opt())), GOLD_WIEDERGABE);
  assert.equal(kanonisch(pruefeProjekt(specProjekt())), GOLD_PROJEKT);
});

test('S20 defaults stay: spur_neu instrument without a device and intern without a name give the RB-338', () => {
  const a = fuehreListeAus(specProjekt(), [{ befehl: 'spur_neu', art: 'instrument' }]).projekt.spuren.at(-1);
  assert.deepEqual([a.name, a.geraet], ['RB-338', { art: 'intern', name: 'rb338', parameter: {} }]);
  const b = neu(specProjekt(), { art: 'intern' }).projekt.spuren.at(-1);
  assert.deepEqual([b.name, b.geraet], ['RB-338', { art: 'intern', name: 'rb338', parameter: {} }]);
});

test('S20 name rule: the model regex equals the page server graph rule (and the kern kit_name_ok)', () => {
  assert.equal(BK_GRAPH_NAME.source, GRAPH_NAME.source);
});

// ---- through the real session: the graph lookup of session.ts is wired (graphArt reads the graph folder of the kern) ------------------
// CYPHERDJ_BK_ORDNER points at a temp folder holding an instrument graph (inst) and an effect graph (eff, it has an "eingang" node).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sitzung } from './support/proj_context.mjs';

async function sitzungsVersuch(s, geraet) {
  try {
    const r = await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'bk', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet }] }, 'andreas');
    return { code: r.code, grund: r.j?.grund, text: r.j?.text ?? r.j?.meldung ?? '' };
  } catch (e) {
    return { code: e.code ?? e.status ?? 0, grund: e.grund ?? e.message, text: e.message ?? '' };
  }
}

test('S20 session: the graph folder decides: an instrument graph is accepted, an effect graph and an unknown name are refused', async (t) => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bk20-graphen-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const knoten = (extra) => ({ format: 'baukasten/2', name: 'x', stimmen: 1, knoten: [{ id: 'n', art: 'note' }, ...extra, { id: 'o', art: 'ausgang' }], kanten: [] });
  fs.writeFileSync(path.join(ordner, 'inst.json'), JSON.stringify(knoten([])));
  fs.writeFileSync(path.join(ordner, 'eff.json'), JSON.stringify(knoten([{ id: 'e', art: 'eingang' }])));
  const alt = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_BK_ORDNER = ordner;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt; });
  const { s } = sitzung(t);
  await s.neu('Bk', 'andreas');
  const ok = await sitzungsVersuch(s, bk('inst'));
  assert.equal(ok.code, 200, JSON.stringify(ok));
  assert.deepEqual(s.aktuell().j.projekt.spuren.at(-1).geraet, bk('inst'));
  const eff = await sitzungsVersuch(s, bk('eff'));
  assert.notEqual(eff.code, 200, 'an effect graph is no instrument');
  assert.match(JSON.stringify(eff), /argument_ungueltig/);
  const nix = await sitzungsVersuch(s, bk('nix'));
  assert.notEqual(nix.code, 200, 'a name that is not in the folder');
  assert.match(JSON.stringify(nix), /argument_ungueltig/);
  assert.equal(s.aktuell().j.projekt.spuren.length, 1, 'only the accepted track was added');
});

// Package 1.16 rest U2 T2.1b: a bk device carries the preset origin through the command path
test('1.16 bk device: spur_neu and spur_aendern carry geraet.preset; malformed refused; absent stores no key', () => {
  const p = specProjekt();
  const r = neu(p, { ...bk('juno-pad', { k1: 0.4 }), preset: 'nutzer:baukasten/my-pad' });
  assert.equal(r.projekt.spuren.at(-1).geraet.preset, 'nutzer:baukasten/my-pad');
  const id = r.projekt.spuren.at(-1).id;
  const a = fuehreListeAus(r.projekt, [{ befehl: 'spur_aendern', spur_id: id, geraet: { ...bk('juno-pad', { k1: 0.5 }), preset: 'werk:baukasten/warm' } }]);
  assert.equal(a.projekt.spuren.at(-1).geraet.preset, 'werk:baukasten/warm');
  lehntAb(() => neu(p, { ...bk(), preset: 'werk:baukasten' }), 'argument_ungueltig');
  assert.equal('preset' in neu(p, bk()).projekt.spuren.at(-1).geraet, false);
});
