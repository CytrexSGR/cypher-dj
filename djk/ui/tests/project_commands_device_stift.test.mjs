// Kraken patch field task 4: the commands geraet_stift_setzen {spur_id, satz, zeile, spalte, wert} and geraet_stifte_setzen {spur_id, satz?, stifte}.
// The first pin of a track takes the general path (the graph default pins are written into the list first), later pins are light and name one stift_aenderungen
// entry; the patch is ONE replace of /spuren/<id>/geraet/stifte. Pure calculation: no server, no core.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { kopie, tmpOrdner } from './support/project.mjs';

const GRUND = [[0, 0, 0, 0.5], [1, 2, 3, -0.25]];                      // the default pins of the graph "steck"
const NAMEN = Array.from({ length: 16 }, (_, i) => `n${i + 1}`);
const LOOKUP = { steckfeldVon: (g) => (g === 'steck' ? { zeilen: NAMEN, spalten: NAMEN, stifte: GRUND.map((e) => [...e]) } : null) };
const bk = (extra = {}, graph = 'steck') => ({ art: 'intern', name: 'bk', graph, parameter: {}, ...extra });
const rb = () => ({ art: 'intern', name: 'rb338', parameter: {} });
const spur = (id, nr, geraet) => ({ id, nr, name: id, farbe: '#3b8de0', art: 'instrument', geraet, fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
// s7: a bk track without stifte (the graph defaults play); s3: with a list; s5: an RB-338; s9: a bk track whose graph has no matrix
const projekt = () => {   // format /2 (pins exist only there)
  const p = neuesProjekt('P'); p.naechste_id = { spur: 10, clip: 1, gruppe: 1 }; p.spuren = [spur('s7', 7, bk()), spur('s3', 3, bk({ stifte: [[0, 1, 1, 0.5]] })), spur('s5', 5, rb()), spur('s9', 9, bk({}, 'ohne'))];
  return p;
};
const setze = (spurId, satz, zeile, spalte, wert) => ({ befehl: 'geraet_stift_setzen', spur_id: spurId, satz, zeile, spalte, wert });
const liste = (spurId, stifte, satz) => ({ befehl: 'geraet_stifte_setzen', spur_id: spurId, ...(satz === undefined ? {} : { satz }), stifte });
const lauf = (p, b, o = {}) => fuehreListeAus(p, Array.isArray(b) ? b : [b], { ...LOOKUP, ...o });
const lehntAb = (p, b, grund, o = {}) => assert.throws(() => lauf(p, b, o), (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund} for ${JSON.stringify(b)}`);
const spurVon = (p, id) => p.spuren.find((s) => s.id === id);
const A = { quelle: 'andreas', label: 'x' };

test('the first pin of a track takes the general path and holds the graph default pins plus the pin (they are not dropped)', () => {
  const p = projekt();
  const r = lauf(p, setze('s7', 0, 5, 5, 0.75));
  assert.equal(r.betrifft_wiedergabe, true, 'a playback rebuild: the defaults must be written into the list');
  assert.equal(r.stift_aenderungen, undefined);
  assert.deepEqual(spurVon(r.projekt, 's7').geraet.stifte, [[0, 0, 0, 0.5], [0, 5, 5, 0.75], [1, 2, 3, -0.25]]);
  const auf = lauf(p, setze('s7', 0, 0, 0, 1));   // a pin on a default position replaces the default there
  assert.deepEqual(spurVon(auf.projekt, 's7').geraet.stifte, [[0, 0, 0, 1], [1, 2, 3, -0.25]]);
  const null0 = lauf(p, setze('s7', 0, 0, 0, 0));   // removing a default pin keeps the other default
  assert.deepEqual(spurVon(null0.projekt, 's7').geraet.stifte, [[1, 2, 3, -0.25]]);
  assert.equal(spurVon(p, 's7').geraet.stifte, undefined, 'the input project is untouched');
});

test('a later pin is light: no playback, one stift_aenderungen entry with the track nr, ONE replace patch on /geraet/stifte, the original project is never mutated', () => {
  const p = projekt();
  const vorher = kopie(p);
  const staende = p.spuren.map((s) => [s, s.geraet, s.geraet.stifte]);
  const r = lauf(p, setze('s3', 1, 4, 9, -0.5));
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.stift_aenderungen, [{ nr: 3, satz: 1, zeile: 4, spalte: 9, wert: -0.5 }]);
  assert.deepEqual(r.regler_aenderungen, []);
  assert.deepEqual(spurVon(r.projekt, 's3').geraet.stifte, [[0, 1, 1, 0.5], [1, 4, 9, -0.5]]);
  assert.deepEqual(r.vor, [{ op: 'replace', pfad: '/spuren/s3/geraet/stifte', wert: [[0, 1, 1, 0.5], [1, 4, 9, -0.5]] }]);
  assert.deepEqual(r.zurueck, [{ op: 'replace', pfad: '/spuren/s3/geraet/stifte', wert: [[0, 1, 1, 0.5]] }]);
  assert.deepEqual(p, vorher, 'the input project is deep-equal to a copy taken before');
  for (const [s, g, l] of staende) { assert.equal(s.geraet, g); assert.equal(s.geraet.stifte, l, 'same device and same list object'); }
  assert.deepEqual(spurVon(p, 's3').geraet.stifte, [[0, 1, 1, 0.5]]);
  assert.equal(spurVon(r.projekt, 's3').geraet !== spurVon(p, 's3').geraet, true, 'a copy of the device');
  assert.equal(spurVon(r.projekt, 's5'), spurVon(p, 's5'), 'other tracks are shared');
  assert.deepEqual(wende(r.projekt, r.zurueck).spuren, vorher.spuren);
  const voll = lauf(p, setze('s3', 1, 4, 9, -0.5), { voll: true });
  assert.deepEqual(voll.projekt.spuren, r.projekt.spuren, 'the general path gives the same project');
  assert.deepEqual(p, vorher, 'also after the general path');
});

test('several pins in one light list: the last write per position wins, other tracks and knobs are not touched', () => {
  const p = projekt();
  const r = lauf(p, [setze('s3', 0, 2, 2, 0.5), setze('s3', 0, 2, 2, 0.75), setze('s3', 0, 3, 3, 0.25), setze('s3', 0, 3, 3, 0)]);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.stift_aenderungen, [{ nr: 3, satz: 0, zeile: 2, spalte: 2, wert: 0.75 }, { nr: 3, satz: 0, zeile: 3, spalte: 3, wert: 0 }]);
  assert.deepEqual(spurVon(r.projekt, 's3').geraet.stifte, [[0, 1, 1, 0.5], [0, 2, 2, 0.75]]);
  const mit = lauf(p, [setze('s3', 0, 2, 2, 0.5), { befehl: 'geraet_param_setzen', spur_id: 's3', param: 'k5', wert: 0.8 }]);
  assert.equal(mit.betrifft_wiedergabe, false, 'a knob and a pin together are still light');
  assert.deepEqual(mit.regler_aenderungen, [{ pfad: 'spur/1/bk/5', wert: 0.8 }]);
  assert.equal(mit.stift_aenderungen.length, 1);
  assert.equal(spurVon(mit.projekt, 's3').geraet.parameter.k5, 0.8);
});

test('wert 0 removes the entry (light); removing the last pin leaves the empty list, which means "all zero", not "defaults"', () => {
  const p = projekt();
  const r = lauf(p, setze('s3', 0, 1, 1, 0));
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(spurVon(r.projekt, 's3').geraet.stifte, []);
  assert.deepEqual(r.stift_aenderungen, [{ nr: 3, satz: 0, zeile: 1, spalte: 1, wert: 0 }]);
  const nichts = lauf(p, setze('s3', 0, 9, 9, 0));   // removing a pin that is not there: the list is the same, nothing to log
  assert.deepEqual(spurVon(nichts.projekt, 's3').geraet.stifte, [[0, 1, 1, 0.5]]);
});

// (a freeze exists only on a Surge track, so a bk track never has one: the `freeze` guard of istLeicht is the plan's safety net and has no reachable case)

test('undo and redo restore both lists; they are playback builds that send no pins; two drags of one pin are one undo step', (t) => {
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const p0 = projekt();
  // the first pin (general path): defaults + pin
  let q = aendere(w, p0, [setze('s7', 0, 5, 5, 0.75)], A, {}, { ergebnis: lauf(p0, setze('s7', 0, 5, 5, 0.75)) });
  assert.equal(q.betrifft_wiedergabe, true);
  const nach1 = [[0, 0, 0, 0.5], [0, 5, 5, 0.75], [1, 2, 3, -0.25]];
  assert.deepEqual(spurVon(q.projekt, 's7').geraet.stifte, nach1);
  uhr.t += 5000;
  // two drag steps of the same pin on the second pin: light, one undo step
  const d1 = lauf(q.projekt, setze('s7', 0, 5, 5, 0.8)); q = aendere(w, q.projekt, [setze('s7', 0, 5, 5, 0.8)], A, {}, { ergebnis: d1 });
  assert.equal(q.betrifft_wiedergabe, false);
  uhr.t += 50;
  const d2 = lauf(q.projekt, setze('s7', 0, 5, 5, 0.9)); q = aendere(w, q.projekt, [setze('s7', 0, 5, 5, 0.9)], A, {}, { ergebnis: d2 });
  assert.deepEqual(spurVon(q.projekt, 's7').geraet.stifte, [[0, 0, 0, 0.5], [0, 5, 5, 0.9], [1, 2, 3, -0.25]]);
  let u = rueckgaengig(w, q.projekt, { quelle: 'andreas' });
  assert.equal(u.betrifft_wiedergabe, true, 'undo is a playback build');
  assert.deepEqual(u.regler_aenderungen, [], 'no knob rows');
  assert.deepEqual(spurVon(u.projekt, 's7').geraet.stifte, nach1, 'one undo step took both drags back');
  u = rueckgaengig(w, u.projekt, { quelle: 'andreas' });
  assert.equal(spurVon(u.projekt, 's7').geraet.stifte, undefined, 'the second undo restores the device without a list (graph defaults)');
  let r = wiederholen(w, u.projekt, { quelle: 'andreas' });
  assert.deepEqual(spurVon(r.projekt, 's7').geraet.stifte, nach1);
  r = wiederholen(w, r.projekt, { quelle: 'andreas' });
  assert.deepEqual(spurVon(r.projekt, 's7').geraet.stifte, [[0, 0, 0, 0.5], [0, 5, 5, 0.9], [1, 2, 3, -0.25]]);
});

test('reasons: spur_unbekannt, geraet_falsch, kein_steckfeld, argument_ungueltig, argument_unbekannt', () => {
  const p = projekt();
  lehntAb(p, setze('nix', 0, 0, 0, 0.5), 'spur_unbekannt');
  lehntAb(p, setze('s5', 0, 0, 0, 0.5), 'geraet_falsch');
  lehntAb(p, liste('s5', []), 'geraet_falsch');
  lehntAb(p, setze('s9', 0, 0, 0, 0.5), 'kein_steckfeld');          // a first pin on a graph without a matrix node
  lehntAb(p, setze('s7', 0, 0, 0, 0.5), 'kein_steckfeld', { steckfeldVon: undefined });   // no lookup at all (a caller that passes none)
  lehntAb(p, setze('s7', 0, 0, 0, 0.5), 'kein_steckfeld', { steckfeldVon: () => null });
  lehntAb(p, setze('s9', 0, 0, 0, 0.5), 'kein_steckfeld');
  lehntAb(p, liste('s9', [], 0), 'kein_steckfeld');                 // a set write needs the defaults of the other set
  for (const bad of [setze('s3', 2, 0, 0, 0.5), setze('s3', -1, 0, 0, 0.5), setze('s3', 0.5, 0, 0, 0.5), setze('s3', 0, 16, 0, 0.5), setze('s3', 0, 0, 16, 0.5),
    setze('s3', 0, 0, 1.5, 0.5), setze('s3', 0, 0, 0, 1.5), setze('s3', 0, 0, 0, -1.5), setze('s3', 0, 0, 0, NaN), setze('s3', 0, 0, 0, '0.5'), setze('s3', '0', 0, 0, 0.5),
    { befehl: 'geraet_stift_setzen', spur_id: 's3', satz: 0, zeile: 0, spalte: 0 }, { befehl: 'geraet_stift_setzen', spur_id: 7, satz: 0, zeile: 0, spalte: 0, wert: 0.5 }]) {
    lehntAb(p, bad, 'argument_ungueltig');
  }
  lehntAb(p, { ...setze('s3', 0, 0, 0, 0.5), extra: 1 }, 'argument_unbekannt');
  lehntAb(p, { ...liste('s3', []), extra: 1 }, 'argument_unbekannt');
  for (const bad of [liste('s3', 'x'), liste('s3', [[0, 0, 0]]), liste('s3', [[0, 0, 0, 2]]), liste('s3', [[0, 0, 0, 0.5]], 1), liste('s3', null, 0),
    { befehl: 'geraet_stifte_setzen', spur_id: 's3' }, liste('s3', [], 2), liste('s3', Array.from({ length: 513 }, (_, i) => [i >> 8, (i >> 4) & 15, i & 15, 0.5]))]) {
    lehntAb(p, bad, 'argument_ungueltig');
  }
  assert.throws(() => lauf(p, [setze('s3', 0, 0, 0, 0.5), setze('nix', 0, 0, 0, 0.5)]), (e) => e.grund === 'spur_unbekannt' && e.index === 1);
});

test('geraet_stifte_setzen: with satz the other set is kept, without satz everything is replaced, null returns to the graph defaults, normal form always', () => {
  const p = projekt();
  spurVon(p, 's3').geraet.stifte = [[0, 1, 1, 0.5], [1, 2, 2, 0.25]];
  const mitSatz = lauf(p, liste('s3', [[0, 4, 4, 1], [0, 3, 3, -1]], 0));
  assert.equal(mitSatz.betrifft_wiedergabe, true);
  assert.equal(mitSatz.stift_aenderungen, undefined, 'never light, so no pin is sent as OSC');
  assert.deepEqual(spurVon(mitSatz.projekt, 's3').geraet.stifte, [[0, 3, 3, -1], [0, 4, 4, 1], [1, 2, 2, 0.25]], 'set B kept, set A replaced, sorted');
  const leerSatz = lauf(p, liste('s3', [], 1));
  assert.deepEqual(spurVon(leerSatz.projekt, 's3').geraet.stifte, [[0, 1, 1, 0.5]]);
  const alles = lauf(p, liste('s3', [[1, 0, 0, 0.5], [0, 7, 7, 0.5]]));
  assert.deepEqual(spurVon(alles.projekt, 's3').geraet.stifte, [[0, 7, 7, 0.5], [1, 0, 0, 0.5]]);
  const zeroLeer = lauf(p, liste('s3', []));
  assert.deepEqual(spurVon(zeroLeer.projekt, 's3').geraet.stifte, []);
  const defaults = lauf(p, liste('s3', null));
  assert.equal('stifte' in spurVon(defaults.projekt, 's3').geraet, false);
  assert.equal(defaults.betrifft_wiedergabe, true);
  // set write on a device without a list keeps the defaults of the other set
  const ohneListe = lauf(p, liste('s7', [[0, 9, 9, 0.5]], 0));
  assert.deepEqual(spurVon(ohneListe.projekt, 's7').geraet.stifte, [[0, 9, 9, 0.5], [1, 2, 3, -0.25]]);
  // 512 pins: a playback, never a stift_aenderungen list
  const viele = Array.from({ length: 512 }, (_, i) => [i >> 8, (i >> 4) & 15, i & 15, 0.5]);
  const v = lauf(p, liste('s3', viele));
  assert.equal(v.betrifft_wiedergabe, true);
  assert.equal(v.stift_aenderungen, undefined);
  assert.equal(spurVon(v.projekt, 's3').geraet.stifte.length, 512);
});
