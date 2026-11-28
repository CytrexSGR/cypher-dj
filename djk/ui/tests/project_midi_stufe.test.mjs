// Strand 7 task 1.4: the MIDI stage chain of an instrument track. Project field (model), command midi_stufe_setzen, playback key `midi`, skalaMaske.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, pruefeFehler, midiStufeFehler, wiedergabeSicht } from '../project/model.ts';
import { normalisiere } from '../project/storage.ts';
import { uebersetze } from '../project/playback.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { skalaMaske } from '../public/harmonie.js';
import { specProjekt, kopie, tmpOrdner } from './support/project.mjs';

const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const opt = { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: () => 24000 };
const VOLL = {
  akkord: { intervalle: [4, 7] }, skala: { grundton: 9, skala: 'minor' },
  arp: { muster: 'up', sync: true, rate: '1/16', oktaven: 2, gate: 0.5 }, velocity: { kurve: 0.25, zufall: 8, fest: 100 }, chance: 80, saat: 12345,
};
// s1 audio, s2 rb338, s3 surge (wirt); a bk track and a rack track added by the helper
function projekt() {
  let p = neuesProjekt('T');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', name: 'I' }).projekt;
  return p;
}
const mitMidi = (p, spurId, m) => fuehreAus(p, { befehl: 'midi_stufe_setzen', spur_id: spurId, midi: m }).projekt;
const midiVon = (p, nr) => uebersetze(p, opt).spuren.find((s) => s.nr === nr).midi;

test('mask of a key: bit pc set; A minor and C major are the white keys', () => {
  assert.equal(skalaMaske(0, 'major'), 0b101010110101);
  assert.equal(skalaMaske(9, 'minor'), 0b101010110101);
  assert.equal(skalaMaske(2, 'major'), 2774, 'D major: D E F# G A B C#');
  assert.equal(skalaMaske(0, 'nope'), 0);
});

test('model: a full object round-trips through load and save', () => {
  const p = projekt();
  const q = mitMidi(p, 's2', VOLL);
  const r = pruefeProjekt(JSON.parse(JSON.stringify(normalisiere(q))));
  assert.ok('projekt' in r, JSON.stringify(r));
  assert.deepEqual(r.projekt.spuren[1].midi, VOLL);
  assert.equal(JSON.stringify(normalisiere(r.projekt)), JSON.stringify(normalisiere(q)));
  const frei = { aus: true, arp: { muster: 'random', sync: false, hz: 8, oktaven: 1, gate: 1 }, skala: { quelle: 'projekt' } };
  assert.equal(midiStufeFehler(frei), null);
});

test('model: refusals name their field', () => {
  const faelle = [
    ['aus false', { aus: false }, /aus/],
    ['unknown member', { x: 1 }, /midi\.x/],
    ['no intervals', { akkord: { intervalle: [] } }, /intervalle/],
    ['seven intervals', { akkord: { intervalle: [1, 2, 3, 4, 5, 6, 7] } }, /intervalle/],
    ['zero interval', { akkord: { intervalle: [0] } }, /intervalle\[0\]/],
    ['interval 25', { akkord: { intervalle: [25] } }, /intervalle\[0\]/],
    ['interval fraction', { akkord: { intervalle: [1.5] } }, /intervalle\[0\]/],
    ['intervals twice', { akkord: { intervalle: [4, 4] } }, /distinct/],
    ['scale name', { skala: { grundton: 0, skala: 'x' } }, /skala\.skala/],
    ['scale root 12', { skala: { grundton: 12, skala: 'minor' } }, /grundton/],
    ['scale source', { skala: { quelle: 'lane' } }, /quelle/],
    ['arp pattern', { arp: { muster: 'x', sync: true, rate: '1/4', oktaven: 1, gate: 0.5 } }, /muster/],
    ['arp rate name', { arp: { muster: 'up', sync: true, rate: '1/3', oktaven: 1, gate: 0.5 } }, /rate/],
    ['arp rate and hz', { arp: { muster: 'up', sync: true, rate: '1/4', hz: 4, oktaven: 1, gate: 0.5 } }, /arp\.hz/],
    ['arp hz 0.4', { arp: { muster: 'up', sync: false, hz: 0.4, oktaven: 1, gate: 0.5 } }, /hz/],
    ['arp hz 41', { arp: { muster: 'up', sync: false, hz: 41, oktaven: 1, gate: 0.5 } }, /hz/],
    ['arp oktaven 5', { arp: { muster: 'up', sync: true, rate: '1/4', oktaven: 5, gate: 0.5 } }, /oktaven/],
    ['arp gate 0.04', { arp: { muster: 'up', sync: true, rate: '1/4', oktaven: 1, gate: 0.04 } }, /gate/],
    ['arp gate 1.1', { arp: { muster: 'up', sync: true, rate: '1/4', oktaven: 1, gate: 1.1 } }, /gate/],
    ['velocity kurve 2', { velocity: { kurve: 2, zufall: 0 } }, /kurve/],
    ['velocity zufall 65', { velocity: { kurve: 0, zufall: 65 } }, /zufall/],
    ['velocity zufall fraction', { velocity: { kurve: 0, zufall: 1.5 } }, /zufall/],
    ['velocity fest 0', { velocity: { kurve: 0, zufall: 0, fest: 0 } }, /fest/],
    ['velocity fest 128', { velocity: { kurve: 0, zufall: 0, fest: 128 } }, /fest/],
    ['chance 101', { chance: 101 }, /chance/],
    ['chance fraction', { chance: 50.5 }, /chance/],
    ['saat negative', { saat: -1 }, /saat/],
    ['saat 2^32', { saat: 4294967296 }, /saat/],
    ['saat fraction', { saat: 1.5 }, /saat/],
  ];
  for (const [name, m, re] of faelle) {
    const f = midiStufeFehler(m);
    assert.ok(f !== null && re.test(f), `${name}: ${f}`);
    const p = projekt();
    lehntAb(p, { befehl: 'midi_stufe_setzen', spur_id: 's2', midi: m }, 'argument_ungueltig');
    p.spuren[1].midi = m;
    assert.match(pruefeFehler(JSON.parse(JSON.stringify(p))) ?? '', re, `${name} in a file`);
  }
  assert.equal(midiStufeFehler({ saat: 0, chance: 0, velocity: { kurve: -1, zufall: 64, fest: 127 }, akkord: { intervalle: [-24, 24, 1, -1, 2, -2] } }), null);
});

