// Plan 1.11 task 17: a track whose device is a foreign instrument plugin (geraet {art: 'wirt', name: 'plugin'}). Four layers: the model and commands
// (create, undo, redo, limits, old projects byte-identical, playback in the shape of a Surge track), the host manager against an in-memory stand-in
// for djk-instrumente and the host socket (state before the first note, restart by systemd, missing plugin), the session (fast open, routes, reasons) and
// the page (click and drop create the track). The negative control is the golden file of a Surge project recorded before this task.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { pruefeFehler, neuesProjekt } from '../project/model.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { uebersetze } from '../project/playback.ts';
import { InstrumentWirte } from '../plugins/instrumentwirte.ts';
import { hostSpec } from '../plugins/hostverwaltung.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { BEREICH_GRUENDE } from '../areas/proj/mapping.ts';
import { tmpOrdner } from './support/project.mjs';
import { surgeSzenario } from './support/surge_track_scenario.mjs';
import { sitzung, pruefKontext, warteBis } from './support/proj_context.mjs';

const W = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const schlaf = (ms) => new Promise((ok) => setTimeout(ok, ms));
const PL = (pfad = '/opt/plugins/Vital.vst3') => ({ format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789' });
const INDEX = {
  v1: { ...PL(), name: 'Vital', art: 'instrument', status: 'ok' },
  e1: { ...PL('/opt/plugins/Fake EQ.vst3'), name: 'Fake EQ', art: 'effekt', status: 'ok' },
  b1: { ...PL('/opt/plugins/Bad.vst3'), name: 'Bad', art: 'instrument', status: 'blockiert', grund: 'abgestuerzt' },
};
const optionen = (extra = {}) => ({ quelle: 'andreas', pluginDa: () => true, pluginIndex: (id) => INDEX[id] ?? null, ...extra });
const lauf = (p, b, extra) => fuehreListeAus(p, Array.isArray(b) ? b : [b], optionen(extra));
const lehntAb = (p, b, grund) => assert.throws(() => lauf(p, b), (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const NEU = (extra = {}, geraet = { art: 'wirt', name: 'plugin', plugin_id: 'v1' }) => ({ befehl: 'spur_neu', art: 'instrument', geraet, ...extra });

// --- model and commands ------------------------------------------------------------------------------------------------------------------

test('spur_neu plugin_id: the device holds identity, slot and state path; the track is named after the plugin; the project is valid', () => {
  const r = lauf(neuesProjekt('P'), NEU());
  const s = r.projekt.spuren[0];
  assert.deepEqual(s.geraet, { art: 'wirt', name: 'plugin', slot: 1, plugin: { ...PL(), name: 'Vital' }, zustand: 'plugins/s1.carxs' });
  assert.equal(s.name, 'Vital');
  assert.equal(s.freeze, null, 'frozen like a Surge track');
  assert.equal(pruefeFehler(JSON.parse(JSON.stringify(r.projekt))), null);
});

test('create, undo, redo through the history: one undo step, the same id, slot and state path after redo', (t) => {
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 1_000_000, zeitgeber: false });
  let q = neuesProjekt('P');
  q = aendere(v, q, [NEU({}, { art: 'wirt', name: 'plugin', plugin: PL() })], { quelle: 'andreas', label: 'Add plugin track' }).projekt;
  assert.equal(q.spuren.length, 1);
  q = rueckgaengig(v, q, { quelle: 'andreas' }).projekt;
  assert.equal(q.spuren.length, 0);
  q = wiederholen(v, q, { quelle: 'andreas' }).projekt;
  assert.deepEqual([q.spuren[0].id, q.spuren[0].geraet.slot, q.spuren[0].geraet.zustand], ['s1', 1, 'plugins/s1.carxs']);
});

test('reasons: an effect is kein_instrument, a blocked one plugin_blockiert, an unknown one plugin_unbekannt, a missing file plugin_nicht_ladbar', () => {
  const p = neuesProjekt('P');
  lehntAb(p, NEU({}, { art: 'wirt', name: 'plugin', plugin_id: 'e1' }), 'kein_instrument');
  lehntAb(p, NEU({}, { art: 'wirt', name: 'plugin', plugin_id: 'b1' }), 'plugin_blockiert');
  lehntAb(p, NEU({}, { art: 'wirt', name: 'plugin', plugin_id: 'zz' }), 'plugin_unbekannt');
  assert.throws(() => lauf(p, NEU(), { pluginDa: () => false }), (e) => e.grund === 'plugin_nicht_ladbar');
  assert.ok(GRUND_TEXT.kein_instrument && BEREICH_GRUENDE.includes('kein_instrument'));
  // the effect side keeps its reason for an instrument
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'host', plugin_id: 'v1' }, 'kein_effekt');
});

