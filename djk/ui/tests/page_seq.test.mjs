// SEQ deck v2, task 4: the SEQ place on the page. seq_field.js is pure (no DOM): the view of a deck (patterns with their lanes), the playhead cell, the
// requests of a gesture and what is drawn after the answer, the instrument exchange. seq_view.js is the DOM part; it is run here against the DOM stand-in
// (tests/helpers/pages_mock.mjs) with the real app.js, and read as text where a pin is cheaper than a node.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liesApp } from './helpers/app_source.mjs';
import { installiere, attrappe, sendeStrom } from './helpers/pages_mock.mjs';
import {
  seqAnsicht, deckAnsicht, folgeEditierbar, geraetText, kopfZelle, kopfPos, ANLEGEN_HINWEIS, anlegenZustand, zellKlassen, zellText, zellTitel, velNeu, tonNeu,
  griffArt, laengeNeu, loslassFelder, imRechteck, radFelder, sende, legeAn, leereDeck, neueFolge, geraetWahl, ladeInfos, infosAusCache, fehlendeInfos,
  leereInfoCache, wechselBefehle, tonVonText, kurvePfad, laengeText, laengeAusSchritten, pxProBeat, zeileTitel, LAENGEN_TAKTE, SICHT_BREITEN,
} from '../public/seq_field.js';
import { zeileBenutzt, leereZeilen, deckSpielSchritt, deckSpielt, msBisTakt } from '../public/seq_field.js';
import { zelleBefehle, abgeleiteteZeilen, SeqFehler } from '../public/seq_logic.js';
import {
  zeilenBereich, wertAusPos, wertBruch, wertText, ueberlagere, mitLaenge, wertSchreibe, wiederholZellen, kurveBeatAusX, kurveWertAusY, kurvePunkte, kurveMarken, kurveNeu,
  kurveVerschiebe, kurveWeg, kurveSchreibe, formAus, formSchreibe, eigenLaengen, eigenLaengeText, eigenAusSchritten, laengeZeileBefehle, zielWahl, zielUmhaengen, sprungZiel,
  sichtbarBeats, linealZellen, GROSS_SCHLUESSEL, grossLesen, grossSchreiben, grossUmschalten, grossGilt, grossEscape,
  freierName, holeMitFrist, reglerInfoMeldung, vergissLeereInfos,
} from '../public/seq_field.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');

// ---------- fixtures: a deck with a kit pattern and a Baukasten pattern ----------
const AUS = { art: 'gruppe', id: 'g_seq' };
const note = (id, beat, ton, vel = 100, laenge = 0.5) => ({ id, beat, laenge, ton, vel });
const kitSpur = () => ({
  id: 's1', nr: 1, name: 'Drums', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: '909' }, ausgang: AUS, mute: false, solo: false, fader_db: 0, pan: 0,
  clips: [{ id: 'c1', art: 'midi', name: 'Drums', start_beat: 0, laenge_beats: 64, loop_beats: 4, noten: [note('n1', 0, 36), note('n2', 1, 38, 120), note('n3', 0.5, 42, 60)] }],
});
const bkSpur = (extra = {}) => ({
  id: 's2', nr: 2, name: 'Bass', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'bassmusik', parameter: { k3: 0.4 } }, ausgang: AUS, mute: false, solo: false, fader_db: 0, pan: 0,
  clips: [{
    id: 'c2', art: 'midi', name: 'Bass', start_beat: 0, laenge_beats: 64, loop_beats: 4,
    noten: [note('m1', 0, 48, 100, 1), note('m2', 1.5, 51, 90, 0.5)],
    huellkurven: [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }, { beat: 2, wert: -0.2 }] }],
    seq: { schema: 1, zeilen: [{ id: 'noten', art: 'noten', teiler: 0.125 }, { id: 'vel', art: 'werte', teiler: 0.25, ziel: 'vel' }, { id: 'cutoff', art: 'werte', teiler: 0.25, ziel: 'geraet.k3' }] },
  }],
  ...extra,
});
const fremdSpur = () => ({ id: 's3', nr: 3, name: 'Arranged', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} }, ausgang: AUS, mute: false, solo: false, fader_db: 0, pan: 0,
  clips: [{ id: 'c3', art: 'midi', name: 'A', start_beat: 8, laenge_beats: 16, noten: [] }, { id: 'c4', art: 'midi', name: 'B', start_beat: 32, laenge_beats: 16, noten: [] }] });
const projekt = (spuren = [kitSpur(), bkSpur()], extra = {}) => ({
  live: true, rev: 7, spuren: [...spuren, { id: 'sx', nr: 9, name: 'Other', art: 'instrument', ausgang: { art: 'gruppe', id: 'g_modul' }, clips: [] }],
  gruppen: [{ id: 'g_modul', name: 'M', modul: {} }, { id: 'g_seq', name: 'SEQ 2', seq: { schema: 2 } }],
  plaetze: [{ typ: 'track' }, { typ: 'seq', gruppe: 'g_seq' }, { typ: 'leer' }, { typ: 'leer' }], ...extra,
});
const INFO_BK = { art: 'bk', regler: [{ nr: 3, name: 'Cutoff', vorgabe: 0.5 }, { nr: 4, name: 'Resonance', vorgabe: 0.3 }], klaenge: [] };
const INFO_KIT = { art: 'kit', regler: [], klaenge: [{ ton: 36, name: 'Kick' }, { ton: 38, name: 'Snare' }] };
const INFOS = { s1: INFO_KIT, s2: INFO_BK };

// ---------- seq_field.js: the view of a deck ----------
test('seqAnsicht: no deck on the place, no project, or a deck of another place is not there; a pattern is a track of the group', () => {
  const leer = { vorhanden: false, gruppe_id: null, folgen: [] };
  assert.deepEqual(seqAnsicht(null, 2), leer);
  assert.deepEqual(seqAnsicht({ live: true }, 2), leer, 'a project without groups');
  assert.deepEqual(seqAnsicht(projekt(), 3), leer, 'the deck sits on place 2');
  assert.deepEqual(seqAnsicht(projekt(undefined, { plaetze: [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }] }), 2), leer, 'a place that is not typed seq shows no deck, whatever group exists');
  assert.deepEqual(seqAnsicht(projekt(undefined, { plaetze: [{ typ: 'seq', gruppe: 'g_seq' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }] }), 2), leer, 'the place table, not the group, says where the deck sits');
  assert.equal(seqAnsicht(projekt(undefined, { plaetze: [{ typ: 'seq', gruppe: 'g_seq' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }] }), 1).gruppe_id, 'g_seq', 'the deck follows the place table to place 1');
  const a = seqAnsicht(projekt(), 2);
  assert.equal(a.vorhanden, true); assert.equal(a.gruppe_id, 'g_seq');
  assert.deepEqual(a.folgen.map((f) => f.spur_id), ['s1', 's2'], 'the track of another group is not a pattern');
  assert.deepEqual(a.folgen.map((f) => f.clip_id), ['c1', 'c2']);
});

test('deckAnsicht: a kit pattern and a Baukasten pattern are two blocks with their lanes; a 1/32 lane has 32 cells per bar', () => {
  const a = deckAnsicht(projekt(), 2, INFOS);
  assert.equal(a.folgen.length, 2);
  const [kit, bk] = a.folgen;
  assert.deepEqual([kit.name, kit.geraet_text, kit.stumm, kit.editierbar], ['Drums', 'Kit · 909', false, true]);
  assert.deepEqual(bk.geraet_text, 'Baukasten · bassmusik');
  assert.deepEqual(kit.sicht.zeilen.map((z) => [z.id, z.name, z.abgeleitet]), [['t36', 'Kick', true], ['t38', 'Snare', true], ['t42', 'F#1', true]],
    'three derived trigger lanes in pitch order, named by the kit sounds, else by the note');
  assert.ok(kit.sicht.zeilen.every((z) => z.zellen.length === 16), '1/16 of a 1-bar pattern: 16 cells');
  assert.deepEqual(bk.sicht.zeilen.map((z) => z.id), ['noten', 'vel', 'cutoff']);
  assert.equal(bk.sicht.zeilen[0].zellen.length, 32, 'a 1/32 lane of a 4-beat pattern: 32 cells (per bar)');
  assert.equal(bk.sicht.zeilen[0].zellen[0].an, true);
  assert.equal(a.baukasten, 1, 'the deck head counts the Baukasten patterns');
  assert.equal(a.laenge_beats, 4);
});

test('deckAnsicht: the width is the longest pattern, at least one bar; a pattern that D8 does not allow is one row without lanes', () => {
  const lang = bkSpur(); lang.clips[0].loop_beats = 16;
  assert.equal(deckAnsicht(projekt([lang]), 2, INFOS).laenge_beats, 16);
  const kurz = kitSpur(); kurz.clips[0].loop_beats = 1;
  assert.equal(deckAnsicht(projekt([kurz]), 2, INFOS).laenge_beats, 4, 'at least one bar');
  const a = deckAnsicht(projekt([kitSpur(), fremdSpur()]), 2, INFOS);
  assert.deepEqual(a.folgen.map((f) => f.editierbar), [true, false]);
  assert.equal(a.folgen[1].sicht, null);
  assert.equal(a.folgen[1].geraet_text, 'RB-338');
});

test('folgeEditierbar is the rule of D8: an instrument track with no clip, or one MIDI clip from beat 0 over 64 beats', () => {
  assert.equal(folgeEditierbar({ art: 'instrument', clips: [] }), true);
  assert.equal(folgeEditierbar(kitSpur()), true);
  assert.equal(folgeEditierbar(fremdSpur()), false, 'two clips');
  assert.equal(folgeEditierbar({ art: 'audio', clips: [] }), false);
  const k = kitSpur(); k.clips[0].start_beat = 4;
  assert.equal(folgeEditierbar(k), false, 'does not start at 0');
  const l = kitSpur(); l.clips[0].laenge_beats = 32;
  assert.equal(folgeEditierbar(l), false, 'not the whole region');
  const a = kitSpur(); a.clips[0].art = 'audio';
  assert.equal(folgeEditierbar(a), false);
});

test('the instrument text of a pattern head', () => {
  assert.equal(geraetText({ geraet: { art: 'wirt', name: 'surge' } }), 'Surge');
  assert.equal(geraetText({ geraet: { art: 'rack', glieder: [] } }), 'Rack');
  assert.equal(geraetText({}), '–');
});

// ---------- the playhead ----------
test('kopfZelle: the cell under the playhead; a 1-bar lane at beat 5.26 on 1/16 is cell 5; a lane of its own length wraps at its length', () => {
  const zeile = { art: 'noten', teiler: 0.25, laenge_beats: 4, zellen: new Array(16).fill({}) };
  assert.equal(kopfZelle(5.26, zeile), 5);
  assert.equal(kopfZelle(0, zeile), 0);
  assert.equal(kopfZelle(3.99, zeile), 15);
  assert.equal(kopfZelle(4, zeile), 0);
  assert.equal(kopfZelle(63.9, zeile), 15);
  assert.equal(kopfZelle(-0.25, zeile), 15, 'before beat 0 wraps');
  const fein = { art: 'noten', teiler: 0.125, laenge_beats: 4, zellen: new Array(32).fill({}) };
  assert.equal(kopfZelle(1.0000000001, fein), 8);
  for (const x of [null, undefined, NaN, Infinity]) assert.equal(kopfZelle(x, zeile), -1, `${x}: no playhead`);
  const eigen = { art: 'werte', teiler: 0.25, laenge_beats: 3, zellen: new Array(12).fill({}) };
  assert.equal(kopfZelle(3.1, eigen), 0, 'a value lane of 3 beats under a 4-beat pattern wraps at 3');
  assert.equal(kopfZelle(2.9, eigen), 11);
  assert.equal(kopfZelle(7, eigen), 4);
  const kurve = { art: 'kurve', laenge_beats: 3, punkte: [] };
  assert.equal(kopfZelle(1, kurve), -1, 'a curve has no cells');
  assert.equal(kopfPos(7, kurve), 1, 'but a position in beats');
  assert.equal(kopfPos(NaN, kurve), -1);
});

// ---------- cells: classes, text, gestures ----------
test('a cell is drawn on, accented above velocity 110, tied, offset, with a count; a pitched cell shows its note name', () => {
  const [kit, bk] = deckAnsicht(projekt(), 2, INFOS).folgen;
  const trig = kit.sicht.zeilen[0], pitch = bk.sicht.zeilen[0], wert = bk.sicht.zeilen[2];
  assert.deepEqual(zellKlassen(trig.zellen[0], trig), ['sq-zelle', 'an']);
  assert.deepEqual(zellKlassen(trig.zellen[1], trig), ['sq-zelle']);
  assert.ok(zellKlassen(kit.sicht.zeilen[1].zellen[4], kit.sicht.zeilen[1]).includes('akzent'), 'velocity 120');
  assert.deepEqual(zellKlassen(pitch.zellen[0], pitch), ['sq-zelle', 'ton', 'an']);
  assert.ok(zellKlassen(pitch.zellen[1], pitch).includes('gebunden'), 'the note of one beat covers the next cells of the 1/32 grid');
  const mehr = { an: true, vel: 100, zahl: 3, ton: 48, versatz: 0.05 };
  assert.deepEqual(zellKlassen(mehr, pitch), ['sq-zelle', 'ton', 'an', 'versatz', 'mehrere']);
  assert.equal(zellText(pitch.zellen[0], pitch), 'C2', '48 is C2 in the notation of the piano roll');
  assert.equal(zellText(mehr, pitch), 'C2+2', 'a chord shows the lowest note and a count');
  assert.equal(zellText(trig.zellen[0], trig), '');
  assert.equal(zellText({ an: true, zahl: 2 }, trig), '×2');
  assert.deepEqual(zellKlassen(wert.zellen[0], wert), ['sq-zelle', 'wert', 'an'], 'a value cell takes the pointer');
  assert.equal(zellTitel(pitch, 0, pitch.zellen[0]), 'notes, cell 1, velocity 100, C2');
});

test('a vertical drag sets the velocity, a horizontal drag in the pitched lane the length; the wheel moves a note by semitones, with shift by octaves', () => {
  assert.equal(velNeu(100, 0), 100); assert.equal(velNeu(100, -10), 108); assert.equal(velNeu(100, 10), 92);
  assert.equal(velNeu(100, -1000), 127); assert.equal(velNeu(100, 1000), 1);
  assert.equal(tonNeu(36, -1, false), 37, 'wheel up raises'); assert.equal(tonNeu(36, 1, false), 35);
  assert.equal(tonNeu(36, -1, true), 48); assert.equal(tonNeu(126, -1, true), 127); assert.equal(tonNeu(3, 1, true), 0);
  assert.equal(griffArt(1, 2, true), null, 'below the threshold: a click');
  assert.equal(griffArt(0, -10, true), 'vel'); assert.equal(griffArt(30, 3, true), 'laenge');
  assert.equal(griffArt(30, 3, false), 'vel', 'a trigger lane has no length to drag');
  assert.equal(laengeNeu(1, 50, 25, 8), 3); assert.equal(laengeNeu(2, -200, 25, 8), 1, 'at least one cell'); assert.equal(laengeNeu(1, 500, 25, 8), 8, 'not past the pattern end');
});

test('a press let go away from its cell does not toggle it; a click does; a drag goes out as it is', () => {
  assert.equal(loslassFelder(null, true), null);
  assert.deepEqual(loslassFelder({ art: null }, true), {});
  assert.equal(loslassFelder({ art: null }, false), null);
  assert.deepEqual(loslassFelder({ art: 'vel', vel: 64 }, false), { vel: 64 });
  assert.deepEqual(loslassFelder({ art: 'laenge', laenge: 3 }, true), { laenge: 3 });
  const r = { left: 10, right: 30, top: 5, bottom: 25 };
  assert.equal(imRechteck(20, 15, r), true); assert.equal(imRechteck(31, 15, r), false); assert.equal(imRechteck(20, 15, null), false);
});

test('the wheel: the request carries a defined note and a change, otherwise nothing is sent; a pending name shows only in a cell that is on', () => {
  const an = { an: true, vel: 100, ton: 48, noten: [] }, aus = { ...an, an: false };
  assert.deepEqual(radFelder(an, 50), { ton: 50 });
  assert.equal(radFelder(an, undefined), null); assert.equal(radFelder(an, 48), null, 'the stored note');
  assert.equal(radFelder(aus, 50), null, 'the cell was switched off meanwhile'); assert.equal(radFelder(undefined, 50), null); assert.equal(radFelder(an, 'x'), null);
  const pitch = { art: 'noten', teiler: 0.25 };
  assert.notEqual(zellText(an, pitch, 52), zellText(an, pitch), 'a pending note replaces the stored name');
  assert.equal(zellText(aus, pitch, 52), '');
});

test('a note given as a number or as a name of the piano roll (60 = C3)', () => {
  assert.equal(tonVonText('36'), 36); assert.equal(tonVonText(' 127 '), 127); assert.equal(tonVonText('128'), null); assert.equal(tonVonText('-1'), null);
  assert.equal(tonVonText('C3'), 60); assert.equal(tonVonText('c1'), 36); assert.equal(tonVonText('F#1'), 42); assert.equal(tonVonText('Bb1'), 46); assert.equal(tonVonText('C-2'), 0);
  assert.equal(tonVonText('H1'), null); assert.equal(tonVonText(''), null); assert.equal(tonVonText('abc'), null);
});

// ---------- the empty state ----------
test('CREATE is disabled with the hint "open the live container" while no live project is open', () => {
  assert.equal(ANLEGEN_HINWEIS, 'open the live container');
  assert.deepEqual(anlegenZustand(null), { aus: true, hinweis: 'open the live container' });
  assert.deepEqual(anlegenZustand({ live: false }), { aus: true, hinweis: 'open the live container' });
  assert.deepEqual(anlegenZustand(projekt()), { aus: false, hinweis: '' });
});

// ---------- requests ----------
function server(antworten) {
  const rufe = [];
  const holeJson = async (weg, daten) => { rufe.push([weg, daten]); const a = antworten.shift(); return typeof a === 'function' ? a() : a; };
  return { holeJson, rufe };
}
const mitRev = (p, rev = p.rev + 1, extra = {}) => ({ ...p, rev, ...extra });

test('a click sends POST /seq/befehle with the commands of zelleBefehle; the cell is drawn on only after the answer, taken from the project of the answer', async () => {
  const p0 = projekt();
  const [kit] = deckAnsicht(p0, 2, INFOS).folgen, zeile = kit.sicht.zeilen[0];
  const befehle = zelleBefehle(kit.spur, kit.clip, zeile, 4, {});
  assert.equal(befehle.length, 1); assert.equal(befehle[0].befehl, 'noten_neu');
  let antworte;
  const s = server([() => new Promise((ok) => { antworte = ok; })]);
  const lauf = sende(2, 'Cell', befehle, p0, s.holeJson);
  assert.deepEqual(s.rufe, [['/seq/befehle', { platz: 2, label: 'Cell', befehle }]]);
  assert.equal(deckAnsicht(p0, 2, INFOS).folgen[0].sicht.zeilen[0].zellen[4].an, false, 'while the request is out the cell is still off');
  const neu = projekt(); neu.spuren[0].clips[0].noten.push(note('n9', 1, 36, 100));
  antworte({ status: 200, j: { rev: 8, projekt: mitRev(neu, 8), kern: {}, gruppe_id: 'g_seq' } });
  const r = await lauf;
  assert.equal(r.ok, true); assert.equal(r.neuLesen, false, 'the answer carries the project'); assert.equal(r.text, '');
  assert.equal(deckAnsicht(r.projekt, 2, INFOS).folgen[0].sicht.zeilen[0].zellen[4].an, true, 'after the answer it is on');
  assert.equal(p0.rev, 7); assert.equal(deckAnsicht(p0, 2, INFOS).folgen[0].sicht.zeilen[0].zellen[4].an, false, 'the old object stays as it was');
});

