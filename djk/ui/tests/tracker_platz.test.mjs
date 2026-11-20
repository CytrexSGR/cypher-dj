// Tracker task 19: device roles, the note field `platz` (slot) and the INS sub-column.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { neuesProjekt, pruefeProjekt, kanonisch } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { rolleFxAus, hatFxArbeit } from '../project/fx_ausrollen.ts';
import { listeGraphen } from '../graphs.ts';
import { pfadeVon } from '../devices_parameter.ts';
import { REPO, HIER } from '../paths.ts';
import { OHNE_DOKU } from './support/devices_doku.mjs';

const M = await import('../public/tracker/grid_model.js');
const { projiziere, zellText, statusText, rollenVonGraphen } = M;
const E = await import('../public/tracker/eingabe.js');
const { taste } = await import('../public/tracker/tasten.js');
const { zellBreite, spurPositionen } = await import('../public/tracker/grid_view.js');
const { kopiere, einsetzen } = await import('../public/tracker/auswahl.js');

const BK = { art: 'intern', name: 'bk', graph: 'amiga', parameter: {} };
const lauf = (p, b) => fuehreListeAus(structuredClone(p), b).projekt;
const basis = (clips = []) => {
  let p = lauf(neuesProjekt('x'), [{ befehl: 'spur_neu', art: 'instrument', name: 'I', geraet: BK }]);
  for (const c of clips) p = lauf(p, [{ befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 16, ...c }]);
  return p;
};
const N = (beat, laenge, ton = 60, extra = {}) => ({ beat, laenge, ton, vel: 100, ...extra });
const refuse = (p, b) => { try { fuehreListeAus(structuredClone(p), b); } catch (e) { return e; } return null; };

// ---- validation and commands ----
test('platz: stored 1..32 as a whole number, refused outside, never written absent', () => {
  const p = basis([{ noten: [N(0, 1, 60, { platz: 3 }), N(1, 1, 62, { platz: 1 }), N(2, 1, 64, { platz: 32 }), N(3, 1, 65)] }]);
  const n = p.spuren[0].clips[0].noten;
  assert.deepEqual(n.map((x) => x.platz), [3, 1, 32, undefined]);
  assert.ok(!('platz' in n[3]));
  assert.ok(pruefeProjekt(JSON.parse(JSON.stringify(p))).projekt);
  for (const bad of [0, 33, 1.5, -1, '3']) {
    const e = refuse(basis(), [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [N(0, 1, 60, { platz: bad })] }]);
    assert.ok(e && e.grund === 'argument_ungueltig', `platz ${bad}: ${e && e.message}`);
    const q = JSON.parse(JSON.stringify(p)); q.spuren[0].clips[0].noten[0].platz = bad;
    assert.ok(pruefeProjekt(q).fehler, `file with platz ${bad} is refused`);
  }
});

test('noten_aendern sets and removes platz (null); noten_neu accepts it', () => {
  let p = basis([{ noten: [N(0, 1, 60)] }]);
  const id = p.spuren[0].clips[0].noten[0].id;
  p = lauf(p, [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id, platz: 7 }] }]);
  assert.equal(p.spuren[0].clips[0].noten[0].platz, 7);
  p = lauf(p, [{ befehl: 'noten_neu', clip_id: 'c1', noten: [N(1, 1, 62, { platz: 2 })] }]);
  assert.equal(p.spuren[0].clips[0].noten[1].platz, 2);
  p = lauf(p, [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id, platz: null }] }]);
  assert.ok(!('platz' in p.spuren[0].clips[0].noten[0]));
  assert.ok(refuse(p, [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id, platz: 33 }] }]));
});

test('a project without platz is byte for byte as before: the commands write nothing for it', () => {
  const a = basis([{ noten: [N(0, 1, 60), N(1, 1, 62, { chance: 50 })] }]);
  assert.ok(!kanonisch(a).includes('platz'));
  const b = lauf(a, [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: a.spuren[0].clips[0].noten[0].id, vel: 90 }] }]);
  assert.ok(!kanonisch(b).includes('platz'));
});

