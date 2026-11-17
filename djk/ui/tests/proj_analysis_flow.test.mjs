// ANALYZE slice 1: POST /proj/analyse as a flow (areas/proj/sound_analysis.ts + Ausgabe.rendereStreifen) against the REAL S2 integration
// (tests/support/output_setup.mjs). The render is the double tests/support/render_mock.mjs in RENDER_ATTRAPPE_MISCHUNG mode (one sine per track whose
// level follows the fader in the controls file); loudness is measured by the real ffmpeg. The analysis is replaced by a stand-in that reads the WAVs
// with leseWavF32Bloecke and returns the measurement of the contract fixture with the real peak; the hint functions are stand-ins too, so this file never
// loads project/klang_messung.ts. The real worker runs in tests/proj_analyse_ende.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { alsAntwort } from '../areas/proj/output.ts';
import { KlangAnalyse } from '../areas/proj/sound_analysis.ts';
import { leseWavF32Bloecke } from '../sampler/wav.ts';
import { pruefeAntwort } from '../project/sound_contract.ts';

const FIXTURE = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'analyse_antwort.json'), 'utf8'));
const PLUGIN = { format: 'vst3', pfad: '/x/Fake.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const KEIN_HOST = { abhaengig: { insert: async () => ({ code: 1, aus: '', fehler: 'test: no host' }), sock: async () => { throw new Error('test: no socket'); } } };

async function ruf(f) {
  try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); }
}
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');
const renderAufrufe = (a) => (fs.existsSync(protokollDatei(a)) ? fs.readFileSync(protokollDatei(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
const MISCHUNG = (a) => ({ RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) });
const tmpReste = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('djk-analyse-')).sort();
const nurSchluessel = (x) => { const i = x.argv.indexOf('--nur-schluessel'); return i < 0 ? null : x.argv[i + 1]; };
const regeln = (x) => ({ regler: x.regler, nurSchluessel: nurSchluessel(x), trocken: x.argv.includes('--trocken-aus'), ohneZustand: x.argv.includes('--ohne-zustand') });

// stand-in of the analysis: peak from the WAV, everything else from the fixture
function werkAttrappe(zaehler = { n: 0, dateien: [] }, schlafMs = 0) {
  const teil = (datei, frames) => {
    let spitze = 0;
    if (datei) leseWavF32Bloecke(datei, 65536, (b) => { for (const x of b) spitze = Math.max(spitze, Math.abs(x)); });
    const db = spitze > 0 ? 20 * Math.log10(spitze) : -200;
    const m = structuredClone(FIXTURE.quelle);
    return { stumm: datei === null, spitze_db: datei === null ? -200 : db, rms_db: datei === null ? -200 : db - 3, crest_db: 3, stereo: m.stereo, spektrum: m.spektrum, zeitbild: m.zeitbild,
      spaltenTerz: new Float32Array(30), spalten: m.zeitbild.spalten, frames };
  };
  return async (d) => {
    zaehler.n++; zaehler.dateien.push(d);
    if (schlafMs) await new Promise((ok) => setTimeout(ok, schlafMs));
    return { quelle: teil(d.quelle, d.frames[0]), ...(d.vergleich !== undefined ? { vergleich: teil(d.vergleich, d.frames[1]) } : {}) };
  };
}
const HINWEISE = { quelle: () => [], ueberdeckung: () => [] };
const klang = (a, o = {}) => new KlangAnalyse(a.ausgabe, { analysiere: werkAttrappe(), hinweise: HINWEISE, ...o });
const analyse = (a, k, d, extra = {}) => mitUmgebung({ ...MISCHUNG(a), ...extra }, () => ruf(() => k.analysiere(d)));

test('a track renders exactly as proj_lautheit renders it', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const k = klang(a);
  const r = await analyse(a, k, { quelle: { art: 'spur', id: 's2' } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(pruefeAntwort(r.body), []);
  const mein = renderAufrufe(a);
  assert.equal(mein.length, 1);
  const l = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({})));
  assert.equal(l.code, 200, JSON.stringify(l.body));
  const alle = renderAufrufe(a);
  assert.equal(alle.length, 1 + 4);
  assert.deepEqual(regeln(mein[0]), regeln(alle[1 + 1]), 'the s2 render of proj_lautheit has the same controls and key mask');
  const s2 = l.body.spuren.find((s) => s.nr === 2);
  assert.ok(Math.abs(r.body.quelle.lautheit.lufs_i - s2.lufs_i) <= 0.05, `${r.body.quelle.lautheit.lufs_i} vs ${s2.lufs_i}`);
  assert.equal(typeof r.body.quelle.lautheit.lufs_s_max, 'number');
  assert.equal(typeof r.body.quelle.lautheit.lufs_m_max, 'number');
  assert.deepEqual([r.body.von_beat, r.body.bis_beat, r.body.dauer_s, r.body.tempo_bpm], [0, 16, 8, 120]);
  assert.equal(r.body.quelle.name, 'Bass');
});

