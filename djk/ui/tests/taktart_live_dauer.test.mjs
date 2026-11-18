// Plan studio-taktart review fix: the bar count of a live clear (leeren) and blend ramp is bars of the open project meter. 4/4 stays 4 beats per bar
// (live_blend / live_leeren pin that); here 3/4 means 3 beats per bar, and the 4/4 case is repeated as a before/after anchor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { baueModul, baueNeuePfade } from '../project/live.ts';
import { aendereStand } from '../project/state.ts';
import { liveAufbau } from './support/live_module.mjs';

const D = (n) => ({ sha256: n.repeat(64), pfad: `/x/${n}.wav` });
const NOTEN = [{ beat: 0, laenge: 0.25, ton: 36, vel: 100 }, { beat: 4, laenge: 0.25, ton: 42, vel: 90 }];
async function stemsUndPfade(z, gid) {
  const o = z.offen();
  const { slot: _s, ...h } = o.projekt.gruppen.find((g) => g.id === gid).modul;
  const loop = { ...D('e'), beats: h.laenge_beats, frames: h.laenge_beats * 24000 };
  const neu = baueNeuePfade(baueModul(o.projekt, 'A', loop, { drums: D('1'), bass: D('2'), other: D('3') }, h), 'A', { drums: NOTEN });
  await z.zugang.uebernimm(aendereStand(o.verlauf, o.projekt, neu, { quelle: 'andreas', label: 'stems+paths' }, z.zugang.haken()), { quelle: 'andreas', label: 'x' });
}
const meter = (z, n) => z.aendern([{ befehl: 'taktart_setzen', taktart: [n, 4] }], 'meter');

for (const [n, rows] of [[4, [14, 20]], [3, [10, 16]]]) {
  test(`leeren over 1 bar in ${n}/4: ende_beat is start + ${n}, the ramp rows span ${n} beats`, async (t) => {
    const z = await liveAufbau(t);
    await z.exportiere('A');
    const g = z.gruppeVon(z.projekt(), 'A');
    await z.aendern([{ befehl: 'gruppenspur_aendern', gruppe_id: g.id, fader_db: 0 }]);
    if (n !== 4) await meter(z, n);
    z.protokoll.gesendet.length = 0;
    const start = z.uhr.beat;
    const a = await z.l.leere({ slot: 'A', takte: 1 }, 'andreas');
    assert.equal(a.code, 200, JSON.stringify(a.j));
    assert.equal(a.j.ende_beat, start + n);
    await z.l.fertig('A');
    const r = z.zeilen().filter((x) => x.felder.pfad === `grp/${g.nr}/fader`).length;
    assert.ok(r >= rows[0] && r <= rows[1], `${r} rows`);
  });

  test(`blend over 1 bar in ${n}/4: ende_beat is start + ${n}`, async (t) => {
    const z = await liveAufbau(t);
    await z.exportiere('A');
    await stemsUndPfade(z, z.gruppeVon(z.projekt(), 'A').id);
    if (n !== 4) await meter(z, n);
    z.protokoll.gesendet.length = 0;
    const start = z.uhr.beat;
    const a = await z.bl.blende({ slot: 'A', stem: 'drums', wert: 1, takte: 1 }, 'andreas');
    assert.equal(a.code, 200, JSON.stringify(a.j));
    assert.equal(a.j.ende_beat, start + n);
    await z.bl.fertig('A', 'drums');
    const nr = z.projekt().spuren.find((s) => s.art === 'audio' && z.projekt().gruppen.find((x) => x.id === s.ausgang?.id)?.name === 'Drums').nr;
    const r = z.protokoll.gesendet.filter((x) => x.adresse === '/k/teil' && x.felder.pfad === `spur/${nr}/fader`).length;
    assert.ok(r >= rows[0] && r <= rows[1] + 4, `${r} rows`);
  });
}