test('PRODUCTION commands keep platz: split, clip duplicate, join; linked clips fan it out', () => {
  let p = basis([{ noten: [N(0, 1, 60, { platz: 3 }), N(6, 1, 62, { platz: 9 })] }]);
  p = lauf(p, [{ befehl: 'clip_teilen', clip_id: 'c1', beat: 4 }]);
  const alle = () => p.spuren[0].clips.flatMap((c) => c.noten.map((n) => n.platz));
  assert.deepEqual(alle().sort(), [3, 9]);
  const dup = lauf(p, [{ befehl: 'clip_duplizieren', clip_id: p.spuren[0].clips[0].id }]);
  assert.equal(dup.spuren[0].clips.flatMap((c) => c.noten).filter((n) => n.platz === 3).length, 2);
  const ver = lauf(p, [{ befehl: 'clips_verbinden', clip_ids: p.spuren[0].clips.map((c) => c.id) }]);
  assert.deepEqual(ver.spuren[0].clips[0].noten.map((n) => n.platz).sort(), [3, 9]);
  // linked clips: a note inserted with platz reaches the other member with the field
  let q = basis([{ noten: [N(0, 1, 60)] }]);
  q = lauf(q, [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 16, laenge_beats: 16, noten: [N(9, 1, 70)] }]);
  q = lauf(q, [{ befehl: 'clip_verknuepfen', clip_id: q.spuren[0].clips[1].id, mit: 'c1' }]);
  q = lauf(q, [{ befehl: 'noten_neu', clip_id: 'c1', noten: [N(2, 1, 64, { platz: 5 })] }]);
  for (const c of q.spuren[0].clips) assert.deepEqual(c.noten.filter((n) => n.platz !== undefined).map((n) => n.platz), [5], c.id);
});

// ---- unrolling ----
const clipX = (noten, extra = {}) => ({ id: 'c', art: 'midi', name: 'c', start_beat: 0, laenge_beats: 8, noten, ...extra });
const rahmen = (o = {}) => ({ lpb: 4, ticks: 6, stufig: true, rollen: { slot: 5 }, ...o });
const roll = (c, r) => rolleFxAus(c, r, () => {});

test('a note with platz 3 makes a slot point 2/31 at its start', () => {
  const a = roll(clipX([N(1, 1, 60, { platz: 3 })]), rahmen());
  assert.deepEqual([...a.regler], [[5, [[1, 2 / 31]]]]);
  assert.deepEqual([a.bend, a.pegel, a.pan], [[], [], []]);
});

test('notes without platz stand on the track knob when the clip uses platz; the slot returns to it at the clip end', () => {
  const c = clipX([N(0, 1, 60, { platz: 3 }), N(2, 1, 62), N(4, 1, 64, { platz: 32 })]);
  const a = roll(c, rahmen({ slotBasis: 0.5 }));
  assert.deepEqual(a.regler.get(5), [[0, 2 / 31], [2, 0.5], [4, 1], [8, 0.5]]);
  // without a known knob value nothing is claimed for notes without platz and nothing is reset
  assert.deepEqual(roll(c, rahmen()).regler.get(5), [[0, 2 / 31], [4, 1]]);
  // a clip that does not use platz stays silent for the slot role
  assert.equal(roll(clipX([N(0, 1, 60)]), rahmen({ slotBasis: 0.5 })).regler.size, 0);
  // the last note ends on the knob value already: no extra point at the clip end
  assert.deepEqual(roll(clipX([N(0, 1, 60, { platz: 1 })]), rahmen({ slotBasis: 0 })).regler.get(5), [[0, 0]]);
});

test('platz with fx in the clip, loops and a device without the role', () => {
  const c = clipX([N(0, 1, 60, { platz: 2 })], { loop_beats: 4, fx: [{ beat: 1, spalte: 0, code: 'PAN', wert: 0x80 }] });
  assert.deepEqual(roll(c, rahmen()).regler.get(5).slice(0, 2), [[0, 1 / 31], [4, 1 / 31]]);
  assert.equal(roll(clipX([N(0, 1, 60, { platz: 2 })]), rahmen({ rollen: {} })).regler.size, 0);
  assert.equal(roll(clipX([N(0, 1, 60)]), rahmen({ rollen: {} })).regler.size, 0);
});

test('hatFxArbeit: effects, or platz on a device with the slot role', () => {
  const sp = [{ beat: 0, spalte: 0, code: 'PAN', wert: 1 }];
  assert.equal(hatFxArbeit(clipX([N(0, 1)]), rahmen()), false);
  assert.equal(hatFxArbeit(clipX([N(0, 1)], { fx: sp }), rahmen()), true);
  assert.equal(hatFxArbeit(clipX([N(0, 1, 60, { platz: 2 })]), rahmen()), true);
  assert.equal(hatFxArbeit(clipX([N(0, 1, 60, { platz: 2 })]), rahmen({ rollen: {} })), false);
});