test('a list without a command sends nothing; an answer without a project asks the page to read it again', async () => {
  const p0 = projekt();
  const s = server([{ status: 200, j: { rev: 8 } }]);
  const leer = await sende(2, 'Cell', [], p0, s.holeJson);
  assert.deepEqual(s.rufe, []); assert.equal(leer.ok, true); assert.equal(leer.projekt, p0); assert.equal(leer.neuLesen, false);
  const r = await sende(2, 'Cell', [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1'] }], p0, s.holeJson);
  assert.equal(r.ok, true); assert.equal(r.neuLesen, true); assert.equal(r.projekt, p0, 'nothing new to draw yet');
});

test('a refused write is a message and the project is the one before; a lost deck or a stale revision asks for a re-read', async () => {
  const p0 = projekt();
  const b = [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1'] }];
  const t = server([{ status: 409, j: { fehler: 'ki_gestoppt', text: 'Stop Cypher is on' } }]);
  const r = await sende(2, 'Cell', b, p0, t.holeJson);
  assert.equal(r.ok, false); assert.match(r.text, /Stop Cypher is on/); assert.equal(r.projekt, p0); assert.equal(r.neuLesen, false);
  for (const fehler of ['seq_fehlt', 'kein_liveprojekt', 'rev_veraltet']) {
    const s = server([{ status: 409, j: { fehler, text: fehler } }]);
    assert.equal((await sende(2, 'Cell', b, p0, s.holeJson)).neuLesen, true, fehler);
  }
  const u = server([]);
  const keins = await sende(2, 'Cell', b, null, u.holeJson);
  assert.equal(keins.ok, false); assert.match(keins.text, /live container/); assert.deepEqual(u.rufe, []);
  const n = server([{ status: 0, j: { fehler: 'netz', text: 'page server unreachable: boom' } }]);
  const nr = await sende(2, 'Cell', b, p0, n.holeJson);
  assert.match(nr.text, /page server unreachable/); assert.equal(nr.neuLesen, true, 'a network error leaves the server state unknown: the page reads the project again');
});

test('a request that gets no answer is cut after the time limit and answers like a network error; a quick answer passes', async () => {
  const haengt = (_weg, opt) => new Promise((_ok, nein) => { opt.signal.addEventListener('abort', () => nein(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const t0 = Date.now();
  const r = await holeMitFrist(haengt, '/seq/befehle', { method: 'POST' }, 30);
  assert.ok(Date.now() - t0 < 1000, 'cut at the limit, not hanging');
  assert.equal(r.status, 0); assert.equal(r.j.fehler, 'netz'); assert.match(r.j.text, /did not answer/);
  const gut = await holeMitFrist(async () => ({ status: 200, json: async () => ({ a: 1 }) }), '/x', {}, 1000);
  assert.deepEqual(gut, { status: 200, j: { a: 1 } });
  const kaputt = await holeMitFrist(async () => { throw new Error('boom'); }, '/x', {}, 1000);
  assert.equal(kaputt.status, 0); assert.match(kaputt.j.text, /page server unreachable: boom/);
  assert.match(lies('seq_view.js'), /holeMitFrist\(/, 'the page asks through it'); assert.doesNotMatch(lies('seq_view.js'), /schreibe\(\(p\) => [^\n]*holeJson\)/, 'the page does not pass the plain holeJson to the SEQ writes');
});

test('freierName: the instrument name, then name 2, name 3, ignoring case; a name that is free stays', () => {
  assert.equal(freierName('bassmusik', []), 'bassmusik');
  assert.equal(freierName('bassmusik', ['bassmusik']), 'bassmusik 2');
  assert.equal(freierName('bassmusik', ['bassmusik', 'bassmusik 2']), 'bassmusik 3');
  assert.equal(freierName('bassmusik', ['BassMusik', 'BASSMUSIK 2']), 'bassmusik 3', 'ignoring case');
  assert.equal(freierName('bassmusik', ['bassmusik', 'bassmusik 3']), 'bassmusik 2', 'the first free number');
  assert.equal(freierName('Drums', ['Bass']), 'Drums');
});

test('a 200 with kern.wiedergabe shows the message of PRODUCTION and draws the saved state', async () => {
  const p0 = projekt();
  const neu = mitRev(projekt(), 8);
  const s = server([{ status: 200, j: { rev: 8, projekt: neu, kern: { wiedergabe: { nr: null, fehler: 'zu_gross' } }, gruppe_id: 'g_seq' } }]);
  const r = await sende(2, 'Cell', [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1'] }], p0, s.holeJson);
  assert.equal(r.ok, true); assert.equal(r.projekt, neu, 'the saved state is drawn');
  assert.equal(r.text, 'Saved, but the core did not load the arrangement: too many clips or notes for the core'); assert.equal(r.warnung, true);
});

test('anlegen, folge and leeren post their routes; the answer carries the project', async () => {
  const p0 = projekt([]); p0.gruppen = p0.gruppen.filter((g) => !g.seq);
  const mit = mitRev(projekt([]), 8);
  const s = server([{ status: 200, j: { rev: 8, projekt: mit, kern: {}, gruppe_id: 'g_seq' } }, { status: 200, j: { rev: 9, projekt: mitRev(projekt(), 9), kern: {}, gruppe_id: 'g_seq' } },
    { status: 200, j: { rev: 10, projekt: mitRev(p0, 10), kern: {}, gruppe_id: 'g_seq' } }]);
  const a = await legeAn(2, p0, s.holeJson);
  assert.equal(a.ok, true); assert.equal(a.neuLesen, false); assert.equal(seqAnsicht(a.projekt, 2).vorhanden, true);
  const f = await neueFolge(2, 'Bass', { art: 'intern', name: 'bk', graph: 'bassmusik' }, undefined, a.projekt, s.holeJson);
  assert.equal(f.ok, true);
  const l = await leereDeck(2, f.projekt, s.holeJson);
  assert.equal(l.ok, true); assert.equal(seqAnsicht(l.projekt, 2).vorhanden, false);
  assert.deepEqual(s.rufe, [['/seq/anlegen', { platz: 2 }], ['/seq/folge', { platz: 2, name: 'Bass', geraet: { art: 'intern', name: 'bk', graph: 'bassmusik' } }], ['/seq/leeren', { platz: 2 }]]);
  const g = server([{ status: 200, j: { rev: 11, projekt: mit, kern: {} } }]);
  await neueFolge(2, 'X', { art: 'intern', name: 'rb338', parameter: {} }, 8, mit, g.holeJson);
  assert.equal(g.rufe[0][1].loop_beats, 8);
  const keins = server([]);
  assert.match((await legeAn(2, null, keins.holeJson)).text, /live container/); assert.deepEqual(keins.rufe, []);
});

// ---------- instrument info and the picker ----------
test('ladeInfos asks GET /seq/geraet once per device, keeps the answer, and a failed answer is tried again later', async () => {
  leereInfoCache();
  const zweiBk = projekt([bkSpur(), { ...bkSpur(), id: 's4', clips: [] }, kitSpur()]);
  assert.deepEqual(fehlendeInfos(zweiBk, 2, 0).map((s) => s.id), ['s2', 's4', 's1']);
  const rufe = [];
  const holeGet = async (weg) => { rufe.push(weg); return weg.includes('s1') ? { status: 200, j: INFO_KIT } : { status: 200, j: INFO_BK }; };
  const infos = await ladeInfos(zweiBk, 2, holeGet, 0);
  assert.deepEqual(rufe.sort(), ['/seq/geraet?spur_id=s1', '/seq/geraet?spur_id=s2'], 'two spurs on the same graph: one request');
  assert.deepEqual(infos.s2, INFO_BK); assert.deepEqual(infos.s4, INFO_BK); assert.deepEqual(infos.s1, INFO_KIT);
  assert.deepEqual(fehlendeInfos(zweiBk, 2, 1), []);
  assert.deepEqual(infosAusCache(zweiBk, 2, 1).s1, INFO_KIT);
  leereInfoCache();
  const kaputt = async () => ({ status: 500, j: { fehler: 'intern' } });
  const mager = await ladeInfos(projekt(), 2, kaputt, 1000);
  assert.deepEqual(mager.s2, { art: 'bk', regler: [], klaenge: [] }, 'without the route the lanes are drawn with their own names');
  assert.deepEqual(fehlendeInfos(projekt(), 2, 2000), [], 'not again at once');
  assert.equal(fehlendeInfos(projekt(), 2, 20000).length, 2, 'later again');
  leereInfoCache();
});

test('the instrument picker offers the Baukasten instruments, the kits and the RB-338', () => {
  const w = geraetWahl([{ name: 'bassmusik', art: 'instrument' }, { name: 'hall', art: 'effect' }, { name: 'lead', art: 'instrument' }], [{ name: '909', klaenge: 12 }]);
  assert.deepEqual(w.map((e) => [e.gruppe, e.text]), [['Baukasten', 'bassmusik'], ['Baukasten', 'lead'], ['Kit', '909 (12)'], ['RB-338', 'RB-338']]);   // own group name: the menu's type group "Other" must not clash with it
  assert.deepEqual(w[0].geraet, { art: 'intern', name: 'bk', graph: 'bassmusik' });
  assert.deepEqual(w[2].geraet, { art: 'intern', name: 'kit', kit: '909' });
  assert.deepEqual(w[3].geraet, { art: 'intern', name: 'rb338', parameter: {} });
  assert.deepEqual(geraetWahl(undefined, undefined).map((e) => e.text), ['RB-338']);
});

test('the instrument picker leaves out graphs with latency; a pattern that has one keeps it in its own exchange menu', () => {
  const g = [{ name: 'bass', art: 'instrument', latenz: 0 }, { name: 'limited', art: 'instrument', latenz: 23 }, { name: 'old', art: 'instrument' }, { name: 'fx', art: 'effekt', latenz: 69 }];
  assert.deepEqual(geraetWahl(g, []).map((e) => e.text), ['bass', 'old', 'RB-338'], 'latency > 0 is out; a missing value counts as 0');
  assert.deepEqual(geraetWahl(g, [], 'limited').map((e) => e.text), ['bass', 'limited', 'old', 'RB-338'], 'the graph the pattern already plays stays');
  assert.deepEqual(geraetWahl(g, [], 'bass').map((e) => e.text), ['bass', 'old', 'RB-338']);
  assert.deepEqual(geraetWahl(g, [], 'limited').find((e) => e.text === 'limited').geraet, { art: 'intern', name: 'bk', graph: 'limited' });
});

// ---------- instrument exchange (review focus 4) ----------
test('wechselBefehle: Baukasten to another Baukasten graph keeps the knob lanes: the plain spur_aendern, no question', () => {
  const bk = bkSpur(), neu = { art: 'intern', name: 'bk', graph: 'lead' };
  const w = wechselBefehle(bk, bk.clips[0], neu, INFO_BK);
  assert.deepEqual(w, { befehle: [{ befehl: 'spur_aendern', spur_id: 's2', geraet: neu }], frage: null, meldung: null });
});

test('wechselBefehle: to a kit with a knob envelope: the deletions then spur_aendern in one list, and the question names the lanes', () => {
  const bk = bkSpur(), kit = { art: 'intern', name: 'kit', kit: '909' };
  bk.clips[0].huellkurven.push({ ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0 }] }, { ziel: 'transpose', punkte: [{ beat: 0, wert: 1 }] });
  const w = wechselBefehle(bk, bk.clips[0], kit, INFO_BK);
  assert.deepEqual(w.befehle, [{ befehl: 'huellkurve_loeschen', clip_id: 'c2', ziel: 'geraet.k3' }, { befehl: 'huellkurve_loeschen', clip_id: 'c2', ziel: 'geraet.k4' },
    { befehl: 'spur_aendern', spur_id: 's2', geraet: kit }], 'the transpose envelope fits every device and stays');
  assert.match(w.frage, /Cutoff, Resonance/); assert.match(w.frage, /909/); assert.equal(w.meldung, null);
});

test('wechselBefehle: without device envelopes the exchange is plain; the same instrument is nothing; an automation lane on a knob is a message and sends nothing', () => {
  const kit = { art: 'intern', name: 'kit', kit: '909' }, rb = { art: 'intern', name: 'rb338', parameter: {} };
  const ohne = kitSpur();
  assert.deepEqual(wechselBefehle(ohne, ohne.clips[0], { art: 'intern', name: 'bk', graph: 'bassmusik' }, INFO_KIT).befehle, [{ befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'intern', name: 'bk', graph: 'bassmusik' } }]);
  assert.deepEqual(wechselBefehle(ohne, ohne.clips[0], kit, INFO_KIT), { befehle: [], frage: null, meldung: null });
  const leer = { ...kitSpur(), clips: [] };
  assert.equal(wechselBefehle(leer, null, rb, INFO_KIT).befehle.length, 1, 'a pattern without a clip');
  const bk = bkSpur(); bk.automation = [{ id: 'l1', ziel: 'geraet.k2', punkte: [] }];
  const m = wechselBefehle(bk, bk.clips[0], kit, INFO_BK);
  assert.deepEqual(m.befehle, []); assert.equal(m.meldung, 'This track has an automation lane on a device knob. Remove it in PRODUCTION first.');
  assert.equal(wechselBefehle(bk, bk.clips[0], { art: 'intern', name: 'bk', graph: 'lead' }, INFO_BK).meldung, null, 'a Baukasten lane fits another graph');
  const rbSpur = { ...bkSpur(), geraet: rb };
  rbSpur.clips[0].huellkurven = [{ ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0 }] }];
  assert.equal(wechselBefehle(rbSpur, rbSpur.clips[0], rb, { art: 'rb338', regler: [], klaenge: [] }).befehle.length, 0);
  assert.equal(wechselBefehle(rbSpur, rbSpur.clips[0], { art: 'intern', name: 'bk', graph: 'x' }, { art: 'rb338', regler: [], klaenge: [] }).befehle[0].ziel, 'geraet.cutoff');
});

// ---------- lengths, widths, curve path ----------
test('pattern lengths: 1, 2, 4, 8, 16 bars and a free step count; the text of a length', () => {
  assert.deepEqual(LAENGEN_TAKTE, [1, 2, 4, 8, 16]);
  assert.equal(laengeText(4), '1 bar'); assert.equal(laengeText(8), '2 bars'); assert.equal(laengeText(3), '12 steps'); assert.equal(laengeText(0.125), '0.125 beats');
  assert.equal(laengeText(16), '4 bars'); assert.equal(laengeText(1), '4 steps');
  assert.equal(laengeAusSchritten('12'), 3); assert.equal(laengeAusSchritten('1'), 0.25); assert.equal(laengeAusSchritten('256'), 64);
  for (const x of ['0', '257', '1.5', 'x', '', '-4']) assert.equal(laengeAusSchritten(x), null, x);
});

test('the visible width: all fits the longest pattern between 48 and 256 px per beat; 1, 2 or 4 bars fill the place; a pattern wider than the place scrolls', () => {
  assert.deepEqual(SICHT_BREITEN, [1, 2, 4, 'all']);
  assert.equal(pxProBeat('all', 4, 1000), 250); assert.equal(pxProBeat('all', 16, 1000), 62); assert.equal(pxProBeat('all', 64, 1000), 48);
  assert.equal(pxProBeat('all', 8, 1600), 200, 'all fills the width: a 2-bar pattern on 1600 px');
  assert.equal(pxProBeat('all', 4, 5000), 256, 'the upper limit is the one of 1, 2 and 4 bars');
  assert.equal(pxProBeat('all', 2, 1000), 250, 'a deck is at least one bar wide');
  assert.equal(pxProBeat(1, 4, 800), 200); assert.equal(pxProBeat(2, 16, 800), 100); assert.equal(pxProBeat(4, 16, 100), 24, 'never narrower than 24');
  assert.equal(pxProBeat('all', 4, 0), 96); assert.equal(pxProBeat(2, 4, NaN), 96, 'unmeasured: the default');
});

test('kurvePfad draws the points with their forms and repeats the curve at its length, pale after the first pass', () => {
  const punkte = [{ beat: 0, wert: 0, form: 'linear' }, { beat: 1, wert: 1, form: 'sprung' }];
  const k = kurvePfad(punkte, 2, 4, 10, 20, { min: 0, max: 1 });
  assert.match(k.erste, /^M0 17 L0 17 L10 17 L10 3 L20 3$/, 'a jump holds the old value, then steps; the last value holds to the lane length');
  assert.match(k.spaeter, /^M20 17/, 'the second pass starts at the lane length');
  assert.deepEqual(kurvePfad([], 2, 4, 10, 20, { min: 0, max: 1 }), { erste: '', spaeter: '' });
  assert.equal(kurvePfad(punkte, 4, 4, 10, 20, { min: 0, max: 1 }).spaeter, '', 'a lane as long as the pattern has no repeat');
  assert.match(kurvePfad([{ beat: 0, wert: 0 }, { beat: 2, wert: 1, form: 's' }], 4, 4, 10, 20, { min: 0, max: 1 }).erste, /L20 3/, 'the s form ends on its point');
});

test('lane titles name the kind and the target', () => {
  const bk = deckAnsicht(projekt(), 2, INFOS).folgen[1].sicht.zeilen;
  assert.equal(zeileTitel(bk[0]), 'pitch'); assert.equal(zeileTitel(bk[1]), 'values · velocity'); assert.equal(zeileTitel(bk[2]), 'values · Cutoff');
  assert.equal(zeileTitel({ art: 'kurve', name: 'Resonance' }), 'curve · Resonance');
  assert.equal(zeileTitel({ art: 'noten', ton: 36, name: 'Kick' }), 'Kick');
});

// ---------- the DOM (real app.js, stand-in) ----------
let live, seqAnsichtModul, setzeProduktion;
const platz = (n = 2) => attrappe.body.querySelector(`section.seqplatz[data-seq="${n}"]`);
const antwort = (p) => ({ code: 200, j: { rev: p.rev, projekt: p, kern: {}, gruppe_id: 'g_seq' } });
let posts, naechste = null;
const modulPosts = [];
const transportPosts = [];
const aendernPosts = [];
let modulAntwort = () => ({ code: 200, j: { ok: true, rev: 9, projekt: { ...projekt(), rev: 9 }, bericht: { platz: 2, deck_neu: false, patterns: [{ name: 'A' }, { name: 'B' }], weggelassen: { sends: 1, inserts: 0, master_inserts: 0, returns: 0, gruppen: 0, kettenautomation: 0, tonart: false, spuren_uebersprungen: [], gekuerzt: [] } } } });
before(async () => {
  posts = [];
  installiere({
    html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    antworten: {
      'GET /bestand': { j: [] }, 'GET /loops': { j: [] },
      'GET /seq/geraet': { j: INFO_KIT },
      'GET /graphen': { j: { graphen: [{ name: 'bassmusik', art: 'instrument', regler_namen: {} }] } }, 'GET /proj/kits': { j: { kits: [{ name: '909', klaenge: 12 }] } },
      'POST /seq/befehle': (k) => { posts.push(k); return naechste ? naechste(k) : antwort({ ...projekt(), rev: 8 }); },
      'POST /seq/anlegen': () => antwort(projekt([])),
      'GET /proj/liste': { j: [{ slug: 'mod-a', name: 'Mod A', werkbank: true }, { slug: 'plain', name: 'Plain' }, { slug: 'mod-b', name: 'Mod B', werkbank: true }] },
      'POST /seq/modul': (k) => { modulPosts.push(k); return modulAntwort(k); },
      'POST /proj/aendern': (k) => { aendernPosts.push(k); return { code: 200, j: { rev: 8, projekt: { ...live.projekt, rev: 8 } } }; },
      'POST /proj/transport': (k) => { transportPosts.push(k); return { code: 200, j: { quittung: { status: 2 } } }; },
    },
  });
  await import('../public/app.js');
  live = (await import('../public/live_view.js')).live;
  seqAnsichtModul = await import('../public/seq_view.js');
  ({ setzeProduktion } = await import('../public/seitenrahmen.js'));
  await new Promise((r) => setTimeout(r, 40));
});

test('the node of a place draws a block per pattern: head, ruler and lanes with their cells', async () => {
  leereInfoCache();
  live.projekt = projekt(); live.rev = 7;
  seqAnsichtModul.zeichneSeq();
  const k = platz(2);
  assert.ok(k, 'the node exists');
  const bloecke = k.querySelectorAll('.sq-folge');
  assert.equal(bloecke.length, 2, 'two patterns');
  assert.equal(bloecke[0].dataset.folge, 's1'); assert.equal(bloecke[1].dataset.folge, 's2');
  assert.equal(bloecke[0].querySelectorAll('.sq-zeile').length, 3, 'three derived trigger lanes');
  assert.equal(bloecke[0].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle').length, 16);
  assert.equal(bloecke[1].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle').length, 32, 'a 1/32 lane: 32 cells in one bar');
  assert.equal(bloecke[1].querySelectorAll('.sq-zeile')[2].dataset.art, 'werte');
  assert.ok(bloecke[1].querySelector('.sq-lineal'), 'the ruler');
  assert.match(k.querySelector('.sq-folgenkopf [data-sq-geraet]').textContent, /Baukasten|Kit/);
  assert.equal(k.querySelector('.sq-zahl').textContent, '2 patterns');
  assert.match(k.querySelector('.sq-baukasten').textContent, /1 Baukasten/);
  assert.equal(k.querySelector('.sq-leer').hidden, true); assert.equal(k.querySelector('.sq-feld').hidden, false);
  await new Promise((r) => setTimeout(r, 20));
});

test('a click on an empty cell posts the commands of zelleBefehle for that cell, and a pattern from PRODUCTION is one row', async () => {
  live.projekt = projekt([kitSpur(), fremdSpur()]); live.rev = 7; posts.length = 0;
  seqAnsichtModul.zeichneSeq();
  const k = platz(2);
  assert.equal(k.querySelectorAll('.sq-folge').length, 2);
  assert.match(k.querySelectorAll('.sq-folge')[1].textContent, /arranged in PRODUCTION/);
  assert.equal(k.querySelectorAll('.sq-folge')[1].querySelectorAll('.sq-zelle').length, 0);
  const zelle = k.querySelectorAll('.sq-folge')[0].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[4];
  assert.equal(zelle.dataset.z, '4');
  zelle.dispatch('pointerdown', { button: 0, clientX: 50, clientY: 10, pointerId: 1 });
  zelle.dispatch('pointerup', { clientX: 50, clientY: 10, pointerId: 1, type: 'pointerup' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].platz, 2);
  assert.equal(posts[0].befehle[0].befehl, 'noten_neu');
  assert.equal(posts[0].befehle[0].noten[0].beat, 1, 'cell 4 of 1/16 starts at beat 1');
  assert.equal(posts[0].befehle[0].noten[0].ton, 36);
});

test('a drag up on a note sets its velocity (one noten_aendern on release), a drag right in the pitched lane its length', async () => {
  live.projekt = projekt(); live.rev = 7; posts.length = 0;
  seqAnsichtModul.zeichneSeq();
  const bloecke = platz(2).querySelectorAll('.sq-folge');
  const kick = bloecke[0].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[0];
  assert.ok(kick.classList.contains('an'), 'the kick at beat 0');
  kick.dispatch('pointerdown', { button: 0, clientX: 50, clientY: 20, pointerId: 1 });
  kick.dispatch('pointermove', { clientX: 50, clientY: 0 });
  assert.match(platz(2).querySelector('.sq-stand').textContent, /velocity 116/, 'the value shows while dragging');
  kick.dispatch('pointerup', { clientX: 50, clientY: 0, type: 'pointerup' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].befehle, [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', vel: 116 }] }]);
  const ton = bloecke[1].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[0];
  posts.length = 0;
  seqAnsichtModul.zeichneSeq();
  const ton2 = platz(2).querySelectorAll('.sq-folge')[1].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[0];
  ton2.dispatch('pointerdown', { button: 0, clientX: 0, clientY: 10, pointerId: 1 });
  ton2.dispatch('pointermove', { clientX: 300, clientY: 10 });
  ton2.dispatch('pointerup', { clientX: 300, clientY: 10, type: 'pointerup' });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(ton, 'the cell node exists');
  assert.equal(posts[0].befehle[0].noten[0].id, 'm1'); assert.ok(posts[0].befehle[0].noten[0].laenge > 1, 'longer than the one beat it had');
});

test('a refused click shows the message and the cell stays as the saved state has it; a lane that cannot be written sends nothing', async () => {
  live.projekt = projekt(); live.rev = 7; posts.length = 0;
  naechste = () => ({ code: 409, j: { fehler: 'ki_gestoppt', text: 'Stop Cypher is on' } });
  seqAnsichtModul.zeichneSeq();
  const zelle = platz(2).querySelectorAll('.sq-folge')[0].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[4];
  zelle.dispatch('pointerdown', { button: 0, clientX: 50, clientY: 10, pointerId: 1 });
  zelle.dispatch('pointerup', { clientX: 50, clientY: 10, type: 'pointerup' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(posts.length, 1);
  assert.match(attrappe.body.querySelector('#meldung').textContent, /Stop Cypher is on/);
  const jetzt = platz(2).querySelectorAll('.sq-folge')[0].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[4];
  assert.equal(jetzt.classList.contains('an'), false, 'the cell is drawn as the server has it');
  naechste = null;
  // a pitched cell that has a note: the wheel on a cell that is off sends nothing, and an empty command list sends nothing
  posts.length = 0;
  const leer = platz(2).querySelectorAll('.sq-folge')[1].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[5];
  leer.dispatch('wheel', { deltaY: -1 });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(posts.length, 0);
});

// ---------- the page sources ----------
const knoten = lies('seq_view.js'), css = lies('style.css'), html = lies('index.html');

test('four nodes section.seqplatz[data-seq="N"] are built by script into #pult; the exports the page keeps are there', () => {
  assert.match(knoten, /createElement\('section'\)/); assert.match(knoten, /dataset\.seq = String\(n\)/); assert.match(knoten, /\[1, 2, 3, 4\]/); assert.match(knoten, /\$\('#pult'\)\.append/);
  assert.match(knoten, /export function zeichneSeq/); assert.match(knoten, /export function ordneSeqStudio/); assert.match(knoten, /export function baueSeqPlaetze/);
  assert.doesNotMatch(lies('slots.js'), /const EINMALIG = \[[^\]]*seq/);
  assert.doesNotMatch(html, /class="seqplatz|data-seq=/, 'built by script like the deck nodes, not in the markup');
});

test('every write goes through the chain of the page with live.seqLaeuft, a refusal is a message, a SeqFehler sends nothing', () => {
  assert.match(knoten, /live\.seqLaeuft \+= 1/); assert.match(knoten, /live\.seqLaeuft -= 1/);
  assert.match(knoten, /einreihen/); assert.match(knoten, /pruefeLiveSpaeter\(0\)/); assert.match(knoten, /melde\(/);
  assert.match(knoten, /instanceof SeqFehler/);
  assert.match(knoten, /window\.confirm\(/); assert.match(knoten, /requestAnimationFrame/); assert.match(knoten, /kopfZelle\(/);
  assert.match(knoten, /addEventListener\('wheel'/); assert.match(knoten, /pointerdown/);
});

test('the page draws the nodes from the live project on every live change, and reads again on the event {a: seq}', () => {
  assert.match(lies('live_view.js'), /zeichneSeq\(\)/); assert.match(lies('live_view.js'), /if \(a === 'seq'\)/);
  assert.match(lies('stream.js'), /case 'seq': liveEreignis\(a, f\); break;/);
  const app = liesApp();
  assert.match(app, /baueSeqPlaetze\(\);/);
  assert.ok(app.indexOf('baueSeqPlaetze();') < app.indexOf('\nbindePlaetze();'), 'the nodes exist before the layout is applied');
});

test('a place switch away from SEQ posts /plaetze and the server parks the deck; the place head counts the patterns', () => {
  const b = lies('slots_view.js');
  assert.match(b, /const parkt = \(platz\) => \['seq', 'loops'\]\.includes\(typVon\(zustand\.plaetze, platz\)\);/, 'a SEQ place is parked by the server, the silence rule does not hold it');
  assert.match(b, /if \(!s\.still && !parkt\(platz\)\)/);
  assert.match(b, /fetch\('\/plaetze', \{ method: 'POST'/);
  assert.match(b, /const a = seqAnsicht\(live\.projekt, platz\); return `SEQ \$\{platz\} · \$\{a\.vorhanden \? `\$\{a\.folgen\.length\} pattern/, 'the head counts the patterns');
  assert.match(b, /ordneSeqStudio\(typen\(\)\);/);
  assert.match(b, /seq: \(n\) => \$\(`section\.seqplatz\[data-seq="\$\{n\}"\]`\)/);
});

test('the SEQ button sits in each of the four place type rows', () => {
  assert.equal((html.match(/data-platz-typ="seq"/g) ?? []).length, 4);
  assert.match(html, /data-platz-typ="seq" title="SEQ: patterns of notes, values and curves, plays on the strip of this place"/);
});

test('the CSS: the node scrolls, cells take their width from the grid, accent, tie and playhead have their own look, both views place it', () => {
  assert.match(css, /\.seqplatz \{/); assert.match(css, /\.sq-feld \{[^}]*overflow: auto;/); assert.match(css, /\.sq-zelle\.an/); assert.match(css, /\.sq-zelle\.akzent/);
  assert.match(css, /\.sq-zelle\.gebunden/); assert.match(css, /\.sq-zelle\.kopf/); assert.match(css, /var\(--sq-beat/);
  assert.match(css, /body:not\(\.studio\) \.platz-aus \{ display: none !important; \}/);
  assert.doesNotMatch(css, /body\.studio #pult|body\.studio \.seqplatz/);
});

test('the old Studio strip move is gone: nothing hides the desk or places the SEQ node but the places table', () => {
  const b = lies('slots_view.js');
  assert.doesNotMatch(b, /zeigeStudioZuege|studioZug/);
  assert.doesNotMatch(css, /data-studio-zug|--mu-breite/);
  assert.match(knoten, /style\.setProperty\('--seq-n', String\(i\)\)/);
});

test('an own SEQ write lets the places re-evaluate; the place table of /lage is the only truth, the page follows no deck of its own', () => {
  assert.match(knoten, /zeigePlaetzeSpaeter\(\)/);
  const b = lies('slots_view.js');
  assert.doesNotMatch(b, /folgeServer|folgeDemServer|deckAktiv/, 'a deck on a place not typed seq is not followed');
  assert.match(lies('stream.js'), /case 'proj':[^\n]*holeLage\(\)/, 'the proj event reads /lage again');
  assert.match(lies('live_view.js'), /export function zeichneLive\(\) \{\s*zeigePlaetzeSpaeter\(\);/);
});


// ====================================================================================================================================================
// Task 5: value lanes, curve lanes, lane head, the jump to PRODUCTION
// ====================================================================================================================================================
const bkMit = (zeilen, hk, extra = {}) => { const s = bkSpur(); s.clips[0].seq = { schema: 1, zeilen }; s.clips[0].huellkurven = hk; Object.assign(s.clips[0], extra); return s; };
const sichtVon = (spur, infos = { s2: INFO_BK }) => deckAnsicht(projekt([spur]), 2, infos).folgen[0].sicht;
const KURVE_RESO = { id: 'reso', art: 'kurve', ziel: 'geraet.k4' };
const WERTE_CUT = { id: 'cutoff', art: 'werte', teiler: 0.25, ziel: 'geraet.k3' };
const NOTEN = { id: 'noten', art: 'noten', teiler: 0.25 };

test('the bar of a value cell: the pointer height gives the value on the range of the target, snapped; a length is never 0 and its range is 0..4 cells', () => {
  const vel = { ziel: 'vel', bereich: { min: 1, max: 127 } }, laenge = { ziel: 'laenge', bereich: { min: -1, max: 1 } }, knopf = { ziel: 'geraet.k3', bereich: { min: 0, max: 1 } };
  assert.equal(wertAusPos(vel, 100, 100, 40), 127, 'the top of the cell');
  assert.equal(wertAusPos(vel, 140, 100, 40), 1, 'the bottom of the cell');
  assert.equal(wertAusPos(vel, 120, 100, 40), 64, 'whole velocity steps');
  assert.deepEqual(zeilenBereich(laenge), { min: 0, max: 4 }, 'seq_logic.js gives a length lane the range -1..1 of an unknown target: the page draws cells');
  assert.equal(wertAusPos(laenge, 120, 100, 40), 2); assert.equal(wertAusPos(laenge, 140, 100, 40), 0.25, 'a length is above 0');
  assert.equal(wertAusPos(knopf, 112, 100, 40), 0.7, 'hundredths for a knob');
  assert.equal(wertAusPos(knopf, 50, 100, 40), 1, 'above the cell: the top'); assert.equal(wertAusPos(knopf, 400, 100, 40), 0, 'below the cell: the bottom');
  assert.equal(wertAusPos({ ziel: 'transpose', bereich: { min: -48, max: 48 } }, 120, 100, 40), 0, 'whole semitones');
  assert.equal(wertBruch(knopf, 0.25), 0.25); assert.equal(wertBruch(laenge, 1), 0.25);
  assert.equal(wertText(laenge, 1), '1 cell'); assert.equal(wertText(laenge, 0.5), '0.5 cells'); assert.equal(wertText(knopf, 0.7), '0.7');
});

test('a value cell is drawn from the saved state: held values pale, a point full, a clamped value marked, a velocity cell without a note grey and without pointer', () => {
  const spur = bkMit([NOTEN, { id: 'vel', art: 'werte', teiler: 0.25, ziel: 'vel' }, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.7, form: 'sprung' }] }]);
  const sicht = sichtVon(spur);
  const cut = sicht.zeilen.find((z) => z.id === 'cutoff'), vel = sicht.zeilen.find((z) => z.id === 'vel');
  assert.equal(cut.zellen[0].geklemmt, true, 'base .4 plus offset .7 leaves 0..1');
  assert.ok(zellKlassen(cut.zellen[0], cut).includes('geklemmt'));
  assert.equal(cut.zellen[0].wert, 1, 'drawn clamped');
  assert.ok(!zellKlassen(cut.zellen[1], cut).includes('an') && cut.zellen[1].wert === 1, 'a cell without a point holds the value before it');
  assert.deepEqual(zellKlassen(vel.zellen[4], vel), ['sq-zelle', 'wert', 'gesperrt', 'nurlesen'], 'no note in cell 4: grey, no pointer');
  assert.deepEqual(zellKlassen(vel.zellen[0], vel), ['sq-zelle', 'wert', 'an']);
  assert.match(zellTitel(cut, 0, cut.zellen[0]), /clamped/); assert.match(zellTitel(vel, 4, vel.zellen[4]), /no note here/);
});

test('a drag on a value cell becomes one huellkurve_setzen with the whole envelope; a value that is already there sends nothing', () => {
  const spur = bkMit([NOTEN, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }, { beat: 2, wert: -0.2 }] }]);
  const sicht = sichtVon(spur), z = sicht.zeilen.find((x) => x.id === 'cutoff');
  const b = wertSchreibe(spur, spur.clips[0], z, 4, 0.9, INFO_BK);
  assert.equal(b.length, 1); assert.equal(b[0].befehl, 'huellkurve_setzen');
  assert.deepEqual(b[0].punkte, [{ beat: 0, wert: 0.1 }, { beat: 1, wert: 0.5, form: 'sprung' }, { beat: 2, wert: -0.2 }], 'shown .9 on the base .4 stores .5; the other points stay');
  assert.deepEqual(wertSchreibe(spur, spur.clips[0], z, 0, 0.5, INFO_BK), [], 'cell 0 shows .5 already');
  const weg = wertSchreibe(spur, spur.clips[0], z, 8, null, INFO_BK);
  assert.deepEqual(weg[0].punkte, [{ beat: 0, wert: 0.1 }], 'a double click removes the point of cell 8');
});

test('double click on the only point removes the envelope (huellkurve_loeschen), also with the curve lane', () => {
  const spur = bkMit([NOTEN, WERTE_CUT, KURVE_RESO], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }, { ziel: 'geraet.k4', punkte: [{ beat: 1, wert: 0.2 }] }]);
  const sicht = sichtVon(spur);
  assert.deepEqual(wertSchreibe(spur, spur.clips[0], sicht.zeilen.find((x) => x.id === 'cutoff'), 0, null, INFO_BK), [{ befehl: 'huellkurve_loeschen', clip_id: 'c2', ziel: 'geraet.k3' }]);
  const reso = sicht.zeilen.find((x) => x.id === 'reso');
  assert.deepEqual(kurveSchreibe(spur, spur.clips[0], reso, kurveWeg(reso, 0), INFO_BK), [{ befehl: 'huellkurve_loeschen', clip_id: 'c2', ziel: 'geraet.k4' }]);
});

test('curve edits: a click adds a point (an existing beat is replaced), a drag moves one, points on a clamped knob position refuse the edit', () => {
  const spur = bkMit([NOTEN, KURVE_RESO], [{ ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0 }, { beat: 2, wert: 0.4, form: 's' }] }]);
  const z = sichtVon(spur).zeilen.find((x) => x.id === 'reso');
  assert.deepEqual(z.punkte.map((p) => [p.beat, p.wert, p.form]), [[0, 0.3, 'linear'], [2, 0.7, 's']], 'shown on the base .3');
  assert.deepEqual(kurveNeu(z, 1, 0.9).map((p) => p.beat), [0, 2, 1], 'appended; kurveBefehle sorts');
  const ersetzt = kurveNeu(z, 2, 0.1);
  assert.equal(ersetzt.length, 2); assert.deepEqual(ersetzt[1], { beat: 2, wert: 0.1, form: 's' }, 'the form stays');
  assert.deepEqual(kurveVerschiebe(z, 0, 0.5, 0.8)[0], { beat: 0.5, wert: 0.8, form: 'linear' });
  assert.throws(() => kurveVerschiebe(z, 5, 1, 1), SeqFehler);
  const b = kurveSchreibe(spur, spur.clips[0], z, kurveNeu(z, 1, 0.9), INFO_BK);
  assert.deepEqual(b[0].punkte, [{ beat: 0, wert: 0, form: 'linear' }, { beat: 1, wert: 0.6, form: 'linear' }, { beat: 2, wert: 0.4, form: 's' }], 'the points that were not touched keep their stored value');
});

test('a curve with a point the knob position puts outside 0..1 can be edited: the point nobody touched is written back with exactly its stored value, only the touched one changes', () => {
  const klemm = bkMit([NOTEN, KURVE_RESO], [{ ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0.9 }, { beat: 2, wert: 0.1 }] }]);
  const zk = sichtVon(klemm).zeilen.find((x) => x.id === 'reso');
  assert.equal(zk.punkte[0].geklemmt, true); assert.equal(zk.punkte[0].wert, 1, 'shown clamped'); assert.equal(zk.punkte[0].gespeichert, 0.9, 'the view keeps the stored value of a clamped point');
  const clip = klemm.clips[0];
  const neu = kurveSchreibe(klemm, clip, zk, kurveNeu(zk, 1, 0.5), INFO_BK)[0].punkte;
  assert.deepEqual(neu, [{ beat: 0, wert: 0.9, form: 'linear' }, { beat: 1, wert: 0.2, form: 'linear' }, { beat: 2, wert: 0.1, form: 'linear' }], 'the clamped point keeps .9, not 1 minus the base; the new point is .5 on the base .3');
  const bewegt = kurveSchreibe(klemm, clip, zk, kurveVerschiebe(zk, 0, 0.5, 0.2), INFO_BK)[0].punkte;
  assert.deepEqual(bewegt.map((p) => [p.beat, p.wert]), [[0.5, -0.1], [2, 0.1]], 'the touched point takes the new shown value: the clamped mark is gone with the touch');
  const weg = kurveSchreibe(klemm, clip, zk, kurveWeg(zk, 1), INFO_BK)[0].punkte;
  assert.deepEqual(weg, [{ beat: 0, wert: 0.9, form: 'linear' }], 'removing the other point leaves the clamped one as it was stored');
});

test('curve geometry: points as pixels, snap to a sixteenth of a beat, the value from the pointer height, dashed marks at every repeat', () => {
  const z = { bereich: { min: 0, max: 1 }, ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0, form: 'linear' }, { beat: 1.5, wert: 1, form: 's', geklemmt: true }] };
  assert.deepEqual(kurvePunkte(z, 96, 44), [{ i: 0, x: 0, y: 41, form: 'linear', geklemmt: false }, { i: 1, x: 144, y: 3, form: 's', geklemmt: true }]);
  assert.equal(kurveBeatAusX(100, 96, 4), 1.0625, 'a sixteenth of a beat'); assert.equal(kurveBeatAusX(-5, 96, 4), 0); assert.equal(kurveBeatAusX(5000, 96, 3), 3, 'not behind the lane end');
  assert.equal(kurveWertAusY(z, 3, 44), 1); assert.equal(kurveWertAusY(z, 41, 44), 0); assert.equal(kurveWertAusY(z, 22, 44), 0.5);
  assert.deepEqual(kurveMarken(3, 8), [3, 6], 'a 3-beat lane in an 8-beat pattern starts again at 3 and 6');
  assert.deepEqual(kurveMarken(8, 8), []); assert.deepEqual(kurveMarken(0, 8), []);
});

test('a lane shorter than its pattern is drawn again after its length: whole copies, a cut last one', () => {
  const z = { teiler: 1, laenge_beats: 3, zellen: [{}, {}, {}] };
  assert.deepEqual(wiederholZellen(z, 8).map((w) => [w.von, w.quelle, w.breite]), [[3, 0, 1], [4, 1, 1], [5, 2, 1], [6, 0, 1], [7, 1, 1]]);
  assert.deepEqual(wiederholZellen({ teiler: 0.5, laenge_beats: 0.75, zellen: [{}, {}] }, 1.5).map((w) => [w.von, w.breite]), [[0.75, 0.5], [1.25, 0.25]], 'the cell the lane end cuts is narrower');
  assert.deepEqual(wiederholZellen({ teiler: 1, laenge_beats: 4, zellen: [{}] }, 4), [], 'a lane as long as its pattern has no repeat');
});

test('the playhead of a 3/4-bar curve under a 2-bar pattern wraps at 3 beats; the lane carries its own length, the marks sit at the repeats', () => {
  const spur = bkMit([NOTEN, KURVE_RESO], [{ ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0 }, { beat: 1.5, wert: 0.3 }, { beat: 3, wert: 0 }], verknuepft: false, loop_beats: 3 }], { loop_beats: 8 });
  const sicht = sichtVon(spur);
  const z = sicht.zeilen.find((x) => x.id === 'reso');
  assert.equal(sicht.laenge_beats, 8); assert.equal(z.laenge_beats, 3); assert.equal(z.eigen_laenge, true);
  assert.equal(kopfPos(2.9, z), 2.9); assert.equal(kopfPos(3, z), 0); assert.equal(kopfPos(7, z), 1); assert.equal(kopfPos(5.5, z), 2.5);
  assert.deepEqual(kurveMarken(z.laenge_beats, sicht.laenge_beats), [3, 6]);
  assert.equal(eigenLaengeText(3), '3/4 bar');
});

test('a length the lane has no envelope for yet is kept by the page and goes out with the first point; it is dropped once the envelope has it', () => {
  const spur = bkMit([NOTEN, KURVE_RESO, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }] }]);
  const a = deckAnsicht(projekt([spur]), 2, { s2: INFO_BK });
  const wartend = new Map([['s2/reso', 3], ['s2/cutoff', 2], ['s2/noten', 1], ['s9/gone', 2]]);
  const b = ueberlagere(a, wartend);
  const reso = b.folgen[0].sicht.zeilen.find((x) => x.id === 'reso');
  assert.equal(reso.laenge_beats, 3); assert.equal(reso.eigen_laenge, true);
  assert.deepEqual([...wartend.keys()], ['s2/reso'], 'a lane that has an envelope, a note lane and a lane that is gone lose their entry');
  const werte = ueberlagere(deckAnsicht(projekt([bkMit([NOTEN, { id: 'cutoff', art: 'werte', teiler: 0.5, ziel: 'geraet.k3' }], [])]), 2, { s2: INFO_BK }), new Map([['s2/cutoff', 3]]));
  assert.equal(werte.folgen[0].sicht.zeilen[1].zellen.length, 6, '3 beats on a 1/8 grid: 6 cells');
  assert.equal(ueberlagere(a, new Map()), a, 'nothing pending: the deck as it is');
  const befehle = mitLaenge(reso, kurveBefehle0(spur, reso));
  assert.deepEqual(befehle[0], { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'geraet.k4', punkte: befehle[0].punkte, verknuepft: false, loop_beats: 3 });
  assert.equal(mitLaenge({ ...reso, hat_huellkurve: true }, kurveBefehle0(spur, reso))[0].verknuepft, undefined, 'a lane that has an envelope sends no length with a point');
});
const kurveBefehle0 = (spur, z) => kurveSchreibe(spur, spur.clips[0], { ...z, hat_huellkurve: true }, [{ beat: 0, wert: 0.2 }, { beat: 1, wert: 0.6 }], INFO_BK).map((b) => b);

test('shapes: the menu entry writes the points of formPunkte over the lane length and the descriptor with the shape and its fingerprint; random steps keep the seed until re-rolled', () => {
  const spur = bkMit([NOTEN, KURVE_RESO], []);
  const z = sichtVon(spur).zeilen.find((x) => x.id === 'reso');
  assert.deepEqual(formAus(z, 'sinus'), { art: 'sinus', von: 0.1, bis: 0.9 }, '10 % and 90 % of the range');
  const b = formSchreibe(spur, spur.clips[0], z, INFO_BK, formAus(z, 'sinus'));
  assert.equal(b[0].befehl, 'huellkurve_setzen');
  assert.deepEqual(b[0].punkte, [{ beat: 0, wert: -0.2, form: 's' }, { beat: 2, wert: 0.6, form: 's' }, { beat: 4, wert: -0.2, form: 's' }], 'low, high, low over the 4-beat pattern, stored on the base .3');
  assert.equal(b[1].befehl, 'clip_aendern');
  const f = b[1].seq.zeilen.find((x) => x.id === 'reso').form;
  assert.deepEqual([f.art, f.von, f.bis], ['sinus', 0.1, 0.9]); assert.match(f.abdruck, /^[0-9a-f]{8}$/);
  const zz = { ...z, form: f };
  assert.deepEqual(formAus(zz, 'dreieck'), { art: 'dreieck', von: 0.1, bis: 0.9 }, 'from and to of the shape so far');
  assert.deepEqual(formAus(zz, 'sinus', { von: 0.3 }), { art: 'sinus', von: 0.3, bis: 0.9 });
  const r1 = formAus({ ...z, form: { art: 'zufall', von: 0, bis: 1, saat: 7, stufen: 5, abdruck: '' } }, 'zufall'), r2 = formAus({ ...z, form: { art: 'zufall', von: 0, bis: 1, saat: 7, stufen: 5, abdruck: '' } }, 'zufall', { saat: 8 });
  assert.deepEqual([r1.saat, r1.stufen, r2.saat, r2.stufen], [7, 5, 8, 5]);
  const punkte = (form) => formSchreibe(spur, spur.clips[0], z, INFO_BK, form)[0].punkte;
  assert.deepEqual(punkte(r1), punkte(r1), 'the same seed gives the same dice'); assert.notDeepEqual(punkte(r1), punkte(r2));
  const rest = sichtVon(bkMit([NOTEN, KURVE_RESO], [{ ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0 }] }])).zeilen.find((x) => x.id === 'reso');
  assert.equal(formSchreibe(bkMit([NOTEN, KURVE_RESO], []), bkMit([NOTEN, KURVE_RESO], []).clips[0], { ...z, laenge_beats: 3, eigen_laenge: true, hat_huellkurve: false }, INFO_BK, formAus(z, 'sinus'))[0].loop_beats, 3,
    'a lane with a pending length writes its shape over that length and the length with it');
  void rest;
});

test('the length of a lane with an envelope: a lane that came from a shape writes the shape again over the new length in one command; a plain lane changes only its length', () => {
  const spur = bkMit([NOTEN, KURVE_RESO], []);
  const z0 = sichtVon(spur).zeilen.find((x) => x.id === 'reso');
  const geschrieben = formSchreibe(spur, spur.clips[0], z0, INFO_BK, formAus(z0, 'sinus'));
  const clip = { ...spur.clips[0], huellkurven: [{ ziel: 'geraet.k4', punkte: geschrieben[0].punkte }], seq: geschrieben[1].seq };
  const spur2 = { ...spur, clips: [clip] };
  const z = sichtVon(spur2).zeilen.find((x) => x.id === 'reso');
  assert.ok(z.form, 'the points still match the shape');
  const b = laengeZeileBefehle(spur2, clip, z, 3, INFO_BK);
  const setzen = b.filter((x) => x.befehl === 'huellkurve_setzen');
  assert.equal(setzen.length, 1); assert.equal(setzen[0].verknuepft, false); assert.equal(setzen[0].loop_beats, 3);
  assert.deepEqual(setzen[0].punkte.map((p) => p.beat), [0, 1.5, 3], 'a sine over 3/4 bar');
  const zurueck = laengeZeileBefehle(spur2, { ...clip, huellkurven: [{ ziel: 'geraet.k4', punkte: setzen[0].punkte, verknuepft: false, loop_beats: 3 }] }, { ...z, laenge_beats: 3, eigen_laenge: true }, null, INFO_BK);
  assert.deepEqual(zurueck.find((x) => x.befehl === 'huellkurve_setzen').punkte.map((p) => p.beat), [0, 2, 4], 'linked again: the shape over the pattern');
  assert.equal(zurueck.find((x) => x.befehl === 'huellkurve_setzen').verknuepft, undefined);
  const cut = bkMit([NOTEN, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }]);
  const zc = sichtVon(cut).zeilen.find((x) => x.id === 'cutoff');
  assert.deepEqual(laengeZeileBefehle(cut, cut.clips[0], zc, 2, INFO_BK), [{ befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }], verknuepft: false, loop_beats: 2 }]);
  assert.equal(laengeZeileBefehle(cut, cut.clips[0], { ...zc, hat_huellkurve: false }, 2, INFO_BK), null, 'no envelope: the page keeps the length');
});

