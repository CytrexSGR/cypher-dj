// Front panels task 8: the device view on instrument tracks (bk, RB-338). The adapter sends ONE spur_aendern at the end of a gesture (RB-338, Surge, bk knobs k33..k64);
// a track that no longer carries the device gets nothing; rb338 values are normalised; LEARN is not offered; presets go through the production apply path. Fake DOM, no browser.
// Production plan task 10: knobs k1..k32 of a Baukasten track send geraet_param_setzen while they are dragged (the last block of this file).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spurAdapter, bindeGeraetAnsicht, geraetSchluessel, kannGeraetAnsicht, reglerBereiche, surgeIstEinlesen } from '../public/production/device_view.js';
import { baueFrontplatte } from '../public/panel.js';
import { presetsFuer, spurBeschreibung } from '../public/panel_kopf.js';
import { anzeigeWert, anzeigeText, parameterNachName } from '../public/panel_display.js';
import { wertText } from '../public/panel.js';
import { baueInsertAdapter } from '../public/production/inserts.js';
import { parameterTabelle, anzeigeWert as serverAnzeige } from '../devices_parameter.ts';

class K {
  constructor(tag) {
    this.tag = tag; this.kinder = []; this.attr = {}; this.ev = {}; this.dataset = {}; this.textContent = ''; this.tabIndex = -1;
    this.style = { vars: {}, setProperty: (k, v) => { this.style.vars[k] = v; } };
    const klassen = new Set();
    this.classList = { add: (c) => klassen.add(c), remove: (c) => klassen.delete(c), toggle: (c, an) => (an ?? !klassen.has(c) ? klassen.add(c) : klassen.delete(c)), contains: (c) => klassen.has(c) };
    this.klassen = klassen;
  }
  setAttribute(k, v) { this.attr[k] = String(v); if (k === 'class') for (const c of String(v).split(' ')) this.classList.add(c); }
  append(...k) { for (const x of k) if (x && typeof x === 'object') x.eltern = this; this.kinder.push(...k); }
  replaceChildren(...k) { this.kinder = []; this.append(...k); }
  addEventListener(t, f) { (this.ev[t] ??= []).push(f); }
  setPointerCapture() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100 }; }
  feuere(t, e = {}) { const ev = { preventDefault() {}, pointerId: 1, button: 0, shiftKey: false, target: this, ...e }; for (const f of this.ev[t] ?? []) f(ev); if (this.eltern) this.eltern.feuereWeiter(t, ev); return ev; }
  feuereWeiter(t, ev) { for (const f of this.ev[t] ?? []) f(ev); if (this.eltern) this.eltern.feuereWeiter(t, ev); }
  finde(klasse, aus = []) { if (this.klassen.has(klasse)) aus.push(this); for (const k of this.kinder) k.finde(klasse, aus); return aus; }
  alles(aus = []) { aus.push(this); for (const k of this.kinder) k.alles(aus); return aus; }
}
const DOK = { createElement: (t) => new K(t), createElementNS: (_n, t) => new K(t) };

const knob = (id, param) => ({ id, type: 'knob', label: id, bind: { param } });
const panelV2 = (art, controls) => ({ format: 'cypherdj-panel/2', geraet: art === 'bk' ? { art: 'bk', graph: 'synth-mono' } : { art }, title: 'T', sections: [{ id: 's', title: 'S', cols: 3, controls }] });
const BK_PANEL = panelV2('bk', [knob('c5', 'k5'), knob('c6', 'k6')]);
const BK_TABELLE = [{ name: 'k5', min: 20, max: 2000, log: true, vorgabe: 0.5 }, { name: 'k6', min: 0, max: 1, log: false, vorgabe: 0.5 }];
const BK_PANEL_HOCH = panelV2('bk', [knob('c65', 'k65'), knob('c66', 'k66')]);   // beyond the live range k1..k64 (no real knob: the page keeps the release path for any name above BK_LIVE_MAX)
const BK_TABELLE_HOCH = [{ name: 'k65', min: 20, max: 2000, log: true, vorgabe: 0.5 }, { name: 'k66', min: 0, max: 1, log: false, vorgabe: 0.5 }];
const RB_PANEL = panelV2('rb338', [knob('cut', 'cutoff'), knob('res', 'resonance')]);
const RB_TABELLE = [{ name: 'cutoff', min: 0, max: 1, log: false, vorgabe: 0.3 }, { name: 'resonance', min: 0, max: 1, log: false, vorgabe: 0.1 }];
const BK = (parameter = {}) => ({ art: 'intern', name: 'bk', graph: 'synth-mono', parameter });
const RB = (parameter = {}) => ({ art: 'intern', name: 'rb338', parameter });
const SURGE = { art: 'wirt', name: 'surge', slot: 1 };
const PLUGIN = { art: 'wirt', name: 'plugin', slot: 1, plugin: { name: 'X' } };   // a foreign plug-in host: no view
const spurMit = (geraet) => ({ id: 's1', nr: 1, name: 'Lead', art: 'instrument', geraet, clips: [] });

