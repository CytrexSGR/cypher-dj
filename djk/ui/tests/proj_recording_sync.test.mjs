// 1.8 S3.4 (D13): the server keeps the core in sync with the project. Arm, input, mode and monitor of a track go to the core with /k/rec/spur after every change (listener
// ProjZugang.beiStand), after undo/redo, on project open and after a core restart, not only at the start of a run. imKern changes only after a receipt that is not a
// refusal; while a run is active nothing is sent (dirty), flushed after the run, on the core hello and before every start. Mock core context.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projBereich } from '../areas/proj/area.ts';
import { aufnahmeBereich } from '../areas/proj/recording.ts';
import { pruefKontext, warteBis } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';

const angenommen = { status: 1, grund: '' };
const ok = { status: 3, grund: '' };
const ein = (name) => ({ art: 'intern', name });
const extern = (paar, modus = 'stereo') => ({ art: 'extern', paar, modus });

// n audio tracks G, H, I (unarmed). e.abgelehnt: a queue of answers for the next /k/rec/spur receipts (null = no core answers); e.rec: answers for /k/rec/start.
async function bereit(t, { spuren = 3, rec = [angenommen, { status: 2, grund: '' }] } = {}) {
  const k = pruefKontext();
  const e = { abgelehnt: [] };
  k.regel = (adresse) => (adresse === '/k/rec/spur' && e.abgelehnt.length ? e.abgelehnt.shift() : ok);
  const roh = k.warteQuittung.bind(k), zaehler = new Map();
  k.warteQuittung = async (id) => {
    const g = k.gesendet.find((x) => x.id === id);
    if (g?.adresse !== '/k/rec/start') return roh(id);
    const n = (zaehler.get(id) ?? 0) + 1;
    zaehler.set(id, n);
    return rec[Math.min(n, rec.length) - 1];
  };
  const d = tmpOrdner(t, 'djk-recsync-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const br = aufnahmeBereich(k, b.zugang, { fristMs: 60 });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung, a = br.aufnahme;
  await s.neu('R', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  for (let i = 0; i < spuren; i++) {
    await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'GHI'[i] }] }, 'andreas');
  }
  await a.abgeglichen();
  k.leere();
  const kern = (adr, f) => { b.ereignis(adr, f); a.ereignis(adr, f); };   // what the server hands to every area
  const aendere = async (befehle, label = 'x') => {
    const r = await s.aendern({ rev: s.aktuell().j.projekt.rev, label, befehle }, 'andreas');
    await a.abgeglichen();
    return r;
  };
  const spur = (i) => s.aktuell().j.projekt.spuren[i];
  const arm = (i, eingang, extra = {}) => aendere([{ befehl: 'spur_aendern', spur_id: spur(i).id, eingang, arm: true, ...extra }], 'Arm');
  // the messages of /k/rec/spur as [spur, scharf, eingang, modus, monitor]
  const msgs = () => k.an('/k/rec/spur').map((m) => [m.felder.spur, m.felder.scharf, m.felder.eingang, m.felder.modus, m.felder.monitor]);
  return { k, e, b, s, a, d, kern, aendere, spur, arm, msgs, rec };
}
const rohdatei = (e, kennung, nr, frames) => {
  const f = path.join(e.b.zugang.arbeitsordner(), `aufnahme-${nr}-${kennung}.f32`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.alloc(frames * 8, 1));
};

test('arm sends exactly one /k/rec/spur with the input code, mode and monitor auto; a change unrelated to recording sends none (negative control)', async (t) => {
  const e = await bereit(t);
  await e.arm(0, ein('erz/1'));
  assert.deepEqual(e.msgs(), [[1, 1, 11, 0, 1]]);
  assert.deepEqual(e.a.imKernStand(1), { eingang: 11, modus: 0, monitor: 1 });
  assert.deepEqual(e.a.schmutzig(), []);
  e.k.leere();
  await e.aendere([{ befehl: 'spur_aendern', spur_id: e.spur(0).id, fader_db: -6 }], 'Fader');
  await e.aendere([{ befehl: 'spur_aendern', spur_id: e.spur(1).id, name: 'Neu' }], 'Name');
  assert.deepEqual(e.msgs(), [], 'a fader or a name changes nothing the core holds for recording');
  assert.deepEqual(e.a.schmutzig(), []);
});

