// Review 1.15: order of the /regler requests when a kern mix-tool preset is applied. A preset that switches a tool on must send the
// switch last (the tool must not run with the old threshold, makeup or ceiling while the rest is still in flight, and a refusal midway
// must not leave the tool on with a half-applied setting); a preset that switches it off sends the switch first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GERAETE } from '../presets/geraete.ts';
import { kernGeraetAnfragen } from '../oeffentlich/presets.js';

const g = (id) => GERAETE.find((x) => x.id === id);
const pfade = (r) => r.anfragen.map((a) => `${a.pfad}=${a.nach}`);

test('kern preset switching a tool on sends the on switch after every other field', () => {
  const mb = pfade(kernGeraetAnfragen(g('multiband'), { an: true, tief_makeup: 12, hoch_schwelle: -30 }, 'bus/1'));
  assert.equal(mb.at(-1), 'bus/1/mb/an=1');
  assert.equal(mb.length, 3);
  const lim = pfade(kernGeraetAnfragen(g('kanal-limiter'), { an: true, decke: -1, abklingen: 50 }, 'bus/2'));
  assert.deepEqual(lim, ['bus/2/lim/decke=-1', 'bus/2/lim/abklingen=50', 'bus/2/lim/an=1']);
  const gate = pfade(kernGeraetAnfragen(g('gate'), { an: true, schwelle: -35 }, 'deck/1'));
  assert.deepEqual(gate, ['deck/1/gate/schwelle=-35', 'deck/1/gate/an=1']);
});

test('kern preset switching a tool off sends the off switch first', () => {
  const lim = pfade(kernGeraetAnfragen(g('kanal-limiter'), { decke: -6, an: false }, 'bus/3'));
  assert.deepEqual(lim, ['bus/3/lim/an=0', 'bus/3/lim/decke=-6']);
});

test('negative control: a preset without the on switch keeps its field order', () => {
  const u = pfade(kernGeraetAnfragen(g('utility'), { breite: 150, dc: true, balance: -0.5 }, 'bus/4'));
  assert.deepEqual(u, ['bus/4/util/breite=150', 'bus/4/util/dc=1', 'bus/4/util/balance=-0.5']);
});

// Review 1.15: a refusal whose body is not JSON (a proxy's 502 page) is a refusal with its status, not "server unreachable".
import { setzeWerkzeug } from '../oeffentlich/effekte.js';
test('setzeWerkzeug: a non-JSON error body is reported with its HTTP status', async () => {
  const kaputt = async () => ({ status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  assert.deepEqual(await setzeWerkzeug(kaputt, 'bus/1/lim/decke', -1), { ok: false, text: 'Tool control refused: 502' });
  const weg = async () => { throw new TypeError('fetch failed'); };
  assert.deepEqual(await setzeWerkzeug(weg, 'bus/1/lim/decke', -1), { ok: false, text: 'Page server unreachable: fetch failed' });
});