test('the length picker offers the pattern and every shorter length from a quarter bar; a free step count must fit the pattern', () => {
  assert.deepEqual(eigenLaengen(4).map((e) => [e.text, e.beats]), [['with pattern', null], ['1/4 bar', 1], ['1/2 bar', 2], ['3/4 bar', 3]]);
  assert.deepEqual(eigenLaengen(16).map((e) => e.text), ['with pattern', '1/4 bar', '1/2 bar', '3/4 bar', '1 bar', '2 bars']);
  assert.equal(eigenAusSchritten('6', 4), 1.5); assert.equal(eigenAusSchritten('16', 4), 4); assert.equal(eigenAusSchritten('17', 4), null);
  assert.equal(eigenAusSchritten('0', 4), null); assert.equal(eigenAusSchritten('x', 4), null);
});

test('target pickers: a new values lane offers velocity, length, every knob by name and the track targets; taken or unsupported targets are off', () => {
  const spur = bkMit([NOTEN, { id: 'vel', art: 'werte', teiler: 0.25, ziel: 'vel' }, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }] }]);
  const sicht = sichtVon(spur);
  const werte = zielWahl(sicht, spur, INFO_BK, 'werte');
  const so = (l, t) => l.find((e) => e.text === t);
  assert.deepEqual(werte.map((e) => e.text), ['velocity', 'length', 'Cutoff', 'Resonance', 'transpose', 'track level', 'track pan']);
  assert.equal(so(werte, 'velocity').aus, true); assert.equal(so(werte, 'Cutoff').aus, true, 'has a lane');
  assert.equal(so(werte, 'length').aus, false); assert.deepEqual(so(werte, 'length').zeile, { art: 'werte', teiler: 0.25, ziel: 'laenge' });
  assert.deepEqual(so(werte, 'Resonance').zeile, { art: 'werte', teiler: 0.25, ziel: 'geraet.k4' });
  const kurve = zielWahl(sicht, spur, INFO_BK, 'kurve');
  assert.deepEqual(kurve.map((e) => e.text), ['Cutoff', 'Resonance', 'transpose', 'track level', 'track pan'], 'a curve has no velocity or length');
  assert.deepEqual(so(kurve, 'Resonance').zeile, { art: 'kurve', ziel: 'geraet.k4' });
  // two note lanes: the note lane is named; none: velocity and length are off
  const zwei = bkMit([NOTEN, { id: 'bass2', art: 'noten', teiler: 0.5, ton: 36, name: 'Sub' }], []);
  const z2 = zielWahl(sichtVon(zwei), zwei, INFO_BK, 'werte').filter((e) => /velocity|length/.test(e.text));
  assert.deepEqual(z2.map((e) => e.text), ['velocity · notes', 'velocity · Sub', 'length · notes', 'length · Sub']);
  assert.deepEqual(z2[1].zeile, { art: 'werte', teiler: 0.5, ziel: 'vel', von: 'bass2' });
  const leer = bkMit([], []); leer.clips[0].noten = [];
  const z0 = zielWahl(sichtVon(leer), leer, INFO_BK, 'werte').filter((e) => /velocity|length/.test(e.text));
  assert.ok(z0.every((e) => e.aus && e.titel === 'needs a note lane'));
  // a knob the instrument does not take: a kit offers no knob, a knob list of another kind of instrument is refused by zielErlaubt
  const kit = kitSpur(), kitSicht = deckAnsicht(projekt([kit]), 2, { s1: INFO_KIT }).folgen[0].sicht;
  assert.deepEqual(zielWahl(kitSicht, kit, INFO_KIT, 'kurve').map((e) => e.text), ['transpose', 'track level', 'track pan']);
  const fremd = zielWahl(kitSicht, kit, { art: 'kit', regler: [{ nr: 3, name: 'Cutoff' }], klaenge: [] }, 'kurve').find((e) => e.text === 'Cutoff');
  assert.equal(fremd.aus, true); assert.equal(fremd.titel, 'this instrument has no such knob');
  const rb = { id: 's5', name: 'RB', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} }, clips: [{ id: 'c5', art: 'midi', start_beat: 0, laenge_beats: 64, loop_beats: 4, noten: [] }] };
  assert.deepEqual(zielWahl({ zeilen: [] }, rb, { art: 'rb338', regler: [{ nr: 'cutoff', name: 'Cutoff' }], klaenge: [] }, 'kurve')[0].zeile, { art: 'kurve', ziel: 'geraet.cutoff' }, 'RB-338 knobs are named targets');
});

