// Workbench module -> SEQ deck (slice A): the pure function setzeModulNachSeq.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { seqGruppe, seqFolgen } from '../project/seq.ts';
import { setzeModulNachSeq, NachSeqFehler } from '../project/module_after_seq.ts';

const bk = (graph = 'synth-mono', parameter = {}) => ({ art: 'intern', name: 'bk', graph, parameter });
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const live = () => { const p = neuesProjekt('live'); p.live = true; return p; };
const modul = () => { const p = neuesProjekt('mod'); p.werkbank = { schema: 1 }; return p; };
const spurNeu = (p, name, extra = {}) => lauf(p, { befehl: 'werkbank_spur_neu', name, geraet: bk('drums-909', { k3: 0.7 }), ...extra });
const fehler = (f) => { try { f(); } catch (e) { return e; } return assert.fail('no refusal'); };
const valide = (p) => { const u = pruefeProjekt(JSON.parse(JSON.stringify(p))); assert.ok('projekt' in u, JSON.stringify(u)); };

test('one pattern per instrument track: instrument, knobs, notes with chance/wdh/versatz, row settings, lanes, mixer, report', () => {
  let m = spurNeu(modul(), 'Kick', { loop_beats: 8, noten: [
    { beat: 0, laenge: 0.25, ton: 36, vel: 100, chance: 50, wdh: 2, versatz: 10 }, { beat: 1, laenge: 0.25, ton: 38, vel: 90 }],
    huellkurven: [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.2 }, { beat: 4, wert: -0.2 }] }] });
  m = lauf(m, { befehl: 'zeile_setzen', clip_id: m.spuren[0].clips[0].id, ton: 36, schritte: 12, swing: 60, richtung: 'pendel' },
    { befehl: 'spur_aendern', spur_id: m.spuren[0].id, fader_db: -3, pan: 0.25, mute: true });
  m = spurNeu(m, 'Bass');
  m = lauf(m, { befehl: 'spur_neu', art: 'audio', name: 'Aud' });
  m = lauf(m, { befehl: 'tonart_setzen', grundton: 0, skala: 'minor' });
  const { projekt, bericht } = setzeModulNachSeq(live(), m, 2);
  valide(projekt);
  assert.equal(bericht.deck_neu, true);
  assert.deepEqual(bericht.patterns.map((x) => [x.name, x.quelle_spur]), [['Kick', m.spuren[0].id], ['Bass', m.spuren[1].id]]);
  assert.deepEqual(bericht.weggelassen.spuren_uebersprungen, [{ name: 'Aud', grund: 'audio track' }]);
  assert.equal(bericht.weggelassen.tonart, true);
  const folgen = seqFolgen(projekt, seqGruppe(projekt, 2));
  assert.equal(folgen.length, 2);
  const k = folgen[0];
  const q = m.spuren[0];
  assert.deepEqual(k.spur.geraet, q.geraet);
  assert.deepEqual(k.clip.noten.map(({ id, ...r }) => r), q.clips[0].noten.map(({ id, ...r }) => r));
  assert.equal(k.clip.loop_beats, 8);
  assert.equal(k.clip.laenge_beats, 64);
  assert.equal(k.editierbar, true);
  assert.deepEqual(k.clip.zeilen, q.clips[0].zeilen);
  assert.deepEqual(k.clip.huellkurven, q.clips[0].huellkurven);
  assert.deepEqual([k.spur.fader_db, k.spur.pan, k.spur.mute, k.spur.solo], [-3, 0.25, true, false], 'a fresh deck takes the mixer of the module');
});

test('the report counts what is left out: sends, inserts, master inserts, returns, groups', () => {
  let m = spurNeu(spurNeu(modul(), 'Kick'), 'Bass');
  m = lauf(m, { befehl: 'return_neu', name: 'Verb' });
  m = lauf(m, { befehl: 'send_setzen', strang_id: m.spuren[0].id, return_id: m.returns[0].id, db: -10 },
    { befehl: 'send_setzen', strang_id: m.spuren[1].id, return_id: m.returns[0].id, db: -12 },
    { befehl: 'insert_setzen', strang_id: m.spuren[0].id, pos: 0, art: 'eq' }, { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'komp' },
    { befehl: 'gruppenspur_neu', name: 'G', mitglieder: [m.spuren[1].id] });
  const { bericht } = setzeModulNachSeq(live(), m, 1);
  const w = bericht.weggelassen;
  assert.deepEqual([w.sends, w.inserts, w.master_inserts, w.returns, w.gruppen, w.tonart], [2, 1, 1, 1, 1, false]);
});

