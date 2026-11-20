// Tracker stage 2, fix round F2: the text form writes chords exactly, refuses a note off where no note sounds, names hidden notes, and reads and
// writes effect commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { liesBereich, schreibeBereich, TrackerTextFehler } from '../project/tracker_text.ts';
import { kopie } from './support/project.mjs';

const lauf = (p, b) => fuehreListeAus(kopie(p), b).projekt;
const GERAET = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
const N = (beat, laenge, ton = 60, extra = {}) => ({ beat, laenge, ton, vel: 100, ...extra });
function bau(namen, clips = []) {
  let p = neuesProjekt('x');
  for (const name of namen) p = lauf(p, [{ befehl: 'spur_neu', art: 'instrument', name, geraet: GERAET }]);
  for (const { spur, ...c } of clips) p = lauf(p, [{ befehl: 'clip_neu', spur_id: p.spuren[spur].id, art: 'midi', ...c }]);
  return p;
}
const wende = (p, r) => (r.befehle.length === 0 ? p : fuehreListeAus(kopie(p), r.befehle).projekt);
const fehler = (f) => { try { f(); } catch (e) { assert.ok(e instanceof TrackerTextFehler, String(e)); return e; } assert.fail('expected a TrackerTextFehler'); };
const zeile = (text, nr) => text.split('\n')[nr];
const setze = (text, nr, neu) => text.split('\n').map((z, i) => (i === nr ? neu : z)).join('\n');
const lies = (p, o = {}) => liesBereich(p, { abschnitt_id: 'a1', ...o });
const LEER = '... .. ... .. .';
// the block of a row line: [prefix, [columns], rest]
const teile = (z) => { const k = z.indexOf('| ') + 2; const [pre, body] = [z.slice(0, k), z.slice(k)]; const bl = body.split(' | '); return { pre, bl }; };
// set column c of track block 0 in row line `nr` to `zelle`; with zelle LEER the first following `===` of that column goes as well
function spalteSetzen(text, nr, c, zelle, b = 0) {
  const zl = text.split('\n');
  const aendere = (i, neu) => {
    const { pre, bl } = teile(zl[i]);
    const [notenTeil, ...fx] = bl[b].split('  ');
    const sp = notenTeil.split(' / '); sp[c] = neu;
    bl[b] = [sp.join(' / '), ...fx].join('  ');
    zl[i] = pre + bl.join(' | ');
  };
  aendere(nr, zelle);
  if (zelle === LEER) {
    for (let i = nr + 1; i < zl.length - 1; i++) {
      const sp = teile(zl[i]).bl[b].split('  ')[0].split(' / ');
      if (sp[c].startsWith('===')) { aendere(i, LEER); break; }
      if (!sp[c].startsWith('...')) break;
    }
  }
  return zl.join('\n');
}
// the text form shows no empty column at the end: drop the last note columns that are empty in every row of a block
function kuerze(text) {
  const zl = text.split('\n');
  const reihen = zl.map((l, i) => (i >= 2 && l.includes('| ') ? teile(l) : null));
  const n = Math.max(...reihen.filter(Boolean).map((r) => r.bl.length));
  for (let b = 0; b < n; b++) {
    let benutzt = 1;
    for (const r of reihen.filter(Boolean)) r.bl[b].split('  ')[0].split(' / ').forEach((c, i) => { if (c !== LEER) benutzt = Math.max(benutzt, i + 1); });
    for (const r of reihen.filter(Boolean)) {
      const [nt, ...fx] = r.bl[b].split('  ');
      r.bl[b] = [nt.split(' / ').slice(0, benutzt).join(' / '), ...fx].join('  ');
    }
  }
  return zl.map((l, i) => (reihen[i] ? reihen[i].pre + reihen[i].bl.join(' | ') : i === 1 ? l.replace(/ +\|/g, ' |') : l)).join('\n');
}
const akkord = (extra = {}) => bau(['Lead'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60, extra[0]), N(0, 1, 64, extra[1]), N(0, 1, 67, extra[2])] }]);

