// The real-time export brings the master to the project tempo (tempoAnMaster) inside the load lock before /k/arr/export_lauf, as freeze and
// resample do: the core captures on the master clock (arr_export_run.cpp: ende = k.sample_at(ursprung_ + (bis - von))), so a master left at
// another tempo by a deck would give a WAV of the wrong tempo and length. A refusal (deck_laeuft) comes before anything is loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aufbau } from './support/output_setup.mjs';
import { alsAntwort } from '../areas/proj/output.ts';

const ruf = async (f) => { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } };
const PLUGIN = { format: 'vst3', pfad: '/x/Fake.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const KEIN_HOST = { abhaengig: { insert: async () => ({ code: 1, aus: '', fehler: 'test: no host' }), sock: async () => { throw new Error('test: no socket'); } } };

// a project with an active host stage on s2 (so the export runs in real time) and a stand-in for /k/arr/export_lauf that logs its place in the order
async function mitHost(t) {
  const a = await aufbau(t, { tempo: 120, host: KEIN_HOST });
  await a.vorbei([{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'host', plugin: PLUGIN }]);
  const id = a.projekt().spuren.find((s) => s.id === 's2').inserts[0].id;
  const t0 = Date.now() - 5000;
  a.zugang.hostLage = () => [{ insert_id: id, h: 1, status: 'bereit' }];
  a.zugang.hostGesundAlterMs = () => Date.now() - t0;
  const sende = a.ctx.sende;
  a.ctx.sende = (adresse, felder) => {
    if (adresse !== '/k/arr/export_lauf') return sende(adresse, felder);
    a.protokoll.reihenfolge.push('export_lauf');
    const nr = ++a.zustand.id;
    a.zustand.quittungen.set(nr, { status: 1, grund: '' });
    setTimeout(() => {
      const n = Math.round((felder.bis_beat - felder.von_beat) * 60 / 120 * 48000);
      fs.writeFileSync(felder.pfad, Buffer.alloc(n * 8), { flag: 'wx' });
      a.vomKern('/e/export_lauf', { frames: BigInt(n), spitze: 0, luecken: 0, ungesund: 0, grund: '' });
      a.arrMeldung();
    }, 20);
    return nr;
  };
  a.protokoll.reihenfolge.length = 0;
  return a;
}

test('real-time export calls tempoAnMaster inside the lock before /k/arr/export_lauf', async (t) => {
  const a = await mitHost(t);
  const r = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const rf = a.protokoll.reihenfolge;
  const iS = rf.indexOf('sperre'), iT = rf.indexOf('tempo'), iE = rf.indexOf('export_lauf'), iF = rf.indexOf('frei');
  assert.ok(iT >= 0, `tempoAnMaster was never called: ${JSON.stringify(rf)}`);
  assert.ok(iS < iT && iT < iE && iE < iF, `order must be sperre < tempo < export_lauf < frei: ${JSON.stringify(rf)}`);
});

test('real-time export refused by tempoAnMaster (deck_laeuft): nothing loaded, no export_lauf, lock released', async (t) => {
  const a = await mitHost(t);
  a.zugang.tempoAnMaster = async () => {
    a.protokoll.reihenfolge.push('tempo');
    throw Object.assign(new Error('a deck plays at another tempo'), { status: 409, grund: 'deck_laeuft' });
  };
  const geladen = a.protokoll.gesendet.filter((g) => g.adresse === '/k/arr/laden').length;
  const r = await ruf(() => a.ausgabe.exportiere({}));
  assert.notEqual(r.code, 200, 'the export must be refused');
  const rf = a.protokoll.reihenfolge;
  assert.deepEqual(rf, ['sperre', 'tempo', 'frei'], JSON.stringify(rf));
  assert.equal(a.protokoll.gesendet.filter((g) => g.adresse === '/k/arr/laden').length, geladen, 'no export view may be loaded');
  assert.ok(!(a.offen().ordner && fs.existsSync(`${a.offen().ordner}/export`) && fs.readdirSync(`${a.offen().ordner}/export`).length), 'no file written');
});
