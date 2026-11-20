// Loop deck M2: the command family, the module conversion (M5) and the filter in the mixer paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt, pruefeProjekt, loopDeckGruppe, loopDeckSpuren } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { baueModul, liveSlots } from '../project/live.ts';
import { alleSpurRegler, reglerZuBefehl } from '../areas/proj/mapping.ts';
import { tmpOrdner } from './support/project.mjs';

const live = () => { const p = neuesProjekt('x'); p.live = true; return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const fehler = (p, ...b) => { try { fuehreListeAus(p, b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e; } return assert.fail(`${b.map((x) => x.befehl)} was not refused`); };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const valide = (p) => { const u = pruefeProjekt(kopie(p)); assert.ok('projekt' in u, JSON.stringify(u)); };
const SHA = 'a'.repeat(64);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });
const A = { quelle: 'andreas', label: 'Test' };
// every command forward and back through the history (one undo step each)
function mitUndo(t, p, ...befehle) {
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { jetzt: () => 0, zeitgeber: false });
  const r = aendere(v, p, befehle, A);
  valide(r.projekt);
  const u = rueckgaengig(v, r.projekt, { quelle: 'andreas' });
  const ohne = (x) => JSON.stringify({ ...x, rev: 0, wiedergabe_rev: 0, naechste_id: undefined });
  assert.equal(ohne(u.projekt), ohne(p), `undo of ${befehle.map((b) => b.befehl)} restores the project`);
  return { v, vorher: p, nachher: r.projekt };
}
const mitDeck = (platz = 1) => lauf(live(), { befehl: 'loopdeck_neu', platz });

test('loopdeck_neu: group LOOP n, 4 audio tracks Ln.1..4 with 8 empty cells, default grid takt; one undo step', (t) => {
  const { nachher: p } = mitUndo(t, live(), { befehl: 'loopdeck_neu', platz: 2 });
  const g = loopDeckGruppe(p, 2);
  assert.deepEqual([g.name, g.loopdeck, g.ausgang], ['LOOP 2', { platz: 2, raster: 'takt' }, undefined]);
  const spuren = loopDeckSpuren(p, g);
  assert.deepEqual(spuren.map((s) => [s.name, s.art]), [1, 2, 3, 4].map((i) => [`L2.${i}`, 'audio']));
  assert.ok(spuren.every((s) => s.zellen.length === 8 && s.zellen.every((z) => z === null)));
  assert.equal(lauf(live(), { befehl: 'loopdeck_neu', platz: 1, raster: '1/2' }).gruppen[0].loopdeck.raster, '1/2');
});

test('loopdeck_neu twice on one place is refused platz_belegt; the other place and bad arguments', () => {
  const p = mitDeck(1);
  assert.equal(fehler(p, { befehl: 'loopdeck_neu', platz: 1 }).grund, 'platz_belegt');
  valide(lauf(p, { befehl: 'loopdeck_neu', platz: 2 }));
  assert.equal(fehler(live(), { befehl: 'loopdeck_neu', platz: 3 }).grund, 'argument_ungueltig');
  assert.equal(fehler(live(), { befehl: 'loopdeck_neu', platz: 1, raster: 'x' }).grund, 'argument_ungueltig');
  assert.equal(fehler(neuesProjekt('n'), { befehl: 'loopdeck_neu', platz: 1 }).grund, 'kein_liveprojekt');
});

test('loopdeck_neu over a module in that slot converts: cell 1 of track 1 carries the loop, module group gone, one undo restores both', (t) => {
  const loop = { sha256: 'e'.repeat(64), pfad: 'audio/e.wav', beats: 16, frames: 16 * 24000 };
  const herkunft = { quelle_sha256: 'c'.repeat(64), titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 0, laenge_beats: 16, bpm: 120,
    datum: '2026-11-12' };
  const mit = baueModul(live(), 'B', loop, { drums: { sha256: 'd'.repeat(64), pfad: 'audio/d.wav' } }, herkunft);
  assert.ok(liveSlots(mit).B);
  const { nachher: p } = mitUndo(t, mit, { befehl: 'loopdeck_neu', platz: 2 });
  assert.equal(liveSlots(p).B, undefined);
  assert.equal(p.gruppen.filter((g) => g.modul).length, 0);
  assert.equal(p.gruppen.length, 1);
  assert.equal(p.spuren.length, 4);
  const [t1, t2] = loopDeckSpuren(p, loopDeckGruppe(p, 2));
  const z = t1.zellen[0];
  assert.deepEqual([z.name, z.art, z.sha256, z.beats, z.bpm, z.gain_db, z.pfad_hinweis], ['Song', 'loop', 'e'.repeat(64), 16, 120, 0, 'audio/e.wav']);
  assert.match(z.id, /^z\d+$/);
  assert.ok(t1.zellen.slice(1).every((x) => x === null) && t2.zellen.every((x) => x === null));
  // a module in the other slot stays
  const a = baueModul(live(), 'A', loop, {}, herkunft);
  assert.ok(liveSlots(lauf(a, { befehl: 'loopdeck_neu', platz: 2 })).A);
});

