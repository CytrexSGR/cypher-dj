// A test instance (CYPHERDJ_INSTANZ=a..i) must not take the real MIDI controllers of the desk: it lists them as present but not connected, writes no
// edge to them for the kern, and refuses to put one on a place. Opt-in: CYPHERDJ_ECHTE_GERAETE=1. The production instance behaves as before.
// No real server, no ALSA, no PipeWire: the routes run on a Router over temp files, the detection is a stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json } from '../http/transport.ts';
import { echteGeraeteErlaubt, istEchtesGeraet } from '../areas/devices/lock.ts';
import { baueKantenText } from '../areas/devices/edges.ts';
import { standard } from '../areas/devices/store.ts';
import { geraeteBereich } from '../areas/devices/area.ts';
import { registerBereich } from '../areas/controller/register.ts';

const LPD8 = 'Midi-Bridge:LPD8: MIDI 1 (capture)', LC3 = 'Midi-Bridge:LC3 1: DAW In (capture)';
const PRUEF = 'Midi-Bridge:RtMidiOut Client:cypherdj-e-test (capture)';   // the fixture client of the test instance e (~/.config/cypherdj-e/geraete.json)

test('the right to real devices: the production instance has it, a test instance only with CYPHERDJ_ECHTE_GERAETE=1', () => {
  assert.equal(echteGeraeteErlaubt('', {}), true);
  assert.equal(echteGeraeteErlaubt('e', {}), false);
  assert.equal(echteGeraeteErlaubt('e', { CYPHERDJ_ECHTE_GERAETE: '1' }), true);
  for (const v of ['', '0', 'true', 'yes']) assert.equal(echteGeraeteErlaubt('e', { CYPHERDJ_ECHTE_GERAETE: v }), false, `value "${v}" is no opt-in`);
  assert.equal(echteGeraeteErlaubt('', { CYPHERDJ_ECHTE_GERAETE: '0' }), true, 'the production instance never loses them');
});

test('a real device is a port of the ALSA bridge that is not a cypherdj client; fixtures and software ports are not', () => {
  assert.equal(istEchtesGeraet(LPD8), true);
  assert.equal(istEchtesGeraet(LC3), true);
  assert.equal(istEchtesGeraet('Midi-Bridge:Akai APC20: MIDI 1 (capture)'), true);
  assert.equal(istEchtesGeraet(PRUEF), false);
  assert.equal(istEchtesGeraet('Midi-Bridge:cypherdj-softcontroller-e:hand (capture)'), false);
  assert.equal(istEchtesGeraet('cypherdj-pruef-ein:midi_aus'), false);
  assert.equal(istEchtesGeraet('X:Y'), false);
});

test('edge file: without the right, no line leads a real device to a midi_ein; audio, fixtures and the default are untouched', () => {
  const k = standard();
  k.eingaenge[0].audio = { knoten: 'a', ports: ['a:FL', 'a:FR'] };
  k.midi = { profil: 'midi-controller', port: LPD8, frei_fuer_cypher: false };
  k.controller = [{ platz: 2, port: LC3 }, { platz: 3, port: PRUEF }, { platz: 4, port: 'a:b' }];
  assert.equal(baueKantenText(k), `a:FL\tein_1_L\na:FR\tein_1_R\n${LPD8}\tmidi_ein_1\n${LC3}\tmidi_ein_2\n${PRUEF}\tmidi_ein_3\na:b\tmidi_ein_4\n`, 'default: as before');
  assert.equal(baueKantenText(k, true), baueKantenText(k));
  assert.equal(baueKantenText(k, false), `a:FL\tein_1_L\na:FR\tein_1_R\n${PRUEF}\tmidi_ein_3\na:b\tmidi_ein_4\n`);
});

