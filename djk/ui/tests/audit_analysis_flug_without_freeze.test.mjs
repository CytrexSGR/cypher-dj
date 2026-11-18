// Audit U08: an in-flight /proj/analyse run is only joined by a request of the same ohne_freeze mode; the other mode starts its own run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KlangAnalyse } from '../areas/proj/sound_analysis.ts';
import { AusgabeFehler } from '../areas/proj/output.ts';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const QUELLE = { art: 'spur', spur_id: 's2', punkt: 'post' };

test('analysiere: the tool (ohne_freeze false) does not inherit the window\'s freeze_noetig refusal of a run in flight', async (t) => {
  const a = { analyseVorpruefung: () => ({ slug: 'p', rev: 3, von: 0, bis: 8, tempo_bpm: 120 }) };
  const ka = new KlangAnalyse(a, {});
  const modi = [];
  ka.messe = async (q, v, von, bis, ohneFreeze) => {
    modi.push(ohneFreeze);
    await schlaf(50);
    if (ohneFreeze) throw new AusgabeFehler('freeze_noetig', 'the track has to be frozen first');
    return { rev: 3, marke: 'frozen and measured' };
  };
  const fenster = ka.analysiere({ quelle: QUELLE, ohne_freeze: true }).catch((e) => e);
  await schlaf(10);
  const werkzeug = await ka.analysiere({ quelle: QUELLE, ohne_freeze: false });
  assert.equal(werkzeug.marke, 'frozen and measured');
  assert.equal((await fenster).grund, 'freeze_noetig');
  assert.deepEqual(modi, [true, false], 'each mode ran itself');
});

test('analysiere: two identical requests of the same mode still share one run', async () => {
  const a = { analyseVorpruefung: () => ({ slug: 'p', rev: 3, von: 0, bis: 8, tempo_bpm: 120 }) };
  const ka = new KlangAnalyse(a, {});
  let n = 0;
  ka.messe = async () => { n += 1; await schlaf(50); return { rev: 3 }; };
  const [x, y] = await Promise.all([ka.analysiere({ quelle: QUELLE, ohne_freeze: true }), (async () => { await schlaf(10); return ka.analysiere({ quelle: QUELLE, ohne_freeze: true }); })()]);
  assert.equal(n, 1);
  assert.equal(x, y);
});
