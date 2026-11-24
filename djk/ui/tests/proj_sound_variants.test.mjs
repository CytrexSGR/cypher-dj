// FIND SOUND task 2: Ausgabe.rendereKlangVarianten renders knob variants of one Baukasten track from a modified copy of the open project. Against the REAL S2
// integration (tests/support/output_setup.mjs) with the render double tests/support/render_mock.mjs, which records the playback file it was given.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { alsAntwort } from '../areas/proj/output.ts';
// Hermetic graphs: the shipped demo graphs of the repo, not the owner's ~/cypherdj/werke/geraete (the public export has no such folder).
process.env.CYPHERDJ_BK_ORDNER = path.resolve(import.meta.dirname, '..', '..', 'instruments', 'modular_dsp', 'demos');

const ruf = async (f) => { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } };
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');
const renderAufrufe = (a) => (fs.existsSync(protokollDatei(a)) ? fs.readFileSync(protokollDatei(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
// a private TMPDIR per test: other test files that run at the same time create djk-analyse-* folders in the shared one
const tmpOrdner = (a) => path.join(a.tmp, 'tmpdir');
const UMG = (a, extra = {}) => ({ TMPDIR: tmpOrdner(a), RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a), ...extra });
const tmpReste = (a) => fs.readdirSync(tmpOrdner(a)).sort();
const dateien = (a) => fs.readdirSync(a.arbeitsordner).filter((n) => n.startsWith('wiedergabe-')).sort();
const sammle = (r) => r;

// the aufbau project plus a Baukasten track "Pad" (s4) with knob k1 = 0.3 and a note in the range
async function mitPad(t, extra = {}) {
  const a = await aufbau(t, { tempo: 120, ...extra });
  fs.mkdirSync(tmpOrdner(a));
  await a.aendern([
    { befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet: { art: 'intern', name: 'bk', graph: 'juno-pad', parameter: { k1: 0.3, k2: 0.6 } } },
    { befehl: 'clip_neu', spur_id: 's4', art: 'midi', start_beat: 0, laenge_beats: 16, noten: [{ beat: 0, laenge: 1, ton: 48, vel: 100 }] },
  ], 'Pad');
  return a;
}
const lauf = (a, spur, varianten, von = 0, bis = 8, env = {}) =>
  mitUmgebung(UMG(a, env), () => ruf(() => a.ausgabe.rendereKlangVarianten(spur, varianten, von, bis, async (r) => sammle(r))));
const padParameter = (aufruf) => aufruf.wiedergabe.spuren.find((x) => x.geraet === 'bk').parameter;

test('each variant renders with its own knob value and the empty variant with the project value', async (t) => {
  const a = await mitPad(t);
  const r = await lauf(a, 's4', [{}, { k1: 0.5 }, { k1: 0.9, k3: 0.1 }]);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.teile.length, 3);
  assert.ok(r.body.teile.every((x) => !x.stumm && typeof x.datei === 'string' && x.frames > 0 && Number.isFinite(x.spitze_db)));
  assert.equal(r.body.slug, a.offen().slug);
  assert.equal(r.body.tempo_bpm, 120);
  const mein = renderAufrufe(a);
  assert.equal(mein.length, 3, 'one render per variant');
  assert.deepEqual(padParameter(mein[0]), { k1: 0.3, k2: 0.6 }, 'the empty variant is the sound as the project has it');
  assert.deepEqual(padParameter(mein[1]), { k1: 0.5, k2: 0.6 });
  assert.deepEqual(padParameter(mein[2]), { k1: 0.9, k2: 0.6, k3: 0.1 });
  // the same controls as the single-track render of the analysis: the track alone, as the mix has it
  assert.ok(mein.every((x) => x.argv.includes('--ohne-zustand') && !x.argv.includes('--trocken-aus')));
});

test('the open project keeps its rev and its knob values', async (t) => {
  const a = await mitPad(t);
  const vorher = structuredClone(a.projekt());
  const verlaufVorher = a.s.aktuell().j.projekt.rev;
  const r = await lauf(a, 's4', [{ k1: 0.9 }, { k2: 0.1 }]);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.rev, verlaufVorher);
  assert.equal(a.projekt().rev, verlaufVorher);
  assert.deepEqual(a.projekt(), vorher);
  assert.deepEqual(a.projekt().spuren.find((x) => x.id === 's4').geraet.parameter, { k1: 0.3, k2: 0.6 });
});