async function stapel(t, { echte, konfig, erk }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-instanz-geraete-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const konfigPfad = path.join(d, 'geraete.json'), kantenPfad = path.join(d, 'eingaenge-kanten');
  if (konfig) fs.writeFileSync(konfigPfad, JSON.stringify(konfig));
  const router = new Router();
  router.melde(geraeteBereich({ log: () => {}, quelle: () => 'andreas' }, { konfigPfad, kantenPfad, cacheMs: 0, echteGeraete: echte, erkenne: async () => erk }));
  const server = http.createServer(async (q, a) => {
    const r = router.finde(q.method ?? '', new URL(q.url ?? '/', 'http://x').pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    await r.handler(q, a, new URL(q.url ?? '/', 'http://x'));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const ruf = async (m, p, body) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { code: r.status, j: await r.json() }; };
  return { ruf, konfigPfad, kantenPfad };
}
const ERK = { audio: [], midi: [{ port: LPD8, alias: 'LPD8' }, { port: LC3, alias: '' }, { port: PRUEF, alias: '' }] };
const mitPlaetzen = () => ({ ...standard(), midi: { profil: 'midi-controller', port: LPD8, frei_fuer_cypher: false }, controller: [{ platz: 2, port: LC3 }] });

test('geraete, test instance: a config that already holds real devices does not wire them at start, and the lage says not connected', async (t) => {
  const { ruf, kantenPfad } = await stapel(t, { echte: false, konfig: mitPlaetzen(), erk: ERK });
  assert.equal(fs.readFileSync(kantenPfad, 'utf8'), '', 'the kern gets no edge to the LPD8 or the Launch Control 3');
  const g = await ruf('GET', '/geraete');
  assert.equal(g.code, 200);
  assert.equal(g.j.echte_geraete, false);
  assert.deepEqual(g.j.controller.map((c) => [c.platz, c.da, c.verbunden]), [[1, true, false], [2, true, false]], 'present, not connected (even if a core still reported the bit)');
  assert.deepEqual([g.j.midi.da, g.j.midi.verbunden], [true, false]);
});

test('geraete, test instance: a real device cannot be put on a place (409, nothing written); a fixture port can', async (t) => {
  const { ruf, konfigPfad, kantenPfad } = await stapel(t, { echte: false, erk: ERK });
  const m = await ruf('POST', '/geraete/midi', { profil: 'midi-controller', port: LPD8 });
  assert.deepEqual([m.code, m.j.fehler], [409, 'echte_geraete_gesperrt']);
  const c = await ruf('POST', '/geraete/controller', { port: LC3 });
  assert.deepEqual([c.code, c.j.fehler], [409, 'echte_geraete_gesperrt']);
  assert.ok(!fs.existsSync(konfigPfad) && !fs.existsSync(kantenPfad), 'a refused request writes nothing');
  const ok = await ruf('POST', '/geraete/controller', { port: PRUEF });
  assert.equal(ok.code, 200);
  assert.equal(fs.readFileSync(kantenPfad, 'utf8'), `${PRUEF}\tmidi_ein_2\n`);
});

test('geraete, test instance with the opt-in and the production instance: real devices are wired as before', async (t) => {
  for (const echte of [true, undefined]) {
    const { ruf, kantenPfad } = await stapel(t, { echte, erk: ERK });
    const m = await ruf('POST', '/geraete/midi', { profil: 'midi-controller', port: LPD8 });
    assert.equal(m.code, 200, `echte=${echte}`);
    const c = await ruf('POST', '/geraete/controller', { port: LC3 });
    assert.equal(c.code, 200);
    assert.equal(fs.readFileSync(kantenPfad, 'utf8'), `${LPD8}\tmidi_ein_1\n${LC3}\tmidi_ein_2\n`);
    assert.equal((await ruf('GET', '/geraete')).j.echte_geraete, true);
  }
});

async function registerStapel(t, opt) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-instanz-register-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const router = new Router();
  router.melde(registerBereich({ log: () => {}, quelle: () => 'andreas' }, { ordner, aktiv: () => null, midiPort: () => null, host: () => ({}), usb: () => ['09e8:007b', '1235:0157', '09e8:0075'], ...opt }));
  const server = http.createServer(async (q, a) => {
    const r = router.finde(q.method ?? '', '/register');
    await r.handler(q, a, new URL(q.url ?? '/', 'http://x'));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  return (await fetch(`http://127.0.0.1:${server.address().port}/register`)).json();
}

test('register: a test instance lists the plugged-in desk devices as present but not connected, the production instance as before', async (t) => {
  const test_ = await registerStapel(t, { echte: false });
  assert.equal(test_.echte_geraete, false);
  const apc = test_.katalog.find((k) => k.id === 'apc20'), s8 = test_.katalog.find((k) => k.id === 's8');
  assert.deepEqual([apc.da, apc.verbunden, s8.da, s8.verbunden], [true, false, false, false]);
  assert.ok(test_.katalog.every((k) => k.verbunden === false));
  const betrieb = await registerStapel(t, {});
  assert.equal(betrieb.echte_geraete, true);
  assert.deepEqual(betrieb.katalog.filter((k) => k.da).map((k) => [k.id, k.verbunden]), [['apc20', true], ['lpd8', true], ['lc3', true]]);
  assert.equal(betrieb.katalog.find((k) => k.id === 's8').verbunden, false);
});

test('page rows: without the right every device is "present, not connected", the dot stays off and nothing offers ADD', async () => {
  const { geraeteZeilen } = await import('../public/register_view.js');
  const register = { echte_geraete: false, katalog: [
    { id: 'apc20', name: 'Akai APC20', weg: 'pult', midi: 'APC20', da: true, verbunden: false, eintraege: 29, rueckweg: 'LEDs', hinweis: '' },
    { id: 'lpd8', name: 'Akai LPD8', weg: 'lernen', midi: 'LPD8', da: true, verbunden: false, eintraege: 0, rueckweg: 'none', hinweis: '' },
    { id: 's8', name: 'Traktor Kontrol S8', weg: 'pult', midi: null, da: false, verbunden: false, eintraege: 49, rueckweg: 'x', hinweis: '' },
  ] };
  const geraete = { echte_geraete: false, controller: [{ platz: 2, port: LC3, name: 'LC3 1', da: true, gesperrt: true, verbunden: false }],
    quellen: { midi: [{ port: LPD8, alias: 'LPD8:MIDI 1', gesperrt: true }, { port: 'Midi-Bridge:Launchkey Mini MK4 25: MIDI In (capture)', alias: '', gesperrt: true }] } };
  const z = geraeteZeilen(register, geraete, null);
  assert.deepEqual(z.map((x) => [x.art, x.name, x.zustand, x.da]), [
    ['platz', 'LC3 1', 'present, not connected (test instance)', false],
    ['frei', 'Akai LPD8', 'present, not connected (test instance)', false],
    ['frei', 'Midi-Bridge:Launchkey Mini MK4 25: MIDI In (capture)', 'present, not connected (test instance)', false],
    ['katalog', 'Akai APC20', 'present, not connected (test instance)', false],
    ['katalog', 'Traktor Kontrol S8', 'not connected', false],
  ]);
  assert.deepEqual(z.filter((x) => x.art === 'frei').map((x) => x.gesperrt), [true, true], 'no ADD for them');
});

test('page rows: the production instance keeps its texts', async () => {
  const { geraeteZeilen } = await import('../public/register_view.js');
  const register = { echte_geraete: true, katalog: [{ id: 'apc20', name: 'Akai APC20', weg: 'pult', midi: 'APC20', da: true, verbunden: true, eintraege: 29, rueckweg: 'LEDs', hinweis: '' }] };
  const z = geraeteZeilen(register, { echte_geraete: true, controller: [], quellen: { midi: [{ port: LPD8, alias: 'LPD8' }] } }, null);
  assert.deepEqual(z.map((x) => [x.name, x.zustand, x.da]), [['LPD8', 'connected, no place yet', true], ['Akai APC20', 'connected', true]]);
});
