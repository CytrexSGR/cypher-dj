// Media browser slice 1, task 2: /sampler/datei/hoer and /sampler/datei/spur by catalog sha. The catalog rows point at files OUTSIDE every sampler root.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';
import { sinusWav } from './support/sinus_wav.mjs';
import { baueKatalog, ksha } from './support/catalog.mjs';
import { listeSchnitte } from '../sampler/schnitt.ts';

async function aufbau(t, { ohneKatalog = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-katr-'));
  const d = { root, loops: path.join(root, 'loops'), module: path.join(root, 'module'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk'), lib: path.join(root, 'lib'), aussen: path.join(root, 'aussen') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  fs.writeFileSync(path.join(d.sampler, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: d.lib }]));
  const alt = { bk: process.env.CYPHERDJ_BK_ORDNER, sampler: process.env.CYPHERDJ_SAMPLER };
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  process.env.CYPHERDJ_SAMPLER = d.sampler;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', alt.bk], ['CYPHERDJ_SAMPLER', alt.sampler]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const kick = path.join(d.aussen, 'Kick 01.wav'), weg = path.join(d.aussen, 'weg.wav'), prot = path.join(d.aussen, 'prot.wav'), trk = path.join(d.aussen, 'track.wav');
  sinusWav(kick, { hz: 110, sekunden: 0.5, rate: 44100, kanaele: 1 });
  sinusWav(weg, { hz: 110, sekunden: 0.5, rate: 44100, kanaele: 1 });
  sinusWav(prot, { hz: 110, sekunden: 0.5, rate: 44100, kanaele: 1 });
  sinusWav(trk, { hz: 110, sekunden: 0.5, rate: 44100, kanaele: 1 });
  const katalog = ohneKatalog ? '/nicht/da/katalog.sqlite' : baueKatalog(path.join(root, 'kat'), [
    { n: 1, typ: 'oneshot', name: 'Kick 01', instrument: 'kick', pfad: kick },
    { n: 2, typ: 'oneshot', name: 'Weg', pfad: weg },
    { n: 3, typ: 'oneshot', name: 'Prot', schutz: 'ableton', pfad: prot },
    { n: 4, typ: 'track', titel: 'Ein Track', pfad: trk },
    { n: 5, typ: 'oneshot', name: 'Ohne Pfad', pfad: null },
  ]);
  const s = await stapel(t, { loops: d.loops, katalog });
  s.optionen.modulOrdner = d.module;
  s.optionen.samplerOrdner = d.sampler;
  const oeffne = async (name = 'Mod', tempo = 120) => {
    const r = await ruf(s.url, 'POST', '/proj/neu', { name, werkbank: true });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    assert.equal((await ruf(s.url, 'POST', '/proj/aendern', { rev: r.j.projekt.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: tempo }] })).code, 200);
  };
  const verlauf = async () => (await ruf(s.url, 'GET', '/proj/verlauf')).j;
  return { ...s, d, oeffne, verlauf, weg, sha: (n) => ksha(n) };
}

test('hoer by sha: a catalog file outside every root is served', async (t) => {
  const z = await aufbau(t);
  const a = await fetch(`${z.url}/sampler/datei/hoer?sha=${z.sha(1)}`);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await a.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
});

test('hoer by sha: unknown sha 404 quelle_unbekannt, protected row 422 format_falsch, sha with wurzel 400 argument_ungueltig', async (t) => {
  const z = await aufbau(t);
  const g = async (q) => { const r = await ruf(z.url, 'GET', `/sampler/datei/hoer?${q}`); return [r.code, r.j.fehler]; };
  assert.deepEqual(await g(`sha=${'0'.repeat(64)}`), [404, 'quelle_unbekannt']);
  assert.deepEqual(await g(`sha=${z.sha(3)}`), [422, 'format_falsch']);
  assert.deepEqual(await g(`sha=${z.sha(4)}`), [422, 'format_falsch'], 'a library track is not a sample');
  assert.deepEqual(await g(`sha=${z.sha(5)}`), [404, 'quelle_unbekannt'], 'a row without a path');
  assert.deepEqual(await g(`sha=${z.sha(1)}&wurzel=Lib&rel=x.wav`), [400, 'argument_ungueltig']);
  assert.deepEqual(await g(''), [400, 'argument_ungueltig'], 'neither');
  assert.deepEqual(await g('sha=abc'), [400, 'sha_ungueltig']);
});

test('hoer and spur by sha without a catalog: 503 katalog_fehlt', async (t) => {
  const z = await aufbau(t, { ohneKatalog: true });
  const r = await ruf(z.url, 'GET', `/sampler/datei/hoer?sha=${z.sha(1)}`);
  assert.deepEqual([r.code, r.j.fehler], [503, 'katalog_fehlt']);
});

test('spur by sha: one history step and a cut with quelle {art: katalog, ref: sha}', async (t) => {
  const z = await aufbau(t);
  await z.oeffne();
  const v0 = (await z.verlauf()).length;
  const r = await ruf(z.url, 'POST', '/sampler/datei/spur', { sha: z.sha(1) });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(typeof r.j.spur_id, 'string');
  const cuts = listeSchnitte({ ordner: z.d.sampler });
  assert.equal(cuts.length, 1);
  assert.deepEqual(cuts[0].quelle, { art: 'katalog', ref: z.sha(1) });
  assert.equal(cuts[0].name, 'Kick 01');
  const v = await z.verlauf();
  assert.equal(v.length, v0 + 1);
  assert.equal(v.at(-1).label, 'Tone Kick 01');
  const n = await ruf(z.url, 'POST', '/sampler/datei/spur', { sha: z.sha(1), name: 'Mein Kick' });
  assert.equal(n.code, 200, JSON.stringify(n.j));
  assert.deepEqual(listeSchnitte({ ordner: z.d.sampler }).map((c) => c.name).sort(), ['Kick 01', 'Mein Kick']);
});

test('spur by sha: a file removed after listing is 404 quelle_unbekannt and leaves no cut', async (t) => {
  const z = await aufbau(t);
  await z.oeffne();
  const vorher = listeSchnitte({ ordner: z.d.sampler }).length, v0 = (await z.verlauf()).length;
  fs.rmSync(z.weg);
  const r = await ruf(z.url, 'POST', '/sampler/datei/spur', { sha: z.sha(2) });
  assert.deepEqual([r.code, r.j.fehler], [404, 'quelle_unbekannt']);
  assert.equal(listeSchnitte({ ordner: z.d.sampler }).length, vorher);
  assert.equal((await z.verlauf()).length, v0);
});

test('spur by sha: a track row and a protected row are 422 format_falsch, mixed addressing 400, POST /sampler/schnitt refuses art katalog', async (t) => {
  const z = await aufbau(t);
  await z.oeffne();
  const p = async (d) => { const r = await ruf(z.url, 'POST', '/sampler/datei/spur', d); return [r.code, r.j.fehler]; };
  assert.deepEqual(await p({ sha: z.sha(4) }), [422, 'format_falsch']);
  assert.deepEqual(await p({ sha: z.sha(3) }), [422, 'format_falsch']);
  assert.deepEqual(await p({ sha: z.sha(1), wurzel: 'Lib', rel: 'x.wav' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await p({}), [400, 'argument_ungueltig']);
  assert.deepEqual(await p({ wurzel: 'Lib' }), [400, 'argument_ungueltig']);
  const s = await ruf(z.url, 'POST', '/sampler/schnitt', { quelle: { art: 'katalog', ref: z.sha(1) } });
  assert.deepEqual([s.code, s.j.fehler], [400, 'argument_ungueltig']);
  assert.deepEqual(listeSchnitte({ ordner: z.d.sampler }), []);
});