test('chord without stored columns: emptying column 1 keeps E and G where they are (prober case)', () => {
  const p = akkord();
  const t = lies(p, { von: 0, bis: 4 });
  const edit = spalteSetzen(t, 2, 0, LEER);
  const r = schreibeBereich(p, edit);
  assert.ok(r.befehle.length > 0);
  const q = wende(p, r);
  assert.equal(lies(q, { von: 0, bis: 4 }), edit);
  assert.deepEqual(q.spuren[0].clips[0].noten.map((n) => n.ton).sort(), [64, 67], 'no note is duplicated');
});

test('chord: emptying column 2 or 3, changing a middle note, emptying two columns', () => {
  const p = akkord();
  const t = lies(p, { von: 0, bis: 4 });
  const faelle = [[[1, LEER]], [[2, LEER]], [[1, 'F-3 64 ... .. .']], [[0, LEER], [2, LEER]], [[0, LEER], [1, LEER]]];
  for (const f of faelle) {
    const edit = f.reduce((x, [c, z]) => spalteSetzen(x, 2, c, z), t);
    const q = wende(p, schreibeBereich(p, edit));
    assert.equal(lies(q, { von: 0, bis: 4 }), kuerze(edit));
    assert.equal(q.spuren[0].clips[0].noten.length, 3 - f.filter(([, z]) => z === LEER).length);
  }
});

test('mixed chord (some notes with, some without a stored column): every case reads back exactly', () => {
  for (const extra of [{ 1: { spalte: 3 } }, { 0: { spalte: 2 } }, { 2: { spalte: 2 } }, { 1: { spalte: 2 }, 2: { spalte: 5 } }]) {
    const p = akkord(extra);
    const t = lies(p, { von: 0, bis: 4 });
    for (const c of [0, 1, 2, 3]) {
      if (c >= t.split('\n')[2].split(' / ').length) continue;
      const edit = spalteSetzen(t, 2, c, LEER);
      const q = wende(p, schreibeBereich(p, edit));
      assert.equal(lies(q, { von: 0, bis: 4 }), kuerze(edit), `${JSON.stringify(extra)} column ${c}`);
    }
  }
});

test('prober case exactly: the note off of the emptied note stays in the text (stale): E and G stay where they are, nothing is duplicated', () => {
  const p = akkord();
  const t = lies(p, { von: 0, bis: 4 });
  const q = wende(p, schreibeBereich(p, setze(t, 2, '00  | ... .. ... .. . / E-3 64 ... .. . / G-3 64 ... .. .  ... ..')));
  assert.equal(zeile(lies(q, { von: 0, bis: 4 }), 2), '00  | ... .. ... .. . / E-3 64 ... .. . / G-3 64 ... .. .  ... ..');
  assert.deepEqual(q.spuren[0].clips[0].noten.map((n) => n.ton).sort(), [64, 67]);
});

test('an unchanged text still writes nothing for a chord (no pin commands)', () => {
  const p = akkord();
  const r = schreibeBereich(p, lies(p));
  assert.deepEqual(r.befehle, []);
  assert.equal(r.ohne_aenderung, true);
});

