// Live module tests (plan live-module tasks 3 and later): the proj session of output_setup.mjs, the live bridge with the deck side as a double, the real
// stems object with a test separator. `kern` is the clock double of the ramp (ramp.ts): beat advances by `schritt` beats per poll of the ramp.
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './output_setup.mjs';
import { warteBis } from './proj_context.mjs';
import { Stems } from '../../areas/proj/stems.ts';
import { liveBereich } from '../../areas/live/export.ts';
import { speichereModul } from '../../project/module_storage.ts';
import { pythonVorgabe } from '../../server.ts';
import { REPO_PFADE } from '../../paths.ts';

export const SHA = 'a'.repeat(64), MID = SHA.slice(0, 16), RATE = 24000;
const BASIS_FRAMES = 12 * RATE;

export function basisDatei(dir) {
  const b = Buffer.alloc(BASIS_FRAMES * 8);
  for (let i = 0; i < BASIS_FRAMES; i++) { b.writeFloatLE(((i % 2000) - 1000) / 4000, i * 8); b.writeFloatLE(((i * 7) % 2000 - 1000) / 4000, i * 8 + 4); }
  const f = path.join(dir, 'basis.f32');
  fs.writeFileSync(f, b);
  return f;
}

export async function liveAufbau(t, { trenner = 'langsam', schritt = 0.1, speichern = true, kernDa = true, midi } = {}) {
  const r = await aufbau(t, { mitKick: false });
  const dir = path.join(r.tmp, 'deckdaten');
  fs.mkdirSync(dir);
  const basis = basisDatei(dir);
  const stems = new Stems(r.ctx, r.zugang, { python: pythonVorgabe(), cwd: REPO_PFADE.werkstatt, zusatzArgs: ['--trenner', trenner], killMs: 2000 });
  t.after(() => stems.schliesse());
  stems.ereignis('/zustand/kern', { generation: 1, quantum: 256, ki_gestoppt: 0 });
  const deck = { deck: 1, material_id: MID, basis_bpm: 120, fassung: 1, basisDatei: basis, startFrame: 3 * RATE + 17, frames: 4 * RATE,
    laenge_beats: 4, von_beat: 5 };
  const zeile = { sha: SHA, typ: 'track', titel: 'Song', kuenstler: 'Art', bpm: 120, camelot: '8A', };
  const modulOrdner = path.join(r.tmp, 'module');
  // the clock double: every poll of the ramp moves it on; `schritt` can be changed during a test (tempo change),
  // `laeuft` and `steht` switch the transport and the clock
  const uhr = { beat: 100, bpm: 120, schritt, laeuft: true, steht: false, wanduhr: 0, polls: 0, beiPoll: null };
  const kern = { uhr: () => (kernDa ? { beat: uhr.beat, bpm: uhr.bpm } : null), laeuft: () => uhr.laeuft };
  const rampe = { pollMs: 20, stillMs: 1000, jetzt: () => uhr.wanduhr,
    warte: async (ms) => { uhr.polls++; uhr.wanduhr += ms; if (!uhr.steht) uhr.beat += uhr.schritt; if (uhr.beiPoll) await uhr.beiPoll(uhr.polls); } };
  const nach = [], nachStems = [];
  const b = liveBereich(r.ctx, r.zugang, stems, {
    deckLoop: () => ({ ...deck }), herkunft: () => zeile,
    nachExport: (e) => { nach.push(e); if (speichern) speichereModul(e.projekt, e.gruppeId, { basis: modulOrdner }); },
    nachStems: (e) => { nachStems.push(e); if (speichern) speichereModul(e.projekt, e.gruppeId, { basis: modulOrdner }); },
    ...(midi ? { midi } : {}),
    leeren: { kern, rampe, speichere: (p, g) => speichereModul(p, g, { basis: modulOrdner }) } });
  assert.ok((await r.s.liveOeffnen('andreas')).code === 200);
  const projekt = () => r.s.aktuell().j.projekt;
  const stand = (s = 'A') => b.modul.stand()[s];
  // cancels a running separation (the slow test separator), so no child outlives the test
  const abbruch = async (s) => {
    if (!(await warteBis(() => ['laeuft', 'fertig', 'fehler'].includes(stand(s)?.stems?.stems), 20000))) throw new Error('separation never started');
    if (stand(s).stems.stems === 'laeuft') {
      stems.abbrechen({ auftrag_id: stand(s).stems.auftrag_id });
      await warteBis(() => stand(s).stems.stems !== 'laeuft', 20000);
    }
  };
  const exportiere = async (slot) => { const a = await b.modul.exportiere({ deck: 1, slot }, 'andreas'); await abbruch(slot); return a; };
  const gruppeVon = (p, slot) => p.gruppen.find((g) => g.ausgang === undefined && g.modul?.slot === slot);
  // the ramp rows: up to and including the first -200. What follows is the reset of the freed group slot to 0
  // that every group removal writes (commands.ts)
  const alleZeilen = () => r.protokoll.gesendet.filter((g) => g.adresse === '/k/teil' && /^grp\/\d+\/fader$/.test(g.felder.pfad));
  const zeilen = () => { const a = alleZeilen(); const i = a.findIndex((x) => x.felder.nach === -200); return i < 0 ? a : a.slice(0, i + 1); };
  const aendern = async (befehle, label = 'Test') => {
    const x = await r.s.aendern({ rev: projekt().rev, label, befehle }, 'andreas');
    if (x.code !== 200) throw new Error(`aendern ${label}: ${x.code} ${JSON.stringify(x.j)}`);
    return x;
  };
  return { ...r, b, m: b.modul, l: b.leeren, bl: b.blend, stems, uhr, projekt, stand, alleZeilen, exportiere, abbruch, gruppeVon, zeilen, aendern, nach,
    nachStems, modulOrdner, deck,
    fehl: async (f) => { try { await f(); } catch (e) { return { code: e.code, fehler: e.fehler }; } assert.fail('no refusal'); } };
}
import assert from 'node:assert/strict';