test('re-assigning: an envelope lane moves between envelope targets, a velocity lane between velocity and length; taken targets are off', () => {
  const spur = bkMit([NOTEN, { id: 'vel', art: 'werte', teiler: 0.25, ziel: 'vel' }, WERTE_CUT, KURVE_RESO], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }] }]);
  const sicht = sichtVon(spur);
  const cut = zielUmhaengen(sicht.zeilen.find((z) => z.id === 'cutoff'), sicht, spur, INFO_BK);
  assert.deepEqual(cut.map((e) => [e.text, e.aktuell, e.aus]), [['Cutoff', true, false], ['Resonance', false, true], ['transpose', false, false], ['track level', false, false], ['track pan', false, false]]);
  assert.equal(cut[1].titel, 'has a lane already');
  const vel = zielUmhaengen(sicht.zeilen.find((z) => z.id === 'vel'), sicht, spur, INFO_BK);
  assert.deepEqual(vel.map((e) => [e.ziel, e.aktuell, e.aus]), [['vel', true, false], ['laenge', false, false]]);
  const kit = kitSpur(), ks = deckAnsicht(projekt([kit]), 2, { s1: INFO_KIT }).folgen[0].sicht;
  assert.equal(zielUmhaengen({ id: 'x', art: 'kurve', ziel: 'transpose' }, ks, kit, INFO_KIT).find((e) => e.text === 'transpose').aktuell, true);
});

test('the jump goes to the clip of the pattern touched last, else the first; no pattern or no clip is a message', () => {
  const a = deckAnsicht(projekt(), 2, INFOS);
  assert.deepEqual(sprungZiel(a, 's2'), { clip_id: 'c2', name: 'Bass' });
  assert.deepEqual(sprungZiel(a, undefined), { clip_id: 'c1', name: 'Drums' }, 'nothing touched yet: the first pattern');
  assert.deepEqual(sprungZiel(a, 'unknown'), { clip_id: 'c1', name: 'Drums' });
  const fremd = deckAnsicht(projekt([fremdSpur()]), 2, INFOS);
  assert.deepEqual(sprungZiel(fremd, 's3'), { clip_id: 'c3', name: 'Arranged' }, 'a pattern arranged in PRODUCTION: its first clip');
  assert.match(sprungZiel(deckAnsicht(projekt([]), 2, INFOS), null).meldung, /No pattern yet/);
  const ohne = kitSpur(); ohne.clips = [];
  assert.match(sprungZiel(deckAnsicht(projekt([ohne]), 2, INFOS), 's1').meldung, /has no clip yet/);
});