// ---------- property: a read text with random cell edits reads back as written, or the write is refused ----------
function zufall(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
test('property: 200 random edits of a read text: lesen(schreiben(text)) == text, or the writing is refused', () => {
  const p = bau(['Lead', 'Bass'], [
    { spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(0, 1, 64), N(0, 1, 67), N(0.5, 0.25, 72), N(1, 1, 62, { spalte: 2 }), N(2, 1, 60), N(2, 0.5, 65)] },
    { spur: 1, start_beat: 0, laenge_beats: 16, noten: [N(0, 0.5, 48), N(1, 0.25, 50), N(2, 2, 52), N(2.25, 1, 55)] }]);
  const rnd = zufall(20261119);
  const toene = ['C-3', 'D-3', 'E-3', 'F-3', 'G-3', 'A-3', 'C-4'];
  let angenommen = 0, abgelehnt = 0;
  // a stale note off (its note was cut by another cell) is allowed to differ: compare without the note offs
  const ohneAus = (x) => x.replace(/=== \.\. \.\.\. \.\. \./g, LEER);
  for (let i = 0; i < 200; i++) {
    let text = lies(p, { von: 0, bis: 15 });
    for (let m = 1 + Math.floor(rnd() * 3); m > 0; m--) {
      const nr = 2 + Math.floor(rnd() * 16);
      const bl = teile(text.split('\n')[nr]).bl;
      const bi = Math.floor(rnd() * bl.length);
      const c = Math.floor(rnd() * bl[bi].split('  ')[0].split(' / ').length);
      const art = Math.floor(rnd() * 3);
      const ton = toene[Math.floor(rnd() * toene.length)];
      text = spalteSetzen(text, nr, c, art === 0 ? LEER : `${ton} ${art === 1 ? '64' : '40'} ... .. .`, bi);
    }
    check(text);
  }
  function check(text) {
    let r;
    try { r = schreibeBereich(p, text); } catch (e) { assert.ok(e instanceof TrackerTextFehler, String(e)); abgelehnt++; return; }
    angenommen++;
    assert.equal(kuerze(ohneAus(lies(wende(p, r), { von: 0, bis: 15 }))), kuerze(ohneAus(text)));
  }
  assert.ok(angenommen >= 150, `enough edits are accepted to make the property meaningful (accepted ${angenommen}, refused ${abgelehnt})`);
});

// ---------- note off, hidden notes ----------
test('a note off where no note sounds is refused with its line; a note off under a sounding note cuts it', () => {
  const p = bau(['Bass'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]);
  const t = lies(p, { von: 0, bis: 8 });
  const e = fehler(() => schreibeBereich(p, setze(t, 8, '06  | === .. ... .. .  ... ..')));
  assert.equal(e.zeile, 9);
  assert.match(e.text, /note off where no note sounds/);
  const r = schreibeBereich(p, setze(t, 5, '03  | === .. ... .. .  ... ..'));
  assert.ok(r.befehle.length > 0);
});

test('hidden notes: the head names them, an unchanged text writes nothing, an edit leaves them alone', () => {
  const noten = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => N(0, 1, 60 + i));
  const p = bau(['Pad'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten }]);
  const t = lies(p, { von: 0, bis: 2 });
  assert.match(zeile(t, 0), /  hidden: A 1$/);
  assert.deepEqual(schreibeBereich(p, t).befehle, []);
  const hidden = p.spuren[0].clips[0].noten.at(-1).id;
  const r = schreibeBereich(p, setze(t, 2, zeile(t, 2).replace('C-3 64', 'C-3 50')));
  assert.ok(r.befehle.length > 0);
  assert.ok(!JSON.stringify(r.befehle).includes(`"${hidden}"`), 'the hidden note is not in a command');
  assert.equal(wende(p, r).spuren[0].clips[0].noten.length, 9);
});

