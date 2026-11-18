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
