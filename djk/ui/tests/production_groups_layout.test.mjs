// 1.10 T3: groups in the arrangement: the derived display order (gruppenLayout), the row table with header rows and hidden members, the pure
// helpers of the header (gruppenKopfZustand) and of Ctrl+G (gruppeAusWahl). Pure, node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zeilenTabelle, zeilenFuer, zeilenHoehe, zeileBei, spurIndexBeiTabelle, spurZeile, gruppenLayout, GRUPPEN_HOEHE }
  from '../public/production/layout.js';
import { trefferClip } from '../public/production/clips.js';
import { gruppenKopfZustand, gruppeAusWahl } from '../public/production/routing.js';

const sp = (id, g = null, extra = {}) => ({ id, name: id, clips: [], ...(g ? { ausgang: { art: 'gruppe', id: g } } : {}), ...extra });
const gr = (id, nr, gefaltet = false) => ({ id, nr, name: `G${nr}`, gefaltet });
const A = { beat0: 0, pxProBeat: 10 };

test('T3 table without layout is byte-equal to the old one (golden of the S1 table)', () => {
  const tab = zeilenTabelle(5, [1], new Map([[2, 1]]));
  assert.equal(JSON.stringify(tab), JSON.stringify([
    { art: 'spur', spur: 0, y: 0, h: 64 }, { art: 'spur', spur: 1, y: 64, h: 64 }, { art: 'lane', spur: 1, y: 128, h: 48 },
    { art: 'spur', spur: 2, y: 176, h: 64 }, { art: 'take', spur: 2, take: 0, y: 240, h: 40 },
    { art: 'spur', spur: 3, y: 280, h: 64 }, { art: 'spur', spur: 4, y: 344, h: 64 }]));
  assert.equal(JSON.stringify(zeilenFuer({ spuren: [sp('s1'), sp('s2')], gruppen: [gr('g1', 1)] }, [], new Map())), JSON.stringify(zeilenTabelle(2)), 'a group without members: no layout');
});

const P = { spuren: [sp('s1'), sp('s2', 'g1'), sp('s3'), sp('s4', 'g2'), sp('s5', 'g1'), sp('s6', 'g2')], gruppen: [gr('g1', 1), gr('g2', 2, true), gr('g3', 3)] };

test('T3 gruppenLayout: header at the first member, members cluster after it (non-contiguous), empty group has no row', () => {
  assert.deepEqual(gruppenLayout(P).folge, [
    { art: 'spur', spur: 0, tiefe: 0, verborgen: false },
    { art: 'gruppe', gruppe: 0 }, { art: 'spur', spur: 1, tiefe: 1, verborgen: false }, { art: 'spur', spur: 4, tiefe: 1, verborgen: false },
    { art: 'spur', spur: 2, tiefe: 0, verborgen: false },
    { art: 'gruppe', gruppe: 1 }, { art: 'spur', spur: 3, tiefe: 1, verborgen: true }, { art: 'spur', spur: 5, tiefe: 1, verborgen: true }]);
  assert.deepEqual(gruppenLayout({ spuren: [sp('s1', 'gX')], gruppen: [] }).folge, [{ art: 'spur', spur: 0, tiefe: 0, verborgen: false }], 'unknown group: ungrouped');
  assert.deepEqual(gruppenLayout(null).folge, []);
});

test('T3 table with groups: row order, y values, header height, hidden member h 0, total height', () => {
  const tab = zeilenFuer(P, [4], new Map([[3, 2]]));   // lane open on s5, take rows on the (hidden) s4: no take rows
  assert.deepEqual(tab.map((z) => [z.art, z.art === 'gruppe' ? z.gruppe : z.spur, z.y, z.h, z.tiefe ?? null, z.verborgen ?? null]), [
    ['spur', 0, 0, 64, 0, false],
    ['gruppe', 0, 64, GRUPPEN_HOEHE, null, null],
    ['spur', 1, 92, 64, 1, false],
    ['spur', 4, 156, 64, 1, false], ['lane', 4, 220, 48, null, null],
    ['spur', 2, 268, 64, 0, false],
    ['gruppe', 1, 332, GRUPPEN_HOEHE, null, null],
    ['spur', 3, 360, 0, 1, true], ['spur', 5, 360, 0, 1, true]]);
  assert.equal(zeilenHoehe(tab), 360);
  assert.equal(GRUPPEN_HOEHE, 28);
});

test('T3 hit tests: a header row and a hidden row are no track row, zeileBei never returns a hidden row', () => {
  const tab = zeilenFuer(P);
  assert.equal(spurIndexBeiTabelle(tab, 70), -1, 'header row');
  for (let y = -2; y <= zeilenHoehe(tab) + 2; y++) assert.notEqual(zeileBei(tab, y)?.verborgen, true, `y=${y}`);
  assert.equal(zeileBei(tab, 70).art, 'gruppe');
  assert.equal(spurIndexBeiTabelle(tab, 100), 1);
  assert.equal(spurZeile(tab, 3).verborgen, true);
});