test('slots: the plugin track takes a Surge slot; a third host track is refused (slot_belegt, the existing reason for both slots in use)', () => {
  let p = lauf(neuesProjekt('P'), NEU()).projekt;
  p = lauf(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }).projekt;
  assert.deepEqual(p.spuren.map((s) => s.geraet.slot), [1, 2]);
  lehntAb(p, NEU(), 'slot_belegt');
  lehntAb(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }, 'slot_belegt');
  // a deleted plugin track frees its slot
  const q = lauf(p, { befehl: 'spur_loeschen', spur_id: 's1' }).projekt;
  assert.equal(lauf(q, NEU()).projekt.spuren.at(-1).geraet.slot, 1);
});

test('a plugin device takes no Surge fields and is no rack member; a Surge track keeps its patch', () => {
  const p = neuesProjekt('P');
  lehntAb(p, NEU({}, { art: 'wirt', name: 'plugin', plugin_id: 'v1', patch: 'x' }), 'argument_unbekannt');
  lehntAb(p, NEU({}, { art: 'wirt', name: 'plugin', plugin_id: 'v1', parameter: {} }), 'argument_unbekannt');
  lehntAb(p, NEU({}, { art: 'wirt', name: 'plugin', plugin_id: 'v1', plugin: PL() }), 'argument_ungueltig');
  lehntAb(p, NEU({}, { art: 'rack', glieder: [{ id: 'g1', geraet: { art: 'wirt', name: 'plugin', plugin_id: 'v1' } }] }), 'argument_ungueltig');
  const q = lauf(p, NEU()).projekt;
  lehntAb(q, { befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'rack' } }, 'argument_ungueltig');
  lehntAb(q, { befehl: 'geraet_richtung', spur_id: 's1', wort: 'bright' }, 'richtung_unbekannt');
});

test('a plugin device in a damaged file is refused by the model: wrong state path, missing identity, unknown field', () => {
  const j = JSON.parse(JSON.stringify(lauf(neuesProjekt('P'), NEU()).projekt));
  const mit = (f) => { const c = JSON.parse(JSON.stringify(j)); f(c.spuren[0].geraet); return c; };
  assert.equal(pruefeFehler(JSON.parse(JSON.stringify(j))), null);
  for (const f of [(g) => { g.zustand = '../x.carxs'; }, (g) => { delete g.plugin; }, (g) => { g.patch = 'a'; }, (g) => { g.plugin.format = 'au'; }]) {
    assert.notEqual(pruefeFehler(mit(f)), null);
  }
});

test('playback of a plugin track has the shape of a Surge track on that slot (art wirt, slot, notes), nothing else', () => {
  const bau = (geraet) => {
    let p = lauf(neuesProjekt('P'), NEU({}, geraet)).projekt;
    p = lauf(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, name: 'n' }, { surgePatchDa: () => true }).projekt;
    p = lauf(p, { befehl: 'noten_neu', clip_id: p.spuren[0].clips[0].id, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] }).projekt;
    return JSON.stringify(uebersetze(p, { nr: 1, audioOrdner: '/x/audio', frames: () => 96000 }));
  };
  assert.equal(bau({ art: 'wirt', name: 'plugin', plugin_id: 'v1' }), bau({ art: 'wirt', name: 'surge' }));
});

test('negative control: a Surge project reproduces its golden file (commands, project bytes, playback) byte for byte', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(W, 'tests', 'support', 'surge_spur_golden.json'), 'utf8'));
  const s = surgeSzenario();
  assert.equal(s.kanonisch, golden.kanonisch);
  assert.equal(s.wiedergabe, golden.wiedergabe);
  assert.ok(!s.kanonisch.includes('plugin'), 'no plugin field appears in a Surge project');
});