// ---------- effect commands ----------
const mitFx = (extra = []) => {
  const p = bau(['Lead'], [{ spur: 0, start_beat: 0, laenge_beats: 16, noten: [N(0, 4, 60)] }]);
  return lauf(p, [{ befehl: 'fx_setzen', clip_id: p.spuren[0].clips[0].id, eintraege: [
    { beat: 0, spalte: 0, code: 'VIB', wert: 0x46 }, { beat: 0.25, spalte: 1, code: 'ARP', wert: 0x37 }, ...extra] }]);
};
test('effect commands read as `CODE vv` in their column', () => {
  const t = lies(mitFx(), { von: 0, bis: 1 });
  assert.match(zeile(t, 2), /C-3 64 \.\.\. \.\. \.  VIB 46  \.\.\. \.\./);
  assert.match(zeile(t, 3), /\.\.\. \.\. \.\.\. \.\. \.  \.\.\. \.\.  ARP 37/);
});
test('effect commands: reading and writing back unchanged is 0 commands (whole section, with knob values too)', () => {
  const p = mitFx();
  assert.deepEqual(schreibeBereich(p, lies(p)).befehle, []);
  const q = lauf(p, [{ befehl: 'huellkurve_setzen', clip_id: p.spuren[0].clips[0].id, ziel: 'geraet.k12', punkte: [{ beat: 0, wert: 0.5, form: 'sprung' }] }]);
  assert.deepEqual(schreibeBereich(q, lies(q)).befehle, []);
  assert.match(lies(q, { von: 0, bis: 0 }), /VIB 46 +K12 /);
});
test('effect commands: a new code, a changed value and a cleared cell write fx_setzen, in one undo step with the notes', () => {
  const p = mitFx();
  const t = lies(p, { von: 0, bis: 3 });
  let r = schreibeBereich(p, setze(t, 4, zeile(t, 4).replace('... ..  ... ..  ... ..', '... ..  ... ..  ... ..').replace(/  \.\.\. \.\.$/, '  GLD 0A')));
  assert.ok(r.befehle.every((b) => b.befehl === 'fx_setzen'), JSON.stringify(r.befehle));
  assert.ok(wende(p, r).spuren[0].clips[0].fx.some((e) => e.code === 'GLD' && e.wert === 10));
  r = schreibeBereich(p, setze(t, 2, zeile(t, 2).replace('VIB 46', 'VIB 47')));
  assert.deepEqual(r.befehle.map((b) => b.befehl), ['fx_setzen']);
  assert.deepEqual(wende(p, r).spuren[0].clips[0].fx.find((e) => e.code === 'VIB'), { beat: 0, spalte: 0, code: 'VIB', wert: 0x47 });
  r = schreibeBereich(p, setze(t, 2, zeile(t, 2).replace('VIB 46', '... ..')));
  assert.equal(wende(p, r).spuren[0].clips[0].fx.some((e) => e.code === 'VIB'), false);
  // together with a note change: one command list
  r = schreibeBereich(p, setze(t, 2, zeile(t, 2).replace('C-3 64', 'D-3 64').replace('VIB 46', 'TRM 80')));
  const q = wende(p, r);
  assert.equal(q.spuren[0].clips[0].noten[0].ton, 62);
  assert.ok(q.spuren[0].clips[0].fx.some((e) => e.code === 'TRM' && e.wert === 128));
  assert.equal(lies(q, { von: 0, bis: 3 }), setze(t, 2, zeile(t, 2).replace('C-3 64', 'D-3 64').replace('VIB 46', 'TRM 80')));
});
test('effect commands: lower case code, unknown code and a missing clip are refused with the line', () => {
  const p = mitFx();
  const t = lies(p, { von: 0, bis: 1 });
  assert.deepEqual(schreibeBereich(p, setze(t, 2, zeile(t, 2).replace('VIB', 'vib'))).befehle, []);
  const e = fehler(() => schreibeBereich(p, setze(t, 2, zeile(t, 2).replace('VIB 46', 'WOB 46'))));
  assert.equal(e.zeile, 3);
  assert.match(e.text, /WOB/);
  fehler(() => schreibeBereich(p, setze(t, 2, zeile(t, 2).replace('VIB 46', 'VIB 4G'))));
  const leer = bau(['Lead']);
  const lt = lies(leer, { von: 0, bis: 1 });
  assert.equal(fehler(() => schreibeBereich(leer, setze(lt, 3, zeile(lt, 3).replace(/  \.\.\. \.\.$/, '  VIB 10')))).zeile, 4);
});