test('a clip of 32 bars: only the first 16 bars come along, the pattern is editable, the report counts the cut notes and lane points', () => {
  let m = spurNeu(modul(), 'Long', { noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }, { beat: 70, laenge: 1, ton: 36, vel: 100 }, { beat: 100, laenge: 1, ton: 38, vel: 100 }],
    huellkurven: [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 80, wert: 0.5 }] }] });
  const id = m.spuren[0].clips[0].id;
  m = lauf(m, { befehl: 'clip_aendern', clip_id: id, laenge_beats: 128 }, { befehl: 'clip_aendern', clip_id: id, loop_beats: 128 });
  const { projekt, bericht } = setzeModulNachSeq(live(), m, 3);
  const f = seqFolgen(projekt, seqGruppe(projekt, 3))[0];
  assert.deepEqual(f.clip.noten.map((n) => n.beat), [0]);
  assert.equal(f.clip.loop_beats, 64);
  assert.equal(f.clip.laenge_beats, 64);
  assert.equal(f.editierbar, true);
  assert.deepEqual(f.clip.huellkurven[0].punkte, [{ beat: 0, wert: 0 }]);
  assert.deepEqual(bericht.weggelassen.gekuerzt, [{ name: 'Long', noten: 2, punkte: 1 }]);
});

test('the 16 Baukasten track limit is hit by the third of four tracks: a refusal that names it, the input project is untouched', () => {
  let p = live();
  p = lauf(p, { befehl: 'seq_anlegen', platz: 1 });
  for (let i = 0; i < 14; i++) p = lauf(p, { befehl: 'seq_folge_neu', gruppe_id: p.gruppen[0].id, name: `P${i}`, geraet: bk() });
  let m = modul();
  for (const n of ['A', 'B', 'C', 'D']) m = spurNeu(m, n);
  const vorher = JSON.stringify(p);
  const e = fehler(() => setzeModulNachSeq(p, m, 2));
  assert.ok(e.grund !== undefined, String(e));
  assert.match(`${e.grund} ${e.detail}`, /at most 16 Baukasten/);
  assert.equal(JSON.stringify(p), vorher, 'nothing is written');
});

test('loading the same module twice into one place: the second load adds patterns named 2, muted, the first ones untouched', () => {
  let m = spurNeu(spurNeu(modul(), 'Kick'), 'Bass');
  m = lauf(m, { befehl: 'spur_aendern', spur_id: m.spuren[0].id, solo: true });
  const eins = setzeModulNachSeq(live(), m, 2);
  assert.equal(eins.projekt.spuren[0].solo, false, 'solo never comes along: it would silence the other decks of the live container');
  const zwei = setzeModulNachSeq(eins.projekt, m, 2);
  assert.equal(zwei.bericht.deck_neu, false);
  assert.deepEqual(zwei.bericht.patterns.map((x) => x.name), ['Kick 2', 'Bass 2']);
  const folgen = seqFolgen(zwei.projekt, seqGruppe(zwei.projekt, 2)).map((f) => f.spur);
  assert.deepEqual(folgen.slice(2).map((s) => [s.mute, s.solo]), [[true, false], [true, false]]);
  assert.deepEqual(folgen.slice(0, 2), seqFolgen(eins.projekt, seqGruppe(eins.projekt, 2)).map((f) => f.spur), 'the first patterns are unchanged');
  const drei = setzeModulNachSeq(zwei.projekt, m, 2);
  assert.deepEqual(drei.bericht.patterns.map((x) => x.name), ['Kick 3', 'Bass 3']);
});

test('refusals: not the live container, not a module, no instrument track that can come along', () => {
  const m = spurNeu(modul(), 'Kick');
  assert.equal(fehler(() => setzeModulNachSeq(neuesProjekt('x'), m, 1)).fehler, 'kein_liveprojekt');
  assert.equal(fehler(() => setzeModulNachSeq(live(), neuesProjekt('x'), 1)).fehler, 'kein_werkbank');
  const nur = lauf(modul(), { befehl: 'spur_neu', art: 'audio', name: 'Aud' });
  const e = fehler(() => setzeModulNachSeq(live(), nur, 1));
  assert.deepEqual([e.fehler, e.extra.spuren_uebersprungen], ['modul_ohne_instrument', [{ name: 'Aud', grund: 'audio track' }]]);
  assert.equal(fehler(() => setzeModulNachSeq(live(), m, 5)).fehler, 'argument_ungueltig');
});