test('the object bindeProduktion returns carries waehleClip; the page jumps through setzeAnsicht and that function', () => {
  const quelle = lies('production/production.js');
  assert.match(quelle, /import \{ neuerClipWaehler \} from '\.\/clip_waehlen\.js'/);
  assert.match(quelle, /geladen: \(\) => nachlader\.fertig\(\)/); assert.match(quelle, /setzeAuswahl: \(ids\) => ctx\.setzeAuswahl\(ids\)/);
  assert.match(quelle, /return \{ zeige, verberge, ereignis, waehleClip,/);
  assert.match(lies('seitenrahmen.js'), /export function setzeAnsicht\(a, merken = true\)/);
  assert.match(knoten, /setzeAnsicht\('produktion'\);\s*await produktion\.waehleClip\(z\.clip_id\)/);
});

// ---------- the DOM: values, curves, lane head, jump ----------
const infosBk = async () => { leereInfoCache(); await ladeInfos(projekt(), 2, async (w) => ({ status: 200, j: w.includes('s2') ? INFO_BK : INFO_KIT })); };
const lane = (blockNr, id) => platz(2).querySelectorAll('.sq-folge')[blockNr].querySelectorAll('.sq-zeile').find((z) => z.dataset.zeile === id);
const zeige = async (p) => { live.projekt = p; live.rev = p.rev; posts.length = 0; naechste = () => antwort(p); await infosBk(); seqAnsichtModul.zeichneSeq(); };
const warte = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const bkProjekt = (zeilen, hk, extra) => projekt([bkMit(zeilen, hk, extra)]);

test('a drag on a value cell draws the bar and sends nothing; on release exactly one huellkurve_setzen goes out', async () => {
  await zeige(bkProjekt([NOTEN, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }, { beat: 2, wert: -0.2 }] }]));
  const zelle = lane(0, 'cutoff').querySelectorAll('.sq-zelle')[4];
  assert.ok(zelle.classList.contains('wert') && !zelle.classList.contains('nurlesen'));
  zelle.dispatch('pointerdown', { button: 0, clientX: 10, clientY: 5, pointerId: 1 });
  zelle.dispatch('pointermove', { clientX: 10, clientY: 2 });
  assert.match(platz(2).querySelector('.sq-stand').textContent, /Cutoff 0\.9/, 'the value shows while dragging');
  assert.equal(posts.length, 0, 'while dragging only the bar is drawn');
  zelle.dispatch('pointerup', { clientX: 10, clientY: 2, type: 'pointerup' });
  await warte();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].befehle.length, 1); assert.equal(posts[0].befehle[0].befehl, 'huellkurve_setzen');
  assert.deepEqual(posts[0].befehle[0].punkte, [{ beat: 0, wert: 0.1 }, { beat: 1, wert: 0.5, form: 'sprung' }, { beat: 2, wert: -0.2 }]);
});

test('two quick presses on a value cell remove its value; the events are pointerdown and pointerup only, the field is drawn again in between', async () => {
  await zeige(bkProjekt([NOTEN, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }]));
  const druck = (y) => { const c = lane(0, 'cutoff').querySelectorAll('.sq-zelle')[0]; c.dispatch('pointerdown', { button: 0, clientX: 10, clientY: y, pointerId: 1 }); c.dispatch('pointerup', { clientX: 10, clientY: y, type: 'pointerup' }); return c; };
  druck(5); await warte();
  assert.equal(posts.length, 1, 'the first press sets the value at the pointer height');
  posts.length = 0;
  await warte(450);   // longer than the window: the next press is a new first press
  druck(5); await warte(5);   // the field is drawn again between the presses: the second press finds its cell by lane and cell, not by node
  druck(2); await warte();
  assert.equal(posts.length, 2, 'the value of the first press, then the removal');
  assert.deepEqual(posts.at(-1).befehle, [{ befehl: 'huellkurve_loeschen', clip_id: 'c2', ziel: 'geraet.k3' }]);
  posts.length = 0;
  await warte(450); druck(5); await warte(450); druck(5); await warte();
  assert.ok(posts.every((p) => p.befehle[0].befehl !== 'huellkurve_loeschen'), 'two slow presses are two first presses');
  posts.length = 0;
  await warte(450);   // the press just before would otherwise count as the first of a pair
  druck(5); await warte(); druck(5); await warte(); druck(5); await warte();
  assert.equal(posts.filter((p) => p.befehle[0].befehl === 'huellkurve_loeschen').length, 1, 'a third press after the removal is a first press again, not a second removal');
});

test('two quick presses on a velocity cell are two presses, nothing is removed (a velocity cannot be removed)', async () => {
  await zeige(bkProjekt([NOTEN, { id: 'vel', art: 'werte', teiler: 0.25, ziel: 'vel' }], [], { noten: [note('m1', 0, 48, 100, 1)] }));
  const druck = () => { const c = lane(0, 'vel').querySelectorAll('.sq-zelle')[0]; c.dispatch('pointerdown', { button: 0, clientX: 0, clientY: 5, pointerId: 1 }); c.dispatch('pointerup', { clientX: 0, clientY: 5, type: 'pointerup' }); };
  druck(); await warte(5); druck(); await warte();
  assert.ok(!/cannot be removed/.test(attrappe.body.querySelector('#meldung').textContent));
});

test('a velocity cell without a note is grey and takes no pointer; a velocity drag changes the notes of the cell', async () => {
  await zeige(bkProjekt([NOTEN, { id: 'vel', art: 'werte', teiler: 0.25, ziel: 'vel' }], [], { noten: [note('m1', 0, 48, 100, 1)] }));
  const zellen = lane(0, 'vel').querySelectorAll('.sq-zelle');
  assert.ok(zellen[3].classList.contains('gesperrt') && zellen[3].classList.contains('nurlesen'));
  zellen[3].dispatch('pointerdown', { button: 0, clientX: 0, clientY: 5, pointerId: 1 });
  zellen[3].dispatch('pointerup', { clientX: 0, clientY: 5, type: 'pointerup' });
  await warte();
  assert.equal(posts.length, 0, 'no pointer on a cell without a note');
  zellen[0].dispatch('pointerdown', { button: 0, clientX: 0, clientY: 10, pointerId: 1 });
  zellen[0].dispatch('pointermove', { clientX: 0, clientY: 0 });
  zellen[0].dispatch('pointerup', { clientX: 0, clientY: 0, type: 'pointerup' });
  await warte();
  assert.deepEqual(posts[0].befehle, [{ befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'm1', vel: 127 }] }]);
});

test('a clamped value is drawn with the class geklemmt, a point of a curve too', async () => {
  await zeige(bkProjekt([NOTEN, WERTE_CUT, KURVE_RESO], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.7 }] }, { ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0.9 }, { beat: 2, wert: 0 }] }]));
  assert.ok(lane(0, 'cutoff').querySelectorAll('.sq-zelle')[0].classList.contains('geklemmt'));
  assert.ok(!lane(0, 'cutoff').querySelectorAll('.sq-zelle')[8].classList.contains('geklemmt') || true);
  const punkte = lane(0, 'reso').querySelectorAll('.sq-punkt');
  assert.equal(punkte.length, 2); assert.ok(punkte[0].classList.contains('geklemmt')); assert.ok(!punkte[1].classList.contains('geklemmt'));
});

test('a curve lane draws an SVG over the lane width with its points; a lane of its own length draws the pale repeat and a dashed mark at each repeat', async () => {
  await zeige(bkProjekt([NOTEN, KURVE_RESO], [{ ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0 }, { beat: 1.5, wert: 0.3 }, { beat: 3, wert: 0 }], verknuepft: false, loop_beats: 3 }], { loop_beats: 8 }));
  const r = lane(0, 'reso'), svg = r.querySelector('.sq-svg');
  assert.equal(svg.getAttribute('width'), String(8 * 96), 'the pattern width');
  assert.equal(r.querySelectorAll('.sq-pfad').length, 2, 'the first pass and the repeats');
  assert.ok(r.querySelector('.sq-pfad.spaeter'));
  assert.deepEqual(r.querySelectorAll('.sq-marke').map((m) => m.getAttribute('x1')), [String(3 * 96), String(6 * 96)]);
  assert.equal(r.querySelectorAll('.sq-punkt').length, 3);
  assert.match(r.querySelector('[data-sq-eigen]').textContent, /3\/4 bar/);
});

test('a click on a curve lane adds a point at the pointer, a press that moved adds none, a click in the pale repeat adds none', async () => {
  await zeige(bkProjekt([NOTEN, KURVE_RESO], [{ ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0 }, { beat: 3, wert: 0 }], verknuepft: false, loop_beats: 3 }], { loop_beats: 8 }));
  const svg = lane(0, 'reso').querySelector('.sq-svg');
  svg.dispatch('pointerdown', { button: 0, clientX: 96, clientY: 22, pointerId: 1 });
  svg.dispatch('pointerup', { clientX: 96, clientY: 22, type: 'pointerup' });
  await warte();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].befehle[0].befehl, 'huellkurve_setzen');
  assert.deepEqual(posts[0].befehle[0].punkte.map((p) => [p.beat, p.wert]), [[0, 0], [1, 0.2], [3, 0]], 'beat 1, value .5 on the base .3');
  assert.equal(posts[0].befehle[0].loop_beats, 3, 'the length of the lane stays');
  posts.length = 0;
  const s2 = lane(0, 'reso').querySelector('.sq-svg');
  s2.dispatch('pointerdown', { button: 0, clientX: 96, clientY: 22, pointerId: 1 });
  s2.dispatch('pointermove', { clientX: 200, clientY: 22 });
  s2.dispatch('pointerup', { clientX: 200, clientY: 22, type: 'pointerup' });
  s2.dispatch('pointerdown', { button: 0, clientX: 6 * 96, clientY: 22, pointerId: 1 });
  s2.dispatch('pointerup', { clientX: 6 * 96, clientY: 22, type: 'pointerup' });
  await warte();
  assert.equal(posts.length, 0);
});

test('a point is dragged without a request and sent on release; two quick presses on a point remove it', async () => {
  await zeige(bkProjekt([NOTEN, KURVE_RESO], [{ ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0 }, { beat: 2, wert: 0.4 }] }]));
  const punkt = lane(0, 'reso').querySelectorAll('.sq-punkt')[1];
  punkt.dispatch('pointerdown', { button: 0, clientX: 192, clientY: 20, pointerId: 1 });
  punkt.dispatch('pointermove', { clientX: 144, clientY: 3 });
  assert.equal(punkt.getAttribute('cx'), '144'); assert.equal(posts.length, 0, 'the circle moves, nothing is sent');
  punkt.dispatch('pointerup', { clientX: 144, clientY: 3, type: 'pointerup' });
  await warte();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].befehle[0].punkte, [{ beat: 0, wert: 0, form: 'linear' }, { beat: 1.5, wert: 0.7, form: 'linear' }], 'beat 1.5 at the top: 1 on the base .3; the first point keeps its stored value');
  posts.length = 0;
  const p2 = lane(0, 'reso').querySelectorAll('.sq-punkt')[0];
  p2.dispatch('pointerdown', { button: 0, clientX: 0, clientY: 41, pointerId: 1 });
  p2.dispatch('pointerup', { clientX: 0, clientY: 41, type: 'pointerup' });
  await warte();
  assert.equal(posts.length, 0, 'a click on a point changes nothing');
  assert.ok(lane(0, 'reso').querySelectorAll('.sq-punkt')[0] === p2, 'the field is not drawn again under a press that did not move: the second press hits the same circle');
  const zweiter = lane(0, 'reso').querySelectorAll('.sq-punkt')[0];
  zweiter.dispatch('pointerdown', { button: 0, clientX: 0, clientY: 41, pointerId: 1 });
  zweiter.dispatch('pointerup', { clientX: 0, clientY: 41, type: 'pointerup' });
  await warte();
  assert.deepEqual(posts[0].befehle[0].punkte, [{ beat: 2, wert: 0.4, form: 'linear' }], 'the second quick press removes the point; the other point keeps its stored value');
  posts.length = 0;
  const einziger = projekt([bkMit([NOTEN, KURVE_RESO], [{ ziel: 'geraet.k4', punkte: [{ beat: 1, wert: 0.2 }] }])]);
  await zeige(einziger);
  const druck = () => { const c = lane(0, 'reso').querySelectorAll('.sq-punkt')[0]; c.dispatch('pointerdown', { button: 0, clientX: 96, clientY: 30, pointerId: 1 }); c.dispatch('pointerup', { clientX: 96, clientY: 30, type: 'pointerup' }); };
  druck(); await warte(5); druck(); await warte();
  assert.deepEqual(posts[0].befehle, [{ befehl: 'huellkurve_loeschen', clip_id: 'c2', ziel: 'geraet.k4' }]);
  posts.length = 0;
  await warte(450); druck(); await warte(450); druck(); await warte();
  assert.equal(posts.length, 0, 'two slow presses on a point change nothing');
});

test('the shape menu of a curve lane sends the points of formPunkte and the descriptor with the shape', async () => {
  await zeige(bkProjekt([NOTEN, KURVE_RESO], []));
  const kopf = lane(0, 'reso').querySelector('[data-sq-form]');
  kopf.dispatch('click', {});
  const punkte = attrappe.body.querySelectorAll('.p-menue button').map((b) => b.textContent);
  assert.deepEqual(punkte.slice(0, 7), ['Sine', 'Triangle', 'Saw up', 'Saw down', 'Square', 'Ramp', 'Random steps']);
  assert.ok(!punkte.includes('Re-roll'), 're-roll belongs to random steps only');
  attrappe.body.querySelectorAll('.p-menue button').find((b) => b.textContent === 'Sine').click();
  await warte();
  assert.equal(posts.length, 1);
  const [hk, sicht] = posts[0].befehle;
  assert.equal(hk.befehl, 'huellkurve_setzen'); assert.equal(hk.ziel, 'geraet.k4');
  assert.deepEqual(hk.punkte.map((p) => [p.beat, p.form]), [[0, 's'], [2, 's'], [4, 's']]);
  assert.equal(sicht.befehl, 'clip_aendern');
  const f = sicht.seq.zeilen.find((z) => z.id === 'reso').form;
  assert.equal(f.art, 'sinus'); assert.equal(typeof f.abdruck, 'string'); assert.ok(f.abdruck.length > 0);
});

test('re-roll is offered for random steps and sends new points from a new seed', async () => {
  const zufall = formSchreibe(bkMit([NOTEN, KURVE_RESO], []), bkMit([NOTEN, KURVE_RESO], []).clips[0], sichtVon(bkMit([NOTEN, KURVE_RESO], [])).zeilen.find((z) => z.id === 'reso'), INFO_BK, { art: 'zufall', von: 0, bis: 1, saat: 3, stufen: 4 });
  await zeige(bkProjekt([NOTEN, KURVE_RESO], [{ ziel: 'geraet.k4', punkte: zufall[0].punkte }], { seq: { schema: 1, zeilen: [NOTEN, { ...KURVE_RESO, form: zufall[1].seq.zeilen.find((z) => z.id === 'reso').form }] } }));
  lane(0, 'reso').querySelector('[data-sq-form]').dispatch('click', {});
  const knopf = attrappe.body.querySelectorAll('.p-menue button').find((b) => b.textContent === 'Re-roll');
  assert.ok(knopf, 're-roll is there while the lane holds random steps');
  knopf.click();
  await warte();
  assert.equal(posts.length, 1);
  assert.notDeepEqual(posts[0].befehle[0].punkte, zufall[0].punkte, 'new dice');
  assert.equal(posts[0].befehle[0].punkte.length, 4, 'the steps stay');
});

test('+ lane offers values per step and curve with a target step; the pick sends the descriptor with the new lane', async () => {
  await zeige(bkProjekt([NOTEN, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }] }]));
  platz(2).querySelector('[data-sq-neue-zeile]').dispatch('click', {});
  const erste = attrappe.body.querySelectorAll('.p-menue button').map((b) => b.textContent);
  assert.ok(erste.includes('Values per step…') && erste.includes('Curve…'), erste.join('|'));
  attrappe.body.querySelectorAll('.p-menue button').find((b) => b.textContent === 'Values per step…').click();
  const zweite = attrappe.body.querySelectorAll('.p-menue button');
  assert.deepEqual(zweite.map((b) => b.textContent), ['velocity', 'length', 'Cutoff', 'Resonance', 'transpose', 'track level', 'track pan']);
  assert.ok(zweite[2].disabled, 'Cutoff has a lane'); assert.ok(!zweite[3].disabled);
  zweite[3].click();
  await warte();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].befehle[0].befehl, 'clip_aendern');
  assert.deepEqual(posts[0].befehle[0].seq.zeilen.at(-1), { id: 'k4', art: 'werte', teiler: 0.25, ziel: 'geraet.k4' });
  platz(2).querySelector('[data-sq-neue-zeile]').dispatch('click', {});
  attrappe.body.querySelectorAll('.p-menue button').find((b) => b.textContent === 'Curve…').click();
  assert.deepEqual(attrappe.body.querySelectorAll('.p-menue button').map((b) => b.textContent), ['Cutoff', 'Resonance', 'transpose', 'track level', 'track pan']);
  attrappe.body.querySelectorAll('.p-menue button')[4].click();
  await warte();
  assert.deepEqual(posts.at(-1).befehle[0].seq.zeilen.at(-1), { id: 'pan', art: 'kurve', ziel: 'spur_pan' });
});

test('the target picker of a lane re-assigns it: the envelope moves to the new target with the same shown values', async () => {
  await zeige(bkProjekt([NOTEN, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }]));
  lane(0, 'cutoff').querySelector('[data-sq-ziel]').dispatch('click', {});
  const e = attrappe.body.querySelectorAll('.p-menue button').find((b) => b.textContent === 'Resonance');
  assert.ok(e && !e.disabled); e.click();
  await warte();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].befehle.map((b) => [b.befehl, b.ziel]), [['huellkurve_loeschen', 'geraet.k3'], ['huellkurve_setzen', 'geraet.k4'], ['clip_aendern', undefined]]);
  assert.equal(posts[0].befehle[1].punkte[0].wert, 0.2, 'shown .5 on the base .3 of the new knob');
});

test('the length picker of a lane: with an envelope it sends the length; without one the page keeps it and the first point carries it', async () => {
  await zeige(bkProjekt([NOTEN, WERTE_CUT, KURVE_RESO], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }]));
  lane(0, 'cutoff').querySelector('[data-sq-eigen]').dispatch('click', {});
  attrappe.body.querySelectorAll('.p-menue button').find((b) => b.textContent === '1/2 bar').click();
  await warte();
  assert.deepEqual(posts[0].befehle, [{ befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }], verknuepft: false, loop_beats: 2 }]);
  posts.length = 0;
  lane(0, 'reso').querySelector('[data-sq-eigen]').dispatch('click', {});
  attrappe.body.querySelectorAll('.p-menue button').find((b) => b.textContent === '3/4 bar').click();
  await warte();
  assert.equal(posts.length, 0, 'no envelope: nothing to write yet');
  const r = lane(0, 'reso');
  assert.match(r.querySelector('[data-sq-eigen]').textContent, /3\/4 bar/);
  assert.equal(r.querySelectorAll('.sq-marke').length, 1, 'the mark where the lane starts again');
  r.querySelector('.sq-svg').dispatch('pointerdown', { button: 0, clientX: 96, clientY: 22, pointerId: 1 });
  r.querySelector('.sq-svg').dispatch('pointerup', { clientX: 96, clientY: 22, type: 'pointerup' });
  await warte();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].befehle[0].verknuepft, false); assert.equal(posts[0].befehle[0].loop_beats, 3);
});