test('the master renders with the project controls like the loudness sum', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await analyse(a, klang(a), { quelle: { art: 'master' }, von_beat: 0, bis_beat: 8 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const l = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 8 })));
  const alle = renderAufrufe(a);
  assert.deepEqual(regeln(alle[0]), regeln(alle[1 + 2]), 'the sum render is the third of proj_lautheit');
  assert.equal(r.body.quelle.name, 'Master');
  assert.ok(Math.abs(r.body.quelle.lautheit.lufs_i - l.body.summe.lufs_i) <= 0.05);
});

test('a group and a return render with the group and return controls of proj_lautheit', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s2'] }, { befehl: 'return_neu', name: 'R' }], 'Group and return');
  const g = a.projekt().gruppen[0].id, rid = a.projekt().returns[0].id;
  await a.aendern([{ befehl: 'send_setzen', strang_id: 's1', return_id: rid, db: -6 }], 'Send');
  const r = await analyse(a, klang(a), { quelle: { art: 'gruppe', id: g }, vergleich: { art: 'return', id: rid }, von_beat: 0, bis_beat: 8 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.quelle.name, 'G');
  assert.equal(r.body.vergleich.stumm, false);
  const l = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 8 })));
  assert.equal(l.code, 200, JSON.stringify(l.body));
  const alle = renderAufrufe(a);
  assert.equal(alle.length, 2 + 5);
  assert.deepEqual(regeln(alle[0]), regeln(alle[2 + 3]), 'group');
  assert.deepEqual(regeln(alle[1]), regeln(alle[2 + 4]), 'return');
  assert.equal(regeln(alle[1]).trocken, true);
});

test('unknown ids and bad arguments are refused', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const k = klang(a);
  const fehler = async (d) => { const r = await analyse(a, k, d); return [r.code, r.body.fehler]; };
  assert.deepEqual(await fehler({ quelle: { art: 'spur', id: 's9' } }), [400, 'spur_unbekannt']);
  assert.deepEqual(await fehler({ quelle: { art: 'gruppe', id: 'g9' } }), [400, 'gruppe_unbekannt']);
  assert.deepEqual(await fehler({ quelle: { art: 'return', id: 'r9' } }), [400, 'return_unbekannt']);
  assert.deepEqual(await fehler({ quelle: { art: 'master' }, vergleich: { art: 'spur', id: 's9' } }), [400, 'spur_unbekannt']);
  assert.deepEqual(await fehler({ quelle: { art: 'x' } }), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler({ quelle: { art: 'spur' } }), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler({ art: 'master' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler({}), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler({ quelle: { art: 'master' }, extra: 1 }), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler({ quelle: { art: 'master' }, bis_beat: 2000 }), [400, 'export_bereich']);
  assert.deepEqual(await fehler({ quelle: { art: 'master' }, von_beat: 'a' }), [400, 'argument_ungueltig']);
  const selbst = await analyse(a, k, { quelle: { art: 'spur', id: 's1' }, vergleich: { art: 'spur', id: 's1' } });
  assert.deepEqual([selbst.code, selbst.body.fehler], [400, 'argument_ungueltig']);
  assert.match(selbst.body.text, /another strip/);
  a.zustand.quelle = 'cypher'; a.zustand.ki = true;
  assert.deepEqual(await fehler({ quelle: { art: 'master' } }), [409, 'ki_gestoppt']);
  assert.equal(renderAufrufe(a).length, 0, 'nothing was rendered');
});

test('it runs while the transport plays when no track needs a freeze', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  assert.equal((await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }))).code, 200);
  const vorher = a.freezes().length;
  a.zustand.kernStatus = 2; a.arrMeldung();
  const r = await analyse(a, klang(a), { quelle: { art: 'spur', id: 's2' } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(a.freezes().length, vorher, 'no freeze was sent');
  assert.equal(renderAufrufe(a).length, 1);
});