function aufbau(geraet, { panel = BK_PANEL, tabelle = BK_TABELLE, presets = [], vokabular = null, antwortVonZiel = null, manuell = false, ablehnen = false, panelAntwort = null } = {}) {
  const register = { eintraege: presets };
  const spur = spurMit(geraet);
  const gesendet = [], gefragt = [], gemeldet = [], kopfOpts = [], warteschlange = [];
  // the writer queue: a job computes its command when it is its turn (from the project as it is then) and takes the answer into the project
  const lauf = async () => {
    const j = warteschlange.shift();
    const x = j.rechne(ctx.st.projekt);
    if (x && !ablehnen) {
      gesendet.push({ label: x.label, befehle: x.befehle });
      const b = x.befehle[0];
      if (b.befehl === 'geraet_param_setzen') spur.geraet = { ...spur.geraet, parameter: { ...spur.geraet.parameter, [b.param]: b.wert } };   // the project takes the knob value
      else spur.geraet = b.geraet;
    } else if (ablehnen) ctx.melde('refused', true);   // the writer reports a refusal itself (beiFehler of the writer queue)
    j.ok(!!x && !ablehnen);
  };
  const ctx = {
    st: { projekt: { spuren: [spur] } },
    aendereAus: (rechne) => new Promise((ok) => { warteschlange.push({ rechne, ok }); if (!manuell) lauf(); }),
    aendere: async (label, befehle) => { gesendet.push({ label, befehle }); return true; },
    holeGet: async (weg) => {
      gefragt.push(weg);
      if (weg === '/presets/register') return { status: 200, j: { register } };
      if (weg === '/presets/vokabular') return { status: 200, j: { inhalt: vokabular } };
      if (panelAntwort) { const x = panelAntwort(); if (x) return x; }
      return { status: 200, j: { geraet: {}, parameter: tabelle, panel, quelle: 'datei', fehler: [] } }; },
    holeJson: async (weg, body) => {
      gefragt.push([weg, body]);
      if (weg === '/presets/von_ziel') return antwortVonZiel ? antwortVonZiel(body, register) : { status: 201, j: { herkunft: 'nutzer' } };
      return { status: 200, j: { weg: 'proj', label: 'Apply preset', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', geraet: RB({ cutoff: 0.9 }) }] } }; },
    melde: (t, f) => gemeldet.push([t, f]),
  };
  const wurzel = new K('div');
  const ansicht = bindeGeraetAnsicht(ctx, wurzel, { dokument: DOK, kopfBauer: (host, o) => { kopfOpts.push(o); return { neu() {} }; } });
  return { ctx, spur, wurzel, ansicht, gesendet, gefragt, gemeldet, kopfOpts, lauf, warteschlange };
}
const warte = () => new Promise((r) => setImmediate(r));
const knopfVon = (wurzel, id) => wurzel.alles().find((e) => e.dataset?.id === id).finde('fp-knopf')[0];
const ziehe = (k, schritte, dy = 4) => {
  k.feuere('pointerdown', { clientX: 10, clientY: 100 });
  for (let i = 1; i <= schritte; i++) k.feuere('pointermove', { clientX: 10, clientY: 100 - i * dy });
};

test('a drag of 10 moves on a knob beyond the live range (k65) sends exactly one spur_aendern at pointerup, with the last value and every existing parameter (the release path)', async () => {
  const a = aufbau(BK({ k1: 0.25, k66: 0.75 }), { panel: BK_PANEL_HOCH, tabelle: BK_TABELLE_HOCH });
  a.ansicht.zeige(a.spur);
  await warte();
  const k = knopfVon(a.wurzel, 'c65');
  ziehe(k, 10);
  assert.equal(a.gesendet.length, 0, 'moving only previews');
  k.feuere('pointerup');
  k.feuere('lostpointercapture');   // the browser fires it after pointerup: nothing more goes out
  await warte();
  assert.equal(a.gesendet.length, 1);
  const { label, befehle } = a.gesendet[0];
  assert.equal(label, 'Lead: c65', 'the undo step names the track and the control label');
  assert.equal(befehle.length, 1);
  const b = befehle[0];
  assert.equal(b.befehl, 'spur_aendern');
  assert.equal(b.spur_id, 's1');
  assert.deepEqual(Object.keys(b.geraet.parameter).sort(), ['k1', 'k65', 'k66']);
  assert.equal(b.geraet.parameter.k1, 0.25);
  assert.equal(b.geraet.parameter.k66, 0.75);
  assert.ok(Math.abs(b.geraet.parameter.k65 - 0.75) < 1e-9, `k65 = ${b.geraet.parameter.k65}`);   // 10 moves x 4 px / 160 px from the default 0.5 ... plus 0.25
  assert.equal(b.geraet.art, 'intern');
  assert.equal(b.geraet.graph, 'synth-mono');
});

test('the panel shows the value at once (adapter keeps it locally) and falls back to the vorgabe of the table', () => {
  const sp = spurMit(BK({ k6: 0.75 }));
  const ctx = { st: { projekt: { spuren: [sp] } }, aendere: async () => true };
  const ad = spurAdapter(ctx, sp, BK_TABELLE);
  assert.equal(ad.get('k5'), 0.5, 'absent parameter: vorgabe');
  assert.equal(ad.get('k6'), 0.75);
  assert.equal(ad.get('k7'), undefined, 'unknown to the table: the panel uses the control default');
  ad.set('k5', 0.9);
  assert.equal(ad.get('k5'), 0.9);
  assert.equal(ad.lernPfad, undefined);
});

test('a track switched to a plug-in while the view is open: the view closes and a late gesture end sends nothing for k5', async () => {
  const a = aufbau(BK({ k1: 0.25 }));
  a.ansicht.zeige(a.spur);
  await warte();
  const k = knopfVon(a.wurzel, 'c5');
  ziehe(k, 3);
  a.spur.geraet = PLUGIN;   // the project answer arrives in the middle of the drag
  assert.equal(a.ansicht.zeige(a.spur), false, 'no view for a plug-in track');
  assert.equal(a.ansicht.handle(), null);
  assert.equal(a.wurzel.kinder.length, 0);
  k.feuere('pointerup');
  await warte();
  assert.equal(a.gesendet.length, 0);
  assert.equal(kannGeraetAnsicht(a.spur), false);
  assert.equal(geraetSchluessel(PLUGIN), null);
  assert.equal(geraetSchluessel(SURGE), 'surge');
});

test('the adapter itself drops the send when the live track carries another device (the panel was not told yet)', async () => {
  const sp = spurMit(BK());
  const gesendet = [];
  const ctx = { st: { projekt: { spuren: [sp] } }, aendere: async (l, b) => { gesendet.push(b); return true; } };
  const ad = spurAdapter(ctx, sp, BK_TABELLE);
  ad.set('k5', 0.2);
  sp.geraet = PLUGIN;
  await ad.ende();
  assert.equal(gesendet.length, 0);
  ctx.st.projekt.spuren = [];   // track deleted
  sp.geraet = BK();
  const ad2 = spurAdapter(ctx, sp, BK_TABELLE);
  ad2.set('k5', 0.2);
  assert.equal(ad2.ende(), undefined);
});

test('an rb338 track asks /geraete/panel?art=rb338 and sends normalised values (no unit scaling)', async () => {
  const a = aufbau(RB({ cutoff: 0.6 }), { panel: RB_PANEL, tabelle: RB_TABELLE });
  a.ansicht.zeige(a.spur);
  await warte();
  assert.equal(a.gefragt[0], '/geraete/panel?art=rb338');   // the first request: the panel; the register follows
  const k = knopfVon(a.wurzel, 'res');
  ziehe(k, 4, 16);   // 64 px = 0.4 of travel from the vorgabe 0.1
  k.feuere('pointerup');
  await warte();
  assert.equal(a.gesendet.length, 1);
  const p = a.gesendet[0].befehle[0].geraet.parameter;
  assert.deepEqual(Object.keys(p).sort(), ['cutoff', 'resonance']);
  assert.equal(p.cutoff, 0.6);
  assert.ok(Math.abs(p.resonance - 0.5) < 1e-9, `resonance = ${p.resonance}`);
  assert.ok(p.resonance >= 0 && p.resonance <= 1);
  assert.deepEqual(a.kopfOpts[0].geraet, { art: 'rb338' });
});

test('a bk track asks for its graph; LEARN is not offered (no lernPfad, header without lernen)', async () => {
  const a = aufbau(BK());
  a.ansicht.zeige(a.spur);
  await warte();
  assert.equal(a.gefragt[0], '/geraete/panel?art=bk&graph=synth-mono');
  assert.equal(a.kopfOpts[0].lernen, undefined);
  assert.deepEqual(a.kopfOpts[0].geraet, { art: 'bk', graph: 'synth-mono' });
  assert.deepEqual(reglerBereiche(BK_TABELLE), { 5: { min: 20, max: 2000, log: true, vorgabe: 0.5 }, 6: { min: 0, max: 1, log: false, vorgabe: 0.5 } });
});

test('the same track and device is not rebuilt, a project update only refreshes; another track rebuilds; a stale answer is ignored', async () => {
  const a = aufbau(BK());
  a.ansicht.zeige(a.spur);
  await warte();
  const fp = a.ansicht.handle();
  a.spur.geraet = BK({ k5: 0.9 });
  a.ansicht.zeige(a.spur);
  assert.equal(a.ansicht.handle(), fp);
  const panelAnfragen = () => a.gefragt.filter((x) => typeof x === 'string' && x.startsWith('/geraete/panel')).length;
  assert.equal(panelAnfragen(), 1);
  a.ansicht.zeige({ ...a.spur, id: 's2' });
  a.ansicht.zeige(a.spur);   // back before the answer of s2 arrived
  await warte();
  assert.equal(a.wurzel.finde('frontplatte').length, 1);
  assert.equal(panelAnfragen(), 3);
});

test('presets: apply goes through POST /presets/anwenden with ziel {art: spur, spur_id}, one write', async () => {
  const a = aufbau(RB(), { panel: RB_PANEL, tabelle: RB_TABELLE, presets: [{ herkunft: 'werk', geraet: 'rb338', slug: 'dark-dub', name: 'Dark Dub', tags: [] }] });
  a.ansicht.zeige(a.spur);
  await warte();
  const o = a.kopfOpts[0];
  assert.deepEqual(presetsFuer(o.register(), o.geraet).map((p) => p.id), ['werk:rb338/dark-dub']);
  const r = await o.anwenden('werk:rb338/dark-dub');
  assert.equal(r.ok, true);
  assert.deepEqual(a.gefragt.find((x) => x[0] === '/presets/anwenden'), ['/presets/anwenden', { id: 'werk:rb338/dark-dub', ziel: { art: 'spur', spur_id: 's1' } }]);
  assert.equal(a.gesendet.length, 1);
  assert.equal(a.gesendet[0].label, 'Apply preset');
  assert.equal(o.aktiv(), 'werk:rb338/dark-dub');
});

test('panel.js: the end of a gesture calls adapter.ende (pointerup, key up, double click, switch click) and the wheel after 300 ms idle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ende = 0;
  const wert = {};
  const adapter = { get: (n) => wert[n], set: (n, v) => { wert[n] = v; }, ende: () => { ende++; } };
  const host = new K('div');
  const fp = baueFrontplatte(host, { panel: panelV2('bk', [knob('c5', 'k5'), { id: 'sw', type: 'switch', label: 'Sw', bind: { param: 'k6' } }]), regler: {}, adapter, dokument: DOK });
  const k = host.alles().find((e) => e.dataset?.id === 'c5').finde('fp-knopf')[0];
  k.feuere('pointerdown', { clientX: 0, clientY: 50 }); k.feuere('pointermove', { clientX: 0, clientY: 40 });
  assert.equal(ende, 0);
  k.feuere('pointerup');
  assert.equal(ende, 1);
  k.feuere('keydown', { key: 'ArrowUp' }); k.feuere('keyup', { key: 'ArrowUp' });
  assert.equal(ende, 2);
  k.feuere('dblclick');
  assert.equal(ende, 3);
  for (let i = 0; i < 5; i++) { k.feuere('wheel', { deltaY: -100 }); t.mock.timers.tick(100); }
  assert.equal(ende, 3, 'the wheel keeps going: still one gesture');
  t.mock.timers.tick(300);
  assert.equal(ende, 4);
  host.alles().find((e) => e.dataset?.id === 'sw').finde('fp-schalter')[0].feuere('click');
  assert.equal(ende, 5);
  k.feuere('wheel', { deltaY: -100 });
  fp.zerstoere();   // closing mid-wheel does not lose the value
  assert.equal(ende, 6);
  t.mock.timers.tick(1000);
  assert.equal(ende, 6);
});

test('panel.js without adapter.ende works as before', () => {
  const host = new K('div');
  const adapter = { get: () => undefined, set() {} };
  baueFrontplatte(host, { panel: panelV2('bk', [knob('c5', 'k5')]), regler: {}, adapter, dokument: DOK });
  const k = host.finde('fp-knopf')[0];
  k.feuere('pointerdown', { clientX: 0, clientY: 50 }); k.feuere('pointermove', { clientX: 0, clientY: 40 }); k.feuere('pointerup'); k.feuere('keyup', {});
});

test('the register is fetched by the view itself (no PRESETS panel needed), once, and the header is redrawn when it arrived', async () => {
  const a = aufbau(RB(), { panel: RB_PANEL, tabelle: RB_TABELLE, presets: [{ herkunft: 'werk', geraet: 'rb338', slug: 'a', name: 'A', tags: [] }] });
  let neu = 0;
  a.ansicht = bindeGeraetAnsicht(a.ctx, a.wurzel, { dokument: DOK, kopfBauer: (h, o) => { a.kopfOpts.push(o); return { neu() { neu++; } }; } });
  a.ansicht.zeige(a.spur);
  await warte(); await warte();
  assert.equal(a.gefragt.filter((x) => x === '/presets/register').length, 1);
  assert.ok(neu >= 1);
  const o = a.kopfOpts.at(-1);
  assert.deepEqual(presetsFuer(o.register(), o.geraet).map((p) => p.id), ['werk:rb338/a']);
});

test('SAVE: POST /presets/von_ziel with the track as target, a valid description, the graph tag for bk; the register is fetched again', async () => {
  const voc = { familien: { instrument: { bass: ['sub', 'acid'], lead: ['mono'] } }, charakter: ['warm'], einsatz: ['drop'] };
  const a = aufbau(RB(), { panel: RB_PANEL, tabelle: RB_TABELLE, vokabular: voc });
  a.ansicht.zeige(a.spur);
  await warte();
  const o = a.kopfOpts[0];
  const r = await o.sichern('Mine');
  assert.equal(r.ok, true);
  const [weg, body] = a.gefragt.find((x) => x[0] === '/presets/von_ziel');
  assert.equal(weg, '/presets/von_ziel');
  assert.deepEqual(body.ziel, { art: 'spur', spur_id: 's1' });
  assert.equal(body.name, 'Mine');
  assert.equal(body.beschreibung.art, 'bass');
  assert.equal(body.beschreibung.unterart, 'acid');
  assert.deepEqual(body.tags, []);
  assert.equal(a.gefragt.filter((x) => x === '/presets/register').length, 2, 'refetched after the save');
  const b = aufbau(BK(), { vokabular: voc });
  b.ansicht.zeige(b.spur);
  await warte();
  await b.kopfOpts[0].sichern('Mine');
  assert.deepEqual(b.gefragt.find((x) => x[0] === '/presets/von_ziel')[1].tags, ['synth-mono']);
});

test('SAVE: a refusal is reported and the register is not refetched; an existing name asks before it overwrites', async () => {
  const a = aufbau(RB(), { panel: RB_PANEL, tabelle: RB_TABELLE, antwortVonZiel: () => ({ status: 400, j: { fehler: 'beschreibung_ungueltig', text: 'bad words' } }) });
  a.ansicht.zeige(a.spur);
  await warte();
  const r = await a.kopfOpts[0].sichern('x');
  assert.equal(r.ok, false);
  assert.match(r.text, /bad words/);
  assert.equal(a.gefragt.filter((x) => x === '/presets/register').length, 1);
  let n = 0;
  const c = aufbau(RB(), { panel: RB_PANEL, tabelle: RB_TABELLE, antwortVonZiel: (body) => (body.ueberschreiben ? { status: 200, j: {} } : { status: 409, j: { fehler: 'name_vergeben' } }) });
  c.ansicht = bindeGeraetAnsicht(c.ctx, c.wurzel, { dokument: DOK, bestaetige: () => { n++; return true; }, kopfBauer: (h, o) => { c.kopfOpts.push(o); return { neu() {} }; } });
  c.ansicht.zeige(c.spur);
  await warte();
  assert.equal((await c.kopfOpts.at(-1).sichern('dup')).ok, true);
  assert.equal(n, 1);
  assert.equal(c.gefragt.filter((x) => x[0] === '/presets/von_ziel').length, 2);
});

test('spurBeschreibung: rb338 is bass/acid when the vocabulary has it, else the first sub-kind of bass; without vocabulary the wanted words', () => {
  assert.deepEqual([spurBeschreibung({ art: 'rb338' }, { familien: { instrument: { bass: ['sub', 'acid'] } } })].map((d) => [d.art, d.unterart]), [['bass', 'acid']]);
  assert.equal(spurBeschreibung({ art: 'rb338' }, { familien: { instrument: { bass: ['sub'] } } }).unterart, 'sub');
  assert.deepEqual([spurBeschreibung({ art: 'rb338' }, null)].map((d) => [d.art, d.unterart]), [['bass', 'acid']]);
  assert.match(spurBeschreibung({ art: 'rb338' }, null).text, /^[^.]*\.$/, 'one sentence');
  assert.doesNotMatch(spurBeschreibung({ art: 'bk', graph: 'g' }, null).text, /track/);
  assert.equal(spurBeschreibung({ art: 'bk', graph: 'drums-909' }, null).art, 'drums');
});

test('anzeigeWert mirrors the server for every rb338 parameter (also gainDb and skew); volume default is -12 dB', () => {
  const t = parameterTabelle({ art: 'rb338' });
  assert.ok(t.length >= 7);
  for (const p of t) for (const k of [0, 0.1, 0.5, p.vorgabe, 0.97, 1]) assert.equal(anzeigeWert(p, k), serverAnzeige(p, k), `${p.name} ${k}`);
  const v = Object.fromEntries(t.map((p) => [p.name, p]));
  assert.ok(Math.abs(anzeigeWert(v.lautstaerke, v.lautstaerke.vorgabe) + 12) < 1e-6);
  assert.equal(anzeigeText(v.lautstaerke, v.lautstaerke.vorgabe), '-12.0 dB');
  assert.equal(anzeigeText(v.cutoff, 0.5), anzeigeText({ ...v.cutoff }, 0.5));
  assert.match(anzeigeText(v.cutoff, 0.5), / Hz$/);
  assert.ok(Math.abs(anzeigeWert(v.cutoff, 0.5) - serverAnzeige(v.cutoff, 0.5)) < 1e-9);
  assert.match(anzeigeText(v.decay, v.decay.vorgabe), /ms$|s$/);
  assert.equal(anzeigeText(v.wellenform, 0), 'Saw');
  assert.equal(anzeigeText(v.wellenform, 1), 'Square');
  assert.match(anzeigeText(v.accent, 0.5), /%$/);
  assert.equal(anzeigeText({ name: 'x', min: -1, max: 1, log: false }, 0.5), '0.00');
});

test('panel.js: readouts of an rb338 panel use the Parameter table (units), bk keeps its regler ranges; percent only without a table entry', async () => {
  const t = parameterTabelle({ art: 'rb338' });
  const host = new K('div');
  const panel = panelV2('rb338', [knob('vol', 'lautstaerke'), knob('cut', 'cutoff'), knob('x', 'unbekannt')]);
  baueFrontplatte(host, { panel, regler: {}, parameter: parameterNachName(t), adapter: { get: () => undefined, set() {} }, dokument: DOK });
  const wert = (id) => host.alles().find((e) => e.dataset?.id === id).finde('fp-wert')[0].textContent;
  assert.equal(wert('vol'), anzeigeText(t.find((p) => p.name === 'lautstaerke'), 0.5), 'real units (here the control default 0.5; the view feeds the table vorgabe through the adapter)');
  assert.match(wert('vol'), / dB$/);
  assert.equal(wertText({ type: 'knob' }, 'cutoff', 0.5, {}, parameterNachName(t)), anzeigeText(t.find((p) => p.name === 'cutoff'), 0.5));
  assert.equal(wertText({ type: 'knob' }, 'unbekannt', 0.5, {}, parameterNachName(t)), '50 %');
  assert.match(wertText({ type: 'knob' }, 'cutoff', 0.5, {}, parameterNachName(t)), / Hz$/);
});

test('two quick gestures before the first answer: the second command is built when its turn comes and carries the first value; the display never jumps back', async () => {
  const a = aufbau(BK({ k1: 0.25 }), { manuell: true, panel: BK_PANEL_HOCH, tabelle: BK_TABELLE_HOCH });
  a.ansicht.zeige(a.spur);
  await warte();
  const k5 = knopfVon(a.wurzel, 'c65'), k6 = knopfVon(a.wurzel, 'c66');
  ziehe(k5, 4); k5.feuere('pointerup');            // gesture A, answer not here yet
  const werteA = a.ansicht.handle().werte().k65;
  ziehe(k6, 2); k6.feuere('pointerup');            // gesture B
  assert.equal(a.warteschlange.length, 2);
  assert.equal(a.gesendet.length, 0);
  await a.lauf();                                   // A answered: it is in the project now
  assert.deepEqual(a.gesendet[0].befehle[0].geraet.parameter.k65, werteA);
  await a.lauf();
  const zweite = a.gesendet[1].befehle[0].geraet.parameter;
  assert.equal(zweite.k65, werteA, 'A is not rolled back');
  assert.equal(zweite.k1, 0.25);
  assert.ok(zweite.k66 > 0.5);
  assert.equal(a.ansicht.handle().werte().k65, werteA);
});

test('a refused write: the shown value goes back to the project value at once', async () => {
  const a = aufbau(BK({ k65: 0.5 }), { ablehnen: true, panel: BK_PANEL_HOCH, tabelle: BK_TABELLE_HOCH });
  a.ansicht.zeige(a.spur);
  await warte();
  const k = knopfVon(a.wurzel, 'c65');
  ziehe(k, 4);
  assert.ok(a.ansicht.handle().werte().k65 > 0.5);
  k.feuere('pointerup');
  await warte();
  assert.equal(a.ansicht.handle().werte().k65, 0.5);
  assert.equal(a.gesendet.length, 0);
});

test('a load error: clicking the device label again (wiederhole) rebuilds; without the click a project update does not refetch', async () => {
  let n = 0;
  const a = aufbau(BK(), { panelAntwort: () => (++n === 1 ? { status: 500, j: { fehler: 'kaputt' } } : null) });
  a.ansicht.zeige(a.spur);
  await warte();
  assert.equal(a.ansicht.handle(), null);
  a.ansicht.zeige(a.spur);
  await warte();
  assert.equal(n, 1, 'a project update alone does not ask again');
  a.ansicht.wiederhole();
  a.ansicht.zeige(a.spur);
  await warte();
  assert.equal(n, 2);
  assert.ok(a.ansicht.handle());
});

test('panel.js: a blocked parameter (adapter.gesperrt) is greyed, shows adapter.get at once, ignores input and sends nothing', () => {
  const wert = { k5: 0.8, k6: 0.5 }, gesetzt = [];
  let sperre = true;
  const adapter = { get: (n) => wert[n], set: (n, v) => gesetzt.push([n, v]), gesperrt: (n) => sperre && n === 'k5' };
  const host = new K('div');
  const fp = baueFrontplatte(host, { panel: panelV2('bk', [knob('c5', 'k5'), knob('c6', 'k6')]), regler: {}, adapter, dokument: DOK });
  const zelle = (id) => host.alles().find((e) => e.dataset?.id === id);
  assert.ok(zelle('c5').klassen.has('fp-gesperrt'));
  assert.equal(zelle('c5').attr['aria-disabled'], 'true');
  assert.ok(!zelle('c6').klassen.has('fp-gesperrt'));
  const k = zelle('c5').finde('fp-knopf')[0];
  k.feuere('pointerdown', { clientX: 0, clientY: 50 }); k.feuere('pointermove', { clientX: 0, clientY: 0 }); k.feuere('pointerup');
  k.feuere('wheel', { deltaY: -100 }); k.feuere('keydown', { key: 'ArrowUp' }); k.feuere('dblclick');
  assert.deepEqual(gesetzt, []);
  wert.k5 = 0.2;   // the macro moves it: the panel follows at once
  fp.aktualisiere();
  assert.equal(fp.werte().k5, 0.2);
  sperre = false; fp.aktualisiere();
  assert.ok(!zelle('c5').klassen.has('fp-gesperrt'));
  const k6 = zelle('c6').finde('fp-knopf')[0];
  k6.feuere('pointerdown', { clientX: 0, clientY: 50 }); k6.feuere('pointermove', { clientX: 0, clientY: 40 });
  assert.equal(gesetzt.length, 1);
});

test('insert stage adapter: a parameter driven by a rack macro is blocked and shows the macro value; others behave as before', () => {
  const ctx = { st: { projekt: { spuren: [{ id: 's1', name: 'T', inserts: [{ id: 'i1', art: 'bk', graph: 'g', werte: { k1: 0.1, k2: 0.2 } }],
    rack: { namen: ['M'], werte: [0.5, 0, 0, 0], makros: [{ ziel: [{ insert: 'i1', param: 'k1', von: 0.2, bis: 0.6 }] }] } }] } }, aendere: () => {} };
  const ad = baueInsertAdapter(ctx, { id: 's1', name: 'T' }, 'i1');
  assert.equal(ad.gesperrt('k1'), true);
  assert.ok(Math.abs(ad.get('k1') - 0.4) < 1e-9, 'the macro value, not the stage value');
  assert.equal(ad.gesperrt('k2'), false);
  assert.equal(ad.get('k2'), 0.2);
  ctx.st.projekt.spuren[0].rack = undefined;
  assert.equal(ad.gesperrt('k1'), false);
  assert.equal(ad.get('k1'), 0.1);
});

test('panel.js: a key up of an unrelated key does not end a wheel gesture; an arrow key up does', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ende = 0;
  const host = new K('div');
  baueFrontplatte(host, { panel: panelV2('bk', [knob('c5', 'k5')]), regler: {}, adapter: { get: () => undefined, set() {}, ende: () => { ende++; } }, dokument: DOK });
  const k = host.finde('fp-knopf')[0];
  k.feuere('wheel', { deltaY: -100 });
  k.feuere('keyup', { key: 'Shift' }); k.feuere('keyup', { key: 'a' });
  assert.equal(ende, 0);
  t.mock.timers.tick(300);
  assert.equal(ende, 1);
  k.feuere('keyup', { key: 'ArrowUp' });
  assert.equal(ende, 2);
});

// ---- front panels task 11: Surge XT in production ----
import { parameterTabelle as paraTab } from '../devices_parameter.ts';
const SURGE_PANEL = panelV2('surge', [knob('cut', 'a_filter1_cutoff'), knob('lvl', 'a_level_o1')]);
const SURGE_TABELLE = [{ name: 'a_filter1_cutoff', min: -60, max: 70, log: false, vorgabe: 0.5 }, { name: 'a_level_o1', min: 0, max: 1, log: false, vorgabe: 0.5 }];
const surgeSpur = (parameter = {}) => ({ ...SURGE, parameter });

test('Surge track: the view opens, one spur_aendern per gesture carries the parameter name as a DISPLAY value (not travel)', async () => {
  const a = aufbau(surgeSpur({ a_level_o1: 0.25 }), { panel: SURGE_PANEL, tabelle: SURGE_TABELLE });
  assert.equal(kannGeraetAnsicht(a.spur), true);
  assert.equal(a.ansicht.zeige(a.spur), true);
  await warte();
  assert.ok(a.gefragt.includes('/geraete/panel?art=surge'));
  assert.equal(a.kopfOpts.length, 0, 'no preset header for Surge');
  const k = knopfVon(a.wurzel, 'cut');
  ziehe(k, 10);
  assert.equal(a.gesendet.length, 0);
  k.feuere('pointerup');
  await warte();
  assert.equal(a.gesendet.length, 1);
  const b = a.gesendet[0].befehle[0];
  assert.equal(b.befehl, 'spur_aendern');
  assert.deepEqual(Object.keys(b.geraet.parameter).sort(), ['a_filter1_cutoff', 'a_level_o1']);
  assert.equal(b.geraet.parameter.a_level_o1, 0.25, 'the other entry is kept');
  const w = b.geraet.parameter.a_filter1_cutoff;
  assert.ok(Math.abs(w - (-60 + 0.75 * 130)) < 1e-6, `cutoff display value = ${w}`);   // travel 0.5 + 10 x 4 px / 160 px
  assert.equal(b.geraet.name, 'surge');
  assert.equal(b.geraet.slot, 1);
});

test('Surge adapter: get() turns a stored display value back into travel, absent = vorgabe', () => {
  const sp = spurMit(surgeSpur({ a_filter1_cutoff: 5 }));
  const ad = spurAdapter({ st: { projekt: { spuren: [sp] } }, aendere: async () => true }, sp, SURGE_TABELLE);
  assert.ok(Math.abs(ad.get('a_filter1_cutoff') - 0.5) < 1e-9);
  assert.equal(ad.get('a_level_o1'), 0.5);
});

test('Surge track: a 33rd distinct name is refused with a message and nothing is sent; known names still go', async () => {
  const namen = Array.from({ length: 33 }, (_, i) => `a_p${i}`);
  const tabelle = namen.map((n) => ({ name: n, min: 0, max: 1, log: false, vorgabe: 0.5 }));
  const voll = Object.fromEntries(namen.slice(0, 32).map((n) => [n, 0.1]));
  const sp = spurMit(surgeSpur(voll));
  const gesendet = [], gemeldet = [], fertig = [];
  const ctx = { st: { projekt: { spuren: [sp] } }, aendere: async (l, b) => { gesendet.push(b); return true; } };
  const ad = spurAdapter(ctx, sp, tabelle, { melde: (t, f) => gemeldet.push([t, f]), beiFertig: (ok) => fertig.push(ok) });
  ad.set('a_p32', 0.9);
  assert.equal(await ad.ende(), undefined);
  assert.equal(gesendet.length, 0);
  assert.equal(gemeldet.length, 1);
  assert.match(gemeldet[0][0], /at most 32/);
  assert.equal(gemeldet[0][1], true);
  assert.deepEqual(fertig, [false], 'the view is told to redraw from the project');
  assert.equal(ad.get('a_p32'), 0.5, 'the refused value is not kept');
  ad.set('a_p3', 0.9);
  await ad.ende();
  assert.equal(gesendet.length, 1);
  assert.equal(Object.keys(gesendet[0][0].geraet.parameter).length, 32);
});

test('the shipped Surge table gives every panel name a range (production adapter positive control)', () => {
  assert.ok(paraTab({ art: 'surge' }).some((p) => p.name === 'a_filter1_cutoff'));
});

test('Surge track: the written display value follows the punkte curve and get() inverts it', async () => {
  const tabelle = [{ name: 'c', min: 0, max: 12, log: false, vorgabe: 0.5, punkte: [0, 1, 10, 11, 12] }];
  const sp = spurMit(surgeSpur({ c: 5.5 }));
  const gesendet = [];
  const ctx = { st: { projekt: { spuren: [sp] } }, aendere: async (l, b) => { gesendet.push(b); return true; } };
  const ad = spurAdapter(ctx, sp, tabelle);
  assert.ok(Math.abs(ad.get('c') - 0.375) < 1e-12);
  ad.set('c', 0.5);
  await ad.ende();
  assert.equal(gesendet[0][0].geraet.parameter.c, 10);
});

import { SURGE_PARAMETER_MAX } from '../project/model.ts';
import { SURGE_MAX } from '../public/production/device_view.js';
test('SURGE_MAX of the page equals SURGE_PARAMETER_MAX of the project model', () => { assert.equal(SURGE_MAX, SURGE_PARAMETER_MAX); });

test('Surge track view: untouched parameters get the host value as vorgabe (GET .../geraet/ist), stored ones are not asked; a host that does not answer keeps the table and says so', async () => {
  const a = aufbau(surgeSpur({ a_level_o1: 0.25 }), { panel: SURGE_PANEL, tabelle: SURGE_TABELLE });
  const alt = a.ctx.holeGet;
  a.ctx.holeGet = async (weg) => {
    if (weg.startsWith('/proj/spur/')) { a.gefragt.push(weg); return { status: 200, j: { werte: { a_filter1_cutoff: 5 } } }; }
    return alt(weg);
  };
  a.ansicht.zeige(a.spur);
  await warte(); await warte();
  assert.ok(a.gefragt.includes('/proj/spur/s1/geraet/ist?namen=a_filter1_cutoff'), JSON.stringify(a.gefragt));

  // adapter level: the table the view hands over carries the host value
  const tab = await surgeIstEinlesen({ holeGet: async () => ({ status: 200, j: { werte: { a_filter1_cutoff: 5 } } }), melde() {} }, spurMit(surgeSpur({ a_level_o1: 0.25 })), SURGE_TABELLE, ['a_filter1_cutoff', 'a_level_o1']);
  assert.ok(Math.abs(tab.find((p) => p.name === 'a_filter1_cutoff').vorgabe - 0.5) < 1e-9);
  assert.equal(tab.find((p) => p.name === 'a_level_o1').vorgabe, 0.5, 'a stored one is not asked');
  const tab2 = await surgeIstEinlesen({ holeGet: async () => ({ status: 200, j: { werte: { a_filter1_cutoff: 70 } } }), melde() {} }, spurMit(surgeSpur()), SURGE_TABELLE, ['a_filter1_cutoff']);
  assert.equal(tab2.find((p) => p.name === 'a_filter1_cutoff').vorgabe, 1);
  const gemeldet = [];
  const tab3 = await surgeIstEinlesen({ holeGet: async () => ({ status: 409, j: {} }), melde: (t, f) => gemeldet.push([t, f]) }, spurMit(surgeSpur()), SURGE_TABELLE, ['a_filter1_cutoff']);
  assert.deepEqual(tab3, SURGE_TABELLE);
  assert.equal(gemeldet.length, 1);
});

// ---- production plan task 10: knobs k1..k64 of a Baukasten track are live ------------------------------------------------------------------------------
// an injectable clock: a timer fires when `vor` passes its time (the adapter takes {setTimeout, clearTimeout} like pluginAdapter)
function uhr() {
  let t = 0;
  const wartend = [];
  return {
    setTimeout: (f, ms) => { const h = { f, at: t + ms }; wartend.push(h); return h; },
    clearTimeout: (h) => { const i = wartend.indexOf(h); if (i >= 0) wartend.splice(i, 1); },
    vor(ms) {
      const ende = t + ms;
      for (;;) {
        wartend.sort((a, b) => a.at - b.at);
        const n = wartend[0];
        if (!n || n.at > ende) break;
        wartend.shift(); t = n.at; n.f();
      }
      t = ende;
    },
    offen: () => wartend.length,
  };
}
// a context that answers at once: the project takes a live knob value like the server does
function liveKontext(sp, { ablehnen = false } = {}) {
  const gesendet = [], gemeldet = [];
  const ctx = {
    st: { projekt: { spuren: [sp] } },
    aendereAus: (rechne) => {
      const x = rechne(ctx.st.projekt);
      if (!x) return Promise.resolve(false);
      if (ablehnen) { gemeldet.push('refused'); return Promise.resolve(false); }
      gesendet.push(x);
      const b = x.befehle[0];
      if (b.befehl === 'geraet_param_setzen') sp.geraet = { ...sp.geraet, parameter: { ...sp.geraet.parameter, [b.param]: b.wert } };
      else sp.geraet = b.geraet;
      return Promise.resolve(true);
    },
  };
  return { ctx, gesendet, gemeldet };
}

test('task 10: a drag of ten set() calls within 100 ms sends at most four geraet_param_setzen, the last with the last value; ende() sends nothing more when it went out already', async () => {
  const sp = spurMit(BK({ k1: 0.25 })), u = uhr();
  const { ctx, gesendet } = liveKontext(sp);
  const ad = spurAdapter(ctx, sp, BK_TABELLE, { zeitgeber: u });
  for (let i = 1; i <= 10; i++) { ad.set('k5', i / 10); u.vor(10); }
  await warte();
  assert.ok(gesendet.length >= 1 && gesendet.length <= 4, `${gesendet.length} commands`);
  for (const x of gesendet) {
    assert.equal(x.befehle.length, 1);
    assert.deepEqual([x.befehle[0].befehl, x.befehle[0].spur_id, x.befehle[0].param], ['geraet_param_setzen', 's1', 'k5']);
    assert.equal(x.label, 'Lead: k5');
  }
  await ad.ende();
  assert.equal(gesendet.at(-1).befehle[0].wert, 1, 'the last command carries the last value');
  const n = gesendet.length;
  assert.equal(ad.ende(), undefined, 'nothing pending');
  u.vor(100);
  assert.equal(gesendet.length, n, 'nothing more goes out after ende');
  // the last value already sent by the timer: ende adds nothing
  ad.set('k6', 0.3); u.vor(30);
  await warte();
  const m = gesendet.length;
  assert.equal(gesendet.at(-1).befehle[0].param, 'k6');
  assert.equal(ad.ende(), undefined);
  assert.equal(gesendet.length, m);
  assert.equal(ad.get('k6'), 0.3);
  assert.equal(sp.geraet.parameter.k6, 0.3, 'the project holds it');
});

test('task 10: knobs beyond k64, an RB-338 track and a Surge track keep the single spur_aendern at the end of the gesture (no live send)', async () => {
  for (const [geraet, param, tabelle] of [[BK({ k1: 0.25 }), 'k65', BK_TABELLE_HOCH], [RB({ cutoff: 0.6 }), 'cutoff', RB_TABELLE]]) {
    const sp = spurMit(geraet), u = uhr();
    const { ctx, gesendet } = liveKontext(sp);
    const ad = spurAdapter(ctx, sp, tabelle, { zeitgeber: u });
    ad.set(param, 0.2); ad.set(param, 0.4);
    u.vor(500);
    await warte();
    assert.equal(gesendet.length, 0, `${geraet.name} ${param}: nothing during the drag`);
    assert.equal(u.offen(), 0, 'no timer');
    await ad.ende();
    assert.equal(gesendet.length, 1);
    assert.equal(gesendet[0].befehle[0].befehl, 'spur_aendern');
  }
  const sp = spurMit(BK()), { ctx, gesendet } = liveKontext(sp), u = uhr();   // the border: k64 is live (k33 too), k65 is not
  const ad = spurAdapter(ctx, sp, [{ name: 'k64', vorgabe: 0.5 }, { name: 'k65', vorgabe: 0.5 }], { zeitgeber: u });
  ad.set('k65', 0.9); u.vor(100); await warte();
  assert.equal(gesendet.length, 0);
  ad.set('k64', 0.9); u.vor(30); await warte();
  assert.equal(gesendet.at(-1).befehle[0].befehl, 'geraet_param_setzen');
  ad.set('k33', 0.9); u.vor(30); await warte();
  assert.equal(gesendet.at(-1).befehle[0].befehl, 'geraet_param_setzen');
  assert.equal(gesendet.at(-1).befehle[0].param, 'k33');
});

test('task 10 (failure case): a refused live send reports once, the display returns to the stored value, the rest of the gesture sends nothing', async () => {
  const sp = spurMit(BK({ k5: 0.4 })), u = uhr();
  const k = liveKontext(sp, { ablehnen: true });
  const fertig = [];
  const ad = spurAdapter(k.ctx, sp, BK_TABELLE, { zeitgeber: u, beiFertig: (ok) => fertig.push(ok) });
  ad.set('k5', 0.9);
  assert.equal(ad.get('k5'), 0.9, 'the drag shows the value at once');
  u.vor(30);
  await warte();
  assert.equal(k.gemeldet.length, 1, 'the writer reported the refusal');
  assert.equal(ad.get('k5'), 0.4, 'the display is back at the stored value');
  assert.deepEqual(fertig, [false]);
  ad.set('k5', 0.95); u.vor(300);
  await warte();
  assert.equal(k.gemeldet.length, 1, 'no second send, so no second report');
  assert.equal(ad.get('k5'), 0.95, 'the knob still previews');
  assert.equal(ad.ende(), undefined);
  assert.equal(ad.get('k5'), 0.4, 'the gesture is over: the stored value shows');
  assert.equal(k.gesendet.length, 0);
  assert.equal(sp.geraet.parameter.k5, 0.4);
});

test('task 10: a drag on the panel knob of a bk track sends geraet_param_setzen, and the whole drag is one undo step label', async () => {
  const a = aufbau(BK({ k1: 0.25 }));
  a.ansicht.zeige(a.spur);
  await warte();
  const k = knopfVon(a.wurzel, 'c5');
  ziehe(k, 10);
  k.feuere('pointerup');
  await warte();
  assert.equal(a.gesendet.length, 1, 'the pointerup flushes the last value (the 30 ms timer of a fast drag had not fired)');
  assert.equal(a.gesendet[0].label, 'Lead: c5');
  const b = a.gesendet[0].befehle[0];
  assert.deepEqual([b.befehl, b.spur_id, b.param], ['geraet_param_setzen', 's1', 'k5']);
  assert.ok(Math.abs(b.wert - 0.75) < 1e-9, `wert ${b.wert}`);
  assert.equal(a.spur.geraet.parameter.k1, 0.25, 'the other knobs are untouched');
  assert.ok(Math.abs(a.ansicht.handle().werte().k5 - 0.75) < 1e-9, 'the panel shows the stored value after the answer');
});

// Workbench task 4: option `breit` builds the wide plate (fp-breit); PRODUCTION's call without it is unchanged.
test('bindeGeraetAnsicht with breit builds the wide plate; without it the small one', async () => {
  for (const [opt, breit] of [[{ breit: true }, true], [{}, false]]) {
    const a = aufbau(BK());
    const wurzel = new K('div');
    const v = bindeGeraetAnsicht(a.ctx, wurzel, { dokument: DOK, kopfBauer: () => ({ neu() {} }), ...opt });
    v.zeige(a.spur);
    await warte();
    const platten = wurzel.alles().filter((e) => e.klassen.has('frontplatte'));
    assert.ok(platten.length > 0, 'a plate was built');
    assert.ok(platten[0].classList.contains('fp-breit') === breit, `breit=${breit}`);
  }
});
