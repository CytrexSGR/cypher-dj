// Find sound, task 3: the optional track field `stammbaum` (the family tree of a Baukasten track) and the project command
// stammbaum_setzen {spur_id, stammbaum}. The tree is project data: saved, undone and redone with its command, never part of the playback view.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fuehreListeAus, BefehlFehler, BEFEHL_NAMEN } from '../project/commands.ts';
import { pruefeProjekt, wiedergabeSicht, kanonisch, neuesProjekt } from '../project/model.ts';
import { uebersetze } from '../project/playback.ts';
import { Projekte } from '../project/storage.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { speichereModul, liesModul, modulOrdner, setzeModulEin } from '../project/module_storage.ts';
import { specProjekt, kopie, tmpOrdner } from './support/project.mjs';

const bk = (parameter = {}) => ({ art: 'intern', name: 'bk', graph: 'juno-pad', parameter });
const spur = (id, nr, geraet) => ({ id, nr, name: id, farbe: '#3b8de0', art: 'instrument', geraet, fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
const projekt = () => {
  const p = specProjekt();
  p.spuren = [spur('s7', 7, bk()), spur('s3', 3, bk({ k5: 0.25 })), spur('s5', 5, { art: 'intern', name: 'rb338', parameter: {} })];
  return p;
};
const baum = () => ({
  graph: 'juno-pad', aktiv: 'n2',
  knoten: [{ id: 'n1', eltern: null, werte: { k5: 0.25, k6: 0.5 }, text: 'start' }, { id: 'n2', eltern: 'n1', werte: { k5: 0.6 }, text: 'brighter' }],
});
const setze = (spurId, stammbaum) => ({ befehl: 'stammbaum_setzen', spur_id: spurId, stammbaum });
const lehntAb = (p, b, grund) => assert.throws(() => fuehreListeAus(p, [b]), (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund} for ${JSON.stringify(b)}`);
const spurVon = (p, id) => p.spuren.find((s) => s.id === id);
const A = { quelle: 'andreas', label: 'x' };

test('the command stores the tree and alone does not touch the playback', () => {
  assert.ok(BEFEHL_NAMEN.includes('stammbaum_setzen'));
  const p = projekt();
  const vorher = kopie(p);
  const r = fuehreListeAus(p, [setze('s7', baum())]);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(spurVon(r.projekt, 's7').stammbaum, baum());
  assert.equal(kanonisch(wiedergabeSicht(r.projekt)), kanonisch(wiedergabeSicht(p)), 'the playback view is the same');
  assert.deepEqual(p, vorher, 'the input project is untouched');
  const voll = fuehreListeAus(p, [setze('s7', baum())], { voll: true });
  assert.equal(voll.betrifft_wiedergabe, false, 'the general path says the same');
  assert.deepEqual(voll.projekt.spuren, r.projekt.spuren);
  const neu = { ...baum(), aktiv: 'n1' };   // replacing an existing tree
  assert.equal(spurVon(fuehreListeAus(r.projekt, [setze('s7', neu)]).projekt, 's7').stammbaum.aktiv, 'n1');
});

test('together with geraet_param_setzen it is one undo step and undo removes both', (t) => {
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const start = projekt();
  const q = aendere(w, start, [{ befehl: 'geraet_param_setzen', spur_id: 's7', param: 'k5', wert: 0.6 }, setze('s7', baum())], A);
  assert.equal(spurVon(q.projekt, 's7').geraet.parameter.k5, 0.6);
  assert.equal(spurVon(q.projekt, 's7').stammbaum.aktiv, 'n2');
  assert.equal(q.projekt.rev, start.rev + 1, 'one revision');
  const u = rueckgaengig(w, q.projekt, { quelle: 'andreas' });
  assert.equal(spurVon(u.projekt, 's7').stammbaum, undefined, 'the tree is gone');
  assert.equal(spurVon(u.projekt, 's7').geraet.parameter.k5, undefined, 'and the knob is back');
  assert.equal(u.projekt.rev, start.rev + 2);
  const r = wiederholen(w, u.projekt, { quelle: 'andreas' });
  assert.deepEqual(spurVon(r.projekt, 's7').stammbaum, baum());
  assert.equal(spurVon(r.projekt, 's7').geraet.parameter.k5, 0.6);
});

test('null removes the field; removing a tree that is not there is allowed', () => {
  const p = fuehreListeAus(projekt(), [setze('s7', baum())]).projekt;
  const r = fuehreListeAus(p, [setze('s7', null)]);
  assert.ok(!('stammbaum' in spurVon(r.projekt, 's7')), 'no key left, not even null');
  assert.equal(r.betrifft_wiedergabe, false);
  assert.ok(!('stammbaum' in spurVon(fuehreListeAus(projekt(), [setze('s7', null)]).projekt, 's7')));
});

test('a malformed tree, an audio track and an RB-338 track are refused', () => {
  const p = projekt();
  lehntAb(p, setze('nope', baum()), 'spur_unbekannt');
  lehntAb(p, setze('s5', baum()), 'geraet_falsch');
  p.spuren.push({ id: 's8', nr: 8, name: 'Aud', farbe: '#3b8de0', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  lehntAb(p, setze('s8', baum()), 'geraet_falsch');
  const falsch = [
    ['root with a parent', { ...baum(), knoten: [{ id: 'n1', eltern: 'n9', werte: {}, text: 'x' }], aktiv: 'n1' }],
    ['active node missing', { ...baum(), aktiv: 'n7' }],
    ['knob out of range', { ...baum(), knoten: [{ id: 'n1', eltern: null, werte: { k5: 1.5 }, text: 'x' }], aktiv: 'n1' }],
    ['unknown field', { ...baum(), extra: 1 }],
    ['not an object', 'tree'],
    ['an array', []],
    ['undefined', undefined],
  ];
  for (const [name, b] of falsch) {
    assert.throws(() => fuehreListeAus(p, [setze('s7', b)]), (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig' && /stammbaum/.test(e.message), name);
  }
  lehntAb(p, { ...setze('s7', baum()), extra: 1 }, 'argument_unbekannt');
  const zuViele = { ...baum(), knoten: Array.from({ length: 201 }, (_, i) => ({ id: `n${i + 1}`, eltern: i ? 'n1' : null, werte: {}, text: '' })), aktiv: 'n1' };
  lehntAb(p, setze('s7', zuViele), 'argument_ungueltig');
  assert.ok(!('stammbaum' in spurVon(p, 's7')), 'a refusal changes nothing');
});

test('the model refuses a tree on an audio track and a malformed tree in a file', () => {
  const p = projekt();
  spurVon(p, 's7').stammbaum = baum();
  assert.ok('projekt' in pruefeProjekt(p), JSON.stringify(pruefeProjekt(p)));
  const roh = specProjekt();
  roh.spuren[0].stammbaum = baum();   // audio track
  assert.ok(!('projekt' in pruefeProjekt(roh)), 'an audio track may not carry a tree');
  const kaputt = projekt();
  spurVon(kaputt, 's7').stammbaum = { ...baum(), aktiv: 'x' };
  const r = pruefeProjekt(kaputt);
  assert.ok(!('projekt' in r) && /stammbaum/.test(JSON.stringify(r)), JSON.stringify(r));
});

test('a project file with a tree validates and survives save and load', (t) => {
  const w = tmpOrdner(t);
  const pr = new Projekte(w);
  const { slug } = pr.lege('Tree');
  const p = fuehreListeAus(projekt(), [setze('s7', baum())]).projekt;
  assert.ok('projekt' in pruefeProjekt(p));
  pr.speichere(slug, p);
  assert.match(fs.readFileSync(path.join(w, slug, 'project.json'), 'utf8'), /"stammbaum"/);
  assert.deepEqual(spurVon(pr.lies(slug), 's7').stammbaum, baum());
  assert.ok(!('stammbaum' in spurVon(pr.lies(slug), 's3')), 'another track has none');
});

test('the playback file does not contain the tree', () => {
  const p = fuehreListeAus(projekt(), [setze('s7', baum())]).projekt;
  const opt = { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: () => 24000 };
  const mit = JSON.stringify(uebersetze(p, opt)), ohne = JSON.stringify(uebersetze(projekt(), opt));
  assert.ok(!/stammbaum|brighter/.test(mit), 'no tree in the translation');
  assert.equal(mit, ohne, 'the translation is byte for byte the same without the tree');
  assert.ok(!/stammbaum|brighter/.test(JSON.stringify(wiedergabeSicht(p))));
});

test('duplicating a track by placing a module and saving a module KEEP the tree without a validation error', (t) => {
  // there is no track duplicate command; the copies of a track are a module save and a module placement (both structuredClone the track)
  const basis = tmpOrdner(t, 'djk-stamm-');
  const p0 = neuesProjekt('quelle');
  let p = fuehreListeAus(p0, [{ befehl: 'gruppenspur_neu', name: 'Mod' }, { befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet: bk({ k5: 0.25 }) }]).projekt;
  const g = p.gruppen[0], s = p.spuren[0];
  p = fuehreListeAus(p, [{ befehl: 'ziel_setzen', strang_id: s.id, ausgang: { art: 'gruppe', id: g.id } }, setze(s.id, baum())]).projekt;
  const { id } = speichereModul(p, g.id, { basis });
  const datei = liesModul(id, basis);
  assert.deepEqual(datei.spuren[0].stammbaum, baum(), 'saving a module keeps the tree in modul.json');
  const ziel = neuesProjekt('ziel');
  const r = setzeModulEin(ziel, datei, { modulOrdner: modulOrdner(id, basis), audioZiel: path.join(basis, 'audio'), quelle: 'andreas' });
  assert.deepEqual(r.projekt.spuren[0].stammbaum, baum(), 'placing a module keeps the tree on the new track');
  assert.notEqual(r.projekt.spuren[0], datei.spuren[0], 'it is a copy, not the same object');
  assert.ok('projekt' in pruefeProjekt(r.projekt), JSON.stringify(pruefeProjekt(r.projekt)));
});