test('no playback file and no temporary folder is left, also after a failing render', async (t) => {
  const a = await mitPad(t);
  const tmpVorher = tmpReste(a), dateienVorher = dateien(a);
  const gesehen = [];
  const ok = await mitUmgebung(UMG(a), () => ruf(() => a.ausgabe.rendereKlangVarianten('s4', [{}, { k1: 0.5 }], 0, 8, async (r) => {
    for (const x of r.teile) gesehen.push(fs.existsSync(x.datei));            // the WAVs exist while `nimm` runs
    return 1;
  })));
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.deepEqual(gesehen, [true, true]);
  assert.deepEqual(tmpReste(a), tmpVorher);
  const neu = a.protokoll.wiedergaben.map((w) => w.datei);
  assert.ok(neu.length >= 2 && neu.every((d) => !fs.existsSync(d)), 'every playback file written for a variant is deleted');
  assert.ok(dateien(a).every((n) => dateienVorher.includes(n)));
  // a failing render: nothing is left, the lock is free again
  a.protokoll.wiedergaben.length = 0;
  const f = await lauf(a, 's4', [{}, { k1: 0.5 }], 0, 8, { RENDER_ATTRAPPE_RC: '4' });
  assert.deepEqual([f.code, f.body.fehler], [502, 'render_fehler']);
  assert.deepEqual(tmpReste(a), tmpVorher);
  assert.ok(a.protokoll.wiedergaben.every((w) => !fs.existsSync(w.datei)));
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  // a failing `nimm`
  const n = await mitUmgebung(UMG(a), () => ruf(() => a.ausgabe.rendereKlangVarianten('s4', [{}], 0, 8, async () => { throw new Error('nimm'); })));
  assert.notEqual(n.code, 200);
  assert.deepEqual(tmpReste(a), tmpVorher);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
});

test('a silenced track gives silent parts without a render', async (t) => {
  const a = await mitPad(t);
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's4', mute: true }], 'Pad mute');
  const r = await lauf(a, 's4', [{}, { k1: 0.5 }]);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.teile, [{ stumm: true }, { stumm: true }]);
  assert.equal(renderAufrufe(a).length, 0);
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's4', mute: false }], 'Pad unmute');
  const leer = await lauf(a, 's4', [{}], 40, 44);                            // nothing in the range
  assert.deepEqual(leer.body.teile, [{ stumm: true }]);
  assert.equal(renderAufrufe(a).length, 0);
});

test('refusals: unknown track, audio track, unknown knob, value out of range, nine variants', async (t) => {
  const a = await mitPad(t);
  const fehler = async (spur, v) => { const r = await lauf(a, spur, v); return [r.code, r.body.fehler]; };
  assert.deepEqual(await fehler('s9', [{}]), [400, 'spur_unbekannt']);
  assert.deepEqual(await fehler('s1', [{}]), [409, 'geraet_falsch']);
  assert.deepEqual(await fehler('s2', [{}]), [409, 'geraet_falsch'], 'an RB-338 track is no Cypher Modular track');
  assert.deepEqual(await fehler('s4', [{ k65: 0.5 }]), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler('s4', [{ k0: 0.5 }]), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler('s4', [{ gain: 0.5 }]), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler('s4', [{ k1: 1.01 }]), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler('s4', [{ k1: -0.01 }]), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler('s4', [{ k1: Number.NaN }]), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler('s4', []), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler('s4', Array.from({ length: 9 }, () => ({}))), [400, 'argument_ungueltig']);
  assert.equal((await lauf(a, 's4', Array.from({ length: 8 }, () => ({})))).code, 200, 'eight variants are allowed');
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
});

test('a held lock answers beschaeftigt', async (t) => {
  const a = await mitPad(t);
  const eins = lauf(a, 's4', [{}], 0, 8, { RENDER_ATTRAPPE_SCHLAF_MS: '400' });
  await new Promise((ok) => setTimeout(ok, 200));
  assert.deepEqual(a.s.aktuell().j.ausgabe_lauf, { art: 'analyse' });
  const zwei = await lauf(a, 's4', [{}]);
  assert.deepEqual([zwei.code, zwei.body.fehler], [409, 'beschaeftigt']);
  assert.equal((await eins).code, 200);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
});

test('a plugin stage is refused before any render', async (t) => {
  const a = await mitPad(t, { host: { abhaengig: { insert: async () => ({ code: 1, aus: '', fehler: 'x' }), sock: async () => { throw new Error('x'); } } } });
  await a.vorbei([{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'host', plugin: { format: 'vst3', pfad: '/x/Fake.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' } }]);
  const r = await lauf(a, 's4', [{}]);
  assert.deepEqual([r.code, r.body.fehler], [409, 'host_insert_echtzeit']);
  assert.equal(renderAufrufe(a).length, 0);
});