// ---- projection and cell text ----
const rollenAmiga = (g) => (g?.graph === 'amiga' ? { slot: 5, start: 6, rueckwaerts: 7 } : null);
const mitPlatz = () => basis([{ noten: [N(0, 1, 60, { platz: 3 }), N(1, 1, 62), N(2, 1, 64, { platz: 12 })] }]);

test('INS is shown only with the slot role (RSpur.ins)', () => {
  const p = mitPlatz();
  assert.equal(projiziere(p, { abschnitt_id: 'a1', rollen: rollenAmiga }).spuren[0].ins, true);
  assert.ok(!('ins' in projiziere(p, { abschnitt_id: 'a1' }).spuren[0]));
  assert.ok(!('ins' in projiziere(p, { abschnitt_id: 'a1', rollen: () => ({ start: 6 }) }).spuren[0]));
  assert.ok(!('ins' in projiziere(p, { abschnitt_id: 'a1', rollen: () => null }).spuren[0]));
  const sp = projiziere(p, { abschnitt_id: 'a1', rollen: rollenAmiga }).spuren[0];
  const z = (r) => sp.notenspalten[0][r];
  assert.deepEqual([0, 4, 5, 8].map((r) => zellText(z(r), 'ins')), ['03', '..', '..', '12']);   // lpb 4: beats 0, 1, 2 are rows 0, 4, 8
  assert.equal(zellText(null, 'ins'), '..');
  assert.equal(z(0).note.platz, 3);
});

test('the INS cursor place and its width: only on tracks with the slot role, after NOTE, ranked into the width calculation', () => {
  const opt = { spaltenAn: { vol: true, dly: false, chn: false, rpt: false, fx: false }, audioAn: true, anzahl: () => ({ n: 1, f: 1 }) };
  const ohne = spurPositionen({ art: 'instrument' }, 0, opt).map((x) => x.unterspalte);
  const mit = spurPositionen({ art: 'instrument', ins: true }, 0, opt).map((x) => x.unterspalte);
  assert.deepEqual(ohne, ['note', 'vol']);
  assert.deepEqual(mit, ['note', 'ins', 'vol']);
  assert.equal(zellBreite('ins', 'hex'), 2);
  assert.equal(zellBreite('ins', 'dec'), 2);
});

test('the status line names the slot of a note and of one without platz', () => {
  const r = projiziere(mitPlatz(), { abschnitt_id: 'a1', rollen: rollenAmiga });
  const cur = (zeile) => ({ spur: 0, spalte: 0, zeile, unterspalte: 'ins' });
  assert.match(statusText(r, cur(0), 'hex'), /slot 3/);
  assert.match(statusText(r, cur(4), 'hex'), /slot the knob stands on/);
  assert.match(statusText(r, cur(5), 'hex'), /empty/);
});

test('the status line names the real slot count of the bank, and what plays when the note points past it', () => {
  const r = projiziere(mitPlatz(), { abschnitt_id: 'a1', rollen: rollenAmiga });
  const cur = (zeile) => ({ spur: 0, spalte: 0, zeile, unterspalte: 'ins' });
  assert.match(statusText(r, cur(0), 'hex'), /slot 3 of 32$/, 'the bank size is not known: 32');
  assert.match(statusText(r, cur(0), 'hex', { platzZahl: 8 }), /slot 3 of 8$/);
  assert.match(statusText(r, cur(8), 'hex', { platzZahl: 8 }), /slot 12 of 8 \(the bank has 8 slots: it plays slot 8\)$/);
  assert.match(statusText(r, cur(8), 'hex', { platzZahl: 12 }), /slot 12 of 12$/, 'a slot equal to the bank size is inside');
});

test('rollenVonGraphen: the entries of GET /graphen give the roles of a bk device', () => {
  const f = rollenVonGraphen([{ name: 'amiga', rollen: { slot: 1 } }, { name: 'amiga-b1', rollen: { slot: 1, start: 2 } }, { name: 'lead' }]);
  assert.deepEqual(f(BK), { slot: 1 });
  assert.deepEqual(f({ art: 'intern', name: 'bk', graph: 'amiga-b1' }), { slot: 1, start: 2 });
  assert.equal(f({ art: 'intern', name: 'bk', graph: 'lead' }), null);
  assert.equal(f({ art: 'intern', name: 'kit', kit: 'x' }), null);
  assert.equal(f(undefined), null);
  assert.equal(rollenVonGraphen(undefined)(BK), null);
});

