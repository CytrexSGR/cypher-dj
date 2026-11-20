// Kraken patch field task 4: the pin list (steckfeld.ts), its place in the project model (`geraet.stifte` of a Baukasten track, format /2 only),
// the playback translator (`stifte` on the bk track) and the playback view (a pin change is a playback change). Pure calculation: no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaleStifte, stiftFehler, STIFTE_MAX } from '../steckfeld.ts';
import { pruefeProjekt, pruefeFehler, neuesProjekt, spurSicht, kanonisch } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { uebersetze } from '../project/playback.ts';
import { kopie } from './support/project.mjs';

const spur = (id, nr, geraet) => ({ id, nr, name: id, farbe: '#3b8de0', art: 'instrument', geraet, fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
const bk = (extra = {}) => ({ art: 'intern', name: 'bk', graph: 'steck', parameter: {}, ...extra });
const mitSpur = (geraet) => { const p = neuesProjekt('P'); p.spuren = [spur('s1', 1, geraet)]; p.naechste_id = { spur: 2, clip: 1, gruppe: 1 }; return p; };
const UEBERSETZ = { nr: 1, geraetFx: () => ({ stufig: false, rollen: {} }), frames: () => 0, audioOrdner: '/nix', transienten: () => null };

test('stiftFehler: every bad shape names its problem, a good list is null', () => {
  assert.equal(stiftFehler([]), null);
  assert.equal(stiftFehler([[0, 0, 0, 0.5], [0, 0, 1, -1], [1, 15, 15, 1]]), null);
  const schlecht = [
    ['x', 'array'], [null, 'array'], [{}, 'array'],
    [[[0, 0, 0]], '[satz, zeile, spalte, wert]'], [[[0, 0, 0, 0.5, 1]], '[satz, zeile, spalte, wert]'], [['a'], '[satz, zeile, spalte, wert]'],
    [[[2, 0, 0, 0.5]], 'satz'], [[[-1, 0, 0, 0.5]], 'satz'], [[[0.5, 0, 0, 0.5]], 'satz'],
    [[[0, 16, 0, 0.5]], 'zeile'], [[[0, -1, 0, 0.5]], 'zeile'], [[[0, 0, 16, 0.5]], 'spalte'], [[[0, 0, 1.5, 0.5]], 'spalte'],
    [[[0, 0, 0, 1.5]], 'value'], [[[0, 0, 0, -1.01]], 'value'], [[[0, 0, 0, NaN]], 'value'], [[[0, 0, 0, Infinity]], 'value'], [[[0, 0, 0, '0.5']], 'value'],
    [[[0, 0, 0, 0]], 'zero'],
    [[[0, 0, 0, 0.5], [0, 0, 0, 0.25]], 'twice'],
    [[[0, 1, 0, 0.5], [0, 0, 1, 0.5]], 'sorted'], [[[1, 0, 0, 0.5], [0, 0, 0, 0.5]], 'sorted'],
    [Array.from({ length: STIFTE_MAX + 1 }, (_, i) => [i >> 8, (i >> 4) & 15, i & 15, 0.5]), 'at most'],
  ];
  for (const [roh, wort] of schlecht) {
    const f = stiftFehler(roh);
    assert.ok(typeof f === 'string' && f.includes(wort), `${JSON.stringify(roh).slice(0, 60)} -> ${f}`);
  }
  assert.equal(stiftFehler(Array.from({ length: STIFTE_MAX }, (_, i) => [i >> 8, (i >> 4) & 15, i & 15, 0.5])), null, '512 pins are the limit');
});

test('normaleStifte: sorts, last write per position wins, drops zeros, does not change its input', () => {
  const l = [[1, 0, 0, 0.5], [0, 3, 2, 0.25], [0, 0, 0, 0.75], [0, 3, 2, 0], [0, 0, 0, -0.5]];
  const vorher = JSON.stringify(l);
  assert.deepEqual(normaleStifte(l), [[0, 0, 0, -0.5], [1, 0, 0, 0.5]]);
  assert.equal(JSON.stringify(l), vorher);
  assert.deepEqual(normaleStifte([]), []);
  assert.equal(stiftFehler(normaleStifte(l)), null, 'the normal form is a valid stored list');
});

test('a project with stifte loads, saves and loads equal; the empty list is kept (it means "all zero", not "defaults")', () => {
  for (const stifte of [[[0, 2, 3, 0.5], [1, 0, 0, -1]], []]) {
    const p = mitSpur(bk({ stifte }));
    assert.equal(pruefeFehler(p), null);
    const r1 = pruefeProjekt(p).projekt;
    assert.deepEqual(r1.spuren[0].geraet.stifte, stifte);
    const r2 = pruefeProjekt(JSON.parse(JSON.stringify(r1))).projekt;
    assert.equal(kanonisch(r2), kanonisch(r1));
  }
  assert.equal('stifte' in pruefeProjekt(mitSpur(bk())).projekt.spuren[0].geraet, false, 'absent stays absent');
});

test('refused: stifte in a /1 file, a bad entry, and stifte on a rack member', () => {
  const alt = mitSpur(bk({ stifte: [[0, 0, 0, 0.5]] })); alt.format = 'cypherdj-projekt/1'; delete alt.gruppen; delete alt.master;
  assert.match(pruefeFehler(alt) ?? '', /stifte/);
  for (const roh of [[[0, 0, 0, 2]], [[0, 0, 0, 0]], [[3, 0, 0, 0.5]], 'x', [[0, 0, 0, 0.5], [0, 0, 0, 0.5]]]) {
    assert.match(pruefeFehler(mitSpur(bk({ stifte: roh }))) ?? '', /stifte/, JSON.stringify(roh));
  }
  const rack = mitSpur({ art: 'rack', kette: 0, glieder: [{ id: 'g1', geraet: bk({ stifte: [[0, 0, 0, 0.5]] }) }] });
  assert.match(pruefeFehler(rack) ?? '', /stifte/);
  const rackOhne = mitSpur({ art: 'rack', kette: 0, glieder: [{ id: 'g1', geraet: bk() }] });
  assert.equal(pruefeFehler(rackOhne), null, 'a rack member without stifte stays valid');
});

test('the translator writes stifte on the bk track only when the device has them (an empty list too)', () => {
  const ohne = uebersetze(mitSpur(bk()), UEBERSETZ).spuren[0];
  assert.equal('stifte' in ohne, false);
  const mit = uebersetze(mitSpur(bk({ stifte: [[0, 2, 3, 0.5], [1, 0, 0, -1]] })), UEBERSETZ).spuren[0];
  assert.deepEqual(mit.stifte, [[0, 2, 3, 0.5], [1, 0, 0, -1]]);
  assert.equal(mit.geraet, 'bk');
  const leer = uebersetze(mitSpur(bk({ stifte: [] })), UEBERSETZ).spuren[0];
  assert.deepEqual(leer.stifte, []);
});

test('spurSicht differs when a pin changes (a pin is a playback change)', () => {
  const a = mitSpur(bk({ stifte: [[0, 2, 3, 0.5]] })).spuren[0], b = mitSpur(bk({ stifte: [[0, 2, 3, 0.75]] })).spuren[0];
  assert.notEqual(JSON.stringify(spurSicht(a)), JSON.stringify(spurSicht(b)));
  assert.equal(JSON.stringify(spurSicht(a)), JSON.stringify(spurSicht(kopie(a))));
  const r = fuehreListeAus(mitSpur(bk({ stifte: [[0, 2, 3, 0.5]] })), [{ befehl: 'geraet_stifte_setzen', spur_id: 's1', stifte: [[0, 2, 3, 0.75]] }]);
  assert.equal(r.betrifft_wiedergabe, true);
});