test('model: midi only on instrument tracks and only in /2 files', () => {
  const p = projekt();
  const q = mitMidi(p, 's2', { chance: 50 });
  const alt = kopie(q); alt.format = 'cypherdj-projekt/1'; delete alt.gruppen; delete alt.master;
  assert.match(pruefeFehler(alt) ?? '', /midi/);
  const au = kopie(q); au.spuren[0].midi = { chance: 50 };
  assert.match(pruefeFehler(au) ?? '', /midi/);
});

test('command: sets, replaces and removes; one undo step', (t) => {
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { zeitgeber: false });
  const meta = { quelle: 'andreas', label: 'T' };
  const p0 = projekt();
  const a = aendere(v, p0, [{ befehl: 'midi_stufe_setzen', spur_id: 's2', midi: VOLL }], meta);
  assert.deepEqual(a.projekt.spuren[1].midi, VOLL);
  assert.equal(a.betrifft_wiedergabe, true);
  const b = aendere(v, a.projekt, [{ befehl: 'midi_stufe_setzen', spur_id: 's2', midi: { chance: 10 } }], meta);
  assert.deepEqual(b.projekt.spuren[1].midi, { chance: 10 }, 'the whole object is replaced');
  const c = aendere(v, b.projekt, [{ befehl: 'midi_stufe_setzen', spur_id: 's2', midi: null }], meta);
  assert.ok(!('midi' in c.projekt.spuren[1]));
  assert.ok(!JSON.stringify(normalisiere(c.projekt)).includes('"midi"'));
  const u = rueckgaengig(v, c.projekt, { quelle: 'andreas' });
  assert.deepEqual(u.projekt.spuren[1].midi, { chance: 10 }, 'one undo step restores it');
  assert.deepEqual(rueckgaengig(v, u.projekt, { quelle: 'andreas' }).projekt.spuren[1].midi, VOLL);
});

test('command: refusals', () => {
  const p = projekt();
  lehntAb(p, { befehl: 'midi_stufe_setzen', spur_id: 's9', midi: {} }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'midi_stufe_setzen', spur_id: 's1', midi: { chance: 50 } }, 'art_passt_nicht');
  lehntAb(p, { befehl: 'midi_stufe_setzen', spur_id: 's2', midi: 'x' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'midi_stufe_setzen', spur_id: 's2' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'midi_stufe_setzen', spur_id: 's2', midi: { chance: 500 } }, 'argument_ungueltig');
});