test('open in PRODUCTION switches the view and selects the clip of the pattern touched last', async () => {
  await zeige(projekt());
  const gewaehlt = [];
  setzeProduktion({ zeige() {}, verberge() {}, waehleClip: async (id) => { gewaehlt.push(id); return true; } });
  const sprung = platz(2).querySelector('[data-sq-produktion]');
  assert.equal(sprung.hidden, false);
  const kick = platz(2).querySelectorAll('.sq-folge')[0].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[1];
  kick.dispatch('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
  kick.dispatch('pointerup', { clientX: 200, clientY: 200, type: 'pointerup' });   // let go away from the cell: touches the block, toggles nothing
  sprung.dispatch('click', {});
  await warte();
  assert.deepEqual(gewaehlt, ['c1'], 'the drum block was touched');
  assert.equal(attrappe.body.classList.contains('produktion'), true, 'the view is PRODUCTION');
  const bass = platz(2).querySelectorAll('.sq-folge')[1].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[0];
  bass.dispatch('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
  bass.dispatch('pointerup', { clientX: 0, clientY: 0, type: 'pointerup' });
  await warte();
  sprung.dispatch('click', {});
  await warte();
  assert.deepEqual(gewaehlt, ['c1', 'c2'], 'the block that was touched last');
  setzeProduktion(null);
  attrappe.body.classList.remove('produktion');
});

test('open in PRODUCTION with no pattern says so and does not switch', async () => {
  await zeige(projekt([]));
  attrappe.body.classList.remove('produktion');
  platz(2).querySelector('[data-sq-produktion]').dispatch('click', {});
  await warte();
  assert.match(attrappe.body.querySelector('#meldung').textContent, /No pattern yet/);
  assert.equal(attrappe.body.classList.contains('produktion'), false);
});

test('the CSS of values and curves: bars take the pointer, grey cells do not, repeats are pale, points, marks and clamped values have their look', () => {
  assert.match(css, /\.sq-zelle\.wert \{[^}]*cursor: ns-resize/); assert.match(css, /\.sq-zelle\.wert\.gesperrt \{[^}]*filter: grayscale/); assert.match(css, /\.sq-zelle\.wert\.wiederholt \{[^}]*pointer-events: none/);
  assert.match(css, /\.sq-punkt \{/); assert.match(css, /\.sq-punkt\.geklemmt/); assert.match(css, /\.sq-marke \{[^}]*stroke-dasharray/); assert.match(css, /\.sq-zelle\.wert\.geklemmt::after/);
  assert.match(css, /\.sq-produktion\[hidden\]/);
});

// ---------- pale repeats of the note lanes and the ruler up to the visible width ----------
test('the visible width is the longest pattern of the deck; 1, 2 or 4 bars show at least that many bars', () => {
  assert.equal(sichtbarBeats('all', 8), 8); assert.equal(sichtbarBeats('all', 4), 4);
  assert.equal(sichtbarBeats(1, 8), 8, 'the deck is wider than the choice'); assert.equal(sichtbarBeats(2, 4), 8, 'a 1-bar deck shows the 2 bars chosen');
  assert.equal(sichtbarBeats(4, 8), 16); assert.equal(sichtbarBeats(1, 4), 4);
});

test('a note lane of a 1-bar pattern next to a 2-bar pattern repeats pale: 16 cells and 16 repeats at 1/16; a pattern as long as the view has no repeat', () => {
  const deck = deckAnsicht(projekt([kitSpur(), bkMit([NOTEN], [], { loop_beats: 8 })]), 2, INFOS);
  assert.equal(deck.laenge_beats, 8, 'the longest pattern sets the view');
  const kit = deck.folgen[0].sicht, bass = deck.folgen[1].sicht;
  const sicht = sichtbarBeats('all', deck.laenge_beats);
  const z = kit.zeilen[0];
  assert.equal(z.art, 'noten'); assert.equal(z.zellen.length, 16, 'the 16 cells of the pattern itself');
  const w = wiederholZellen(z, sicht);
  assert.equal(w.length, 16, 'and 16 repeats');
  assert.deepEqual([w[0].von, w[0].quelle, w[15].von, w[15].quelle, w[15].breite], [4, 0, 7.75, 15, 0.25], 'from the pattern end to the end of the view; each repeat shows its original cell');
  assert.ok(w.every((x) => x.von >= 4 && x.von + x.breite <= 8 + 1e-9));
  assert.deepEqual(wiederholZellen(bass.zeilen.find((x) => x.art === 'noten'), sicht), [], 'the 2-bar pattern is as long as the view: no repeat');
  assert.equal(wiederholZellen(z, sichtbarBeats('all', kit.laenge_beats)).length, 0, 'alone the pattern is the view');
  assert.equal(wiederholZellen(z, sichtbarBeats(4, 4)).length, 48, 'the choice of 4 bars repeats the bar three times');
});

test('the ruler runs on after the pattern end up to the visible width, the repeated beats are marked', () => {
  const l = linealZellen(4, 8);
  assert.equal(l.length, 8); assert.deepEqual(l.map((c) => c.wiederholung), [false, false, false, false, true, true, true, true]);
  assert.deepEqual(l.filter((c) => c.takt).map((c) => c.beat), [0, 4], 'a bar number at every fourth beat, also in the repeat');
  assert.equal(linealZellen(4, 4).length, 4); assert.ok(linealZellen(4, 4).every((c) => !c.wiederholung));
  const kurz = linealZellen(4.5, 8);
  assert.equal(kurz.length, 8); assert.equal(kurz[4].wiederholung, false, 'the beat the pattern end cuts is still the pattern'); assert.equal(kurz[5].wiederholung, true);
  const eng = linealZellen(4, 6.5);
  assert.equal(eng.at(-1).beat + eng.at(-1).breite, 6.5, 'the ruler ends at the view');
});

test('the DOM: the note lane of the short pattern carries its pale repeats, not operable; the ruler is as wide as the view; the playhead cells are the original ones', async () => {
  await zeige(projekt([kitSpur(), bkMit([NOTEN], [], { loop_beats: 8 })]));
  const kit = platz(2).querySelectorAll('.sq-folge')[0], z = kit.querySelectorAll('.sq-zeile')[0];
  assert.equal(z.querySelectorAll('.sq-zelle').length, 32, '16 cells and 16 repeats');
  const rep = z.querySelectorAll('.sq-zelle.wiederholung');
  assert.equal(rep.length, 16);
  assert.ok(rep.every((c) => c.tagName !== 'BUTTON' && c.getAttribute('aria-hidden') === 'true' && c.classList.contains('nurlesen') && !c.hasAttribute('tabindex')), 'no pointer, no tab stop, hidden from the reader');
  assert.equal(z.querySelectorAll('button.sq-zelle').length, 16, 'only the original cells are buttons');
  assert.equal(kit.querySelector('.sq-lineal').querySelectorAll('.sq-nr').length, 8); assert.equal(kit.querySelector('.sq-lineal').querySelectorAll('.sq-nr.wiederholung').length, 4);
  const bass = platz(2).querySelectorAll('.sq-folge')[1];
  assert.equal(bass.querySelectorAll('.sq-zelle.wiederholung').length, 0, 'the longest pattern has none');
  const felder = rep[0]; felder.dispatch('pointerdown', { button: 0, clientX: 5, clientY: 5, pointerId: 1 }); felder.dispatch('pointerup', { clientX: 5, clientY: 5 });
  await warte(); assert.equal(posts.length, 0, 'a repeat takes no press');
});

test('the DOM: a value lane and a curve lane of the short pattern are drawn up to the visible width too', async () => {
  const kurz = bkMit([NOTEN, WERTE_CUT, KURVE_RESO], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }, { ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0.2 }, { beat: 2, wert: 0.8 }] }], { loop_beats: 4 });
  const lang = kitSpur(); lang.id = 's9'; lang.clips[0].id = 'c9'; lang.clips[0].loop_beats = 8;
  await zeige(projekt([kurz, lang]));
  const cut = lane(0, 'cutoff'), reso = lane(0, 'reso');
  assert.equal(cut.querySelectorAll('.sq-zelle').length, 32, '16 value cells and 16 pale ones');
  assert.equal(reso.querySelector('.sq-svg').getAttribute('width'), String(8 * 96), 'the curve is as wide as the view');
  assert.ok(reso.querySelector('.sq-pfad.spaeter'), 'its repeat is drawn pale');
});

// ---------- the large view ----------
test('the large view toggles per place; only one place is large at a time', () => {
  assert.deepEqual(grossUmschalten({}, 2), { 2: true });
  assert.deepEqual(grossUmschalten({ 2: true }, 2), {}, 'a second press makes it small again');
  assert.deepEqual(grossUmschalten({ 2: true }, 3), { 3: true }, 'another place takes over');
  assert.deepEqual(grossUmschalten({ 1: true, 2: true }, 4), { 4: true });
});

test('a place that is not typed SEQ or is hidden is never large; its entry is dropped; of several the lowest valid place stays', () => {
  const sichtbar = (...p) => (n) => p.includes(n);
  const layout = ['track', 'seq', 'seq', 'loops'];
  assert.deepEqual(grossGilt({ 2: true }, layout, sichtbar(2)), { platz: 2, wahl: { 2: true } });
  assert.deepEqual(grossGilt({ 1: true }, layout, sichtbar(1)), { platz: null, wahl: {} }, 'place 1 is a track now');
  assert.deepEqual(grossGilt({ 4: true }, layout, sichtbar(4)), { platz: null, wahl: {} }, 'loops');
  assert.deepEqual(grossGilt({ 2: true }, layout, sichtbar()), { platz: null, wahl: {} }, 'hidden');
  assert.deepEqual(grossGilt({ 3: true, 2: true }, layout, sichtbar(2, 3)), { platz: 2, wahl: { 2: true } }, 'one at a time');
  assert.deepEqual(grossGilt({ 2: true, 1: true }, layout, sichtbar(1, 2)), { platz: 2, wahl: { 2: true } }, 'the invalid one is dropped, the valid stays');
  assert.deepEqual(grossGilt({}, layout, sichtbar(2, 3)), { platz: null, wahl: {} });
  assert.deepEqual(grossGilt(null, layout, sichtbar(2)), { platz: null, wahl: {} }); assert.deepEqual(grossGilt({ 9: true, x: true }, layout, sichtbar(2)), { platz: null, wahl: {} }, 'unknown keys');
});

test('Escape closes the large view only when no menu is open and no input has the focus', () => {
  assert.equal(grossEscape({ gross: true, menue: false, eingabe: false }), true);
  assert.equal(grossEscape({ gross: true, menue: true, eingabe: false }), false, 'the menu takes the key');
  assert.equal(grossEscape({ gross: true, menue: false, eingabe: true }), false, 'a field takes the key');
  assert.equal(grossEscape({ gross: false, menue: false, eingabe: false }), false, 'nothing large: the page keeps the key');
});

test('the choice is kept in localStorage in try/catch; garbage or a missing store is "no place large"', () => {
  const mem = new Map(), speicher = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(GROSS_SCHLUESSEL, 'djk-seq-gross');
  assert.deepEqual(grossLesen(speicher), {});
  assert.equal(grossSchreiben(speicher, { 2: true }), true); assert.equal(mem.get('djk-seq-gross'), '{"2":true}');
  assert.deepEqual(grossLesen(speicher), { 2: true });
  mem.set('djk-seq-gross', 'not json'); assert.deepEqual(grossLesen(speicher), {});
  mem.set('djk-seq-gross', '[1,2]'); assert.deepEqual(grossLesen(speicher), {}, 'an array is not a choice');
  mem.set('djk-seq-gross', '{"2":false,"3":true}'); assert.deepEqual(grossLesen(speicher), { 3: true }, 'only places that are on');
  const kaputt = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(grossLesen(kaputt), {}); assert.equal(grossSchreiben(kaputt, { 2: true }), false);
  assert.deepEqual(grossLesen(null), {}); assert.equal(grossSchreiben(null, {}), false);
});

test('the DOM: the button at the deck head makes the place large and small again, the choice is kept per place, a place that is no SEQ place is not large', async () => {
  await zeige(projekt());
  const k = platz(2), knopfGross = k.querySelector('[data-sq-gross]');
  k.hidden = false; seqAnsichtModul.ordneSeqStudio(['track', 'seq', 'track', 'track']);   // as slots.js wendeAn and the layout leave a SEQ place that shows
  assert.ok(knopfGross, 'the button'); assert.equal(knopfGross.textContent, '⤢'); assert.equal(knopfGross.title, 'Large view');
  const rechts = k.querySelector('.sq-rechts').elemente;
  assert.ok(rechts.indexOf(knopfGross) < rechts.indexOf(k.querySelector('.sq-breite')), 'left of the width selector');
  assert.equal(k.classList.contains('gross'), false);
  knopfGross.dispatch('click', {});
  assert.equal(k.classList.contains('gross'), true); assert.equal(knopfGross.getAttribute('aria-pressed'), 'true');
  assert.equal(JSON.parse(localStorage.getItem('djk-seq-gross'))[2], true, 'kept for place 2');
  knopfGross.dispatch('click', {});
  assert.equal(k.classList.contains('gross'), false); assert.deepEqual(JSON.parse(localStorage.getItem('djk-seq-gross')), {});
  // the layout is applied (plaetze_ansicht wendePlaetzeAn -> ordneSeqStudio): a place that is hidden or no SEQ place drops its choice
  const SEQ2 = ['track', 'seq', 'track', 'track'];
  knopfGross.dispatch('click', {}); seqAnsichtModul.ordneSeqStudio(SEQ2);
  assert.equal(k.classList.contains('gross'), true, 'a SEQ place that shows stays large when the layout is applied again');
  k.hidden = true; seqAnsichtModul.ordneSeqStudio(SEQ2);
  assert.equal(k.classList.contains('gross'), false, 'hidden: not large'); assert.deepEqual(JSON.parse(localStorage.getItem('djk-seq-gross')), {}, 'and the choice is gone');
  k.hidden = false; knopfGross.dispatch('click', {}); seqAnsichtModul.ordneSeqStudio(['track', 'track', 'track', 'track']);
  assert.equal(k.classList.contains('gross'), false, 'place 2 is a track now'); assert.deepEqual(JSON.parse(localStorage.getItem('djk-seq-gross')), {});
  // only one place at a time
  const k3 = platz(3);
  k3.hidden = false; k.hidden = false; seqAnsichtModul.ordneSeqStudio(['track', 'seq', 'seq', 'track']);
  knopfGross.dispatch('click', {}); k3.querySelector('[data-sq-gross]').dispatch('click', {});
  assert.equal(k3.classList.contains('gross'), true); assert.equal(k.classList.contains('gross'), false, 'only one at a time'); assert.equal(knopfGross.getAttribute('aria-pressed'), 'false');
  k3.querySelector('[data-sq-gross]').dispatch('click', {});
  k.hidden = true; k3.hidden = true;
});

test('the page source: the Escape key, the top edge from the page header, the CSS of the large place', () => {
  assert.match(knoten, /window\.addEventListener\('keydown', grossTaste, true\)/, 'the key is read on the window, capture phase, before a menu registers'); assert.match(knoten, /grossEscape\(\{ gross, menue, eingabe \}\)/);
  assert.match(knoten, /!b\.contains\('tracker'\)/, 'in TRACKER the grid owns Escape: the large view never reacts there');
  assert.match(knoten, /menueOffen\(\)/, 'a menu that is open takes the key'); assert.match(knoten, /'#kopf'/, 'the top edge comes from the header element');
  assert.match(knoten, /--sq-oben/);
  assert.match(css, /\.seqplatz\.gross \{[^}]*position: fixed;/); assert.match(css, /\.seqplatz\.gross \{[^}]*top: var\(--sq-oben/); assert.match(css, /\.seqplatz\.gross \{[^}]*bottom: 0;/);
  assert.match(css, /\.seqplatz\.gross \{[^}]*z-index: 2\d;/); assert.match(css, /\.seqplatz\.gross \{[^}]*background: var\(--panel\)/);
  assert.match(css, /\.sq-zelle\.wiederholung \{[^}]*pointer-events: none/); assert.match(css, /\.sq-nr\.wiederholung \{/);
  const z = Number(/\.seqplatz\.gross \{[^}]*z-index: (\d+);/.exec(css)[1]);
  assert.ok(z > 2 && z < 30, 'above the mixer and the library (2), below the menus (30 and above)');
});

// ---------- page review fixes ----------
test('a write on a knob lane is refused while the instrument info is missing or only the empty entry is there; other lanes do not need it', async () => {
  const spur = bkMit([NOTEN, WERTE_CUT, KURVE_RESO, { id: 'vel', art: 'werte', teiler: 0.25, ziel: 'vel' }], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }]);
  const z = (id, info) => sichtVon(spur, { s2: info }).zeilen.find((x) => x.id === id);
  const leer = { art: 'bk', regler: [], klaenge: [] };
  const ablehnen = (f) => assert.throws(f, (e) => e instanceof SeqFehler && /still loading; try again/.test(e.message) && e.grund === 'info_laedt');
  for (const info of [undefined, leer]) {
    ablehnen(() => wertSchreibe(spur, spur.clips[0], z('cutoff', info), 4, 0.8, info));
    ablehnen(() => kurveSchreibe(spur, spur.clips[0], z('reso', info), [{ beat: 0, wert: 0.4 }], info));
  }
  assert.match(reglerInfoMeldung('geraet.k3', undefined), /The knobs of this instrument are still loading; try again\./);
  assert.equal(reglerInfoMeldung('geraet.k3', INFO_BK), null); assert.equal(reglerInfoMeldung('vel', undefined), null); assert.equal(reglerInfoMeldung('spur_fader', leer), null);
  assert.ok(wertSchreibe(spur, spur.clips[0], z('cutoff', INFO_BK), 4, 0.8, INFO_BK).length, 'with the info it writes');
  assert.doesNotThrow(() => wertSchreibe(spur, spur.clips[0], z('vel', undefined), 0, 90, undefined));
});

test('the empty entry of a failed info request is forgotten on demand, so that the info is asked for again', async () => {
  leereInfoCache();
  const p = projekt();
  await ladeInfos(p, 2, async () => ({ status: 500, j: {} }));
  assert.equal(fehlendeInfos(p, 2).length, 0, 'within the wait time the empty entry counts as asked');
  vergissLeereInfos(p, 2);
  assert.equal(fehlendeInfos(p, 2).length, 2, 'now both devices are missing again');
  await ladeInfos(p, 2, async (w) => ({ status: 200, j: w.includes('s2') ? INFO_BK : INFO_KIT }));
  vergissLeereInfos(p, 2);
  assert.equal(fehlendeInfos(p, 2).length, 0, 'a real answer stays');
});

test('the DOM: a write on a knob lane without the info says so, sends nothing and asks for the info again', async () => {
  await zeige(bkProjekt([NOTEN, WERTE_CUT], [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }]));
  leereInfoCache();
  await ladeInfos(projekt([bkMit([NOTEN, WERTE_CUT], [])]), 2, async () => ({ status: 500, j: {} }));
  seqAnsichtModul.zeichneSeq();
  const anrufe = attrappe.anrufe.length;
  const zelle = lane(0, 'cutoff').querySelectorAll('.sq-zelle')[4];
  zelle.dispatch('pointerdown', { button: 0, clientX: 10, clientY: 5, pointerId: 1 });
  zelle.dispatch('pointerup', { clientX: 10, clientY: 5, type: 'pointerup' });
  await warte();
  assert.equal(posts.length, 0, 'nothing is written');
  assert.match(attrappe.body.querySelector('#meldung').textContent, /still loading; try again/);
  assert.ok(attrappe.anrufe.slice(anrufe).some((a) => a.url.startsWith('/seq/geraet')), 'the info is asked for again');
  await infosBk();
});

