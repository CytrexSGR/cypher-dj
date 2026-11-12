// Nested groups T7: the tree layout of the arrangement, the descendant-wide state dots of a folded parent, the output options of a group head,
// the strip order of the mixer and Ctrl+G with group heads in the selection. Pure, node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gruppenLayout, zeilenFuer, zeilenHoehe, GRUPPEN_HOEHE, SPUR_HOEHE } from '../public/production/layout.js';
import { gruppenKopfZustand, gruppeAusWahl, ausgangOptionen, gruppenStreifenFolge } from '../public/production/routing.js';
import { fuehreAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';

const sp = (id, g = null, extra = {}) => ({ id, name: id, clips: [], ...(g ? { ausgang: { art: 'gruppe', id: g } } : {}), ...extra });
const gr = (id, nr, ueber = null, extra = {}) => ({ id, nr, name: id.toUpperCase(), gefaltet: false, farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false,
  ...(ueber ? { ausgang: { art: 'gruppe', id: ueber } } : {}), ...extra });
// DRUMS(KICK(t1, t2), PERC(t3), t4)
const drums = (g1 = {}) => ({ spuren: [sp('t1', 'kick'), sp('t2', 'kick'), sp('t3', 'perc'), sp('t4', 'drums')],
  gruppen: [gr('drums', 1, null, g1), gr('kick', 2, 'drums'), gr('perc', 3, 'drums')] });
const beschr = (p) => gruppenLayout(p).folge.map((f) => (f.art === 'gruppe' ? p.gruppen[f.gruppe].id : p.spuren[f.spur].id));
const tiefen = (p) => gruppenLayout(p).folge.map((f) => f.tiefe ?? 0);

test('T7 gruppenLayout: DRUMS(KICK(t1,t2), PERC(t3), t4) is a tree with depths 0,1,2,2,1,2,1', () => {
  const p = drums();
  assert.deepEqual(beschr(p), ['drums', 'kick', 't1', 't2', 'perc', 't3', 't4']);
  assert.deepEqual(tiefen(p), [0, 1, 2, 2, 1, 2, 1]);
  assert.equal(gruppenLayout(p).folge.some((f) => f.verborgen), false);
});

test('T7 folding DRUMS hides everything below it (groups and tracks), folding KICK only its tracks', () => {
  const zu = drums({ gefaltet: true });
  assert.deepEqual(gruppenLayout(zu).folge.map((f) => !!f.verborgen), [false, true, true, true, true, true, true]);
  const tab = zeilenFuer(zu);
  assert.equal(zeilenHoehe(tab), GRUPPEN_HOEHE, 'only the DRUMS header row has height');
  assert.deepEqual(tab.filter((z) => z.h > 0).map((z) => z.art), ['gruppe']);
  assert.equal(tab.filter((z) => z.art === 'gruppe' && z.verborgen).length, 2, 'the child group rows exist as hidden rows of height 0');
  const kz = drums(); kz.gruppen[1].gefaltet = true;
  assert.deepEqual(gruppenLayout(kz).folge.map((f) => !!f.verborgen), [false, false, true, true, false, false, false]);
  assert.equal(zeilenHoehe(zeilenFuer(kz)), 3 * GRUPPEN_HOEHE + 2 * SPUR_HOEHE, 'DRUMS, KICK, PERC rows plus t3 and t4');
});

test('T7 sibling order: array position of the first track or child; a group with only child groups sits at its first child', () => {
  // t1 and t5 are loose; OUTER holds only the groups A (t2) and B (t3); C (t4) is top level
  const p = { spuren: [sp('t1'), sp('t2', 'a'), sp('t3', 'b'), sp('t4', 'c'), sp('t5')],
    gruppen: [gr('outer', 1), gr('a', 2, 'outer'), gr('b', 3, 'outer'), gr('c', 4)] };
  assert.deepEqual(beschr(p), ['t1', 'outer', 'a', 't2', 'b', 't3', 'c', 't4', 't5']);
  assert.deepEqual(tiefen(p), [0, 0, 1, 2, 1, 2, 0, 1, 0]);
  // a child group listed before the group's own track in the array
  const q = { spuren: [sp('x1', 'in'), sp('x2', 'top')], gruppen: [gr('top', 1), gr('in', 2, 'top')] };
  assert.deepEqual(beschr(q), ['top', 'in', 'x1', 'x2']);
  // a group without any track below it has no row; a cycle or an unknown parent does not hang
  assert.deepEqual(beschr({ spuren: [sp('t1')], gruppen: [gr('leer', 1), gr('leer2', 2, 'leer')] }), ['t1']);
  assert.deepEqual(beschr({ spuren: [sp('t1', 'a')], gruppen: [gr('a', 1, 'zz')] }), ['a', 't1']);
  assert.equal(beschr({ spuren: [sp('t1', 'a')], gruppen: [gr('a', 1, 'b'), gr('b', 2, 'a')] }).includes('t1'), true, 'a cycle in a damaged file still shows the track');
});

test('T7 flat project: rows and entries as before (a top-level group row carries no tiefe)', () => {
  const p = { spuren: [sp('s1'), sp('s2', 'g1'), sp('s3')], gruppen: [gr('g1', 1)] };
  assert.deepEqual(gruppenLayout(p).folge, [{ art: 'spur', spur: 0, tiefe: 0, verborgen: false }, { art: 'gruppe', gruppe: 0 },
    { art: 'spur', spur: 1, tiefe: 1, verborgen: false }, { art: 'spur', spur: 2, tiefe: 0, verborgen: false }]);
});

test('T7 gruppenKopfZustand of a folded parent reports an armed track two levels down, and counts every descendant', () => {
  const p = drums({ gefaltet: true });
  p.spuren[1] = sp('t2', 'kick', { aufnahme: { scharf: true } });
  const z = gruppenKopfZustand(p, 'drums');
  assert.deepEqual(z, { gefaltet: true, mitglieder: 4, armiert: true, solo: false, stumm: false, lane: false });
  assert.equal(gruppenKopfZustand(p, 'perc').armiert, false, 'a sibling branch does not light it');
  assert.equal(gruppenKopfZustand(p, 'kick').armiert, true);
  // solo, mute and an open lane deep inside; a muted child group counts as muted
  const q = drums({ gefaltet: true }); q.spuren[2] = sp('t3', 'perc', { solo: true }); q.gruppen[1].mute = true;
  const y = gruppenKopfZustand(q, 'drums', new Set(['t1']));
  assert.deepEqual([y.solo, y.stumm, y.lane, y.armiert], [true, true, true, false]);
});

test('T7 ausgangOptionen of a group head: Master and the groups that are neither itself nor below it', () => {
  const p = drums();
  assert.deepEqual(ausgangOptionen(p, 'kick').map((o) => o.wert), ['master', 'drums', 'perc']);
  assert.deepEqual(ausgangOptionen(p, 'drums').map((o) => o.wert), ['master'], 'everything else is below DRUMS');
  assert.deepEqual(ausgangOptionen(p).map((o) => o.wert), ['master', 'drums', 'kick', 'perc'], 'a track may feed any group');
});

test('T7 strip order of the mixer: depth first by group number; a flat project keeps the number order', () => {
  assert.deepEqual(gruppenStreifenFolge(drums()), [{ id: 'drums', tiefe: 0 }, { id: 'kick', tiefe: 1 }, { id: 'perc', tiefe: 1 }]);
  const p = { spuren: [], gruppen: [gr('b', 2), gr('a', 1), gr('c', 3, 'b'), gr('d', 4, 'c')] };
  assert.deepEqual(gruppenStreifenFolge(p), [{ id: 'a', tiefe: 0 }, { id: 'b', tiefe: 0 }, { id: 'c', tiefe: 1 }, { id: 'd', tiefe: 2 }]);
  assert.deepEqual(gruppenStreifenFolge({ gruppen: [gr('x', 1, 'weg')] }), [{ id: 'x', tiefe: 0 }], 'unknown parent: top level');
});

test('T7 Ctrl+G on {KICK head, t4}: one new group holding KICK and t4, nothing outside the selection changes (a real project, the server applies it)', () => {
  let p = neuesProjekt('T');
  for (let i = 0; i < 4; i++) p = fuehreAus(p, { befehl: 'spur_neu', art: 'audio', name: `T${i + 1}` }).projekt;   // s1..s4
  p = fuehreAus(p, { befehl: 'gruppenspur_neu', name: 'KICK', mitglieder: ['s1', 's2'] }).projekt;               // g1
  p = fuehreAus(p, { befehl: 'gruppenspur_neu', name: 'PERC', mitglieder: ['s3'] }).projekt;                     // g2
  p = fuehreAus(p, { befehl: 'gruppenspur_neu', name: 'DRUMS', mitglieder: ['g1', 'g2', 's4'] }).projekt;        // g3
  assert.deepEqual(gruppenLayout(p).folge.map((f) => f.tiefe ?? 0), [0, 1, 2, 2, 1, 2, 1], 'the real project lays out as DRUMS(KICK(t1,t2), PERC(t3), t4)');
  const b = gruppeAusWahl(p, ['s4', 'g1']);   // the KICK head and t4
  assert.deepEqual(b, { befehl: 'gruppenspur_neu', mitglieder: ['g1', 's4'] });
  const nach = fuehreAus(p, b).projekt, neu = nach.gruppen.at(-1);
  assert.equal(nach.gruppen.length, 4);
  assert.deepEqual(nach.gruppen.find((g) => g.id === 'g1').ausgang, { art: 'gruppe', id: neu.id }, 'KICK is a child of the new group');
  assert.deepEqual(nach.spuren.find((s) => s.id === 's4').ausgang, { art: 'gruppe', id: neu.id });
  for (const s of ['s1', 's2', 's3']) assert.deepEqual(nach.spuren.find((x) => x.id === s), p.spuren.find((x) => x.id === s), s);
  for (const g of ['g2', 'g3']) assert.deepEqual(nach.gruppen.find((x) => x.id === g), p.gruppen.find((x) => x.id === g), g);
  assert.equal(p.gruppen.length, 3, 'input untouched');
});

test('T7 Ctrl+G: a selected track below a selected group stays where it is; a group and a track of another group move together', () => {
  const p = drums();
  assert.deepEqual(gruppeAusWahl(p, ['kick', 't1']), { befehl: 'gruppenspur_neu', mitglieder: ['kick'] }, 't1 is inside KICK: moving it would pull it out');
  assert.deepEqual(gruppeAusWahl(p, ['drums', 't3', 'kick']), { befehl: 'gruppenspur_neu', mitglieder: ['drums'] }, 'everything below DRUMS goes with it');
  // review focus: a group head and a track of another group
  assert.deepEqual(gruppeAusWahl(p, ['perc', 't1']), { befehl: 'gruppenspur_neu', mitglieder: ['t1', 'perc'] });
  assert.equal(gruppeAusWahl(p, ['nope']), null);
  assert.equal(gruppeAusWahl({ ...p, gruppen: Array.from({ length: 16 }, (_, i) => gr(`g${i}`, i + 1)) }, ['t1']), null, 'at 16 groups: nothing');
});