test('an unfrozen Surge track refuses while playing and is frozen when stopped', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const k = klang(a);
  a.zustand.kernStatus = 2; a.arrMeldung();
  const r = await analyse(a, k, { quelle: { art: 'spur', id: 's2' } });
  assert.deepEqual([r.code, r.body.fehler], [409, 'transport_laeuft']);
  assert.match(r.body.text, /stop the transport so it can be frozen first/);
  assert.equal(renderAufrufe(a).length, 0);
  assert.equal(a.freezes().length, 0);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  a.zustand.kernStatus = 0; a.arrMeldung();
  const ok = await analyse(a, k, { quelle: { art: 'spur', id: 's2' } });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(a.freezes().length, 1);
});

test('an active plugin stage is refused before any render', async (t) => {
  const a = await aufbau(t, { tempo: 120, host: KEIN_HOST });
  await a.vorbei([{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'host', plugin: PLUGIN }]);
  const r = await analyse(a, klang(a), { quelle: { art: 'spur', id: 's2' } });
  assert.deepEqual([r.code, r.body.fehler], [409, 'host_insert_echtzeit']);
  assert.equal(renderAufrufe(a).length, 0);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
});

test('the same request twice at once renders once; another request meanwhile is busy', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const z = { n: 0, dateien: [] };
  const k = klang(a, { analysiere: werkAttrappe(z, 400) });
  const d = { quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 8 };
  const eins = analyse(a, k, d);
  await new Promise((ok) => setTimeout(ok, 200));
  const zwei = analyse(a, k, d);
  const anders = await analyse(a, k, { quelle: { art: 'spur', id: 's1' }, von_beat: 0, bis_beat: 8 });
  assert.deepEqual([anders.code, anders.body.fehler], [409, 'beschaeftigt']);
  const [x, y] = [await eins, await zwei];
  assert.equal(x.code, 200, JSON.stringify(x.body));
  assert.ok(x.body === y.body, 'both get the same answer');
  assert.equal(renderAufrufe(a).length, 1);
  assert.equal(z.n, 1);
});

test('the cache answers the same key without a render, a new rev renders again, eight answers are kept', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const z = { n: 0, dateien: [] };
  const k = klang(a, { analysiere: werkAttrappe(z) });
  const d = (bis) => ({ quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: bis });
  const erste = await analyse(a, k, d(2));
  assert.equal(erste.code, 200, JSON.stringify(erste.body));
  const nach1 = renderAufrufe(a).length;
  const noch = await analyse(a, k, d(2));
  assert.ok(noch.body === erste.body);
  assert.equal(renderAufrufe(a).length, nach1, 'no render for the cached key');
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -3 }], 'Fader');
  const neu = await analyse(a, k, d(2));
  assert.equal(neu.code, 200);
  assert.ok(neu.body !== erste.body && neu.body.rev > erste.body.rev);
  assert.equal(renderAufrufe(a).length, nach1 + 1);
  // eight kept: nine different ranges, the first is evicted
  for (let b = 3; b <= 10; b++) assert.equal((await analyse(a, k, d(b))).code, 200);   // neu (2) plus 3..10 = nine keys
  const n = renderAufrufe(a).length;
  assert.ok((await analyse(a, k, d(10))).body, 'the newest is still cached');
  assert.equal(renderAufrufe(a).length, n);
  await analyse(a, k, d(2));
  assert.equal(renderAufrufe(a).length, n + 1, 'the first key was evicted');
});