// a module with a Loop track whose clip carries a warp; values differ between the warp and the module so that the source of each number shows
function modulMit(f = () => {}, { ordner } = {}) {
  const loop = { sha256: 'e'.repeat(64), pfad: ordner ? `${ordner}/loops/7-B-m.wav` : 'audio/e.wav', beats: 16, frames: 16 * 24000 };
  const herkunft = { quelle_sha256: 'c'.repeat(64), titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 100, von_beat: 0, laenge_beats: 8, bpm: 100,
    datum: '2026-11-12' };
  const p = kopie(baueModul(live(), 'B', loop, {}, herkunft));
  f(p);
  return p;
}
const loopClips = (p) => p.spuren.find((s) => s.name === 'Loop').clips;

test('module conversion: beats and bpm come from the warp markers; without a warp the module values are the fallback', () => {
  const mit = lauf(modulMit(), { befehl: 'loopdeck_neu', platz: 2 });
  const z = loopDeckSpuren(mit, loopDeckGruppe(mit, 2))[0].zellen[0];
  const ende = loopClips(modulMit()).find((c) => !c.warp.versatz_beats).warp.marker.at(-1);
  assert.deepEqual([z.beats, z.bpm], [ende[1], (ende[1] * 60) / ende[0]], 'markers');
  assert.notEqual(z.beats, 8); assert.notEqual(z.bpm, 100);
  const ohne = lauf(modulMit((p) => { for (const c of loopClips(p)) delete c.warp; }), { befehl: 'loopdeck_neu', platz: 2 });
  const f = loopDeckSpuren(ohne, loopDeckGruppe(ohne, 2))[0].zellen[0];
  assert.deepEqual([f.beats, f.bpm], [8, 100], 'module fallback');
});

test('module conversion refuses (and leaves the module alone) when no cell can be made: no Loop track, no clip, more than 64 beats', () => {
  const faelle = {
    'no Loop track': (p) => { p.spuren = p.spuren.filter((s) => s.name !== 'Loop'); },
    'no clip': (p) => { loopClips(p).length = 0; },
    'warp over 64 beats': (p) => { for (const c of loopClips(p)) { c.warp.marker[c.warp.marker.length - 1][1] = 128; } },
    'module over 64 beats, no warp': (p) => { for (const c of loopClips(p)) delete c.warp; p.gruppen.find((g) => g.modul).modul.laenge_beats = 100; },
  };
  for (const [name, f] of Object.entries(faelle)) {
    const p = modulMit(f);
    const e = fehler(p, { befehl: 'loopdeck_neu', platz: 2 });
    assert.equal(e.grund, 'modul_nicht_umwandelbar', name);
    assert.match(String(e.detail ?? e.message), /left untouched/, name);
    assert.ok(liveSlots(p).B, `${name}: the module is still there`);
  }
});

test('module conversion keeps an absolute path inside the project folder as a project-relative hint; one outside is dropped', () => {
  const ordner = '/work/proj/song';
  const mit = lauf(modulMit(() => {}, { ordner }), { befehl: 'loopdeck_neu', platz: 2 });
  const innen = fuehreListeAus(modulMit(() => {}, { ordner }), [{ befehl: 'loopdeck_neu', platz: 2 }], { quelle: 'andreas', ordner }).projekt;
  assert.equal(loopDeckSpuren(innen, loopDeckGruppe(innen, 2))[0].zellen[0].pfad_hinweis, 'loops/7-B-m.wav');
  assert.equal(loopDeckSpuren(mit, loopDeckGruppe(mit, 2))[0].zellen[0].pfad_hinweis, undefined, 'without a folder the absolute path is dropped');
  const draussen = fuehreListeAus(modulMit(() => {}, { ordner }), [{ befehl: 'loopdeck_neu', platz: 2 }], { quelle: 'andreas', ordner: '/work/other' }).projekt;
  assert.equal(loopDeckSpuren(draussen, loopDeckGruppe(draussen, 2))[0].zellen[0].pfad_hinweis, undefined, 'outside the folder');
});