// --- TO DJ: a section of a tracker project (task 24, D23) ---------------------------------------------------------------------
import { uebersetze } from '../project/playback.ts';
import { fxRahmen } from '../project/playback.ts';
const ROLLEN = () => ({ stufig: false, rollen: { slot: 3, start: 5, rueckwaerts: 6 } });
const spiel = (p) => uebersetze(p, { nr: 1, audioOrdner: '@A@', frames: () => 400000, geraetFx: ROLLEN });
const wspur = (w, nr) => w.spuren.find((s) => s.nr === nr);
const wlane = (s, ziel) => s.auto?.find((l) => l.ziel === ziel)?.punkte ?? [];
const nt = (beat, ton, extra = {}) => ({ beat, laenge: 0.5, ton, vel: 100, ...extra });
// two sections of 16 beats; the second one holds the content: track Lead (VIB, slots, a knob envelope), track Bass, track Empty
function trackerProjekt(lpb = 8, ticks = 3) {
  let p = lauf(neuesProjekt('trk'), { befehl: 'tracker_setzen', an: true, lpb, ticks });
  for (const n of ['Lead', 'Bass', 'Empty']) p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: n, geraet: bk('synth-mono', { k3: 0.25 }) });
  p = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 16, noten: [nt(0, 60)] });
  p = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 16, laenge_beats: 16,
    noten: [nt(0, 60, { platz: 5 }), nt(4, 62, { platz: 9, versatz: 10 }), nt(15.75, 64)] });
  p = lauf(p, { befehl: 'huellkurve_setzen', clip_id: p.spuren[0].clips[1].id, ziel: 'geraet.k3',
    punkte: [{ beat: 0, wert: 0.1, form: 'sprung' }, { beat: 8, wert: -0.1, form: 'sprung' }] });
  p = lauf(p, { befehl: 'fx_setzen', clip_id: p.spuren[0].clips[1].id, eintraege: [{ beat: 0, spalte: 0, code: 'VIB', wert: 0x48 }, { beat: 2, spalte: 1, code: 'SLU', wert: 8 }] });
  p = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren[1].id, art: 'midi', start_beat: 16, laenge_beats: 16, noten: [nt(0, 36), nt(8, 36)] });
  return p;
}

test('TO DJ: a 16 beat section becomes one pattern per track carrying notes, slots, VIB, envelopes; empty tracks stay out', () => {
  const t = trackerProjekt();
  const vorher = JSON.stringify(t);
  const { projekt, bericht } = setzeModulNachSeq(live(), t, 2, { abschnitt_id: 'a2' });
  valide(projekt);
  assert.equal(JSON.stringify(t), vorher, 'the tracker project is not changed');
  assert.deepEqual(bericht.patterns.map((x) => x.name), ['Lead', 'Bass']);
  assert.deepEqual(bericht.weggelassen.spuren_uebersprungen, [{ name: 'Empty', grund: 'nothing in section 01' }]);
  const [lead, bass] = seqFolgen(projekt, seqGruppe(projekt, 2));
  assert.deepEqual(lead.clip.noten.map(({ id, ...r }) => r), [nt(0, 60, { platz: 5 }), nt(4, 62, { platz: 9, versatz: 10 }), nt(15.75, 64, { laenge: 0.25 })]);
  assert.deepEqual(lead.clip.fx, t.spuren[0].clips[1].fx);
  assert.deepEqual(lead.clip.huellkurven[0].punkte, t.spuren[0].clips[1].huellkurven[0].punkte);
  assert.equal(lead.clip.loop_beats, 16);
  assert.equal(bass.clip.noten.length, 2);
  assert.equal(bass.clip.fx, undefined);
  assert.deepEqual(projekt.gruppen[0].seq, { schema: 2, platz: 2, lpb: 8, ticks: 3 });
  // the deck plays the section the way the tracker does: same frame, same slot lane, same pitch events inside the first copy
  assert.deepEqual([fxRahmen(projekt, lead.spur).lpb, fxRahmen(projekt, lead.spur).ticks], [8, 3]);
  const a = wlane(wspur(spiel(t), 1), 'geraet.k3'), b = wlane(wspur(spiel(projekt), 1), 'geraet.k3');
  const imFenster = (l, von) => l.filter((q) => q[0] >= von && q[0] < von + 16).map((q) => [Math.round((q[0] - von) * 1e6) / 1e6, q[1], q[2]]);
  assert.ok(imFenster(a, 16).length >= 3);
  assert.deepEqual(imFenster(b, 0), imFenster(a, 16));
});

