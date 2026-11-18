// Regression (audit U07, rest): a Surge track without a patch whose slot goes to a plugin host and back (undo of the swap). The host that comes back is
// a NEW Surge process with init values, but the mirror still believed it held the map value, so a plain sync (no freeze, no open) sent nothing.
// The fake Surge host answers like the plugin host (refuses) while the slot is swapped, and starts again at its init values when Surge comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpOrdner } from './support/project.mjs';
import { sitzung, warteBis } from './support/proj_context.mjs';
import { falscherWirt, wirtOrdner } from './support/surge_instrument_host.mjs';

test('undo of a swap that took the slot to a plugin host and back: the map of a patch-less Surge track reaches the fresh Surge host', async (t) => {
  const d = tmpOrdner(t, 'djk-swapspiegel-');
  const pfad = path.join(d, 'Vital.vst3'); fs.mkdirSync(pfad);
  const index = { v1: { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789', name: 'Vital', art: 'instrument', status: 'ok' } };
  const ordner = wirtOrdner(t);
  const h = falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3 });
  const stand = new Map(), imPlugin = { an: false };
  h.antwort = (b) => (imPlugin.an ? { ok: false, fehler: 'plugin host' } : null);   // the plugin host has no Surge parameters
  const abhaengig = {
    start: async (slot, art) => {
      if (art === 'surge') { imPlugin.an = false; h.werte = { a_filter1_cutoff: 3 }; }   // a new process: init values
      else imPlugin.an = true;
      stand.set(slot, { lebt: true, bereit: true, art: art === 'surge' ? 'lv2' : 'plugin', kennung: art.startsWith('plugin:') ? art.slice(7) : null, pid: stand.size + 100 });
      return { code: 0, fehler: '' };
    },
    stand: (slot) => stand.get(slot) ?? { lebt: false, bereit: false, art: null, kennung: null, pid: null },
    sock: async () => ({ ok: true }),
    ordner: () => path.join(d, 'proj'),
    log: () => {},
  };
  const { s } = sitzung(t, { wirtOrdner: () => ordner, pluginIndex: (id) => index[id] ?? null,
    instrument: { abhaengig, zeiten: { pollMs: 5000, zustandRuheMs: 5000, fensterMs: 30000, endeMs: 500, sockMs: 2000, startMs: 5000 } } });
  const rev = () => s.aktuell().j.projekt.rev;
  await s.neu('A', 'andreas');
  await s.aendern({ rev: rev(), label: 'surge', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', parameter: { a_filter1_cutoff: 20 } } }] }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 20), 'the mirror sent the entry to the Surge host');
  await s.aendern({ rev: rev(), label: 'plugin', befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' },
    { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'plugin', plugin_id: 'v1' } }] }, 'andreas');
  assert.ok(await warteBis(() => stand.get(1)?.art === 'plugin'), 'the slot went to the plugin host');
  await s.surge.fertig();
  assert.equal((await s.umkehr('undo', { rev: rev() }, 'andreas')).code, 200);
  assert.ok(await warteBis(() => stand.get(1)?.art === 'lv2'), 'the slot went back to a fresh Surge host');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 20, 5000), `the fresh Surge host got the map entry again, it holds ${h.werte.a_filter1_cutoff}`);
});

// A host that systemd restarted under the mirror (new pid, init values, same slot, no swap): the freeze path sends the map again. Same pid: it does not
// (tests/proj_surge_mirror.test.mjs T5.2 pins "nothing is left to send").
test('a Surge host with a new pid gets the whole map again on the freeze path, the same pid gets nothing', async (t) => {
  const d = tmpOrdner(t, 'djk-pidspiegel-');
  const ordner = wirtOrdner(t);
  const h = falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3 });
  const pid = { n: 100 };
  const abhaengig = {
    start: async () => ({ code: 0, fehler: '' }),
    stand: () => ({ lebt: true, bereit: true, art: 'lv2', kennung: null, pid: pid.n }),
    sock: async () => ({ ok: true }),
    ordner: () => path.join(d, 'proj'),
    log: () => {},
  };
  const { s } = sitzung(t, { wirtOrdner: () => ordner, instrument: { abhaengig } });
  await s.neu('A', 'andreas');
  await s.aendern({ rev: 0, label: 'surge', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', parameter: { a_filter1_cutoff: 20 } } }] }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 20), 'the mirror sent the entry');
  h.befehle.length = 0;
  await s.wirtSpiegel();
  assert.deepEqual(h.fahrten(), [], 'same pid: nothing is sent on the freeze path');
  pid.n = 101; h.werte = { a_filter1_cutoff: 3 };   // systemd restarted the host: a new process at its init values
  await s.wirtSpiegel();
  assert.equal(h.werte.a_filter1_cutoff, 20, `the new process got the map entry again, it holds ${h.werte.a_filter1_cutoff}`);
});