test('a loop deck track takes no take lanes; a cell name of spaces only is refused', () => {
  const p = mitDeck(1);
  const [a] = loopDeckSpuren(p, p.gruppen[0]);
  assert.equal(fehler(p, { befehl: 'take_neu', spur_id: a.id }).grund, 'argument_ungueltig');
  const e = fehler(p, { befehl: 'zelle_setzen', spur_id: a.id, index: 1, zelle: Z({ name: '   ' }) });
  assert.match(String(e.detail ?? e.message), /spaces only/);
});

test('loopdeck_aendern sets the grid and loopdeck_leeren empties all cells; both forward and undo', (t) => {
  let p = mitDeck(1);
  const [a, b] = loopDeckSpuren(p, p.gruppen[0]);
  p = lauf(p, { befehl: 'zelle_setzen', spur_id: a.id, index: 1, zelle: Z() }, { befehl: 'zelle_setzen', spur_id: b.id, index: 8, zelle: Z() });
  assert.equal(mitUndo(t, p, { befehl: 'loopdeck_aendern', gruppe_id: p.gruppen[0].id, raster: '4takte' }).nachher.gruppen[0].loopdeck.raster, '4takte');
  const leer = mitUndo(t, p, { befehl: 'loopdeck_leeren', gruppe_id: p.gruppen[0].id }).nachher;
  assert.ok(loopDeckSpuren(leer, leer.gruppen[0]).every((s) => s.zellen.every((z) => z === null)));
  assert.equal(fehler(p, { befehl: 'loopdeck_aendern', gruppe_id: p.gruppen[0].id, raster: 'nope' }).grund, 'argument_ungueltig');
  const ohne = lauf(live(), { befehl: 'gruppenspur_neu', name: 'G' });
  assert.equal(fehler(ohne, { befehl: 'loopdeck_leeren', gruppe_id: ohne.gruppen[0].id }).grund, 'kein_loopdeck');
});

test('zelle_setzen writes with a new id, replaces, clears with null; zelle_aendern is partial and refused on an empty cell', (t) => {
  const p0 = mitDeck(1);
  const s = p0.spuren[0].id;
  const { nachher: p } = mitUndo(t, p0, { befehl: 'zelle_setzen', spur_id: s, index: 3, zelle: Z() });
  assert.equal(p.spuren[0].zellen[2].id, 'z1');
  const p2 = lauf(p, { befehl: 'zelle_setzen', spur_id: s, index: 3, zelle: Z({ name: 'Other' }) });
  assert.deepEqual([p2.spuren[0].zellen[2].id, p2.spuren[0].zellen[2].name], ['z2', 'Other']);
  assert.equal(mitUndo(t, p2, { befehl: 'zelle_setzen', spur_id: s, index: 3, zelle: null }).nachher.spuren[0].zellen[2], null);
  const a = mitUndo(t, p, { befehl: 'zelle_aendern', spur_id: s, index: 3, name: 'New', gain_db: -6, farbe: 9, beats: 8, art: 'einmal' }).nachher.spuren[0].zellen[2];
  assert.deepEqual([a.id, a.name, a.gain_db, a.farbe, a.beats, a.art, a.sha256], ['z1', 'New', -6, 9, 8, 'einmal', SHA]);
  assert.equal(fehler(p, { befehl: 'zelle_aendern', spur_id: s, index: 4, name: 'x' }).grund, 'zelle_leer');
  assert.equal(fehler(p, { befehl: 'zelle_aendern', spur_id: s, index: 3 }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'zelle_setzen', spur_id: s, index: 9, zelle: Z() }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'zelle_setzen', spur_id: s, index: 1, zelle: Z({ extra: 1 }) }).grund, 'argument_unbekannt');
  assert.equal(fehler(p, { befehl: 'zelle_setzen', spur_id: s, index: 1, zelle: Z({ beats: undefined }) }).grund, 'projekt_ungueltig');
  const ohne = lauf(live(), { befehl: 'spur_neu', art: 'audio' });
  assert.equal(fehler(ohne, { befehl: 'zelle_setzen', spur_id: ohne.spuren[0].id, index: 1, zelle: Z() }).grund, 'kein_loopdeck');
});