test('monitor change of an external track: one message with the same input and mode, monitor aus 0, ein 2, auto 1', async (t) => {
  const e = await bereit(t);
  await e.arm(0, extern(2, 'links'));
  assert.deepEqual(e.msgs(), [[1, 1, 2, 1, 1]], 'pair 2, mode links, monitor auto');
  for (const [wort, code] of [['ein', 2], ['aus', 0], ['auto', 1]]) {
    e.k.leere();
    await e.aendere([{ befehl: 'spur_aendern', spur_id: e.spur(0).id, monitor: wort }], 'Monitor');
    assert.deepEqual(e.msgs(), [[1, 1, 2, 1, code]], `monitor ${wort}`);
    assert.equal(e.a.imKernStand(1).monitor, code);
  }
});

test('undo of the arm sends scharf 0, redo sends it again', async (t) => {
  const e = await bereit(t);
  await e.arm(0, ein('erz/1'));
  e.k.leere();
  await e.s.umkehr('undo', { rev: e.s.aktuell().j.projekt.rev }, 'andreas');
  await e.a.abgeglichen();
  assert.deepEqual(e.msgs(), [[1, 0, 0, 0, 1]]);
  assert.equal(e.a.imKernStand(1), null);
  e.k.leere();
  await e.s.umkehr('redo', { rev: e.s.aktuell().j.projekt.rev }, 'andreas');
  await e.a.abgeglichen();
  assert.deepEqual(e.msgs(), [[1, 1, 11, 0, 1]]);
});

test('project switch: every armed track of the old project is cleared in the core', async (t) => {
  const e = await bereit(t);
  await e.arm(0, ein('erz/1'));
  await e.arm(2, extern(1));
  e.k.leere();
  await e.s.neu('Zwei', 'andreas');
  await e.a.abgeglichen();
  assert.deepEqual(e.msgs(), [[1, 0, 0, 0, 1], [3, 0, 0, 0, 1]]);
  assert.deepEqual([e.a.imKernStand(1), e.a.imKernStand(3)], [null, null]);
});

