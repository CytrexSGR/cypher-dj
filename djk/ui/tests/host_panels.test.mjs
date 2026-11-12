// Live host panels: RB-338 / Baukasten-in-host adapters (stub post and timer), graph lookup by knob names, automatic panel, tab labels, host names.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hostAdapter, RB338_HOST_NAME, rb338HostZuPanel, knobHostName, hostKnobName, istVonHost, graphDesHosts, baukastenAutoPanel } from '../public/host_adapter.js';
import { steuerungen, parameterVon } from '../public/panel.js';
import { instrumentReiterHtml } from '../public/instruments_view.js';
import { hostName } from '../public/effects.js';
import { RB_DEFS } from '../project/rb_mapping.ts';
import { pruefePanel } from '../graphs.ts';
import { parameterTabelle, pfadeVon } from '../devices_parameter.ts';

const zeitgeber = () => { const f = []; return { setTimeout: (fn) => { f.push(fn); return f.length; }, lauf: async () => { for (const x of f.splice(0)) await x(); } }; };

test('RB-338: every panel parameter of the shipped hand panel maps to a host name; the host names are the seven plug-in names, one each', () => {
  assert.deepEqual(Object.keys(RB338_HOST_NAME).sort(), Object.keys(RB_DEFS).sort());
  assert.equal(new Set(Object.values(RB338_HOST_NAME)).size, 7);
  const lib = fs.readFileSync(path.join(pfadeVon().wurzel, 'djk', 'instruments', 'rb338', 'src', 'lib.rs'), 'utf8');
  for (const n of Object.values(RB338_HOST_NAME)) assert.ok(lib.includes(`::new("${n}"`), `${n} is a plug-in parameter name in lib.rs`);
  const panel = JSON.parse(fs.readFileSync(path.join(pfadeVon().paneele, 'rb338.json'), 'utf8'));
  const tabelle = parameterTabelle({ art: 'rb338' });
  assert.deepEqual(pruefePanel(panel, 'rb338', {}, tabelle.map((p) => p.name)), []);
  for (const n of steuerungen(panel).flatMap(parameterVon)) assert.ok(RB338_HOST_NAME[n], n);
  assert.equal(rb338HostZuPanel('Env Mod'), 'env_mod');
  assert.equal(rb338HostZuPanel('Knob 1'), null);
});

test('RB-338 adapter: set sends the latest value per parameter after 40 ms as normalised param with the plug-in name; get = sent, else host reading', async () => {
  const z = zeitgeber(), gesendet = [];
  const a = hostAdapter({ gruppe: 'bass', hostName: (p) => RB338_HOST_NAME[p] ?? null, ist: { cutoff: 0.25 }, timer: z, wartMs: 40,
    post: async (pfad, body) => { gesendet.push([pfad, body]); return { ok: true, code: 200, j: { ok: true } }; } });
  assert.equal(a.get('cutoff'), 0.25);
  assert.equal(a.get('decay'), undefined);
  a.set('cutoff', 0.4); a.set('cutoff', 0.6); a.set('env_mod', 1);
  assert.equal(a.get('cutoff'), 0.6);
  assert.equal(gesendet.length, 0, 'nothing before the timer');
  await z.lauf();
  assert.deepEqual(gesendet, [['/klang', { gruppe: 'bass', aktion: 'param', name: 'Cutoff', wert: 0.6 }], ['/klang', { gruppe: 'bass', aktion: 'param', name: 'Env Mod', wert: 1 }]]);
  a.set('unbekannt', 0.5); await z.lauf();
  assert.equal(gesendet.length, 2, 'a parameter without host name sends nothing');
});

test('adapter: a refused or failed send forgets the value, tells the user and asks for a redraw', async () => {
  const z = zeitgeber(), meldungen = []; let neuZeichnen = 0;
  const a = hostAdapter({ gruppe: 'melodie', hostName: knobHostName, ist: { k3: 0.1 }, timer: z, melde: (t, f) => meldungen.push([t, f]), beiAbgelehnt: () => { neuZeichnen++; },
    post: async () => ({ ok: false, code: 409, j: { text: 'wirt refused' } }) });
  a.set('k3', 0.9); await z.lauf();
  assert.equal(a.get('k3'), 0.1);
  assert.deepEqual(meldungen, [['Knob refused: wirt refused', true]]);
  assert.equal(neuZeichnen, 1);
  const b = hostAdapter({ gruppe: 'melodie', hostName: knobHostName, timer: z, melde: (t, f) => meldungen.push([t, f]), post: async () => { throw new Error('down'); } });
  b.set('k1', 0.5); await z.lauf();
  assert.equal(b.get('k1'), undefined);
  assert.equal(meldungen.at(-1)[0], 'Knob not sent: down');
});

