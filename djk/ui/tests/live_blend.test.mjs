// Plan live-module task 8 (decisions 7, 16): the blend of a stem. The equal-power law, the command blend_setzen, the blend lane (expanded to two fader
// lanes in the playback), POST /modul/blend (at once and over bars on the clock double) and the refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, blendFader, pruefeProjekt } from '../project/model.ts';
import { baueModul, baueNeuePfade, liveSlots } from '../project/live.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { aendereStand } from '../project/state.ts';
import { uebersetze } from '../project/playback.ts';
import { liveAufbau } from './support/live_module.mjs';

const HASH = 'c'.repeat(64), D = (n) => ({ sha256: n.repeat(64), pfad: `/x/${n}.wav` });
const herkunft = { quelle_sha256: HASH, titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120, tonart: '8A', datum: '2026-11-12' };
const LOOP = { ...D('e'), beats: 16, frames: 16 * 24000 };
const NOTEN = [{ beat: 0, laenge: 0.25, ton: 36, vel: 100 }, { beat: 4, laenge: 0.25, ton: 42, vel: 90 }];
const mitPfad = () => {
  const p0 = neuesProjekt('x'); p0.live = true;
  const p = baueModul(p0, 'A', LOOP, { drums: D('1'), bass: D('2'), other: D('3'), vocals: D('4') }, herkunft);
  return baueNeuePfade(p, 'A', { drums: NOTEN, bass: NOTEN });
};
const kind = (p, name) => p.gruppen.find((g) => g.name === name);
const spurIn = (p, g, art) => p.spuren.find((s) => s.ausgang?.id === g.id && s.art === art);
const dbZu = (x) => 20 * Math.log10(x);

test('blend law: 0, 0.5, 1 give the equal-power fader pairs; closed is -200', () => {
  assert.deepEqual(blendFader(0), { original: 0, neu: -200 });
  assert.deepEqual(blendFader(1), { original: -200, neu: 0 });
  const m = blendFader(0.5);
  assert.ok(Math.abs(m.original - dbZu(Math.SQRT1_2)) < 1e-4 && Math.abs(m.neu - dbZu(Math.SQRT1_2)) < 1e-4, JSON.stringify(m));
  for (const w of [0.1, 0.3, 0.7, 0.9]) {                                           // equal power: the squared gains add up to 1
    const f = blendFader(w);
    assert.ok(Math.abs(10 ** (f.original / 10) + 10 ** (f.neu / 10) - 1) < 1e-4, String(w));
  }
});

test('blend_setzen stores blend on the stem group and sets both track faders; refuses a stem without a new path', () => {
  let p = mitPfad();
  const d = kind(p, 'Drums');
  for (const [w, o, n] of [[0, 0, -200], [1, -200, 0], [0.5, dbZu(Math.SQRT1_2), dbZu(Math.SQRT1_2)]]) {
    p = fuehreListeAus(p, [{ befehl: 'blend_setzen', gruppe_id: d.id, wert: w }]).projekt;
    const g = kind(p, 'Drums');
    assert.equal(g.blend, w);
    assert.ok(Math.abs(spurIn(p, g, 'audio').fader_db - o) < 1e-4 && Math.abs(spurIn(p, g, 'instrument').fader_db - n) < 1e-4, `${w}`);
  }
  assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(p))));
  const e = (f) => assert.throws(f, (x) => x.grund === 'kein_neuer_pfad' || x.grund === 'argument_ungueltig');
  e(() => fuehreListeAus(p, [{ befehl: 'blend_setzen', gruppe_id: kind(p, 'Other').id, wert: 0.5 }]));
  e(() => fuehreListeAus(p, [{ befehl: 'blend_setzen', gruppe_id: d.id, wert: 1.5 }]));
});