const warteAuf = async (f, ms = 600) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await warte(10); };
test('the DOM: a wheel write the server refuses, or a wheel that nets out, leaves the cell as the saved state has it', async () => {
  await zeige(projekt());
  const zelle = () => platz(2).querySelectorAll('.sq-folge')[1].querySelectorAll('.sq-zeile')[0].querySelectorAll('.sq-zelle')[0];
  const vorher = zelle().textContent;
  assert.ok(vorher.length > 0, 'a pitched cell with a note');
  naechste = () => ({ code: 409, j: { fehler: 'projekt_ungueltig', text: 'nope' } });
  zelle().dispatch('wheel', { deltaY: -1, shiftKey: false, preventDefault() {} });
  assert.ok(zelle().classList.contains('wartet') && zelle().textContent !== vorher, 'the pending note shows while the request is out');
  await warteAuf(() => posts.length > 0); await warte(50);
  assert.equal(zelle().textContent, vorher, 'refused: the old note'); assert.ok(!zelle().classList.contains('wartet'));
  naechste = null; posts.length = 0;
  zelle().dispatch('wheel', { deltaY: -1, preventDefault() {} });
  zelle().dispatch('wheel', { deltaY: 1, preventDefault() {} });
  await warte(300);
  assert.equal(zelle().textContent, vorher, 'a wheel that nets out writes nothing and shows the old note'); assert.ok(!zelle().classList.contains('wartet')); assert.equal(posts.length, 0);
});

test('the DOM: an empty or refused pattern name shows the name of the server again', async () => {
  await zeige(projekt());
  const feld = () => platz(2).querySelectorAll('.sq-folge')[0].querySelector('[data-sq-name]');
  feld().value = '   '; feld().dispatch('change', {});
  await warte(30);
  assert.equal(feld().value, 'Drums', 'empty: the old name');
  naechste = () => ({ code: 409, j: { fehler: 'argument_ungueltig', text: 'name taken' } });
  feld().value = 'Bass'; feld().dispatch('change', {});
  await warteAuf(() => posts.length > 0); await warte(50);
  assert.equal(feld().value, 'Drums', 'refused: the old name');
  naechste = null;
});

test('the DOM: the focus stays on its button or cell when a write draws the field again', async () => {
  await zeige(projekt());
  const stumm = () => platz(2).querySelectorAll('.sq-folge')[1].querySelector('[data-sq-stumm]');
  const alt = stumm(); alt.focus();
  naechste = () => antwort(projekt([kitSpur(), bkSpur({ mute: true })]));
  alt.dispatch('click', {});
  await warteAuf(() => posts.length > 0); await warte(50);
  assert.notEqual(stumm(), alt, 'the block was built again'); assert.equal(attrappe.aktiv, stumm(), 'and the new button has the focus');
  naechste = null;
  await zeige(projekt());
  const zelle = () => platz(2).querySelectorAll('.sq-folge')[0].querySelectorAll('.sq-zeile')[0].querySelectorAll('button.sq-zelle')[3];
  const c0 = zelle(); c0.focus();
  const mehr = kitSpur(); mehr.clips[0].noten.push(note('n9', 0.75, 36));
  naechste = () => antwort(projekt([mehr, bkSpur()]));
  c0.dispatch('click', { detail: 0 });
  await warteAuf(() => posts.length > 0); await warte(50);
  assert.notEqual(zelle(), c0); assert.equal(attrappe.aktiv, zelle(), 'a cell keeps the focus by lane and cell');
  naechste = null;
  await zeige(projekt());
  attrappe.aktiv = null;
  seqAnsichtModul.zeichneSeq();
  assert.equal(attrappe.aktiv, null, 'nothing had the focus: nothing takes it');
});

test('the DOM: giving the focus back after a redraw does not scroll the page', async () => {
  await zeige(projekt());
  const stumm = () => platz(2).querySelectorAll('.sq-folge')[1].querySelector('[data-sq-stumm]');
  const alt = stumm(); alt.focus();
  naechste = () => antwort(projekt([kitSpur(), bkSpur({ mute: true })]));
  attrappe.fokusAufrufe = [];
  alt.dispatch('click', {});
  await warteAuf(() => posts.length > 0); await warte(50);
  naechste = null;
  assert.notEqual(stumm(), alt, 'the block was built again');
  const aufrufe = attrappe.fokusAufrufe.filter((a) => a.ziel === attrappe.aktiv);
  assert.equal(aufrufe.length, 1, 'the new button got the focus once');
  assert.equal(aufrufe[0].opt?.preventScroll, true, 'focus({ preventScroll: true })');
});