test('T3 error case: a clip on a hidden track is neither hit nor reachable by a drop target', () => {
  const clip = { id: 'c1', art: 'audio', start_beat: 0, laenge_beats: 8, name: 'x', quelle: { sha256: 'a' } };
  const p = { ...P, spuren: P.spuren.map((s) => (s.id === 's4' ? { ...s, clips: [clip] } : s)) };
  const tab = zeilenFuer(p);
  for (let y = 0; y <= zeilenHoehe(tab); y += 3) assert.equal(trefferClip(p, A, 40, y, tab)?.clip?.id ?? null, null, `y=${y}`);
  assert.equal(spurIndexBeiTabelle(tab, zeilenHoehe(tab) - 1) !== 3, true);
  // the same clip on an unfolded group is hit
  const q = { ...p, gruppen: [gr('g1', 1), gr('g2', 2, false), gr('g3', 3)] };
  const tq = zeilenFuer(q), z = spurZeile(tq, 3);
  assert.equal(trefferClip(q, A, 40, z.y + 30, tq)?.clip?.id, 'c1');
});

test('T3 review focus 1: a folded group shows armed, solo, muted and open lane of its members', () => {
  const p = { spuren: [sp('s1', 'g1', { aufnahme: { scharf: true } }), sp('s2', 'g1', { solo: true }), sp('s3', 'g1', { mute: true }), sp('s4')], gruppen: [gr('g1', 1, true)] };
  assert.deepEqual(gruppenKopfZustand(p, 'g1', new Set(['s2'])), { gefaltet: true, mitglieder: 3, armiert: true, solo: true, stumm: true, lane: true });
  assert.deepEqual(gruppenKopfZustand({ spuren: [sp('s1', 'g1')], gruppen: [gr('g1', 1)] }, 'g1'), { gefaltet: false, mitglieder: 1, armiert: false, solo: false, stumm: false, lane: false });
  assert.equal(gruppenKopfZustand(p, 'g9').mitglieder, 0);
});

test('T3 review focus 2: gruppeAusWahl, one body, null for nothing, unknown ids and at 8 groups; a grouped track is included', () => {
  const p = { spuren: [sp('s1'), sp('s2', 'g1'), sp('s3')], gruppen: [gr('g1', 1)] };
  assert.deepEqual(gruppeAusWahl(p, ['s3', 's2', 's3']), { befehl: 'gruppenspur_neu', mitglieder: ['s2', 's3'] });
  assert.equal(gruppeAusWahl(p, []), null);
  assert.equal(gruppeAusWahl(p, ['zz']), null);
  assert.equal(gruppeAusWahl(null, ['s1']), null);
  const acht = { ...p, gruppen: Array.from({ length: 8 }, (_, i) => gr(`g${i + 1}`, i + 1)) };
  assert.equal(gruppeAusWahl(acht, ['s1']), null);
  const viele = { spuren: Array.from({ length: 32 }, (_, i) => sp(`s${i + 1}`)), gruppen: [] };
  assert.equal(gruppeAusWahl(viele, viele.spuren.map((s) => s.id)).mitglieder.length, 32);
});

test('T3 the head column order equals the table order (one function writes it): headers, members, take heads, lane heads', async () => {
  const { kopfFolge } = await import('../public/production/track_heads.js');
  const p = { ...P, spuren: P.spuren.map((s) => (s.id === 's5' ? { ...s, art: 'audio', takes: [{ id: 't1', clips: [] }, { id: 't2', clips: [] }] } : s)) };
  const offen = new Set(['s2', 's4']), takeOffen = new Set(['s5']);
  const f = kopfFolge(p, offen, takeOffen);
  assert.deepEqual(f.map((x) => `${x.art}:${x.id}`), ['spur:s1', 'gruppe:g1', 'spur:s2', 'lane:s2', 'spur:s5', 'take:s5', 'spur:s3', 'gruppe:g2', 'spur:s4', 'spur:s6'],
    'the lane of the folded s4 has no row, so no head');
  assert.deepEqual(f.filter((x) => x.art === 'spur').map((x) => [x.id, x.tiefe, x.verborgen]),
    [['s1', 0, false], ['s2', 1, false], ['s5', 1, false], ['s3', 0, false], ['s4', 1, true], ['s6', 1, true]]);
  // the rows of the table in the same order (a take head stands for its take rows)
  const tab = zeilenFuer(p, [1, 3], new Map([[4, 2]]));
  const aus = [];
  for (const z of tab) aus.push(z.art === 'gruppe' ? `gruppe:${p.gruppen[z.gruppe].id}` : `${z.art}:${p.spuren[z.spur].id}`);
  assert.deepEqual([...new Set(aus)], f.map((x) => `${x.art}:${x.id}`));
  assert.deepEqual(kopfFolge({ spuren: [sp('s1'), sp('s2')], gruppen: [] }).map((x) => x.id), ['s1', 's2'], 'no groups: array order');
});

import { nimmtTextAn } from '../public/production/production.js';
test('Ctrl+G is left to the browser only in text-like fields, not after a range or a button', () => {
  const el = (tagName, type, extra = {}) => ({ tagName, type, ...extra });
  for (const t of ['text', 'number', 'search']) assert.equal(nimmtTextAn(el('INPUT', t)), true, t);
  assert.equal(nimmtTextAn(el('TEXTAREA')), true); assert.equal(nimmtTextAn(el('DIV', undefined, { isContentEditable: true })), true);
  assert.equal(nimmtTextAn(el('SELECT')), true);
  assert.equal(nimmtTextAn(el('INPUT', 'range')), false, 'error case: a focused range does not swallow Ctrl+G');
  assert.equal(nimmtTextAn(el('INPUT', 'checkbox')), false); assert.equal(nimmtTextAn(el('BUTTON')), false); assert.equal(nimmtTextAn(null), false);
});
