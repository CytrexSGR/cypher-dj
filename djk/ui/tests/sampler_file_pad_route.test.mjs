// Media browser slice 3, task 7: POST /sampler/datei/pad {spur_id, ton, sha}: a catalog sample on one row of a drum track, as a copy of the kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { CYPHER, ruf } from './support/proj_stack.mjs';
import { sinusWav } from './support/sinus_wav.mjs';
import { baueKatalog, ksha } from './support/catalog.mjs';

const stereo = (frames, v) => { const d = new Float32Array(frames * 2).fill(v); return Buffer.from(d.buffer); };

async function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-pad-'));
  const d = { root, loops: path.join(root, 'loops'), module: path.join(root, 'module'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk'), aussen: path.join(root, 'aussen'), kits: path.join(root, 'kits') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  const vars = { CYPHERDJ_BK_ORDNER: d.bk, CYPHERDJ_SAMPLER: d.sampler, CYPHERDJ_KIT_ORDNER: d.kits };
  const alt = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(d.kits, 'k'));
  const klaenge = [[36, 'bd:0', 0.25], [37, 'sd:0', 0.5]].map(([note, name, v]) => {
    fs.writeFileSync(path.join(d.kits, 'k', `${note}.f32`), stereo(100, v));
    return { note, name, datei: `${note}.f32`, frames: 100, quelle: 'x' };
  });
  fs.writeFileSync(path.join(d.kits, 'k', 'kit.json'), JSON.stringify({ schema: 1, name: 'k', klaenge }));
  const kick = path.join(d.aussen, 'Kick 01.wav'), lang = path.join(d.aussen, 'lang.wav'), weg = path.join(d.aussen, 'weg.wav');
  sinusWav(kick, { hz: 110, sekunden: 0.5, rate: 44100, kanaele: 1 });
  sinusWav(lang, { hz: 110, sekunden: 11, rate: 44100, kanaele: 1 });
  sinusWav(weg, { hz: 110, sekunden: 0.5, rate: 44100, kanaele: 1 });
  const katalog = baueKatalog(path.join(root, 'kat'), [
    { n: 1, typ: 'oneshot', name: 'Kick 01', instrument: 'kick', pfad: kick },
    { n: 2, typ: 'oneshot', name: 'Lang', pfad: lang },
    { n: 3, typ: 'oneshot', name: 'Prot', schutz: 'ableton', pfad: kick },
    { n: 4, typ: 'oneshot', name: 'Weg', pfad: weg },
  ]);
  const s = await stapel(t, { loops: d.loops, katalog });
  s.optionen.modulOrdner = d.module;
  s.optionen.samplerOrdner = d.sampler;
  const oeffne = async () => {
    const r = await ruf(s.url, 'POST', '/proj/neu', { name: 'Mod', werkbank: true });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    return r.j.projekt;
  };
  let zaehler = 0;
  const spur = async (name = zaehler++ === 0 ? 'Drums' : `Drums ${zaehler}`) => {
    const q = (await ruf(s.url, 'GET', '/proj/aktuell')).j.projekt;
    const geraet = { art: 'intern', name: 'kit', kit: 'k' };
    const r = await ruf(s.url, 'POST', '/proj/aendern', { rev: q.rev, label: 'Drums', befehle: [{ befehl: 'werkbank_spur_neu', name, geraet, loop_beats: 4 }] });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    return { id: r.j.projekt.spuren.at(-1).id, projekt: r.j.projekt };
  };
  const verlauf = async () => (await ruf(s.url, 'GET', '/proj/verlauf')).j;
  const kitBytes = () => Object.fromEntries(fs.readdirSync(path.join(d.kits, 'k')).sort().map((n) => [n, fs.readFileSync(path.join(d.kits, 'k', n)).toString('base64')]));
  return { ...s, d, oeffne, spur, verlauf, kitBytes, sha: (n) => ksha(n), weg };
}

test('pad: one history step switches the drum track to the copied kit; undo brings the old kit back', async (t) => {
  const z = await aufbau(t);
  await z.oeffne();
  const { id } = await z.spur();
  const vorher = z.kitBytes(), v0 = (await z.verlauf()).length;
  const r = await ruf(z.url, 'POST', '/sampler/datei/pad', { spur_id: id, ton: 36, sha: z.sha(1) });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.kit, r.j.ton, r.j.name], ['k-2', 36, 'bd:0']);
  assert.equal(r.j.text, 'Kick 01.wav is now bd:0 on Drums (kit k-2)');
  assert.equal(typeof r.j.rev, 'number');
  assert.equal(r.j.projekt.spuren.find((s) => s.id === id).geraet.kit, 'k-2');
  const v = await z.verlauf();
  assert.equal(v.length, v0 + 1);
  assert.equal(v.at(-1).label, 'Sound on bd:0');
  assert.deepEqual(z.kitBytes(), vorher, 'the old kit stays byte-equal');
  assert.ok(fs.existsSync(path.join(z.d.kits, 'k-2', 'kit.json')));
  // a second drop on the same track: the copy of the copy, the counter goes on
  const r2 = await ruf(z.url, 'POST', '/sampler/datei/pad', { spur_id: id, ton: 60, sha: z.sha(1) });
  assert.equal(r2.code, 200, JSON.stringify(r2.j));
  assert.equal(r2.j.kit, 'k-2-2');
  const u = await ruf(z.url, 'POST', '/proj/undo', { rev: r2.j.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  const u2 = await ruf(z.url, 'POST', '/proj/undo', { rev: u.j.rev });
  assert.equal(u2.code, 200, JSON.stringify(u2.j));
  assert.equal((await ruf(z.url, 'GET', '/proj/aktuell')).j.projekt.spuren.find((s) => s.id === id).geraet.kit, 'k');
  assert.deepEqual(z.kitBytes(), vorher);
});