test('TO DJ: a section in the default frame writes no lpb or ticks; a project without fx and slots writes a plain deck', () => {
  const t = lauf(lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'instrument', name: 'K', geraet: bk() }),
    { befehl: 'tracker_setzen', an: true, lpb: 8, ticks: 3 });
  const t2 = lauf(t, { befehl: 'clip_neu', spur_id: t.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 16, noten: [nt(0, 60)] });
  const plain = setzeModulNachSeq(live(), t2, 1, { abschnitt_id: 'a1' }).projekt;
  assert.deepEqual(plain.gruppen[0].seq, { schema: 2, platz: 1 }, 'no fx and no slot: the frame is irrelevant and stays unwritten');
  const d = trackerProjekt(4, 6);
  assert.deepEqual(setzeModulNachSeq(live(), d, 1, { abschnitt_id: 'a2' }).projekt.gruppen[0].seq, { schema: 2, platz: 1 }, 'defaults are never written');
});

test('TO DJ: a project without a tracker marker works, the section list is the default one; no section id loads nothing from a tracker project', () => {
  let p = lauf(neuesProjekt('plain'), { befehl: 'spur_neu', art: 'instrument', name: 'K', geraet: bk() });
  p = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 16, laenge_beats: 16, noten: [nt(1, 60)] });
  const { projekt } = setzeModulNachSeq(live(), p, 3, { abschnitt_id: 'a2' });
  assert.deepEqual(seqFolgen(projekt, seqGruppe(projekt, 3))[0].clip.noten.map((n) => n.beat), [1]);
  assert.equal(fehler(() => setzeModulNachSeq(live(), p, 3, { abschnitt_id: 'zz' })).fehler, 'abschnitt_unbekannt');
  assert.equal(fehler(() => setzeModulNachSeq(live(), p, 3)).fehler, 'kein_werkbank', 'the workbench path still demands a module');
});

test('TO DJ: a section of 128 beats is refused with its length, exactly 64 beats is taken; nothing is written', () => {
  const t = trackerProjekt();
  t.tracker.abschnitte = [{ id: 'a1', laenge_beats: 16 }, { id: 'a2', laenge_beats: 16 }, { id: 'a3', laenge_beats: 16 }, { id: 'a4', laenge_beats: 128 }];
  const l = live();
  const vorher = JSON.stringify(l);
  const e = fehler(() => setzeModulNachSeq(l, t, 1, { abschnitt_id: 'a4' }));
  assert.deepEqual([e.code, e.fehler, e.extra.text], [409, 'abschnitt_zu_lang', 'section 03 is 128 beats long, a SEQ deck takes at most 64']);
  assert.equal(JSON.stringify(l), vorher);
  let g = lauf(neuesProjekt('g'), { befehl: 'spur_neu', art: 'instrument', name: 'K', geraet: bk() });
  g = lauf(g, { befehl: 'clip_neu', spur_id: g.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 64, noten: [nt(63, 60)] });
  g.tracker = { schema: 1, abschnitte: [{ id: 'a1', laenge_beats: 64 }] };
  const ok = setzeModulNachSeq(l, g, 1, { abschnitt_id: 'a1' }).projekt;
  assert.equal(seqFolgen(ok, seqGruppe(ok, 1))[0].clip.loop_beats, 64);
});

test('TO DJ: notes that miss the 1/8-beat grid of the SEQ deck (LPB 3, 6, 12) are refused with the reason, notes that sit on it are taken; nothing is written', () => {
  for (const lpb of [3, 6, 12]) {
    const t = trackerProjekt(lpb);
    t.tracker.abschnitte = [{ id: 'a1', laenge_beats: 16 }, { id: 'a2', laenge_beats: 16 }];
    Object.assign(t.spuren[0].clips[1], { noten: [nt(0, 60), nt(1 / lpb, 62)] });
    const l = live(), vorher = JSON.stringify(l);
    const e = fehler(() => setzeModulNachSeq(l, t, 1, { abschnitt_id: 'a2' }));
    assert.deepEqual([e.code, e.fehler], [409, 'seq_raster_ungleich'], `LPB ${lpb}`);
    assert.match(e.extra.text, new RegExp(`section 01 runs at ${lpb} rows per beat.*1/8`));
    assert.equal(JSON.stringify(l), vorher);
    Object.assign(t.spuren[0].clips[1], { noten: [nt(0, 60), nt(0.5, 62)] });   // rows that fall on the 1/8 grid come along
    const ok = setzeModulNachSeq(l, t, 1, { abschnitt_id: 'a2' }).projekt;
    assert.ok(seqFolgen(ok, seqGruppe(ok, 1)).some((f) => f.spur.name === 'Lead'));
  }
});