test('a muted source is stumm without a render and gives no masking', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', mute: true }], 'Bass mute');
  const gesehen = { q: [], v: [] };
  const hinweise = { quelle: (m) => { gesehen.q.push(m.name); return m.stumm ? [] : [{ art: 'true_peak', text: 'x' }]; }, ueberdeckung: () => { gesehen.u = true; return []; } };
  const z = { n: 0, dateien: [] };
  const k = klang(a, { hinweise, analysiere: werkAttrappe(z) });
  const r = await analyse(a, k, { quelle: { art: 'spur', id: 's1' }, vergleich: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(pruefeAntwort(r.body), []);
  assert.equal(r.body.vergleich.stumm, true);
  assert.deepEqual(Object.values(r.body.vergleich.lautheit), Array(8).fill(null));
  assert.equal(r.body.quelle.stumm, false);
  assert.equal(r.body.ueberdeckung, undefined);
  assert.equal(gesehen.u, undefined, 'no masking hints');
  assert.equal(renderAufrufe(a).length, 1, 'the muted strip is not rendered');
  assert.equal(z.dateien[0].vergleich, null);
});

test('a very quiet source has no loudness below the measuring limit but stays measured', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -70 }], 'quiet');
  const r = await analyse(a, klang(a), { quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const q = r.body.quelle;
  assert.equal(q.stumm, false);
  {
    assert.deepEqual([q.lautheit.lufs_i, q.lautheit.lufs_s_max, q.lautheit.lufs_m_max, q.lautheit.lra], [null, null, null, null]);
    assert.equal(typeof q.lautheit.true_peak_dbtp, 'number');
    assert.equal(typeof q.lautheit.spitze_db, 'number');
  }
  assert.deepEqual(pruefeAntwort(r.body), []);
});

test('a failing ffmpeg is a render_fehler with its reason', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const k = klang(a, { ffmpeg: ['/nonexistent/ffmpeg'] });
  const r = await analyse(a, k, { quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 4 });
  assert.deepEqual([r.code, r.body.fehler], [502, 'render_fehler']);
  assert.match(r.body.text, /loudness measurement failed/);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
});

test('while it runs ausgabe_lauf shows the analysis; afterwards nothing is left', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const vorher = tmpReste();
  const k = klang(a, { analysiere: werkAttrappe({ n: 0, dateien: [] }, 400) });
  const lauf = analyse(a, k, { quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 4 });
  await new Promise((ok) => setTimeout(ok, 250));
  assert.deepEqual(a.s.aktuell().j.ausgabe_lauf, { art: 'analyse' });
  assert.equal((await ruf(() => a.ausgabe.exportiere({}))).body.text, 'an analysis is running');
  assert.equal((await lauf).code, 200);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  assert.deepEqual(tmpReste(), vorher);
  assert.ok(!fs.existsSync(a.protokoll.wiedergaben.at(-1).datei), 'the export playback is deleted');
  assert.equal(a.protokoll.log.at(-1).typ, 'proj_analyse');
});

test('a failing worker answers render_fehler and cleans up', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const vorher = tmpReste();
  const k = klang(a, { analysiere: async () => { throw new Error('boom'); } });
  const r = await analyse(a, k, { quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 4 });
  assert.deepEqual([r.code, r.body.fehler], [502, 'render_fehler']);
  assert.match(r.body.detail, /boom/, 'the worker message is the detail: the English text never carries a foreign message (spec 6.34)');
  assert.match(r.body.text, /^the analysis failed/);
  assert.doesNotMatch(r.body.text, /boom/);
  assert.deepEqual(tmpReste(), vorher);
  assert.ok(!fs.existsSync(a.protokoll.wiedergaben.at(-1).datei));
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
});