test('pad: another track that plays the same kit keeps it', async (t) => {
  const z = await aufbau(t);
  await z.oeffne();
  const a = await z.spur(), b = await z.spur();
  const r = await ruf(z.url, 'POST', '/sampler/datei/pad', { spur_id: a.id, ton: 37, sha: z.sha(1) });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const sp = r.j.projekt.spuren;
  assert.deepEqual([sp.find((s) => s.id === a.id).geraet.kit, sp.find((s) => s.id === b.id).geraet.kit], ['k-2', 'k']);
});

test('pad: a NOTE track is 409 kein_kit, an unknown track 404 spur_unbekannt, and no kit is left behind', async (t) => {
  const z = await aufbau(t);
  const p = await z.oeffne();
  const n = await ruf(z.url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Notes', befehle: [{ befehl: 'werkbank_spur_neu', name: 'Keys', geraet: { art: 'intern' }, loop_beats: 4 }] });
  assert.equal(n.code, 200, JSON.stringify(n.j));
  const note = n.j.projekt.spuren.at(-1).id;
  const g = async (d) => { const r = await ruf(z.url, 'POST', '/sampler/datei/pad', d); return [r.code, r.j.fehler]; };
  assert.deepEqual(await g({ spur_id: note, ton: 36, sha: z.sha(1) }), [409, 'kein_kit']);
  assert.deepEqual(await g({ spur_id: 'gibt-es-nicht', ton: 36, sha: z.sha(1) }), [404, 'spur_unbekannt']);
  assert.deepEqual(fs.readdirSync(z.d.kits), ['k']);
});

test('pad: a module with 8 instrument tracks still takes a pad drop', async (t) => {
  const z = await aufbau(t);
  await z.oeffne();
  let id;
  for (let i = 0; i < 8; i++) id = (await z.spur()).id;
  const voll = await ruf(z.url, 'POST', '/sampler/datei/spur', { sha: z.sha(1) });
  assert.deepEqual([voll.code, voll.j.fehler], [409, 'werkbank_voll'], 'TO TRACK is refused: the module is full');
  const r = await ruf(z.url, 'POST', '/sampler/datei/pad', { spur_id: id, ton: 36, sha: z.sha(1) });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.projekt.spuren.filter((s) => s.art === 'instrument').length, 8);
});

test('pad: without an open project 409 kein_projekt', async (t) => {
  const z = await aufbau(t);
  const r = await ruf(z.url, 'POST', '/sampler/datei/pad', { spur_id: 'x', ton: 36, sha: z.sha(1) });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_projekt']);
});

test('pad: refusals of the sha and the sound leave no kit and no history step', async (t) => {
  const z = await aufbau(t);
  await z.oeffne();
  const { id } = await z.spur();
  const v0 = (await z.verlauf()).length;
  const g = async (d, kopf) => { const r = await ruf(z.url, 'POST', '/sampler/datei/pad', d, kopf); return [r.code, r.j.fehler]; };
  assert.deepEqual(await g({ spur_id: id, ton: 36, sha: '0'.repeat(64) }), [404, 'quelle_unbekannt']);
  assert.deepEqual(await g({ spur_id: id, ton: 36, sha: z.sha(3) }), [422, 'format_falsch'], 'protected');
  assert.deepEqual(await g({ spur_id: id, ton: 36, sha: 'abc' }), [400, 'sha_ungueltig']);
  assert.deepEqual(await g({ spur_id: id, ton: 36, sha: z.sha(2) }), [400, 'klang_zu_lang']);
  fs.rmSync(z.weg);
  assert.deepEqual(await g({ spur_id: id, ton: 36, sha: z.sha(4) }), [404, 'quelle_unbekannt'], 'the file vanished after listing');
  for (const ton of [-1, 128, 1.5, '36', undefined]) assert.deepEqual(await g({ spur_id: id, ton, sha: z.sha(1) }), [400, 'argument_ungueltig']);
  assert.deepEqual(await g({ spur_id: id, ton: 36 }), [400, 'argument_ungueltig'], 'no sha');
  assert.deepEqual(await g({ ton: 36, sha: z.sha(1) }), [400, 'argument_ungueltig'], 'no track');
  assert.deepEqual(await g({ spur_id: id, ton: 36, sha: z.sha(1), x: 1 }), [400, 'argument_unbekannt']);
  assert.equal((await g({ spur_id: id, ton: 36, sha: z.sha(1) }, CYPHER))[0], 200, 'control: a good drop passes');
  assert.deepEqual(fs.readdirSync(z.d.kits).sort(), ['k', 'k-2'], 'only the one good drop made a kit');
  assert.equal((await z.verlauf()).length, v0 + 1);
});