// ---- entry ----
const ort = (p, zeile, o = {}) => ({ abschnitt_id: 'a1', spur_id: p.spuren[0].id, spalte: 0, zeile, unterspalte: 'ins', ...o });
const wende = (p, r) => { assert.ok(r && !r.fehler, JSON.stringify(r)); return lauf(p, r.befehle); };

test('wertSetzen ins: 1..32 sets platz, null clears it, outside refuses, no note refuses, same value is nothing to do', () => {
  const p = basis([{ noten: [N(0, 1, 60), N(1, 1, 62, { platz: 4 })] }]);
  assert.equal(wende(p, E.wertSetzen(p, ort(p, 0), 'ins', 9)).spuren[0].clips[0].noten[0].platz, 9);
  assert.ok(!('platz' in wende(p, E.wertSetzen(p, ort(p, 4), 'ins', null)).spuren[0].clips[0].noten[1]));
  assert.equal(E.wertSetzen(p, ort(p, 4), 'ins', 4), null);
  assert.equal(E.wertSetzen(p, ort(p, 0), 'ins', null), null);
  for (const bad of [0, 33, 1.5]) assert.match(E.wertSetzen(p, ort(p, 0), 'ins', bad).fehler, /Slot 1\.\.32 expected/);
  assert.match(E.wertSetzen(p, ort(p, 8), 'ins', 3).fehler, /No note in this cell/);
  assert.equal(E.zelleLeeren(p, ort(p, 4)).label, 'Clear cell');
  assert.ok(!('platz' in wende(p, E.zelleLeeren(p, ort(p, 4))).spuren[0].clips[0].noten[1]));
});

test('noteSchreiben takes opts.platz for a new note and for a retyped one', () => {
  const p = basis([{ noten: [N(0, 1, 60)] }]);
  const neu = E.noteSchreiben(p, { ...ort(p, 4), unterspalte: 'note' }, 64, { platz: 6 });
  assert.equal(neu.befehle.at(-1).noten[0].platz, 6);
  assert.equal(wende(p, neu).spuren[0].clips[0].noten.find((n) => n.ton === 64).platz, 6);
  const alt = E.noteSchreiben(p, { ...ort(p, 0), unterspalte: 'note' }, 62, { platz: 2 });
  assert.equal(wende(p, alt).spuren[0].clips[0].noten[0].platz, 2);
  const ohne = E.noteSchreiben(p, { ...ort(p, 4), unterspalte: 'note' }, 64, {});
  assert.ok(!('platz' in ohne.befehle.at(-1).noten[0]));
  assert.match(E.noteSchreiben(p, { ...ort(p, 4), unterspalte: 'note' }, 64, { platz: 33 }).fehler, /Slot 1\.\.32 expected/);
});

test('retyping a note keeps its platz; the tracker clipboard carries it', () => {
  const p = basis([{ noten: [N(0, 4, 60, { platz: 3 })] }]);
  const q = wende(p, E.noteSchreiben(p, { ...ort(p, 0), unterspalte: 'note' }, 62, {}));
  assert.equal(q.spuren[0].clips[0].noten[0].platz, 3);
  const w = { abschnitt_id: 'a1', spur_von: 0, spur_bis: 0, zeile_von: 0, zeile_bis: 0, spalten: 'eine', spalte: 0, unterspalte: 'note' };
  const ablage = kopiere(p, w);
  assert.equal(ablage.spuren[0].noten[0].platz, 3);
  const r = einsetzen(p, { abschnitt_id: 'a1', spur_id: p.spuren[0].id, zeile: 8, spalte: 0, unterspalte: 'note' }, ablage);
  const nach = wende(p, r).spuren[0].clips.flatMap((c) => c.noten).filter((n) => n.beat === 2);
  assert.deepEqual(nach.map((n) => n.platz), [3]);
});

// ---- keys ----
test('INS takes decimal digits and nothing else', () => {
  const e = (code, extra = {}) => ({ code, key: code.replace('Digit', ''), shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra });
  assert.deepEqual(taste(e('Digit7'), { unterspalte: 'ins' }), { art: 'ziffer', wert: 7 });
  assert.equal(taste(e('KeyA'), { unterspalte: 'ins', zahlen: 'hex' }), null);
  assert.equal(taste(e('Minus'), { unterspalte: 'ins' }), null);
});