test('core restart: the new generation gets the full state again, once', async (t) => {
  const e = await bereit(t);
  await e.arm(0, ein('erz/1'));
  await e.arm(1, extern(3, 'summe'));
  e.kern('/k/willkommen', { generation: 1 });
  await e.a.abgeglichen();
  e.k.leere();
  e.kern('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => e.msgs().length >= 2, 2000), 'both tracks go to the new core');
  await new Promise((r) => setTimeout(r, 150));   // nachNeustart ends with its own sync: it must find nothing left to send
  await e.a.abgeglichen();
  assert.deepEqual(e.msgs().sort((x, y) => x[0] - y[0]), [[1, 1, 11, 0, 1], [2, 1, 3, 3, 1]]);
  // negative control: the same generation again (a second hello) sends nothing
  e.k.leere();
  e.kern('/k/willkommen', { generation: 2 });
  await e.a.abgeglichen();
  assert.deepEqual(e.msgs(), []);
});

test('refusal: aufnahme_laeuft leaves imKern as it was, marks the track dirty; the hello flushes it', async (t) => {
  const e = await bereit(t);
  e.e.abgelehnt.push({ status: 6, grund: 'aufnahme_laeuft' });
  await e.arm(0, ein('erz/1'));
  assert.equal(e.a.imKernStand(1), null, 'the core refused: imKern does not hold the track');
  assert.deepEqual(e.a.schmutzig(), [1]);
  e.k.leere();
  e.kern('/k/willkommen', { generation: 1 });
  await e.a.abgeglichen();
  assert.deepEqual(e.msgs(), [[1, 1, 11, 0, 1]], 'flushed');
  assert.deepEqual(e.a.imKernStand(1), { eingang: 11, modus: 0, monitor: 1 });
  assert.deepEqual(e.a.schmutzig(), []);
});

test('no core: the silent core (no receipt) marks the track dirty; the next hello flushes it', async (t) => {
  const e = await bereit(t);
  e.e.abgelehnt.push(null);
  await e.arm(0, ein('erz/2'));
  assert.equal(e.a.imKernStand(1), null);
  assert.deepEqual(e.a.schmutzig(), [1]);
  e.k.leere();
  e.kern('/k/willkommen', { generation: 1 });
  await e.a.abgeglichen();
  assert.deepEqual(e.msgs(), [[1, 1, 12, 0, 1]]);
  assert.deepEqual([e.a.imKernStand(1) !== null, e.a.schmutzig()], [true, []]);
});

test('during a run nothing is sent: arm of track 3 waits (dirty), a monitor change of a recording track goes at once, an input change of it is refused (aufnahme_laeuft); after the run track 3 goes out and the next run records it', async (t) => {
  const e = await bereit(t);
  await e.arm(0, ein('erz/1'));
  await e.arm(1, ein('erz/2'));
  const r = await e.a.start({ von_beat: 0 }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r));
  const kennung = r.j.kennung;
  assert.deepEqual(r.j.spuren.map((x) => x.nr), [1, 2]);
  e.k.leere();
  // a new arm during the run
  await e.arm(2, ein('erz/3'));
  assert.deepEqual(e.msgs(), [], 'no /k/rec/spur for track 3 during the run');
  assert.deepEqual(e.a.schmutzig(), [3]);
  // monitor only, on a recording track: the core accepts it in place (D12), so it goes at once
  await e.aendere([{ befehl: 'spur_aendern', spur_id: e.spur(0).id, monitor: 'ein' }], 'Monitor');
  assert.deepEqual(e.msgs(), [[1, 1, 11, 0, 2]]);
  assert.deepEqual(e.a.schmutzig(), [3]);
  // the input of a recording track (1.8 T9, AK2): refused before any message, the project keeps the old input
  e.k.leere();
  await assert.rejects(e.aendere([{ befehl: 'spur_aendern', spur_id: e.spur(1).id, eingang: ein('erz/5') }], 'Eingang'), { code: 409, fehler: 'aufnahme_laeuft' });
  assert.deepEqual(e.msgs(), []);
  assert.deepEqual(e.spur(1).aufnahme.eingang, ein('erz/2'));
  assert.deepEqual(e.a.schmutzig(), [3]);
  // the take comes in: the run ends, the placement is done, then the dirty tracks are flushed
  for (const nr of [1, 2]) { rohdatei(e, kennung, nr, 4800); e.kern('/e/aufnahme', { spur: nr, kennung, status: 0, frames: 4800, start_sample: 0n, luecken: 0 }); }
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 2000), 'the run is over');
  assert.equal(e.a.lage().j.letzte.code, 200, JSON.stringify(e.a.lage().j.letzte));
  await e.a.abgeglichen();
  assert.deepEqual(e.msgs(), [[3, 1, 13, 0, 1]], 'track 3 went out after the placement, track 2 had nothing to send');
  assert.deepEqual(e.a.schmutzig(), []);
  // the next run records tracks 1, 2 and 3, and the takes of both new tracks are placed
  const r2 = await e.a.start({ von_beat: 8 }, 'andreas');
  assert.equal(r2.code, 200, JSON.stringify(r2));
  assert.deepEqual(r2.j.spuren.map((x) => x.nr), [1, 2, 3]);
  const k2 = r2.j.kennung;
  for (const nr of [1, 2, 3]) { rohdatei(e, k2, nr, 4800); e.kern('/e/aufnahme', { spur: nr, kennung: k2, status: 0, frames: 4800, start_sample: 0n, luecken: 0 }); }
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 2000));
  const clips = e.s.aktuell().j.projekt.spuren.map((x) => x.clips.length);
  assert.ok(clips[2] >= 1 && clips[1] >= 2 && clips[0] >= 2, `takes placed on all three tracks: ${clips}`);
});

test('start sends the full state once per core generation and only differences afterwards', async (t) => {
  const e = await bereit(t, { spuren: 2 });
  await e.arm(0, ein('erz/1'));
  e.k.leere();
  const r = await e.a.start({ von_beat: 0 }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.equal(e.msgs().length, 32, 'first start of this generation: all 32 tracks, armed or not');
  const kennung = r.j.kennung;
  rohdatei(e, kennung, 1, 4800);
  e.kern('/e/aufnahme', { spur: 1, kennung, status: 0, frames: 4800, start_sample: 0n, luecken: 0 });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 2000));
  e.k.leere();
  const r2 = await e.a.start({ von_beat: 8 }, 'andreas');
  assert.equal(r2.code, 200, JSON.stringify(r2));
  assert.deepEqual(e.msgs(), [], 'second start: nothing differs, nothing is sent');
});