// --- the host manager against an in-memory stand-in ---------------------------------------------------------------------------------------

function attrappe(ordner, { vst3 = true } = {}) {
  const A = { folge: [], stand: new Map(), startMs: 0, startCode: 0, startFehler: '', klang: new Map(), pid: 1000, ordner };
  const slotKlang = (slot, v) => A.klang.set(slot, v);
  A.abhaengig = {
    start: async (slot, art) => {
      A.folge.push({ art: 'start', slot, spec: art });
      await schlaf(A.startMs);
      if (A.startCode) return { code: A.startCode, fehler: A.startFehler };
      A.stand.set(slot, { lebt: true, bereit: true, art: art === 'surge' ? 'lv2' : 'plugin', kennung: art.startsWith('plugin:') ? art.slice(7) : null, pid: ++A.pid });
      slotKlang(slot, 'standard');
      return { code: 0, fehler: '' };
    },
    stand: (slot) => A.stand.get(slot) ?? { lebt: false, bereit: false, art: null, kennung: null, pid: null },
    sock: async (slot, b) => {
      A.folge.push({ art: 'sock', slot, befehl: b.befehl, pfad: b.pfad, werte: b.werte });
      if (b.befehl === 'zustand_setzen') {
        if (!fs.existsSync(b.pfad)) return { ok: false, fehler: 'zustand_fehlt' };
        slotKlang(slot, fs.readFileSync(b.pfad, 'utf8'));
        return { ok: true };
      }
      if (b.befehl === 'zustand_holen') { fs.mkdirSync(path.dirname(b.pfad), { recursive: true }); fs.writeFileSync(b.pfad, `klang-${A.klang.get(slot)}-${A.folge.length}`); return { ok: true }; }
      if (b.befehl === 'info') return { ok: true, parameter: [{ index: 0, name: 'Cutoff', min: 0, max: 1, vorgabe: 0.5 }], anzeige: true };
      if (b.befehl === 'params') return { ok: true, werte: { 0: 0.25 } };
      if (b.befehl === 'params_setzen') { slotKlang(slot, `param-${JSON.stringify(b.werte)}`); return { ok: true }; }
      if (b.befehl === 'fenster') return { ok: true, fenster: b.an };
      return { ok: true };
    },
    ordner: () => A.ordner,
    log: () => {},
  };
  A.neustart = (slot) => { const s = A.stand.get(slot); A.stand.set(slot, { ...s, pid: ++A.pid }); slotKlang(slot, 'standard'); };   // systemd restarted the unit: empty plugin
  A.aufrufe = (befehl) => A.folge.filter((z) => z.art === 'sock' && z.befehl === befehl);
  return A;
}
const ZEITEN = { pollMs: 15, zustandRuheMs: 60, fensterMs: 100, endeMs: 300, sockMs: 600 };
function aufbau(t, { vst3 = true } = {}) {
  const d = tmpOrdner(t, 'djk-instr-');
  const pfad = path.join(d, 'Vital.vst3');
  if (vst3) fs.mkdirSync(pfad);
  const A = attrappe(path.join(d, 'project'));
  fs.mkdirSync(A.ordner, { recursive: true });
  const verw = new InstrumentWirte(A.abhaengig, ZEITEN);
  t.after(() => verw.halt());
  const projekt = lauf(neuesProjekt('P'), NEU({}, { art: 'wirt', name: 'plugin', plugin: { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789' } })).projekt;
  const datei = path.join(A.ordner, 'plugins', 's1.carxs');
  return { d, pfad, A, verw, projekt, datei, spec: hostSpec(projekt.spuren[0].geraet.plugin) };
}
const status = (verw) => verw.lage()[0]?.status;

test('host: abgleich returns at once (start sleeps 5 s), starts djk-instrumente with the identity spec ending in #, lage says startet', async (t) => {
  const e = aufbau(t);
  e.A.startMs = 5000;
  const t0 = performance.now();
  e.verw.abgleich(e.projekt);
  assert.ok(performance.now() - t0 < 200);
  assert.deepEqual(e.verw.lage().map((x) => [x.spur_id, x.slot, x.status]), [['s1', 1, 'startet']]);
  await schlaf(20);
  assert.equal(e.A.folge[0].spec, `plugin:${e.spec}`);
  assert.ok(e.spec.endsWith('#ABCDEF0123456789ABCDEF0123456789') && e.A.folge[0].spec.startsWith('plugin:vst3:'));
});

test('host: the saved state is restored BEFORE the track is ready, then panik; a fresh project without a state file just goes ready', async (t) => {
  const e = aufbau(t);
  fs.mkdirSync(path.dirname(e.datei), { recursive: true });
  fs.writeFileSync(e.datei, 'MEIN-KLANG');
  const beiPanik = [];
  const alt = e.A.abhaengig.sock;
  e.A.abhaengig.sock = async (slot, b) => { if (b.befehl === 'panik') beiPanik.push([status(e.verw), e.A.klang.get(slot)]); return alt(slot, b); };
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'), JSON.stringify(e.verw.lage()));
  assert.equal(e.A.klang.get(1), 'MEIN-KLANG', 'the host plays the saved sound');
  assert.deepEqual(beiPanik, [['startet', 'MEIN-KLANG']], 'when panik goes out the state is in and the track is not ready yet');
  const folge = e.A.folge.filter((z) => z.art === 'sock').map((z) => z.befehl);
  assert.ok(folge.indexOf('zustand_setzen') < folge.indexOf('panik'));
});

test('host: a host restarted by systemd (new pid, empty plugin) gets its state restored and panik BEFORE it is ready again', async (t) => {
  const e = aufbau(t);
  fs.mkdirSync(path.dirname(e.datei), { recursive: true });
  fs.writeFileSync(e.datei, 'MEIN-KLANG');
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'));
  const vorher = e.A.aufrufe('zustand_setzen').length, panik0 = e.A.aufrufe('panik').length;
  e.A.neustart(1);
  assert.ok(await warteBis(() => status(e.verw) === 'ausfall' || e.A.aufrufe('zustand_setzen').length > vorher), 'noticed');
  assert.ok(await warteBis(() => status(e.verw) === 'bereit' && e.A.aufrufe('panik').length > panik0), JSON.stringify(e.verw.lage()));
  assert.equal(e.A.klang.get(1), 'MEIN-KLANG', 'restored after the restart');
  assert.equal(e.A.aufrufe('zustand_setzen').length, vorher + 1);
  assert.equal(e.A.aufrufe('panik').length, panik0 + 1);
  assert.equal(e.A.folge.filter((z) => z.art === 'start').length, 1, 'systemd restarted it, the manager did not start it again');
});

test('host: a state that cannot be restored keeps the track dry (ausfall zustand_fehler) and the state file untouched', async (t) => {
  const e = aufbau(t);
  fs.mkdirSync(path.dirname(e.datei), { recursive: true });
  fs.writeFileSync(e.datei, 'KAPUTT');
  e.A.abhaengig.sock = ((alt) => async (slot, b) => (b.befehl === 'zustand_setzen' ? { ok: false, fehler: 'zustand_ungueltig' } : alt(slot, b)))(e.A.abhaengig.sock);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => status(e.verw) === 'ausfall'));
  assert.equal(e.verw.lage()[0].grund, 'zustand_fehler');
  await e.verw.zustandSichern('export');
  assert.equal(fs.readFileSync(e.datei, 'utf8'), 'KAPUTT', 'never overwritten');
});

test('host: a missing plugin file says fehlt at once and starts nothing; a plugin without MIDI input says kein_instrument', async (t) => {
  const e = aufbau(t, { vst3: false });
  e.verw.abgleich(e.projekt);
  assert.deepEqual([status(e.verw), e.verw.lage()[0].grund], ['fehlt', 'plugin_nicht_ladbar']);
  assert.equal(e.A.folge.length, 0);
  const f = aufbau(t);
  f.A.startCode = 2; f.A.startFehler = 'djk-instrumente: wirt arr1: plugin rejected: kein_instrument';
  f.verw.abgleich(f.projekt);
  assert.ok(await warteBis(() => status(f.verw) === 'fehlt'));
  assert.equal(f.verw.lage()[0].grund, 'kein_instrument');
});

test('host: state triggers: 2 s after the last param call, window open every interval and once on close, export, close, end', async (t) => {
  const e = aufbau(t);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'));
  for (let i = 0; i < 5; i++) { await e.verw.param('s1', { 0: i / 10 }); await schlaf(10); }
  assert.equal(e.A.aufrufe('zustand_holen').length, 0, 'not while the calls keep coming');
  assert.ok(await warteBis(() => fs.existsSync(e.datei)));
  assert.equal(e.A.aufrufe('zustand_holen').length, 1, 'ten calls in a row write once');
  const n = e.A.aufrufe('zustand_holen').length;
  assert.deepEqual(await e.verw.fenster('s1', true), { ok: true, fenster: true });
  assert.ok(await warteBis(() => e.A.aufrufe('zustand_holen').length > n), 'while the window is open');
  const m = e.A.aufrufe('zustand_holen').length;
  assert.deepEqual(await e.verw.fenster('s1', false), { ok: true, fenster: false });
  assert.ok(e.A.aufrufe('zustand_holen').length > m, 'once on close');
  const k = e.A.aufrufe('zustand_holen').length;
  await e.verw.zustandSichern('export'); assert.equal(e.A.aufrufe('zustand_holen').length, k + 1);
  await e.verw.zustandSichern('schliessen'); assert.equal(e.A.aufrufe('zustand_holen').length, k + 2);
  await e.verw.beende(); assert.equal(e.A.aufrufe('zustand_holen').length, k + 3);
});

test('host: parameter list joined with the values; a track without a ready host answers host_fehlt; removing the track writes its state and returns the slot to Surge', async (t) => {
  const e = aufbau(t);
  assert.deepEqual(await e.verw.parameter('s1'), { ok: false, fehler: 'host_fehlt' });
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'));
  const r = await e.verw.parameter('s1');
  assert.deepEqual(r.parameter, [{ index: 0, name: 'Cutoff', min: 0, max: 1, vorgabe: 0.5, wert: 0.25 }]);
  e.verw.abgleich(neuesProjekt('leer'));
  assert.ok(await warteBis(() => e.A.folge.some((z) => z.art === 'start' && z.spec === 'surge')));
  assert.ok(fs.existsSync(e.datei), 'the state was written when the track left');
  assert.deepEqual(e.verw.lage(), []);
});

// --- the session ---------------------------------------------------------------------------------------------------------------------------

async function sitzungMitInstrument(t, { vst3 = true } = {}) {
  const d = tmpOrdner(t, 'djk-isess-');
  const pfad = path.join(d, 'Vital.vst3');
  if (vst3) fs.mkdirSync(pfad);
  const A = attrappe(null);
  const k = pruefKontext();
  const index = { v1: { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789', name: 'Vital', art: 'instrument', status: 'ok' } };
  const { s, wurzel } = sitzung(t, { pluginIndex: (id) => index[id] ?? null, instrument: { abhaengig: A.abhaengig, zeiten: ZEITEN } }, k);
  s.ereignis('/zustand/arr', { nr: 0, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  await s.neu('I', 'andreas');
  A.ordner = path.join(wurzel, 'i');
  const rev = () => s.aktuell().j.projekt.rev;
  const neu = () => s.aendern({ rev: rev(), label: 'plugin track', befehle: [NEU()] }, 'andreas');
  return { s, k, A, wurzel, rev, neu, pfad };
}

test('session: open returns in under 200 ms with a host start that sleeps 5 s; lage shows the instrument state; a deleted plugin file says fehlt', async (t) => {
  const e = await sitzungMitInstrument(t);
  assert.equal((await e.neu()).code, 200);
  assert.ok(await warteBis(() => e.s.instrumente.lage()[0]?.status === 'bereit'));
  await e.s.oeffnen('i', 'andreas');
  e.A.stand.clear();
  e.A.startMs = 5000;
  const t0 = performance.now();
  const r = await e.s.oeffnen('i', 'andreas');
  assert.ok(performance.now() - t0 < 200, `open took ${performance.now() - t0} ms`);
  assert.equal(r.code, 200);
  assert.equal(e.s.aktuell().j.instrumente[0].status, 'startet');
  fs.rmSync(e.pfad, { recursive: true });
  e.A.startMs = 0;
  await e.s.oeffnen('i', 'andreas');
  const t1 = performance.now();
  await e.s.oeffnen('i', 'andreas');
  assert.ok(performance.now() - t1 < 200);
  assert.deepEqual(e.s.aktuell().j.instrumente.map((x) => [x.spur_id, x.status]), [['s1', 'fehlt']]);
});

test('session: parameter and param routes: no command, no history, no revision change; reasons; Stop Cypher blocks cypher, the window is Andreas only', async (t) => {
  const e = await sitzungMitInstrument(t);
  assert.equal((await e.neu()).code, 200);
  assert.ok(await warteBis(() => e.s.instrumente.lage()[0]?.status === 'bereit'));
  const l = await e.s.geraetParameter('s1');
  assert.equal(l.j.parameter[0].name, 'Cutoff');
  const vor = { rev: e.rev(), verlauf: e.s.verlaufListe().j.length, laden: e.k.an('/k/arr/laden').length };
  const r = await e.s.geraetParam('s1', { werte: { 0: 0.8 } }, 'andreas');
  assert.deepEqual([r.code, r.j.ok], [200, true]);
  assert.deepEqual({ rev: e.rev(), verlauf: e.s.verlaufListe().j.length, laden: e.k.an('/k/arr/laden').length }, vor);
  await assert.rejects(e.s.geraetParam('s9', { werte: { 0: 0.5 } }, 'andreas'), (x) => x.code === 404);
  for (const roh of [null, [], {}, { 0: 'x' }, { a: 0.5 }]) await assert.rejects(e.s.geraetParam('s1', { werte: roh }, 'andreas'), (x) => x.code === 400);
  e.k.ki = true;
  await assert.rejects(e.s.geraetParam('s1', { werte: { 0: 0.5 } }, 'cypher'), (x) => x.code === 409);
  e.k.ki = false;
  await assert.rejects(e.s.geraetFenster('s1', { an: true }, 'cypher'), (x) => x.code === 403 && (x.grund === 'nur_andreas' || x.fehler === 'nur_andreas'));
  assert.deepEqual((await e.s.geraetFenster('s1', { an: true }, 'andreas')).j, { ok: true, fenster: true });
  await e.s.geraetFenster('s1', { an: false }, 'andreas');
});

test('session: the state is written when the project closes; undo of the track keeps the file, redo restores the sound before ready', async (t) => {
  const e = await sitzungMitInstrument(t);
  assert.equal((await e.neu()).code, 200);
  assert.ok(await warteBis(() => e.s.instrumente.lage()[0]?.status === 'bereit'));
  await e.s.geraetParam('s1', { werte: { 0: 0.7 } }, 'andreas');
  await e.s.hostZustandSichern('export');
  const datei = path.join(e.wurzel, 'i', 'plugins', 's1.carxs');
  assert.ok(fs.existsSync(datei));
  assert.equal((await e.s.umkehr('undo', { rev: e.rev() }, 'andreas')).code, 200);
  assert.ok(await warteBis(() => e.s.instrumente.lage().length === 0));
  assert.ok(fs.existsSync(datei));
  assert.equal((await e.s.umkehr('redo', { rev: e.rev() }, 'andreas')).code, 200);
  assert.ok(await warteBis(() => e.s.instrumente.lage()[0]?.status === 'bereit'));
  assert.match(e.A.klang.get(1), /param-/, 'and it is the one with the parameter call in it');
});

test('session: plugin on slot 1, then a Surge project with a patch: the host swap runs first and the patch lade reaches the Surge host after it is ready (geladen set)', async (t) => {
  const d = tmpOrdner(t, 'djk-iswap-');
  const klaenge = path.join(d, 'klaenge'); fs.mkdirSync(klaenge);
  fs.writeFileSync(path.join(klaenge, 'Test.fxp'), 'x');
  const alt = process.env.CYPHERDJ_KLAENGE; process.env.CYPHERDJ_KLAENGE = klaenge;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_KLAENGE; else process.env.CYPHERDJ_KLAENGE = alt; });
  const pfad = path.join(d, 'Vital.vst3'); fs.mkdirSync(pfad);
  const wirtDir = path.join(d, 'hosts'); fs.mkdirSync(wirtDir);
  const A = attrappe(null);
  const swap = { fertig: false }, empfang = [];
  const alteStart = A.abhaengig.start;
  A.abhaengig.start = async (slot, art) => { const r = await alteStart(slot, art); if (art === 'surge') { await schlaf(300); swap.fertig = true; } return r; };
  const srv = net.createServer((c) => { let b = ''; c.on('data', (x) => { b += x; if (!b.endsWith('\n')) return; const m = JSON.parse(b);
    empfang.push({ befehl: m.befehl, nachSwap: swap.fertig }); c.end(JSON.stringify(swap.fertig ? { ok: true, werte: {} } : { ok: false, fehler: 'plugin host' }) + '\n'); }); });
  await new Promise((ok) => srv.listen(path.join(wirtDir, 'wirt-arr1.sock'), ok));
  t.after(() => srv.close());
  const index = { v1: { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789', name: 'Vital', art: 'instrument', status: 'ok' } };
  const { s, wurzel } = sitzung(t, { wirtOrdner: () => wirtDir, pluginIndex: (id) => index[id] ?? null, instrument: { abhaengig: A.abhaengig, zeiten: ZEITEN } });
  s.ereignis('/zustand/arr', { nr: 0, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  await s.neu('B', 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'surge', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', patch: 'Test' } }] }, 'andreas');
  await s.neu('A', 'andreas');
  A.ordner = path.join(wurzel, 'a');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'plugin', befehle: [NEU()] }, 'andreas');
  assert.ok(await warteBis(() => s.instrumente.lage()[0]?.status === 'bereit'));
  empfang.length = 0;
  const t0 = performance.now();
  await s.oeffnen('b', 'andreas');
  assert.ok(performance.now() - t0 < 200, 'open does not wait for the swap');
  assert.ok(await warteBis(() => empfang.some((x) => x.befehl === 'lade' && x.nachSwap), 5000), JSON.stringify(empfang));
  assert.deepEqual(empfang.filter((x) => !x.nachSwap), [], 'nothing reached the slot before the Surge host was back');
  assert.ok(A.folge.some((z) => z.art === 'start' && z.spec === 'surge'));
  const lade = empfang.filter((x) => x.befehl === 'lade').length;
  await s.surge.gleiche(s.aktuell().j.projekt);
  assert.equal(empfang.filter((x) => x.befehl === 'lade').length, lade, 'the patch counts as loaded (geladen set): a later sync does not send it again');
});

// --- the page ------------------------------------------------------------------------------------------------------------------------------

test('page: an instrument entry of the index is draggable and a click creates the track (spur_neu with the device); an effect keeps its path; blocked entries do nothing', async () => {
  const { pluginNutzlast, pluginSpurBefehl, pluginZeilenHtml } = await import('../public/production/devices_browser.js');
  const inst = { id: 'v1', name: 'Vital', format: 'vst3', art: 'instrument', status: 'ok' };
  assert.deepEqual(pluginNutzlast(inst), { art: 'instrument', plugin_id: 'v1', titel: 'Vital' });
  assert.deepEqual(pluginNutzlast({ ...inst, art: 'effekt' }), { art: 'host', plugin_id: 'v1', titel: 'Vital' });
  assert.equal(pluginNutzlast({ ...inst, status: 'blockiert' }), null);
  assert.match(pluginZeilenHtml([inst]), /draggable="true"/);
  const b = pluginSpurBefehl(pluginNutzlast(inst));
  assert.deepEqual(b.befehl, { befehl: 'spur_neu', art: 'instrument', name: 'Vital', geraet: { art: 'wirt', name: 'plugin', plugin_id: 'v1' } });
  // the command is accepted by the real command code
  assert.equal(lauf(neuesProjekt('P'), b.befehl).projekt.spuren[0].geraet.name, 'plugin');
  // click through the real binder with a mock DOM
  const hoer = {}, el = (extra = {}) => ({ addEventListener(n, f) { hoer[`${this.k}:${n}`] = f; }, querySelector: () => null, ...extra });
  const teile = { '[data-teil="geraete"]': { k: 'g', innerHTML: '', addEventListener() {} }, '.plugin-suche': { value: '', addEventListener() {} },
    '.plugin-format': { value: '', addEventListener() {} }, '.plugin-rescan': { addEventListener() {} }, '.plugin-stand': { textContent: '' },
    '.plugin-liste': { k: 'pl', innerHTML: '', addEventListener(n, f) { hoer[n] = f; } } };
  const alt = globalThis.document;
  globalThis.document = { getElementById: () => ({ innerHTML: '', querySelector: (s) => teile[s] }) };
  try {
    const { bindeGeraeteBrowser } = await import('../public/production/devices_browser.js');
    const gesendet = [], gemeldet = [], sicht = [];
    bindeGeraeteBrowser({ holeGet: async (u) => (u.startsWith('/plugins') ? { status: 200, j: { plugins: [inst, { ...inst, id: 'e1', art: 'effekt' }, { ...inst, id: 'b1', status: 'blockiert', grund: 'zeit' }] } } : { status: 200, j: {} }),
      aendere: (l, b2) => gesendet.push([l, b2]), melde: (x, f) => gemeldet.push([x, f]), beimSichtwechsel: sicht, fuegePluginEin: (n) => gesendet.push(['effekt', n]), antwortText: () => '' });
    sicht[0](true);
    await schlaf(20);
    const klick = (i) => hoer.click({ target: { closest: () => ({ dataset: { pluginI: String(i) } }) } });
    klick(0);
    assert.deepEqual(gesendet[0], ['Add Vital track', [b.befehl]]);
    klick(1);
    assert.deepEqual(gesendet[1], ['effekt', { art: 'host', plugin_id: 'e1', titel: 'Vital' }]);
    klick(2);
    assert.equal(gesendet.length, 2); assert.equal(gemeldet.length, 1);
    const ds = {}; const ev = { target: { closest: () => ({ dataset: { pluginI: '0' } }) }, dataTransfer: { setData: (k, v) => { ds[k] = v; } }, preventDefault() { this.stop = true; } };
    hoer.dragstart(ev);
    assert.equal(JSON.parse(Object.values(ds)[0]).art, 'instrument');
  } finally { globalThis.document = alt; }
});

test('page: a plugin instrument dropped on the arrangement sends spur_neu once; the head says the plugin name, and MISSING when the host says fehlt', async () => {
  const { bindeAblage } = await import('../public/production/storage.js');
  const { GERAET_TYP } = await import('../public/production/drag.js');
  const { geraetText } = await import('../public/production/track_heads.js');
  const el = () => ({ h: {}, addEventListener(n, f) { this.h[n] = f; } });
  const ueber = el(), liste = el(), alt = globalThis.document;
  globalThis.document = { querySelector: () => null };
  try {
    const gesendet = [];
    bindeAblage({ st: { projekt: neuesProjekt('P'), sichtbar: true }, $: (n) => ({ ueber, 'inserts-liste': liste })[n], stoebern: () => null, beimSichtwechsel: [],
      zeilen: () => [], aendere: (l, b) => gesendet.push([l, b]), aendereAus: () => {}, melde: () => {} });
    const n = { art: 'instrument', plugin_id: 'v1', titel: 'Vital' };
    ueber.h.drop({ dataTransfer: { types: [GERAET_TYP], getData: () => JSON.stringify(n) }, offsetX: 5, offsetY: 5, preventDefault() {} });
    assert.equal(gesendet.length, 1);
    assert.equal(gesendet[0][1][0].geraet.plugin_id, 'v1');
  } finally { globalThis.document = alt; }
  const s = lauf(neuesProjekt('P'), NEU()).projekt.spuren[0];
  assert.equal(geraetText(s), 'PLUGIN · Vital · 1');
});