// ---- register: /graphen entry and device.ts ----
test('GET /graphen entries carry fx_stufig and rollen from the register, only when present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platz-graphen-'));
  try {
    const g = (name) => JSON.stringify({ name, art: 'instrument', knoten: [{ id: 'r', art: 'regler', nr: 1, min: 0, max: 1 }], kanten: [] });
    for (const n of ['amiga-x', 'plain']) fs.writeFileSync(path.join(dir, `${n}.json`), g(n));
    const fx = (n) => (n === 'amiga-x' ? { stufig: true, rollen: { slot: 1, start: 2 } } : { stufig: false, rollen: {} });
    const l = Object.fromEntries(listeGraphen(dir, {}, fx).graphen.map((e) => [e.name, e]));
    assert.equal(l['amiga-x'].fx_stufig, true);
    assert.deepEqual(l['amiga-x'].rollen, { slot: 1, start: 2 });
    assert.ok(!('fx_stufig' in l.plain) && !('rollen' in l.plain), 'no fields for a device without them');
    assert.deepEqual(listeGraphen(dir).graphen.find((e) => e.name === 'plain'), l.plain, 'the default reads the repo register');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const geraetTest = (name, fn) => test(name, { skip: OHNE_DOKU }, fn);
const TOOL = path.join(HIER, 'tool', 'device.ts');
// only the lines about roles count here: the rest of the output is the state of the repo (panels of recipe graphs), not this task's business
const pruefen = (dir) => {
  const r = spawnSync(process.execPath, [TOOL, 'pruefen', '--wurzel', dir], { encoding: 'utf8', cwd: HIER });
  return { ...r, rollen: r.stdout.split('\n').filter((x) => x.includes(': rollen.')) };
};
function kopieRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platz-geraet-'));
  const von = pfadeVon(REPO), nach = pfadeVon(dir);
  fs.mkdirSync(nach.bk, { recursive: true });
  for (const sub of ['demos', 'paneele']) fs.cpSync(path.join(von.bk, sub), path.join(nach.bk, sub), { recursive: true });
  fs.copyFileSync(von.register, nach.register);
  fs.copyFileSync(von.kategorien, nach.kategorien);
  fs.cpSync(von.doku, nach.doku, { recursive: true });
  fs.cpSync(von.werkPresets, nach.werkPresets, { recursive: true });
  fs.mkdirSync(path.dirname(nach.surge), { recursive: true }); fs.copyFileSync(von.surge, nach.surge);
  return { dir, P: nach };
}
function setzeRollen(P, rollen, rastet) {
  const reg = JSON.parse(fs.readFileSync(P.register, 'utf8'));
  reg.find((e) => e.name === 'synth-mono').rollen = rollen;
  fs.writeFileSync(P.register, JSON.stringify(reg, null, 1));
  const gf = path.join(P.beispiele, 'synth-mono.json');
  const g = JSON.parse(fs.readFileSync(gf, 'utf8'));
  for (const k of g.knoten) if (k.art === 'regler' && rastet.includes(k.nr)) k.rastet = 1;
  fs.writeFileSync(gf, JSON.stringify(g));
}

geraetTest('device.ts pruefen: a role needs a knob that exists and is latched in the graph', () => {
  const { dir, P } = kopieRepo();
  try {
    assert.deepEqual(pruefen(dir).rollen, [], 'positive control: no role, no role line');
    setzeRollen(P, { slot: 1, start: 2 }, [1, 2]);
    const gut = pruefen(dir);
    assert.deepEqual(gut.rollen, [], gut.stdout);
    setzeRollen(P, { slot: 1, start: 2 }, [1]);                                  // knob 2 was latched above: undo that for 2
    const g2 = JSON.parse(fs.readFileSync(path.join(P.beispiele, 'synth-mono.json'), 'utf8'));
    for (const k of g2.knoten) if (k.art === 'regler' && k.nr === 2) delete k.rastet;
    fs.writeFileSync(path.join(P.beispiele, 'synth-mono.json'), JSON.stringify(g2));
    const nicht = pruefen(dir);
    assert.deepEqual(nicht.rollen, ['synth-mono: rollen.start: knob 2 is not latched (rastet 1) in the graph']);
    setzeRollen(P, { slot: 1, rueckwaerts: 64 }, [1]);
    const fehlt = pruefen(dir);
    assert.deepEqual(fehlt.rollen, ['synth-mono: rollen.rueckwaerts: knob 64 does not exist in the graph']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