test('a blend lane (blend:<group id>) expands to two fader lanes in the playback; the core never sees the target', () => {
  let p = mitPfad();
  const d = kind(p, 'Drums');
  p = fuehreListeAus(p, [{ befehl: 'auto_neu', strang_id: d.id, ziel: `blend:${d.id}`, punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }] }]).projekt;
  assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(p))), 'a blend lane is a valid project');
  const lane = kind(p, 'Drums').automation[0];
  assert.equal(lane.ziel, `blend:${d.id}`);
  const w = uebersetze(p, { nr: 1, audioOrdner: '/nix', frames: () => 96000, existiert: () => true });
  const spuren = JSON.parse(JSON.stringify(w.spuren ?? w.datei?.spuren ?? w));
  const lanes = (s) => (s.auto ?? []).filter((l) => l.ziel === 'fader');
  const o = spuren.find((s) => s.nr === spurIn(p, kind(p, 'Drums'), 'audio').nr), n = spuren.find((s) => s.nr === spurIn(p, kind(p, 'Drums'), 'instrument').nr);
  assert.equal(lanes(o).length, 1); assert.equal(lanes(n).length, 1);
  const po = lanes(o)[0].punkte, pn = lanes(n)[0].punkte;
  assert.deepEqual([po[0][0], po[0][1]], [0, 0]);                                   // beat 0: original 0 dB
  assert.deepEqual([pn[0][0], pn[0][1]], [0, -200]);                                // beat 0: new closed
  assert.deepEqual([po.at(-1)[0], po.at(-1)[1]], [8, -200]);
  assert.deepEqual([pn.at(-1)[0], pn.at(-1)[1]], [8, 0]);
  assert.ok(po.length > 4 && po.length === pn.length, 'the moving segment is sampled');
  const mitte = po.find((q) => Math.abs(q[0] - 4) < 1e-9), mn = pn.find((q) => Math.abs(q[0] - 4) < 1e-9);
  assert.ok(Math.abs(mitte[1] - dbZu(Math.SQRT1_2)) < 1e-3 && Math.abs(mn[1] - dbZu(Math.SQRT1_2)) < 1e-3, 'blend 0.5 at beat 4');
  const andere = spuren.filter((s) => s !== o && s !== n && lanes(s).length);
  assert.equal(andere.length, 0, 'no other track gets a lane');
  assert.ok(!JSON.stringify(spuren).includes('blend:'));
});

test('a blend lane is refused on a track and on a group that is not the one it names, and without a new path', () => {
  const p = mitPfad();
  const d = kind(p, 'Drums'), b = kind(p, 'Bass'), o = kind(p, 'Other');
  const g = (strang_id, ziel) => () => fuehreListeAus(p, [{ befehl: 'auto_neu', strang_id, ziel }]);
  assert.throws(g(spurIn(p, d, 'audio').id, `blend:${d.id}`), (x) => x.grund === 'ziel_unbekannt');
  assert.throws(g(d.id, `blend:${b.id}`), (x) => x.grund === 'ziel_unbekannt');
  assert.throws(g(o.id, `blend:${o.id}`), (x) => x.grund === 'ziel_unbekannt');
});

// the module gets stems and new paths (Drums with notes, Bass without) by one project edit, the way the stems chain would
async function stemsUndPfade(z, gid) {
  const o = z.offen();
  const { slot: _s, ...h } = o.projekt.gruppen.find((g) => g.id === gid).modul;
  const loop = { ...D('e'), beats: h.laenge_beats, frames: h.laenge_beats * 24000 };
  const neu = baueNeuePfade(baueModul(o.projekt, 'A', loop, { drums: D('1'), bass: D('2'), other: D('3') }, h), 'A', { drums: NOTEN });
  await z.zugang.uebernimm(aendereStand(o.verlauf, o.projekt, neu, { quelle: 'andreas', label: 'stems+paths' }, z.zugang.haken()), { quelle: 'andreas', label: 'x' });
}

