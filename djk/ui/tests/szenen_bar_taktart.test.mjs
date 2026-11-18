// Plan studio-taktart T5: taktBeats follows the project meter n/4; the scene launch passes o.projekt.taktart. 4/4 golden: taktart_4_szenen.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { szenenZielBeat, taktBeats } from '../areas/proj/szenen_bar.ts';
import { vorlaufBeats } from '../tempo_ramp.ts';
import { liveAufbau } from './support/live_module.mjs';
import { SeqBereich } from '../areas/live/seq.ts';

const BASIS = { kBeat: 100, offset: 0, bpm: 128, loopVon: 0, loopBis: 64, loopAn: false, laeuft: true };

test('taktBeats() and taktBeats([4,4]) and taktBeats(undefined) are 4; taktBeats([3,4]) is 3; invalid values give 4', () => {
  assert.deepEqual([taktBeats(), taktBeats([4, 4]), taktBeats(undefined), taktBeats([3, 4]), taktBeats([6, 8]), taktBeats([13, 4])], [4, 4, 4, 3, 4, 4]);
});

test('szenenZielBeat with taktart [3,4]: the target is a project beat on a multiple of 3, at least vorlaufBeats ahead', () => {
  const lead = vorlaufBeats(128);
  for (const [kBeat, offset] of [[100, 0], [100, 0.37], [101.2, 1.1], [7.99, 0], [9, 0], [8 - 0.2, 0]]) {
    const z = szenenZielBeat({ ...BASIS, kBeat, offset, taktart: [3, 4] });
    const projekt = z - offset;
    assert.ok(Math.abs(projekt / 3 - Math.round(projekt / 3)) < 1e-9, `${projekt} is a multiple of 3`);
    assert.ok(z >= kBeat + lead - 1e-9, `lead: ${z} vs ${kBeat + lead}`);
    assert.ok(z < kBeat + lead + 3 + 1e-9, `no bar skipped: ${z}`);
  }
  assert.equal(szenenZielBeat({ ...BASIS, kBeat: 8, taktart: [3, 4] }), 9);
  assert.equal(szenenZielBeat({ ...BASIS, kBeat: 8, taktart: [4, 4] }), szenenZielBeat({ ...BASIS, kBeat: 8 }));
});

test('the scene launch in areas/live/seq passes o.projekt.taktart (fake weg records the ZielEingang)', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-szenen-taktart-'));
  const bkO = path.join(tmp, 'bk'), kitO = path.join(tmp, 'kits');
  fs.mkdirSync(bkO); fs.mkdirSync(path.join(kitO, '909'), { recursive: true });
  fs.writeFileSync(path.join(bkO, 'bassmusik.json'), JSON.stringify({ knoten: [{ id: 1, art: 'regler', nr: 3, min: 0, max: 1 }] }));
  fs.writeFileSync(path.join(kitO, '909', 'kit.json'), JSON.stringify({ schema: 1, klaenge: [{ note: 36, name: 'kick', datei: 'k.wav' }] }));
  const vorher = { bk: process.env.CYPHERDJ_BK_ORDNER, kit: process.env.CYPHERDJ_KIT_ORDNER };
  process.env.CYPHERDJ_BK_ORDNER = bkO; process.env.CYPHERDJ_KIT_ORDNER = kitO;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', vorher.bk], ['CYPHERDJ_KIT_ORDNER', vorher.kit]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const z = await liveAufbau(t);
  const weg = { eingaenge: [], ab: [], lage: { kBeat: 100, offset: 0, bpm: 120, loopVon: 0, loopBis: 64, loopAn: false, laeuft: true } };
  weg.zielLage = (loop) => ({ ...weg.lage, loopVon: loop.von_beat, loopBis: loop.bis_beat });
  weg.szenenTeile = (plan, quelle, ab) => { weg.ab.push(ab); return new Promise(() => {}); };
  weg.abbruchPlan = async () => ({ status: 3, grund: '' });
  const seq = new SeqBereich(z.ctx, z.zugang, { geraetInfo: () => ({ art: 'rb338', regler: [], klaenge: [] }), szenen: weg });
  await seq.anlege({ platz: 2 }, 'andreas');
  for (const name of ['Drums', 'Bass']) await seq.folge({ platz: 2, name, geraet: 'rb338', loop_beats: 4 }, 'andreas');
  await z.aendern([{ befehl: 'taktart_setzen', taktart: [3, 4] }]);
  const ids = ['Drums', 'Bass'].map((n) => z.projekt().spuren.find((s) => s.name === n).id);
  await seq.befehle({ platz: 2, label: 'M', befehle: [{ befehl: 'spur_aendern', spur_id: ids[0], mute: false }, { befehl: 'spur_aendern', spur_id: ids[1], mute: true }] }, 'andreas');
  await seq.szene({ slot: 0, aktion: 'speichern' }, 'andreas');
  await seq.befehle({ platz: 2, label: 'M', befehle: [{ befehl: 'spur_aendern', spur_id: ids[0], mute: true }] }, 'andreas');
  void seq.szene({ slot: 0, aktion: 'starten' }, 'andreas');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(weg.ab.length, 1);
  assert.equal(weg.ab[0] % 3, 0, `3/4 launch target ${weg.ab[0]} is a multiple of 3 (offset 0)`);
  assert.ok(weg.ab[0] > 100 && weg.ab[0] <= 100 + 3 + 1.5, `ab ${weg.ab[0]}`);
});