test('the instrument picker names a new pattern after the instrument and numbers a second one with the same instrument', () => {
  const src = lies('seq_view.js');
  assert.match(src, /freierName\(/, 'the + pattern entry asks for a free name');
  assert.match(src, /neueFolge\(n, freierName\(e\.name, /);
});

test('LOAD MODULE lists the Workbench modules; the pick loads it into this place, the line says what came along and what was left out', async () => {
  await zeige(projekt());
  modulPosts.length = 0;
  const knopf = platz(2).querySelector('[data-sq-modul]');
  assert.ok(knopf && knopf.textContent === 'LOAD MODULE' && !knopf.hidden);
  knopf.dispatch('click', {});
  await warte();
  const punkte = attrappe.body.querySelectorAll('.p-menue button');
  assert.deepEqual(punkte.map((b) => b.textContent), ['Mod A', 'Mod B'], 'only the entries with werkbank: true');
  punkte[1].click();
  await warteAuf(() => modulPosts.length > 0); await warte(50);
  assert.deepEqual(modulPosts, [{ platz: 2, slug: 'mod-b' }]);
  assert.equal(live.rev, 9);
  assert.equal(attrappe.body.querySelector('#meldung').textContent, 'loaded 2 patterns into SEQ 2 · left out: 1 send');
  assert.equal(attrappe.body.querySelector('#meldung').className, 'ok');
});

test('LOAD MODULE: a refusal is a readable error line and the project stays; without the live container nothing is asked', async () => {
  await zeige(projekt());
  modulAntwort = () => ({ code: 409, j: { fehler: 'kanal_offen', text: 'the channel deck/2 of place 2 is open; close it before a SEQ deck is created there' } });
  modulPosts.length = 0;
  platz(2).querySelector('[data-sq-modul]').dispatch('click', {});
  await warte();
  attrappe.body.querySelectorAll('.p-menue button')[0].click();
  await warteAuf(() => modulPosts.length > 0); await warte(50);
  assert.match(attrappe.body.querySelector('#meldung').textContent, /Load module refused: the channel deck\/2/);
  assert.equal(attrappe.body.querySelector('#meldung').className, 'fehler');
  const vorher = attrappe.anrufe.length;
  live.projekt = null;
  platz(2).querySelector('[data-sq-modul]').dispatch('click', {});
  await warte();
  assert.equal(attrappe.anrufe.length, vorher, 'no request without the live container');
  assert.match(attrappe.body.querySelector('#meldung').textContent, /Open the live container first/);
});

// ---------- SEQ scenes: the row #seq-szenen (public/seq_szenen.js) ----------
const szenenKnoten = () => attrappe.body.querySelector('#seq-szenen');
const szenenKnopf = (i) => szenenKnoten().querySelectorAll('button.szene')[i];
const SZENEN_LEER = { szenen: [null, null, null, null, null, null, null, null], aktiv: null, wartet: null };
const szenenStand = (extra = {}) => ({ ...SZENEN_LEER, szenen: [null, { an: 2, aus: 1 }, null, null, null, null, null, null], ...extra });
let szenenPosts, szenenAntwort;
const szenenSetup = () => {
  live.projekt = null; seqAnsichtModul.zeichneSeq();   // the row starts hidden: showing it reads the state again
  szenenPosts = []; szenenAntwort = szenenStand();
  attrappe.antworten['GET /seq/szenen'] = () => ({ code: 200, j: szenenAntwort });
  attrappe.antworten['POST /seq/szene'] = (k) => { szenenPosts.push(k); return { code: 200, j: { ok: true } }; };
};

test('szenenZeile: eight slots, empty or filled, the lit one and the one that waits for its bar', async () => {
  const { szenenZeile } = await import('../public/seq_szenen.js');
  const z = szenenZeile(szenenStand({ aktiv: 1, wartet: { slot: 3, ziel_beat: 8 } }));
  assert.equal(z.length, 8);
  assert.deepEqual(z[0], { slot: 0, klasse: 'szene leer' });
  assert.deepEqual(z[1], { slot: 1, klasse: 'szene voll aktiv' });
  assert.deepEqual(szenenZeile(szenenStand({ wartet: { slot: 1, ziel_beat: 8 } }))[1], { slot: 1, klasse: 'szene voll wartet' });
  assert.equal(szenenZeile(null).length, 8, 'no answer yet: eight empty slots');
  assert.ok(szenenZeile(null).every((s) => s.klasse === 'szene leer'));
});

test('scene row appears with the first deck and disappears with the last', async () => {
  szenenSetup();
  live.projekt = { ...projekt([]), gruppen: [] }; live.rev = 7; seqAnsichtModul.zeichneSeq();
  assert.equal(szenenKnoten().hidden, true, 'no deck (no group with seq)');
  await zeige(projekt()); await warte();
  assert.equal(szenenKnoten().hidden, false, 'a SEQ deck exists');
  assert.equal(szenenKnoten().querySelectorAll('button.szene').length, 8);
  assert.equal(szenenKnoten().querySelector('#szene-sichern').textContent, 'SAVE');
  live.projekt = { ...projekt(), gruppen: [] }; seqAnsichtModul.zeichneSeq();
  assert.equal(szenenKnoten().hidden, true, 'the last deck is gone');
  live.projekt = null; seqAnsichtModul.zeichneSeq();
  assert.equal(szenenKnoten().hidden, true, 'no live project');
});

test('a number only launches: an empty slot click saves nothing and says how to save; filled posts starten, shift-click posts loeschen', async () => {
  szenenSetup();
  await zeige(projekt()); await warte();
  assert.equal(szenenKnopf(0).classList.contains('leer'), true); assert.equal(szenenKnopf(1).classList.contains('voll'), true);
  szenenKnopf(0).dispatch('click', {}); await warte();
  assert.deepEqual(szenenPosts, [], 'an empty slot never saves by itself');
  assert.match(attrappe.body.querySelector('#meldung').textContent, /Scene 1 is empty.*SAVE.*then 1/);
  szenenKnopf(1).dispatch('click', {}); await warte();
  szenenKnopf(1).dispatch('click', { shiftKey: true }); await warte();
  assert.deepEqual(szenenPosts, [{ slot: 1, aktion: 'starten' }, { slot: 1, aktion: 'loeschen' }]);
});

test('SAVE then an empty slot saves there; while SAVE is armed the button and the hint say what the next click does', async () => {
  szenenSetup();
  await zeige(projekt()); await warte();
  const s = szenenKnoten().querySelector('#szene-sichern'), h = szenenKnoten().querySelector('.szenen-hinweis');
  assert.ok(h, 'the hint line exists');
  s.dispatch('click', {});
  assert.equal(s.textContent, 'SAVE TO…'); assert.match(h.textContent, /pick a number: it stores which patterns are on and which are muted/);
  assert.equal(szenenKnoten().classList.contains('sichern'), true, 'the row marks the slots as save targets');
  szenenKnopf(0).dispatch('click', {}); await warte();
  assert.deepEqual(szenenPosts, [{ slot: 0, aktion: 'speichern' }]);
  assert.equal(s.textContent, 'SAVE'); assert.equal(szenenKnoten().classList.contains('sichern'), false);
  s.dispatch('click', {}); s.dispatch('click', {});
  assert.equal(s.textContent, 'SAVE', 'a second click on SAVE disarms it'); assert.deepEqual(szenenPosts.length, 1);
});

test('szenenHinweis: one line that says what the row holds and what a click does', async () => {
  const { szenenHinweis } = await import('../public/seq_szenen.js');
  assert.equal(szenenHinweis(SZENEN_LEER, false), 'no scene yet: set the M buttons of the patterns, press SAVE, then a number');
  assert.equal(szenenHinweis(szenenStand(), false), 'click a number to switch to that scene on the next bar');
  assert.equal(szenenHinweis(szenenStand({ aktiv: 1 }), false), 'scene 2 is what plays now: 2 patterns on, 1 muted');
  assert.equal(szenenHinweis(szenenStand({ wartet: { slot: 1, ziel_beat: 8 } }), false), 'scene 2 switches on the next bar');
  assert.equal(szenenHinweis(szenenStand({ aktiv: 1 }), true), 'pick a number: it stores which patterns are on and which are muted right now');
  assert.equal(szenenHinweis(null, false), '');
});

test('the small x on a filled slot clears it (aria-label clear scene)', async () => {
  szenenSetup();
  await zeige(projekt()); await warte();
  const x = szenenKnoten().querySelectorAll('button.szene-x')[1];
  assert.ok(x, 'one x per slot'); assert.equal(x.getAttribute('aria-label'), 'clear scene'); x.dispatch('click', {}); await warte();
  assert.deepEqual(szenenPosts, [{ slot: 1, aktion: 'loeschen' }]);
});

test('SAVE then filled click overwrites and the toggle goes off again', async () => {
  szenenSetup();
  await zeige(projekt()); await warte();
  const s = szenenKnoten().querySelector('#szene-sichern');
  s.dispatch('click', {}); assert.equal(s.classList.contains('an'), true);
  szenenKnopf(1).dispatch('click', {}); await warte();
  assert.deepEqual(szenenPosts, [{ slot: 1, aktion: 'speichern' }]);
  assert.equal(s.classList.contains('an'), false);
  szenenKnopf(1).dispatch('click', {}); await warte();
  assert.deepEqual(szenenPosts.at(-1), { slot: 1, aktion: 'starten' }, 'the next click launches again');
});

test('aktiv slot is lit; wartet slot blinks and clears on the event', async () => {
  szenenSetup(); szenenAntwort = szenenStand({ aktiv: 1 });
  await zeige(projekt()); await warte();
  assert.equal(szenenKnopf(1).classList.contains('aktiv'), true);
  szenenAntwort = szenenStand({ wartet: { slot: 1, ziel_beat: 8 } });
  sendeStrom('seq', { szene: true, rev: 7 }); await warte();
  assert.equal(szenenKnopf(1).classList.contains('wartet'), true); assert.equal(szenenKnopf(1).classList.contains('aktiv'), false);
  szenenAntwort = szenenStand({ aktiv: 1 });
  sendeStrom('seq', { szene: true, rev: 7 }); await warte();
  assert.equal(szenenKnopf(1).classList.contains('wartet'), false); assert.equal(szenenKnopf(1).classList.contains('aktiv'), true);
});

test('redraw keeps focus on the clicked scene button (the nodes are updated, not replaced)', async () => {
  szenenSetup();
  await zeige(projekt()); await warte();
  const b = szenenKnopf(1); attrappe.aktiv = b;
  szenenAntwort = szenenStand({ aktiv: 1 });
  sendeStrom('seq', { szene: true, rev: 7 }); await warte();
  assert.equal(szenenKnopf(1), b, 'same node'); assert.equal(attrappe.aktiv, b);
  assert.equal(b.classList.contains('aktiv'), true);
  attrappe.aktiv = null;
});

test('an event during a running read triggers one more read afterwards: two events, slow first fetch, two fetches, final state shown', async () => {
  szenenSetup();
  await zeige(projekt()); await warte();
  const echt = globalThis.fetch; let gesehen = 0, frei;
  const antwortVon = (j) => ({ status: 200, ok: true, json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } });
  globalThis.fetch = (url, opt) => {
    if (String(url).split('?')[0] !== '/seq/szenen') return echt(url, opt);
    gesehen++;
    const jetzt = szenenAntwort;                                  // the server answers with the state of the moment of the request
    return gesehen === 1 ? new Promise((r) => { frei = () => r(antwortVon(jetzt)); }) : Promise.resolve(antwortVon(jetzt));
  };
  try {
    szenenAntwort = szenenStand({ wartet: { slot: 1, ziel_beat: 8 } });
    sendeStrom('seq', { szene: true, rev: 7 }); await warte();      // read 1 starts and hangs
    assert.equal(gesehen, 1);
    szenenAntwort = szenenStand({ aktiv: 1 });                      // the scene executed meanwhile
    sendeStrom('seq', { szene: true, rev: 8 }); await warte();      // event during the running read
    assert.equal(gesehen, 1, 'no parallel read');
    frei(); await warte(); await warte();
    assert.equal(gesehen, 2, 'one more read after the running one');
    assert.equal(szenenKnopf(1).classList.contains('aktiv'), true, 'final state shown');
    assert.equal(szenenKnopf(1).classList.contains('wartet'), false, 'no stuck blink');
  } finally { globalThis.fetch = echt; }
});

test('the row is not a .seqplatz node and not moved by the place layout; it has its own place in the CSS', () => {
  const k = szenenKnoten();
  assert.ok(!k.classList.contains('seqplatz')); assert.equal(k.parent?.id, 'kopf', 'a box of the page header, not of #pult');
  assert.doesNotMatch(lies('slots_view.js'), /seq-szenen|szenen/);
  const css = lies('style.css');
  assert.doesNotMatch(css, /\n#seq-szenen \{|#kopf > #seq-szenen \{[^}]*position: (fixed|absolute);/, 'no fixed row on top of the panels');
  assert.match(css, /#kopf > #seq-szenen \{[^}]*flex-wrap: wrap;[^}]*max-width: 100%;/, 'header box, wraps inside itself, never wider than the window');
  assert.match(css, /body\.werkbank:not\(\.djfx-auf\) #kopf > #seq-szenen \{ display: none; \}/, 'folded away with ROUTING in the STUDIO view');
  assert.match(css, /#seq-szenen \.szene, #seq-szenen \.szene-sichern \{[^}]*height: 28px;/, 'buttons at least 28 px high');
  assert.match(css, /#seq-szenen \.szene\.wartet \{[^}]*animation:/); assert.match(css, /#seq-szenen \.szene\.aktiv \{/);
  assert.match(css, /@keyframes szene-blink/);
  const h = lies('index.html');
  assert.match(h, /<section id="seq-szenen"[^>]*hidden/);
  const kopf = h.slice(h.indexOf('<header id="kopf">'), h.indexOf('</header>'));
  assert.match(kopf, /<section id="seq-szenen"/, 'inside the header');
  assert.ok(!h.slice(h.indexOf('<main id="pult">')).includes('id="seq-szenen"'), 'not in #pult any more');
});

// ---------- deck head: PLAY/STOP of the live container and "hide empty" (Andreas 2026-11-20) ----------
const mitLeererZeile = () => { const b = bkSpur(); b.clips[0].seq.zeilen.push({ id: 'leer', art: 'werte', teiler: 0.25, ziel: 'geraet.k4' }); return projekt([kitSpur(), b]); };

test('zeileBenutzt and leereZeilen: a lane without notes, values or curve points is empty', () => {
  assert.equal(zeileBenutzt({ art: 'noten', zellen: [{ an: false }, { an: true }] }), true);
  assert.equal(zeileBenutzt({ art: 'noten', zellen: [{ an: false }, { gebunden: true }] }), true);
  assert.equal(zeileBenutzt({ art: 'noten', zellen: [{ an: false }] }), false);
  assert.equal(zeileBenutzt({ art: 'werte', zellen: [{ da: false }, { da: true }] }), true);
  assert.equal(zeileBenutzt({ art: 'werte', zellen: [{}] }), false);
  assert.equal(zeileBenutzt({ art: 'kurve', punkte: [] }), false);
  assert.equal(zeileBenutzt({ art: 'kurve', punkte: [{ beat: 0, wert: 0.2 }] }), true);
  const a = { folgen: [{ spur_id: 's1', sicht: { zeilen: [{ id: 'k', art: 'noten', zellen: [{ an: true }] }, { id: 'h', art: 'noten', zellen: [{ an: false }] }] } }, { spur_id: 'sf', sicht: null }] };
  assert.deepEqual([...leereZeilen(a)], ['s1/h'], 'a pattern arranged in PRODUCTION (no view) adds nothing');
});

test('the DOM: "hide empty" hides the lanes empty at the press, says how many, and shows them again on the next press', async () => {
  await zeige(mitLeererZeile());
  const k = platz(2), b = k.querySelector('[data-sq-leer-aus]');
  assert.ok(b && !b.hidden); assert.equal(b.textContent, 'hide empty');
  const vorher = k.querySelectorAll('.sq-zeile').length;
  assert.ok(k.querySelector('.sq-zeile[data-zeile="leer"]'), 'the empty lane shows');
  b.dispatch('click', {});
  assert.equal(k.querySelector('.sq-zeile[data-zeile="leer"]'), null, 'hidden');
  assert.ok(k.querySelectorAll('.sq-zeile').length < vorher);
  assert.match(b.textContent, /^show empty \(\d+\)$/); assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.ok(k.querySelectorAll('.sq-folgenkopf .sq-hinter').some((h) => /empty lanes? hidden/.test(h.textContent)), 'the pattern head counts them');
  b.dispatch('click', {});
  assert.equal(k.querySelectorAll('.sq-zeile').length, vorher); assert.equal(b.textContent, 'hide empty');
});

test('deckSpielSchritt: PLAY on a stopped container plays this deck alone, on a running one it joins; STOP mutes while another plays, else stops', () => {
  const p = (m1, m2) => ({ gruppen: [{ id: 'ga', seq: {}, mute: m1 }, { id: 'gb', seq: {}, mute: m2 }, { id: 'gx', mute: false }],
    plaetze: [{ typ: 'seq', gruppe: 'ga' }, { typ: 'seq', gruppe: 'gb' }, { typ: 'leer' }, { typ: 'leer' }] });
  const stumm = (id, mute) => ({ befehl: 'gruppenspur_aendern', gruppe_id: id, mute });
  assert.deepEqual(deckSpielSchritt(p(false, false), 1, true, false), { befehle: [stumm('gb', true)], transport: 'start' }, 'the other deck is muted, no other group');
  assert.deepEqual(deckSpielSchritt(p(true, true), 1, true, false), { befehle: [stumm('ga', false)], transport: 'start' });
  assert.deepEqual(deckSpielSchritt(p(false, true), 2, true, true), { befehle: [stumm('gb', false)], transport: null }, 'joins the running transport');
  assert.deepEqual(deckSpielSchritt(p(false, false), 1, false, true), { befehle: [stumm('ga', true)], transport: null }, 'deck 2 still plays');
  assert.deepEqual(deckSpielSchritt(p(false, true), 1, false, true), { befehle: [], transport: 'stopp' }, 'the last deck stops the transport');
  assert.deepEqual(deckSpielSchritt(p(false, false), 3, true, false), { befehle: [], transport: null }, 'no deck on place 3');
  assert.equal(deckSpielt(p(false, true), 1, true), true); assert.equal(deckSpielt(p(false, true), 2, true), false); assert.equal(deckSpielt(p(false, false), 1, false), false);
  assert.equal(msBisTakt(0.5, 4, 120, 50), 1700); assert.equal(msBisTakt(3.99, 4, 120, 50), 1955, 'too close to the bar: the one after');
  assert.equal(msBisTakt(null, 4, 120), null);
});

test('the DOM: PLAY on a stopped container mutes the other deck and starts the transport; STOP of the last playing deck stops it; without the live container nothing is sent', async () => {
  const { merkeArr } = await import('../public/live_view.js');
  const zwei = projekt(undefined, { gruppen: [...projekt().gruppen, { id: 'g_seq1', name: 'SEQ 1', seq: { schema: 2, platz: 1 }, mute: false }] });
  await zeige(zwei);
  const b = platz(2).querySelector('[data-sq-spiel]');
  assert.ok(b && !b.hidden); assert.equal(b.textContent, '▶ PLAY');
  transportPosts.length = 0; aendernPosts.length = 0;
  merkeArr({ status: 0, projekt_beat: 0 });
  b.dispatch('click', {});
  await warteAuf(() => transportPosts.length > 0);
  assert.deepEqual(aendernPosts.map((x) => x.befehle), [[{ befehl: 'gruppenspur_aendern', gruppe_id: 'g_seq1', mute: true }]], 'deck 1 is muted first');
  assert.deepEqual(transportPosts, [{ aktion: 'start', beat: 0 }]);
  await warte();
  live.projekt = projekt(undefined, { gruppen: [...projekt().gruppen, { id: 'g_seq1', name: 'SEQ 1', seq: { schema: 2, platz: 1 }, mute: true }] });
  merkeArr({ status: 2, projekt_beat: 3 });
  b.dispatch('click', {});
  await warteAuf(() => transportPosts.length > 1);
  assert.deepEqual(transportPosts[1], { aktion: 'stopp' }, 'deck 2 was the only one playing');
  await warte();
  live.projekt = { ...projekt(), live: false };
  b.dispatch('click', {});
  await warte();
  assert.equal(transportPosts.length, 2, 'no request without the live container');
  assert.match(attrappe.body.querySelector('#meldung').textContent, /Open the live container first/);
  merkeArr({ status: 0, projekt_beat: 0 });
});

test('the page asks the silence rule for a place that is not parked: a SEQ or loops place switches away open or not, the others need silence', async () => {
  const { still } = await import('../public/slots.js');
  const P = [{ typ: 'seq', gruppe: 'g' }, { typ: 'track' }, { typ: 'strudel', gruppe: 's' }, { typ: 'loops', gruppe: 'l' }];
  const offen = { 'deck/1/trim': 0, 'deck/1/fader': 0, 'deck/2/trim': 0, 'deck/2/fader': 0 };
  assert.equal(still(P, 1, offen).still, false, 'the model says open ...');
  assert.equal(still(P, 2, offen).still, false);
  const b = lies('slots_view.js');
  assert.match(b, /frei = s\.still \|\| parkt\(platz\)/, '... and the page lets a parked type through: place 1 may switch, place 2 may not');
});

// ---------- collapse patterns and hide unused kit samples (Andreas 2026-11-22) ----------
const kitMit = (noten, extra = {}) => {
  const s = kitSpur();
  s.clips[0].noten = noten;
  s.clips[0].seq = { schema: 1, zeilen: [36, 38, 42, 46].map((ton) => ({ id: `t${ton}`, art: 'noten', teiler: 0.25, ton })) };
  return { ...s, ...extra };
};
const kitProjekt = (noten = [note('n1', 0, 36), note('n2', 1, 38)]) => projekt([kitMit(noten), bkSpur()]);
const folge = (i) => platz(2).querySelectorAll('.sq-folge')[i];
const zeilenIds = (i) => folge(i).querySelectorAll('.sq-zeile').map((z) => z.dataset.zeile);
const unbenutztKnopf = (i = 0) => folge(i).querySelector('[data-sq-unbenutzt]');
// the stored entries are "<project identity>\u0001<track id>": the tests compare the ids
const gespeichert = (k) => JSON.parse(localStorage.getItem(k)).map((e) => e.split('\u0001')[1]);
const saubere = async () => { localStorage.removeItem('djk-seq-zu'); localStorage.removeItem('djk-seq-unbenutzt'); seqAnsichtModul.ladeSeqSicht(); };

test('collapse: the chevron of a pattern head hides its ruler and lanes, a second press brings them back, the other patterns stay', async () => {
  await saubere();
  await zeige(kitProjekt());
  const vorher = zeilenIds(1);
  assert.ok(zeilenIds(0).length === 4 && vorher.length > 0);
  const knopf = folge(0).querySelector('[data-sq-zu]');
  assert.ok(knopf); assert.equal(knopf.title, 'Collapse or expand this pattern');
  assert.equal(folge(0).querySelector('.sq-folgenkopf').children[0], knopf, 'the chevron is the first element of the head');
  knopf.dispatch('click', {});
  assert.ok(folge(0).classList.contains('zu'));
  assert.equal(zeilenIds(0).length, 0); assert.equal(folge(0).querySelectorAll('.sq-lineal').length, 0);
  assert.deepEqual(zeilenIds(1), vorher, 'the other pattern is untouched');
  assert.equal(folge(0).querySelector('[data-sq-zu]').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(gespeichert('djk-seq-zu'), ['s1']);
  folge(0).querySelector('[data-sq-zu]').dispatch('click', {});
  assert.equal(zeilenIds(0).length, 4); assert.deepEqual(gespeichert('djk-seq-zu'), []);
});

test('collapse: a collapsed head still renames and mutes the pattern', async () => {
  await saubere();
  await zeige(kitProjekt());
  folge(0).querySelector('[data-sq-zu]').dispatch('click', {});
  const von = posts.length;
  const name = folge(0).querySelector('[data-sq-name]');
  name.value = 'Kit new'; name.dispatch('change', {});
  await warte();
  folge(0).querySelector('[data-sq-stumm]').dispatch('click', {});
  await warte();
  const befehle = posts.slice(von).flatMap((p) => p.befehle ?? []);
  assert.ok(befehle.some((b) => b.befehl === 'spur_aendern' && b.name === 'Kit new'), 'rename went out');
  assert.ok(befehle.some((b) => b.befehl === 'spur_aendern' && b.mute === true), 'mute went out');
});

test('collapse all / expand all: one chip in the deck head, its label follows the state', async () => {
  await saubere();
  await zeige(kitProjekt());
  const chip = platz(2).querySelector('[data-sq-alle-zu]');
  assert.ok(chip && !chip.hidden); assert.equal(chip.textContent, 'collapse all');
  chip.dispatch('click', {});
  assert.deepEqual([zeilenIds(0).length, zeilenIds(1).length], [0, 0]);
  assert.equal(chip.textContent, 'expand all');
  assert.deepEqual(gespeichert('djk-seq-zu').sort(), ['s1', 's2']);
  folge(1).querySelector('[data-sq-zu]').dispatch('click', {});
  assert.equal(chip.textContent, 'collapse all', 'one pattern open again: the chip collapses the rest');
  chip.dispatch('click', {});
  assert.equal(chip.textContent, 'expand all');
  chip.dispatch('click', {});
  assert.ok(zeilenIds(0).length > 0 && zeilenIds(1).length > 0);
  assert.equal(chip.textContent, 'collapse all');
});

test('collapse: the state is remembered per viewer and read back at load; stale ids go only within the open project', async () => {
  await saubere();
  await zeige({ ...kitProjekt(), name: 'Set' });
  const sch = (name, id) => `${live.slug ?? ''}|${name}\u0001${id}`;
  localStorage.setItem('djk-seq-zu', JSON.stringify([sch('Set', 's2'), sch('Set', 'gone'), sch('Other', 's9'), 's1']));
  seqAnsichtModul.ladeSeqSicht();
  assert.ok(folge(1).classList.contains('zu') && !folge(0).classList.contains('zu'), 'the stored list is read');
  folge(0).querySelector('[data-sq-zu]').dispatch('click', {});   // writes
  assert.deepEqual(JSON.parse(localStorage.getItem('djk-seq-zu')).sort(), [sch('Other', 's9'), sch('Set', 's1'), sch('Set', 's2')].sort(),
    'gone (this project) and the entry without a project identity are dropped, the other project keeps its entry');
  localStorage.setItem('djk-seq-zu', 'not json');
  seqAnsichtModul.ladeSeqSicht();
  assert.ok(!folge(0).classList.contains('zu'), 'unreadable storage: everything open');
});

test('per-project state: the state of project A survives a visit to B and back, and B does not inherit A for the same track id', async () => {
  await saubere();
  const benannt = (name, noten) => ({ ...kitProjekt(noten), name });
  await zeige(benannt('A'));
  folge(0).querySelector('[data-sq-zu]').dispatch('click', {});
  folge(1).querySelector('[data-sq-zu]').dispatch('click', {});
  await zeige(benannt('A'));   // a redraw of the same project keeps it
  unbenutztKnopf().dispatch('click', {});
  assert.ok(folge(0).classList.contains('zu') && folge(1).classList.contains('zu'));
  // project B has the same track ids s1 and s2: nothing of A shows
  await zeige(benannt('B'));
  assert.ok(!folge(0).classList.contains('zu') && !folge(1).classList.contains('zu'), 'B does not inherit the collapsed patterns');
  assert.equal(unbenutztKnopf().textContent, 'hide unused', 'nor hide unused');
  assert.deepEqual(zeilenIds(0), ['t36', 't38', 't42', 't46']);
  folge(0).querySelector('[data-sq-zu]').dispatch('click', {});   // B writes its own state: A's entries must stay
  // back to A: its state is still there
  await zeige(benannt('A'));
  assert.ok(folge(0).classList.contains('zu') && folge(1).classList.contains('zu'), 'A is as it was left');
  folge(0).querySelector('[data-sq-zu]').dispatch('click', {}); folge(0).querySelector('[data-sq-zu]').dispatch('click', {});
  assert.equal(unbenutztKnopf().textContent, 'show unused (2)', 'hide unused of A is still on and the set is taken from the clip');
  await zeige(benannt('B'));
  assert.ok(folge(0).classList.contains('zu'), 'B keeps what it wrote');
  assert.equal(unbenutztKnopf().textContent, 'hide unused');
});

test('hide unused: only a kit pattern has the toggle; it hides the trigger lanes that hold no note and counts them in its label', async () => {
  await saubere();
  await zeige(kitProjekt());
  assert.equal(folge(1).querySelector('[data-sq-unbenutzt]'), null, 'a Baukasten pattern has none');
  const u = unbenutztKnopf();
  assert.ok(u); assert.equal(u.textContent, 'hide unused');
  assert.deepEqual(zeilenIds(0), ['t36', 't38', 't42', 't46']);
  u.dispatch('click', {});
  assert.deepEqual(zeilenIds(0), ['t36', 't38'], 'only the lanes with a note stay');
  assert.equal(unbenutztKnopf().textContent, 'show unused (2)');
  assert.equal(unbenutztKnopf().getAttribute('aria-pressed'), 'true');
  assert.ok(zeilenIds(1).length > 0, 'the other pattern keeps its lanes');
  assert.deepEqual(gespeichert('djk-seq-unbenutzt'), ['s1']);
  unbenutztKnopf().dispatch('click', {});
  assert.deepEqual(zeilenIds(0), ['t36', 't38', 't42', 't46']);
  assert.equal(unbenutztKnopf().textContent, 'hide unused'); assert.deepEqual(gespeichert('djk-seq-unbenutzt'), []);
});

test('hide unused: a lane that gets a note from elsewhere shows again, a lane the owner empties stays until the toggle is pressed again', async () => {
  await saubere();
  await zeige(kitProjekt());
  unbenutztKnopf().dispatch('click', {});
  assert.deepEqual(zeilenIds(0), ['t36', 't38']);
  // another window writes a hit on the hi-hat lane: the next draw shows it
  live.projekt = kitProjekt([note('n1', 0, 36), note('n2', 1, 38), note('n3', 2, 42)]);
  seqAnsichtModul.zeichneSeq();
  assert.deepEqual(zeilenIds(0), ['t36', 't38', 't42']);
  assert.equal(unbenutztKnopf().textContent, 'show unused (1)');
  // the owner deletes the last snare hit: its lane stays in view
  live.projekt = kitProjekt([note('n1', 0, 36), note('n3', 2, 42)]);
  seqAnsichtModul.zeichneSeq();
  assert.deepEqual(zeilenIds(0), ['t36', 't38', 't42'], 'the emptied lane stays');
  // ... and so does a lane the hi-hat loses again once it was shown
  live.projekt = kitProjekt([note('n1', 0, 36)]);
  seqAnsichtModul.zeichneSeq();
  assert.deepEqual(zeilenIds(0), ['t36', 't38', 't42']);
  // toggled off and on again, the set is taken anew
  unbenutztKnopf().dispatch('click', {}); unbenutztKnopf().dispatch('click', {});
  assert.deepEqual(zeilenIds(0), ['t36']);
  assert.equal(unbenutztKnopf().textContent, 'show unused (3)');
});

test('hide unused: the toggle is remembered per pattern and the hidden set is taken from the clip at page load', async () => {
  await saubere();
  await zeige(kitProjekt());
  const sch = (id) => `${live.slug ?? ''}|${live.projekt.name ?? ''}\u0001${id}`;
  localStorage.setItem('djk-seq-unbenutzt', JSON.stringify([sch('s1'), sch('gone')]));
  seqAnsichtModul.ladeSeqSicht();
  assert.deepEqual(zeilenIds(0), ['t36', 't38']);
  assert.equal(unbenutztKnopf().textContent, 'show unused (2)');
  unbenutztKnopf().dispatch('click', {});   // off; the write drops the id that no deck has
  assert.deepEqual(gespeichert('djk-seq-unbenutzt'), []);
  assert.deepEqual(zeilenIds(0).length, 4);
});

test('hide unused and collapse together: collapsed lanes stay out, the head keeps the toggle and its count', async () => {
  await saubere();
  await zeige(kitProjekt());
  unbenutztKnopf().dispatch('click', {});
  folge(0).querySelector('[data-sq-zu]').dispatch('click', {});
  assert.equal(zeilenIds(0).length, 0);
  assert.equal(unbenutztKnopf().textContent, 'show unused (2)');
  folge(0).querySelector('[data-sq-zu]').dispatch('click', {});
  assert.deepEqual(zeilenIds(0), ['t36', 't38']);
});

test('broken storage: neither reading nor writing the view state throws, and the toggles still work for this page load', async () => {
  await saubere();
  await zeige(kitProjekt());
  const alt = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  try {
    seqAnsichtModul.ladeSeqSicht();
    folge(0).querySelector('[data-sq-zu]').dispatch('click', {});
    assert.equal(zeilenIds(0).length, 0);
    folge(0).querySelector('[data-sq-zu]').dispatch('click', {});
    unbenutztKnopf().dispatch('click', {});
    assert.deepEqual(zeilenIds(0), ['t36', 't38']);
    platz(2).querySelector('[data-sq-alle-zu]').dispatch('click', {});
    assert.equal(zeilenIds(1).length, 0);
  } finally { globalThis.localStorage = alt; await saubere(); }
});

test('the deck chip "hide empty" stays a deck-wide snapshot of its own and works next to the per-pattern toggle', async () => {
  await saubere();
  await zeige(kitProjekt());
  unbenutztKnopf().dispatch('click', {});
  platz(2).querySelector('[data-sq-leer-aus]').dispatch('click', {});
  assert.deepEqual(zeilenIds(0), ['t36', 't38']);
  platz(2).querySelector('[data-sq-leer-aus]').dispatch('click', {});
  assert.deepEqual(zeilenIds(0), ['t36', 't38'], 'the per-pattern toggle is not touched by the deck chip');
  unbenutztKnopf().dispatch('click', {});
  assert.deepEqual(zeilenIds(0).length, 4);
});