test('POST /modul/blend at once: one undo step, both faders in the model; refusals kein_neuer_pfad, slot_leer, argument', async (t) => {
  const z = await liveAufbau(t);
  await z.exportiere('A');
  // the stems are not in yet (the slow separator was cancelled): build the tree the way the chain does
  let p = z.projekt();
  const gid = z.gruppeVon(p, 'A').id;
  const lese = () => z.projekt();
  assert.deepEqual(await z.fehl(() => z.bl.blende({ slot: 'A', stem: 'drums', wert: 0.5 }, 'andreas')), { code: 409, fehler: 'kein_neuer_pfad' });
  assert.deepEqual(await z.fehl(() => z.bl.blende({ slot: 'B', stem: 'drums', wert: 0.5 }, 'andreas')), { code: 409, fehler: 'slot_leer' });
  assert.equal((await z.fehl(() => z.bl.blende({ slot: 'A', stem: 'tuba', wert: 0.5 }, 'andreas'))).fehler, 'argument_ungueltig');
  assert.equal((await z.fehl(() => z.bl.blende({ slot: 'A', stem: 'drums', wert: 2 }, 'andreas'))).fehler, 'argument_ungueltig');
  assert.equal((await z.fehl(() => z.bl.blende({ slot: 'A', stem: 'drums', wert: 1, takte: 3 }, 'andreas'))).fehler, 'argument_ungueltig');
  assert.equal((await z.fehl(() => z.bl.blende({ slot: 'A', stem: 'drums', wert: 1, extra: 1 }, 'andreas'))).fehler, 'argument_unbekannt');
  await stemsUndPfade(z, gid);
  p = lese();
  const revVor = p.rev;
  assert.deepEqual(await z.fehl(() => z.bl.blende({ slot: 'A', stem: 'bass', wert: 0.5 }, 'andreas')), { code: 409, fehler: 'kein_neuer_pfad' }, 'Bass has no notes: no path');
  const a = await z.bl.blende({ slot: 'A', stem: 'drums', wert: 0.5 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.zustand, 'fertig');
  p = lese();
  assert.equal(p.rev, revVor + 1);
  const d = kind(p, 'Drums');
  assert.equal(d.blend, 0.5);
  assert.ok(Math.abs(spurIn(p, d, 'instrument').fader_db - dbZu(Math.SQRT1_2)) < 1e-4);
  assert.equal(z.bl.stand().A.drums.zustand, 'fertig');
});

test('blend over 1 bar: both track rows step on the clock, the model gets the end value once; the answer comes at once', async (t) => {
  const z = await liveAufbau(t);
  await z.exportiere('A');
  const gid = z.gruppeVon(z.projekt(), 'A').id;
  await stemsUndPfade(z, gid);
  const vor = z.projekt();
  const d0 = kind(vor, 'Drums');
  const nrO = spurIn(vor, d0, 'audio').nr, nrN = spurIn(vor, d0, 'instrument').nr;
  z.protokoll.gesendet.length = 0;
  const mitten = [];
  z.uhr.beiPoll = async (n) => { if (n === 20) mitten.push(z.projekt().rev, kind(z.projekt(), 'Drums').blend); };
  const start = z.uhr.beat;
  const a = await z.bl.blende({ slot: 'A', stem: 'drums', wert: 1, takte: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.zustand, 'rampe');
  assert.equal(a.j.ende_beat, start + 4);
  assert.deepEqual(await z.fehl(() => z.bl.blende({ slot: 'A', stem: 'drums', wert: 0, takte: 1 }, 'andreas')), { code: 409, fehler: 'rampe_laeuft' });
  await z.bl.fertig('A', 'drums');
  assert.deepEqual(mitten, [vor.rev, undefined], 'mid-ramp the model is untouched');
  const zeilen = (nr) => z.protokoll.gesendet.filter((g) => g.adresse === '/k/teil' && g.felder.pfad === `spur/${nr}/fader`).map((g) => g.felder.nach);
  const zo = zeilen(nrO), zn = zeilen(nrN);
  assert.ok(zo.length >= 14 && zo.length <= 20, `about every 1/16 note: ${zo.length}`);
  assert.ok(zo.slice(0, -1).every((w, i) => i === 0 || w <= zo[i - 1]), `original falls: ${zo.join(' ')}`);
  assert.ok(zn.slice(0, -1).every((w, i) => i === 0 || w >= zn[i - 1]), `new rises: ${zn.join(' ')}`);
  const p = z.projekt();
  assert.equal(p.rev, vor.rev + 1, 'one project edit for the whole ramp');
  assert.equal(kind(p, 'Drums').blend, 1);
  assert.deepEqual([spurIn(p, kind(p, 'Drums'), 'audio').fader_db, spurIn(p, kind(p, 'Drums'), 'instrument').fader_db], [-200, 0]);
  assert.equal(z.bl.stand().A.drums.zustand, 'fertig');
  assert.equal(z.bl.stand().A.drums.ende, 'erreicht');
});

test('level offset neu_trim_db: blend 1 puts the new fader at the trim, the pair stays equal power minus the trim; blend_trim_setzen re-applies it', () => {
  assert.deepEqual(blendFader(1, -13), { original: -200, neu: -13 });
  assert.deepEqual(blendFader(0, -13), { original: 0, neu: -200 });
  assert.ok(Math.abs(blendFader(0.5, -13).neu - (dbZu(Math.SQRT1_2) - 13)) < 1e-4);
  assert.equal(blendFader(1, 20).neu, 6, 'the fader maximum caps a positive trim');
  let p = mitPfad();
  const d = kind(p, 'Drums');
  p = fuehreListeAus(p, [{ befehl: 'blend_setzen', gruppe_id: d.id, wert: 1 }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'blend_trim_setzen', gruppe_id: d.id, db: -13 }]).projekt;
  assert.equal(kind(p, 'Drums').neu_trim_db, -13);
  assert.equal(spurIn(p, kind(p, 'Drums'), 'instrument').fader_db, -13, 'blend 1: new as loud as the original at 0 dB');
  assert.equal(spurIn(p, kind(p, 'Drums'), 'audio').fader_db, -200);
  p = fuehreListeAus(p, [{ befehl: 'blend_setzen', gruppe_id: d.id, wert: 0.5 }]).projekt;
  assert.ok(Math.abs(spurIn(p, kind(p, 'Drums'), 'instrument').fader_db - (dbZu(Math.SQRT1_2) - 13)) < 1e-4, 'blend_setzen uses the trim');
  assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(p))));
  assert.equal(kind(fuehreListeAus(p, [{ befehl: 'blend_trim_setzen', gruppe_id: d.id, db: 0 }]).projekt, 'Drums').neu_trim_db, undefined, '0 removes the field');
  assert.throws(() => fuehreListeAus(p, [{ befehl: 'blend_trim_setzen', gruppe_id: kind(p, 'Other').id, db: -3 }]), (x) => x.grund === 'kein_neuer_pfad');
  assert.throws(() => fuehreListeAus(p, [{ befehl: 'blend_trim_setzen', gruppe_id: d.id, db: 99 }]), (x) => x.grund === 'argument_ungueltig');
  const bad = JSON.parse(JSON.stringify(p)); bad.gruppen.find((g) => g.name === 'Drums').neu_trim_db = 'x';
  assert.ok('fehler' in pruefeProjekt(bad) || !('projekt' in pruefeProjekt(bad)), 'the validator refuses a non-number');
});

test('the blend lane expansion in the playback carries the trim on the new fader', () => {
  let p = mitPfad();
  const d = kind(p, 'Drums');
  p = fuehreListeAus(p, [{ befehl: 'blend_trim_setzen', gruppe_id: d.id, db: -10 }, { befehl: 'auto_neu', strang_id: d.id, ziel: `blend:${d.id}`,
    punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }] }]).projekt;
  const w = uebersetze(p, { nr: 1, audioOrdner: '/nix', frames: () => 96000, existiert: () => true });
  const spuren = JSON.parse(JSON.stringify(w.spuren ?? w));
  const n = spuren.find((s) => s.nr === spurIn(p, kind(p, 'Drums'), 'instrument').nr);
  const pn = n.auto.find((l) => l.ziel === 'fader').punkte;
  assert.deepEqual([pn.at(-1)[0], pn.at(-1)[1]], [8, -10]);
  assert.deepEqual([pn[0][0], pn[0][1]], [0, -200]);
});
