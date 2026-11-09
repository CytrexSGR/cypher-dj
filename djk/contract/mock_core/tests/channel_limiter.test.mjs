// node --test tests/channel_limiter.test.mjs: 1.15 A5c. Like the kern (core/src/net.cpp hallo), the dummy sends /e/kanal_limiter ,ii (gebaut, latenz_samples)
// to a subscriber on its first /k/hallo of a generation, from its config: kanal_limiter_vorhalt_ms > 0 builds, L = round(vorhalt_ms * 48) + 2, + 12 with
// kanal_limiter_echtspitze (konfig.schema.json). Always, also when not built (0, 0). A heartbeat hallo (the runner sends one every 0.5 s) brings it not again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../sequences_fast.mjs';
import { S, sende } from './help.mjs';

const meldungen = (r) => r.log.filter((m) => m.adresse === '/e/kanal_limiter').map((m) => ({ typen: m.typen, werte: m.werte }));
const leer = [sende(S(1), ['/k/ki/frei', 'hs', 2, 'andreas'])];   // a step far enough out that several heartbeat hallos have run

test('A5c dummy: built (0.5 ms) sends 1, 26 once; with true peak 1, 38; 3.0 ms gives 1, 146', () => {
  for (const [cfg, soll] of [[{ kanal_limiter_vorhalt_ms: 0.5 }, [1, 26]], [{ kanal_limiter_vorhalt_ms: 0.5, kanal_limiter_echtspitze: true }, [1, 38]],
    [{ kanal_limiter_vorhalt_ms: 3.0 }, [1, 146]]]) {
    const m = meldungen(fahre([...leer, sende(S(9), ['/k/ki/frei', 'hs', 3, 'andreas'])], { cfg }));
    assert.equal(m.length, 1, `exactly once despite the heartbeats: ${JSON.stringify(m)}`);
    assert.deepEqual(m[0].werte, soll, JSON.stringify(cfg));
  }
});

test('A5c dummy: not built (the default) still says it: 0, 0 (the server tells "not built" from "never said")', () => {
  const m = meldungen(fahre(leer));
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].werte, [0, 0]);
  assert.equal(m[0].typen, 'ii');
});

test('A5c dummy: echtspitze alone builds nothing (vorhalt 0): 0, 0', () => {
  const m = meldungen(fahre(leer, { cfg: { kanal_limiter_echtspitze: true } }));
  assert.deepEqual(m.map((x) => x.werte), [[0, 0]]);
});