test('zelle_bewegen: move, swap when filled, across the two decks, ids kept; empty source refused', (t) => {
  let p = lauf(mitDeck(1), { befehl: 'loopdeck_neu', platz: 2 });
  const [a] = loopDeckSpuren(p, loopDeckGruppe(p, 1)), [b] = loopDeckSpuren(p, loopDeckGruppe(p, 2));
  p = lauf(p, { befehl: 'zelle_setzen', spur_id: a.id, index: 1, zelle: Z({ name: 'One' }) }, { befehl: 'zelle_setzen', spur_id: b.id, index: 5, zelle: Z({ name: 'Two' }) });
  const zelle = (q, id, i) => q.spuren.find((s) => s.id === id).zellen[i - 1];
  const m = mitUndo(t, p, { befehl: 'zelle_bewegen', von: { spur_id: a.id, index: 1 }, nach: { spur_id: a.id, index: 2 } }).nachher;
  assert.deepEqual([zelle(m, a.id, 1), zelle(m, a.id, 2).id], [null, 'z1']);
  const w = mitUndo(t, p, { befehl: 'zelle_bewegen', von: { spur_id: a.id, index: 1 }, nach: { spur_id: b.id, index: 5 } }).nachher;
  assert.deepEqual([zelle(w, a.id, 1).id, zelle(w, a.id, 1).name, zelle(w, b.id, 5).id, zelle(w, b.id, 5).name], ['z2', 'Two', 'z1', 'One']);
  assert.equal(fehler(p, { befehl: 'zelle_bewegen', von: { spur_id: a.id, index: 2 }, nach: { spur_id: a.id, index: 3 } }).grund, 'zelle_leer');
  assert.equal(fehler(p, { befehl: 'zelle_bewegen', von: { spur_id: a.id }, nach: { spur_id: a.id, index: 3 } }).grund, 'argument_ungueltig');
});

test('spur_aendern filter: ok on a deck track refused on another track; two changes coalesce into one undo step', (t) => {
  let p = lauf(mitDeck(1), { befehl: 'spur_neu', art: 'audio', name: 'Plain' });
  const deckSpur = p.spuren[0].id, plain = p.spuren[4].id;
  assert.equal(lauf(p, { befehl: 'spur_aendern', spur_id: deckSpur, filter: 0.5 }).spuren[0].filter, 0.5);
  assert.equal(fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: deckSpur, filter: 0.5 }]).betrifft_wiedergabe, false, 'the filter is a control row, not playback');
  assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: plain, filter: 0.5 }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'spur_aendern', spur_id: deckSpur, filter: 1.5 }).grund, 'argument_ungueltig');
  const r = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: deckSpur, filter: -0.25 }]);
  assert.deepEqual(r.regler_aenderungen.filter((x) => /filter/.test(x.pfad)), [{ pfad: 'spur/1/filter', wert: -0.25 }]);
  const dir = tmpOrdner(t), uhr = { t: 0 };
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const f = (q, w) => aendere(v, q, [{ befehl: 'spur_aendern', spur_id: deckSpur, filter: w }], A).projekt;
  let q = f(p, 0.2); uhr.t += 300; q = f(q, 0.7);
  assert.equal(q.spuren[0].filter, 0.7);
  const u = rueckgaengig(v, q, { quelle: 'andreas' });
  assert.equal(u.projekt.spuren[0].filter, 0, 'one undo step takes both drags back');
});

test('abbildung maps filter to spur/<nr>/filter, both ways', () => {
  let p = mitDeck(1);
  p = lauf(p, { befehl: 'spur_aendern', spur_id: p.spuren[1].id, filter: 0.4 });
  const regler = alleSpurRegler(p);
  assert.equal(regler.filter((x) => /\/filter$/.test(x.pfad)).length, 32);
  assert.deepEqual(regler.find((x) => x.pfad === 'spur/2/filter'), { pfad: 'spur/2/filter', wert: 0.4 });
  assert.equal(regler.find((x) => x.pfad === 'spur/3/filter').wert, 0);
  const r = reglerZuBefehl(p, 'spur/3/filter', -0.6);
  assert.deepEqual(r.befehl, { befehl: 'spur_aendern', spur_id: p.spuren[2].id, filter: -0.6 });
  assert.equal(reglerZuBefehl(p, 'spur/3/filter', 0), null, 'already there');
  assert.equal(reglerZuBefehl(p, 'spur/2/filter', 5).befehl.filter, 1, 'clamped');
  const plain = lauf(p, { befehl: 'spur_neu', art: 'audio' });
  assert.equal(reglerZuBefehl(plain, 'spur/5/filter', 0.5), null, 'a track outside a deck has no filter');
});