test('TO DJ: an empty section is refused; notes are cut at the section end, notes of other sections stay out', () => {
  const t = trackerProjekt();
  t.tracker.abschnitte = [{ id: 'a1', laenge_beats: 16 }, { id: 'a2', laenge_beats: 16 }, { id: 'a3', laenge_beats: 16 }];
  const e = fehler(() => setzeModulNachSeq(live(), t, 1, { abschnitt_id: 'a3' }));
  assert.equal(e.fehler, 'abschnitt_leer');
  assert.equal(e.extra.text, 'section 02 holds no notes, envelope points or effects on an instrument track a SEQ deck can play');
  const u = trackerProjekt();
  Object.assign(u.spuren[1].clips[0], { start_beat: 0, laenge_beats: 32 });   // a loose clip that crosses the section border
  u.spuren[1].clips[0].noten = [nt(0, 36), nt(15.5, 38, { laenge: 2 }), nt(16, 40)];
  const { projekt } = setzeModulNachSeq(live(), u, 1, { abschnitt_id: 'a1' });
  const bass = seqFolgen(projekt, seqGruppe(projekt, 1)).find((f) => f.spur.name === 'Bass');
  assert.deepEqual(bass.clip.noten.map((n) => [n.beat, n.ton, n.laenge]), [[0, 36, 0.5], [15.5, 38, 0.5]]);
});

test('TO DJ: too many Baukasten tracks: the refusal names both counts, nothing partial', () => {
  let l = live();
  l = lauf(l, { befehl: 'seq_anlegen', platz: 1 });
  for (let i = 0; i < 15; i++) l = lauf(l, { befehl: 'seq_folge_neu', gruppe_id: l.gruppen[0].id, name: `P${i}`, geraet: bk() });
  const t = trackerProjekt();
  const vorher = JSON.stringify(l);
  const e = fehler(() => setzeModulNachSeq(l, t, 2, { abschnitt_id: 'a2' }));
  assert.deepEqual([e.code, e.fehler], [409, 'zu_viele_bk']);
  assert.equal(e.extra.text, 'the live project holds 15 Baukasten tracks and the section brings 2, at most 16 are possible');
  assert.deepEqual([e.extra.vorhanden, e.extra.neu], [15, 2]);
  assert.equal(JSON.stringify(l), vorher);
});

test('TO DJ: a second section into a deck whose frame differs: refused when the deck holds fx or slots, otherwise the frame follows', () => {
  const a = trackerProjekt(8, 3), b = trackerProjekt(12, 4);
  const eins = setzeModulNachSeq(live(), a, 1, { abschnitt_id: 'a2' }).projekt;
  const e = fehler(() => setzeModulNachSeq(eins, b, 1, { abschnitt_id: 'a2' }));
  assert.equal(e.grund, 'seq_raster_belegt');
  // a deck with plain patterns takes over the frame of the section that needs one
  let plain = lauf(neuesProjekt('pl'), { befehl: 'spur_neu', art: 'instrument', name: 'K', geraet: bk() });
  plain = lauf(plain, { befehl: 'clip_neu', spur_id: plain.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 16, noten: [nt(0, 60)] });
  const nur = setzeModulNachSeq(live(), plain, 1, { abschnitt_id: 'a1' }).projekt;
  const danach = setzeModulNachSeq(nur, a, 1, { abschnitt_id: 'a2' }).projekt;
  assert.deepEqual(danach.gruppen[0].seq, { schema: 2, platz: 1, lpb: 8, ticks: 3 });
});

test('seq_folge_neu takes fx; a project without the new fields stays byte for byte the same', () => {
  let l = lauf(live(), { befehl: 'seq_anlegen', platz: 1 });
  const fx = [{ beat: 1, spalte: 0, code: 'VIB', wert: 0x48 }];
  const m = lauf(l, { befehl: 'seq_folge_neu', gruppe_id: l.gruppen[0].id, name: 'F', geraet: bk(), loop_beats: 8, noten: [nt(0, 60)], fx });
  assert.deepEqual(m.spuren[0].clips[0].fx, fx);
  const e = fehler(() => lauf(l, { befehl: 'seq_folge_neu', gruppe_id: l.gruppen[0].id, name: 'F', geraet: bk(), fx: [{ beat: 1, spalte: 7, code: 'VIB', wert: 1 }] }));
  assert.equal(e.grund, 'fx_ungueltig');
  const ohne = lauf(l, { befehl: 'seq_folge_neu', gruppe_id: l.gruppen[0].id, name: 'F', geraet: bk(), noten: [nt(0, 60)] });
  assert.ok(!('fx' in ohne.spuren[0].clips[0]));
  assert.deepEqual(ohne.gruppen[0].seq, { schema: 2, platz: 1 });
});
