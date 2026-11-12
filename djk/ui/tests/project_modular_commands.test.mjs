// S17 task 1: the command bk_setzen. Plan 2026-11-01-baukasten-s17.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler, BEFEHL_NAMEN } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, kanonisch } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { specProjekt, mitVon, SHA_B, ohneAbgeleitetes } from './support/project.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 100)}`);
const acht = (x) => Array(8).fill(x);

test('S17 T1.6 bk_setzen adds, replaces and removes; the key is absent when empty', () => {
  const p = neuesProjekt('T');
  const r1 = ok(p, { befehl: 'bk_setzen', kanal: 'erz/2', graph: 'juno-pad-dyn' });
  assert.deepEqual(r1.projekt.baukasten, [{ id: 'erz2', graph: 'juno-pad-dyn', regler: acht(0.5) }]);
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(r1.projekt))).fehler, undefined);
  const v = [0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5];
  const r2 = ok(r1.projekt, { befehl: 'bk_setzen', kanal: 'erz/2', graph: 'juno-pad-dyn', regler: v });
  assert.equal(r2.projekt.baukasten.length, 1); assert.deepEqual(r2.projekt.baukasten[0].regler, v);
  const r3 = ok(r2.projekt, { befehl: 'bk_setzen', kanal: 'erz/2', graph: null });
  assert.equal('baukasten' in r3.projekt, false, 'key absent, not []');
  assert.equal(p.baukasten, undefined, 'input untouched');
});

test('S17 T1.7 regler omitted keeps the old values; a new graph drops sha256, the same name keeps it', () => {
  let p = ok(neuesProjekt('T'), { befehl: 'bk_setzen', kanal: 'deck/1', graph: 'fx-bandecho', regler: acht(0.2), sha256: SHA_B }).projekt;
  assert.equal(p.baukasten[0].sha256, SHA_B);
  const same = ok(p, { befehl: 'bk_setzen', kanal: 'deck/1', graph: 'fx-bandecho' }).projekt;
  assert.deepEqual(same.baukasten[0].regler, acht(0.2)); assert.equal(same.baukasten[0].sha256, SHA_B);
  const other = ok(p, { befehl: 'bk_setzen', kanal: 'deck/1', graph: 'fx-hall' }).projekt;
  assert.deepEqual(other.baukasten[0].regler, acht(0.2), 'values kept for the same channel');
  assert.equal('sha256' in other.baukasten[0], false, 'sha256 dropped with a new graph name');
  const neu = ok(p, { befehl: 'bk_setzen', kanal: 'deck/1', graph: 'fx-hall', sha256: 'c'.repeat(64) }).projekt;
  assert.equal(neu.baukasten[0].sha256, 'c'.repeat(64));
});

test('S17 T1.8 refusals', () => {
  const p = ok(neuesProjekt('T'), { befehl: 'bk_setzen', kanal: 'erz/2', graph: 'a' }).projekt;
  const b = (x) => ({ befehl: 'bk_setzen', kanal: 'erz/2', graph: 'a', ...x });
  lehntAb(p, b({ kanal: 'erz/4' }), 'argument_ungueltig');
  lehntAb(p, b({ kanal: 'erz/9' }), 'argument_ungueltig');
  lehntAb(p, b({ kanal: 'deck/5' }), 'argument_ungueltig');
  lehntAb(p, b({ graph: '../x' }), 'argument_ungueltig');
  lehntAb(p, b({ regler: Array(7).fill(0.5) }), 'argument_ungueltig');
  lehntAb(p, b({ regler: Array(65).fill(0.5) }), 'argument_ungueltig');
  lehntAb(p, b({ regler: acht(2) }), 'argument_ungueltig');
  lehntAb(p, b({ sha256: 'zz' }), 'argument_ungueltig');
  lehntAb(p, b({ wert: 1 }), 'argument_unbekannt');
  lehntAb(p, { befehl: 'bk_setzen', kanal: 'erz/3', graph: null }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'bk_setzen', graph: 'a' }, 'argument_ungueltig');
  assert.ok(ok(p, b({ graph: 'b' })), 'negative control: a valid call passes');
});

test('S17 T1.9 no playback reload, no freeze discarded', () => {
  let p = mitVon(specProjekt());
  p = ok(p, { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] }).projekt;
  p.spuren[2].freeze = { datei: 'freeze/s3-1.f32', frames: 96000, kennung: 1, sha256: SHA_B };
  const r = ok(p, { befehl: 'bk_setzen', kanal: 'erz/3', graph: 'inst' });
  assert.equal(r.betrifft_wiedergabe, false);
  assert.ok(r.projekt.spuren[2].freeze, 'freeze still set');
  assert.deepEqual(r.regler_aenderungen, []);
  const g = ok(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'rb338', parameter: {} } });
  assert.equal(g.betrifft_wiedergabe, true, 'negative control: a device change does reload the playback');
});

test('S17 T1.10 undo and redo round trip are byte-identical', () => {
  const p = mitVon(specProjekt());
  const r = ok(p, { befehl: 'bk_setzen', kanal: 'erz/2', graph: 'juno-pad-dyn', regler: acht(0.7) });
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  const zurueck = wende(r.projekt, r.zurueck);
  assert.equal(ohneAbgeleitetes(zurueck), ohneAbgeleitetes(p));
  assert.equal('baukasten' in zurueck, false);
  const r2 = ok(r.projekt, { befehl: 'bk_setzen', kanal: 'erz/2', graph: null });
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r2.vor)), ohneAbgeleitetes(r2.projekt));
  assert.equal(ohneAbgeleitetes(wende(r2.projekt, r2.zurueck)), ohneAbgeleitetes(r.projekt));
  assert.ok(kanonisch(r.projekt).includes('baukasten'));
});

test('S17 T1.11 BEFEHL_NAMEN includes bk_setzen', () => {
  assert.ok(BEFEHL_NAMEN.includes('bk_setzen'));
});