test('playback: bk, rb338 (rate names to beats), wirt and rack tracks carry the key; hz and defaults', () => {
  const rate = { '1/2': 2, '1/4': 1, '1/4t': 2 / 3, '1/8': 0.5, '1/8t': 1 / 3, '1/16': 0.25, '1/16t': 1 / 6, '1/32': 0.125 };
  const w = specProjekt(); w.format = 'cypherdj-projekt/2'; w.gruppen = []; w.master = { fader_db: 0 };
  w.spuren.push({ id: 's4', nr: 4, name: 'Pad', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'juno-pad', parameter: {} },
    fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  w.spuren.push({ id: 's5', nr: 5, name: 'Rack', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'rack', kette: 0,
    glieder: [{ id: 'g1', geraet: { art: 'intern', name: 'kit', kit: 'k1' } }] }, fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  const g = pruefeProjekt(w);
  assert.ok('projekt' in g, JSON.stringify(g));
  let p = g.projekt;
  for (const [i, id] of ['s2', 's3', 's4', 's5'].entries()) {
    p = mitMidi(p, id, { arp: { muster: 'down', sync: true, rate: Object.keys(rate)[i], oktaven: 3, gate: 0.25 }, akkord: { intervalle: [7] } });
  }
  for (const [i, nr] of [2, 3, 4, 5].entries()) {
    assert.deepEqual(midiVon(p, nr), { akkord: [7], arp: { muster: 'down', rate: Object.values(rate)[i], oktaven: 3, gate: 0.25 }, saat: 0 }, `track ${nr}`);
  }
  p = mitMidi(p, 's2', { arp: { muster: 'chord', sync: false, hz: 12.5, oktaven: 1, gate: 1 }, velocity: { kurve: -0.5, zufall: 4 }, chance: 100, saat: 7 });
  assert.deepEqual(midiVon(p, 2), { arp: { muster: 'chord', hz: 12.5, oktaven: 1, gate: 1 }, velocity: { kurve: -0.5, zufall: 4, fest: 0 }, chance: 100, saat: 7 });
  assert.equal(midiVon(p, 1), undefined, 'the audio track has none');
});

test('playback: aus, an object without a stage, and a project without midi write nothing', () => {
  const p = projekt();
  const bytesOhne = JSON.stringify(uebersetze(p, opt));
  assert.ok(!bytesOhne.includes('midi'));
  assert.equal(midiVon(mitMidi(p, 's2', { ...VOLL, aus: true }), 2), undefined);
  assert.equal(midiVon(mitMidi(p, 's2', { saat: 5 }), 2), undefined);
  assert.equal(midiVon(mitMidi(p, 's2', {}), 2), undefined);
  assert.equal(JSON.stringify(uebersetze(mitMidi(mitMidi(p, 's2', VOLL), 's2', null), opt)), bytesOhne, 'removed again: the same bytes as before');
});

test('playback: a plain project with only a MIDI stage is /2 and carries the key; without a stage it stays /1', () => {
  const p = projekt();
  const ohne = uebersetze(p, opt);
  assert.equal(ohne.format, 'cypherdj-arr/1');
  assert.ok(!JSON.stringify(ohne).includes('midi'));
  const mit = uebersetze(mitMidi(p, 's2', { arp: { muster: 'up', sync: true, rate: '1/16', oktaven: 2, gate: 0.5 } }), opt);
  assert.equal(mit.format, 'cypherdj-arr/2');
  assert.ok(mit.spuren.find((s) => s.nr === 2).midi, 'the track carries midi');
});

test('playback: a project without midi writes the golden bytes of an existing fixture', () => {
  const w = specProjekt();
  const x = uebersetze(pruefeProjekt(w).projekt, { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: () => 24000 });
  assert.ok(!JSON.stringify(x).includes('midi'));
  assert.deepEqual(x.spuren.map((s) => s.nr), [1, 2, 3]);
});

test('playback: scale source project follows the project key; without a key the scale is left out', () => {
  let p = mitMidi(projekt(), 's2', { skala: { quelle: 'projekt' }, chance: 90 });
  assert.deepEqual(midiVon(p, 2), { chance: 90, saat: 0 }, 'no key: the scale stage is left out, the others stay');
  assert.equal(midiVon(mitMidi(projekt(), 's2', { skala: { quelle: 'projekt' } }), 2), undefined, 'no key and no other stage: nothing');
  const q = fuehreAus(p, { befehl: 'tonart_setzen', grundton: 9, skala: 'minor' });
  assert.equal(q.betrifft_wiedergabe, true, 'a key change is a new playback when a track follows it');
  assert.deepEqual(midiVon(q.projekt, 2), { skala: { maske: skalaMaske(9, 'minor') }, chance: 90, saat: 0 });
  const r = fuehreAus(q.projekt, { befehl: 'tonart_setzen', grundton: 2, skala: 'major' });
  assert.deepEqual(midiVon(r.projekt, 2).skala, { maske: skalaMaske(2, 'major') });
  const f = mitMidi(r.projekt, 's2', { skala: { grundton: 0, skala: 'major' } });
  assert.deepEqual(midiVon(f, 2).skala, { maske: skalaMaske(0, 'major') });
  assert.equal(fuehreAus(f, { befehl: 'tonart_setzen', grundton: 5, skala: 'minor' }).betrifft_wiedergabe, false, 'a fixed scale ignores the key');
  assert.ok(wiedergabeSicht(f));
});