test('a failing render answers render_fehler and frees the lock', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const k = klang(a);
  const vorher = tmpReste();
  const f = await mitUmgebung({ RENDER_ATTRAPPE_RC: '4' }, () => ruf(() => k.analysiere({ quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 4 })));
  assert.deepEqual([f.code, f.body.fehler], [502, 'render_fehler']);
  assert.deepEqual(tmpReste(), vorher);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  const ok = await analyse(a, k, { quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 4 });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
});

test('a joined request never gets an older revision: it measures again when the project changed meanwhile', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const z = { n: 0, dateien: [] };
  const k = klang(a, { analysiere: werkAttrappe(z, 500) });
  const d = { quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 4, ohne_freeze: true };
  const eins = analyse(a, k, d);
  await new Promise((ok) => setTimeout(ok, 250));
  const r0 = a.projekt().rev;
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -3 }], 'Fader meanwhile');
  assert.ok(a.projekt().rev > r0);
  const zwei = await analyse(a, k, d);
  const e = await eins;
  assert.equal(e.code, 200, JSON.stringify(e.body));
  assert.equal(zwei.code, 200, JSON.stringify(zwei.body));
  assert.ok(zwei.body.rev > e.body.rev, `the second answer is newer: ${zwei.body.rev} vs ${e.body.rev}`);
  assert.equal(zwei.body.rev, a.projekt().rev);
  assert.equal(z.n, 2, 'measured twice');
});

test('a joined request gets the answer when only the run itself raised the revision (its freeze)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const z = { n: 0, dateien: [] };
  const k = klang(a, { analysiere: werkAttrappe(z, 500) });
  const d = { quelle: { art: 'spur', id: 's2' }, von_beat: 0, bis_beat: 4 };
  const r0 = a.projekt().rev;
  const eins = analyse(a, k, d);
  await new Promise((ok) => setTimeout(ok, 300));
  assert.ok(a.projekt().rev > r0, 'the freeze raised the revision');
  const zwei = await analyse(a, k, d);
  const e = await eins;
  assert.ok(e.body === zwei.body);
  assert.equal(z.n, 1);
});

test('ohne_freeze: nothing is frozen; a taking-part track with unfrozen notes is refused as freeze_noetig', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const k = klang(a);
  // the track that takes part has notes: refused before anything is frozen or rendered
  for (const quelle of [{ art: 'spur', id: 's3' }, { art: 'master' }]) {
    const r = await analyse(a, k, { quelle, ohne_freeze: true });
    assert.deepEqual([r.code, r.body.fehler], [409, 'freeze_noetig'], JSON.stringify(quelle));
    assert.match(r.body.text, /^the track Lead has to be frozen first; freeze it or measure with the tool$/);
  }
  assert.equal(a.freezes().length, 0);
  assert.equal(renderAufrufe(a).length, 0);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  // another track does not take part: measured, still nothing frozen
  const ok = await analyse(a, k, { quelle: { art: 'spur', id: 's2' }, ohne_freeze: true });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(a.freezes().length, 0, 'no freeze was sent');
  // negative control: without the option the same master request freezes the Lead
  const mit = await analyse(a, k, { quelle: { art: 'master' } });
  assert.equal(mit.code, 200, JSON.stringify(mit.body));
  assert.equal(a.freezes().length, 1);
  assert.deepEqual((await analyse(a, k, { quelle: { art: 'master' }, ohne_freeze: 'ja' })).body.fehler, 'argument_ungueltig');
});

test('"vergleich": null counts as no comparison', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await analyse(a, klang(a), { quelle: { art: 'spur', id: 's2' }, vergleich: null, von_beat: 0, bis_beat: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.vergleich, undefined);
});