test('Baukasten in the host: k<n> <-> Knob n, 1..64 only; the reading maps back to panel names', () => {
  assert.equal(knobHostName('k1'), 'Knob 1'); assert.equal(knobHostName('k32'), 'Knob 32'); assert.equal(knobHostName('k64'), 'Knob 64');
  for (const f of ['k0', 'k65', 'k033', 'k01', 'cutoff', 'Knob 1']) assert.equal(knobHostName(f), null, f);
  assert.equal(hostKnobName('Knob 12'), 'k12');
  assert.equal(hostKnobName('Knob 64'), 'k64');
  for (const f of ['Knob 0', 'Knob 65', 'Volume', 'k1']) assert.equal(hostKnobName(f), null, f);
  assert.deepEqual(istVonHost({ Volume: 0.5, 'Knob 1': 0.25, 'Knob 2': 7, 'Knob 3': 'x' }, hostKnobName), { k1: 0.25, k2: 1 });
  assert.deepEqual(istVonHost({ Cutoff: 0.5, Square: 1, Foo: 0.2 }, rb338HostZuPanel), { cutoff: 0.5, wellenform: 1 });
  assert.deepEqual(istVonHost(null, hostKnobName), {});
});

test('Baukasten in the host: the graph is found by its knob names, only when exactly one instrument graph fits', () => {
  const g = [{ name: 'a', art: 'instrument', regler_namen: { 1: 'Cutoff', 2: 'Res' } }, { name: 'b', art: 'instrument', regler_namen: { 1: 'Cutoff' } },
    { name: 'fx', art: 'effekt', regler_namen: { 1: 'Cutoff', 2: 'Res' } }];
  assert.equal(graphDesHosts({ 'Knob 1': 'Cutoff', 'Knob 2': 'Res' }, g), 'a');
  assert.equal(graphDesHosts({ 'Knob 1': 'Cutoff' }, g), 'b');
  assert.equal(graphDesHosts({ 'Knob 1': 'Other' }, g), null);
  assert.equal(graphDesHosts({}, g), null);
  assert.equal(graphDesHosts({ 'Knob 1': 'Cutoff', 'Knob 2': 'Res' }, [...g, { name: 'a2', art: 'instrument', regler_namen: { 1: 'Cutoff', 2: 'Res' } }]), null, 'two fit: ambiguous');
});

test('Baukasten in the host: the automatic panel has one knob per reported Knob, named from the graph, 8 per section', () => {
  const params = { Volume: 0.5 }; for (let n = 1; n <= 10; n++) params[`Knob ${n}`] = 0.5;
  const p = baukastenAutoPanel(params, { 'Knob 2': 'Cutoff' });
  assert.equal(p.sections.length, 2);
  assert.deepEqual(steuerungen(p).flatMap(parameterVon), Array.from({ length: 10 }, (_, i) => `k${i + 1}`));
  assert.equal(steuerungen(p).find((c) => c.id === 'k2').label, 'Cutoff');
  assert.equal(steuerungen(p).find((c) => c.id === 'k1').label, 'Knob 1');
  assert.deepEqual(pruefePanel(p, 'host', Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), { min: 0, max: 1, log: false }])), Array.from({ length: 10 }, (_, i) => `k${i + 1}`)), []);
  assert.equal(baukastenAutoPanel({ Volume: 1 }), null);
});

test('tabs: a channel without a graph shows its host name, a loaded graph wins, none known stays empty', () => {
  const h = instrumentReiterHtml(['erz/2', 'erz/3', 'erz/5'], 'erz/2', { 'erz/3': 'synth-mono' }, { 'erz/2': 'RB-338', 'erz/3': 'Surge XT' });
  assert.match(h, />I2 · RB-338<\/button>/);
  assert.match(h, />I3 · synth-mono<\/button>/);
  assert.match(h, />I5 · empty<\/button>/);
  assert.match(instrumentReiterHtml(['erz/3'], 'erz/3', {}, { 'erz/3': '<b>x</b>' }), /I3 · &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(instrumentReiterHtml(['erz/2'], 'erz/2', {}), />I2 · empty<\/button>/);
});

test('host names: the grand piano and the rest as before', () => {
  assert.equal(hostName({ art: 'sfz:grand', plugin: 'SFZ' }), 'Grand piano');
  assert.equal(hostName({ art: 'vst3:rb338', plugin: 'RB-338' }), 'RB-338');
  assert.equal(hostName({ art: 'lv2' }), 'Surge XT');
  assert.equal(hostName({ art: 'sfz:piano.sfz' }), 'piano.sfz');
});
