// Strand 11 slice 7 (7.7): POST /aufbau, stored session setups outside any project (setup.ts). Real in-process page server (core is a log, clock set
// by hand), the setup folder of the test instance under its shm folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz, TEST_INSTANZ } from './support/instance.mjs';
import { aufbauOrdnerVorgabe } from '../paths.ts';
import { aufbauZumLaden, pruefeAufbau } from '../setup.ts';

belegeTestInstanz();
const CYPHER = { 'x-djk-quelle': 'cypher' };
const ORDNER = aufbauOrdnerVorgabe(TEST_INSTANZ);
const raeumen = () => fs.rmSync(ORDNER, { recursive: true, force: true });

test('the setup folder of a test instance is its shm folder, the live studio keeps ~/.config/cypherdj/aufbau', () => {
  assert.equal(ORDNER, `/dev/shm/cypherdj-${TEST_INSTANZ}/aufbau`);
  assert.ok(aufbauOrdnerVorgabe('').endsWith(path.join('.config', 'cypherdj', 'aufbau')));
});

test('aufbauZumLaden: the block faders leave the scene rows and become moves, the block graphs win over the scene graphs', () => {
  const a = { v: 1, geschrieben: 'x', aufbau: { bpm: 130, kanaele: { 'deck/1': -6 }, graphen: { 'erz/5': 'acid' }, live_oeffnen: true },
    szene: { v: 1, takt: 1, muster: {}, regler: { 'deck/1/fader': -12, 'pad/1/fader': -3, 'deck/1/trim': 1 }, graphen: { 'erz/5': 'alt', 'fx/3': 'g' } } };
  assert.ok(pruefeAufbau(a));
  assert.ok(!pruefeAufbau({ ...a, aufbau: { ...a.aufbau, kanaele: { 'deck/3': 0 } } }), 'only the four container strips');
  const { szene, kanaele } = aufbauZumLaden(a);
  assert.deepEqual(szene.regler, { 'deck/1/trim': 1 });
  assert.deepEqual(szene.graphen, { 'erz/5': 'acid', 'fx/3': 'g' });
  assert.deepEqual(kanaele, [{ kanal: 'deck/1', pfad: 'deck/1/fader', nach: -6 }, { kanal: 'pad/1', pfad: 'pad/1/fader', nach: -3 }]);
});

test('aufbau: sichern and zeige round-trip; after a core restart (faders at -200) laden ramps the faders open over 2 bars and sets the tempo; a track place keeps its hearing check; '
  + 'loeschen keeps the file in papierkorb', async (t) => {
  raeumen();
  t.after(raeumen);
  const s = await echterServer(t, 'auf', 9);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };   // bar 5
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  assert.equal((await s.post('/strudel', { strom: 2, text: 'note("c2")' })).code, 200);
  Object.assign(s.o.stand.regler, { 'deck/1/fader': -4, 'deck/2/fader': -8, 'pad/1/fader': 0, 'pad/2/fader': -2, 'master/pegel': -3 });
  let r = await s.post('/aufbau', { aktion: 'sichern', name: 'techno' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.kanaele, { 'deck/1': -4, 'deck/2': -8, 'pad/1': 0, 'pad/2': -2 });
  assert.equal(r.j.bpm, 128);
  const datei = path.join(ORDNER, 'techno.json');
  assert.equal(fs.statSync(datei).mode & 0o777, 0o600, 'file mode 0600');
  r = await s.post('/aufbau', { aktion: 'sichern', name: 'techno' }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'aufbau_vorhanden']);
  assert.equal((await s.post('/aufbau', { aktion: 'ersetzen', name: 'techno' }, CYPHER)).code, 200, 'ersetzen replaces');
  const zeige = (await s.post('/aufbau', { aktion: 'zeige', name: 'techno' }, { ...CYPHER, 'x-djk-aktion': 'zeige' })).j.aufbau;
  assert.deepEqual(zeige.aufbau, { bpm: 128, kanaele: { 'deck/1': -4, 'deck/2': -8, 'pad/1': 0, 'pad/2': -2 }, graphen: {}, live_oeffnen: true });
  assert.equal(zeige.szene.muster['2'], 'note("c2")');
  assert.equal(zeige.szene.v, 1);
  assert.deepEqual((await s.post('/aufbau', { aktion: 'liste' }, CYPHER)).j.aufbauten.map((x) => [x.name, x.bpm]), [['techno', 128]]);
  assert.deepEqual([(await s.post('/aufbau', { aktion: 'zeige', name: 'Böse' })).code], [400]);
  assert.deepEqual((await s.post('/aufbau', { aktion: 'laden', name: 'fehlt' }, CYPHER)).j.fehler, 'aufbau_unbekannt');

  // the restart trap: the core forgot the faders (-200), the tempo is another one; laden opens them as 2-bar ramps from the stored values.
  // The places are free containers (containerFrei: loops, stems, strudel, leer); a track place keeps its hearing check (below).
  const plaetze = s.projekt().plaetze;
  const altPlaetze = structuredClone(plaetze);
  plaetze[0] = { typ: 'loops', gruppe: 'g-test' }; plaetze[1] = { typ: 'stems', gruppe: 'g-test' }; plaetze[3] = { typ: 'leer' };
  assert.equal(plaetze[2].typ, 'strudel');
  Object.assign(s.o.stand.regler, { 'deck/1/fader': -200, 'deck/2/fader': -200, 'pad/1/fader': -200, 'pad/2/fader': -200, 'master/pegel': -20 });
  s.o.kern.uhr = { beat: 40, bpm: 120, mono_ns: 0 };   // bar 11
  s.log.length = 0;
  r = await s.post('/aufbau', { aktion: 'laden', name: 'techno' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.live_geoeffnet, false);
  assert.equal(r.j.bpm, 128);
  assert.deepEqual(r.j.kanaele.map((k) => [k.kanal, k.nach, k.takte]), [['deck/1', -4, 2], ['deck/2', -8, 2], ['pad/1', 0, 2], ['pad/2', -2, 2]], JSON.stringify(r.j.ausgelassen));
  assert.ok(!r.j.ausgelassen.some((x) => x.grund === 'nur_rampe' || x.grund === 'kein_hoerschein'), JSON.stringify(r.j.ausgelassen));
  assert.ok(r.j.ausgelassen.length === 0, JSON.stringify(r.j.ausgelassen));
  assert.ok(r.j.regler.includes('master/pegel'), 'the master raise of 17 dB ramps instead of nur_rampe: ' + JSON.stringify(r.j));
  const an = (adr) => s.log.filter((z) => z.typ === 'an_kern' && z.adresse === adr);
  const fader = an('/k/teil').find((z) => z.felder?.pfad === 'deck/1/fader');
  assert.ok(fader, JSON.stringify(an('/k/teil').map((z) => z.felder?.pfad)));
  assert.deepEqual([fader.felder.nach, fader.felder.dauer_beats, fader.felder.quelle], [-4, 8, 'cypher']);
  assert.ok(fader.felder.ab_beat > 40, 'from the next bar');
  const tempo = an('/k/tempo/rampe');
  assert.equal(tempo.length, 1);
  assert.equal(tempo[0].felder.bpm ?? tempo[0].felder.nach ?? tempo[0].felder.ziel_bpm, 128, JSON.stringify(tempo[0].felder));
  assert.ok(s.o.spuren.get('szene-techno'), 'the scene track runs');
  const projOrdner = s.o.proj.zugang.offen().ordner;
  assert.ok(fs.existsSync(path.join(projOrdner, 'szenen', '_vor_laden.json')), 'the scene restore saved _vor_laden in the live project');
  assert.ok(!fs.existsSync(path.join(projOrdner, 'szenen', 'techno.json')), 'the setup is not a scene of the project');

  // a track place: its strip still needs a valid hearing check (Ohr); the setup lists it as left out and restores the rest
  plaetze[0] = altPlaetze[0].typ === 'track' ? altPlaetze[0] : { typ: 'track' };
  s.o.stand.regler['deck/1/fader'] = -200;
  r = await s.post('/aufbau', { aktion: 'laden', name: 'techno' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.ok(r.j.ausgelassen.some((x) => x.ziel === 'deck/1/fader' && x.grund === 'kein_hoerschein'), JSON.stringify(r.j.ausgelassen));
  assert.ok(!r.j.kanaele.some((k) => k.kanal === 'deck/1'));

  // Stop Cypher holds laden
  s.o.handBremse = true;
  assert.deepEqual((await s.post('/aufbau', { aktion: 'laden', name: 'techno' }, CYPHER)).j.fehler, 'ki_gestoppt');
  s.o.handBremse = false;

  // loeschen moves the file to papierkorb/
  assert.equal((await s.post('/aufbau', { aktion: 'loeschen', name: 'techno' }, CYPHER)).code, 200);
  assert.ok(!fs.existsSync(datei));
  assert.ok(fs.existsSync(path.join(ORDNER, 'papierkorb', 'techno.json')));
  assert.deepEqual((await s.post('/aufbau', { aktion: 'liste' }, CYPHER)).j.aufbauten, []);
});

test('aufbau laden opens the live container first when no project is open', async (t) => {
  raeumen();
  t.after(raeumen);
  const s = await echterServer(t, 'auf2', 10);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };
  const szene = { v: 1, geschrieben: 'x', takt: 5, bpm: 128, muster: {}, regler: {}, graphen: {}, fx: [null, null], fx_zuweisung: [{}, {}, {}],
    fx_routing: 'post_fader', klang: {}, spuren: [], info: { plaetze: null, decks: null } };
  fs.mkdirSync(ORDNER, { recursive: true });
  fs.writeFileSync(path.join(ORDNER, 'leer.json'), JSON.stringify({ v: 1, geschrieben: 'x', aufbau: { bpm: 128, kanaele: { 'pad/1': -6 }, graphen: {}, live_oeffnen: true }, szene }));
  assert.ok(!s.o.proj.zugang.offen(), 'no project open');
  const r = await s.post('/aufbau', { aktion: 'laden', name: 'leer' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.live_geoeffnet, true);
  assert.equal(s.o.proj.zugang.offen()?.projekt.live, true);
  assert.equal(r.j.bpm, null, 'the tempo already matches: no ramp');
  assert.deepEqual(r.j.kanaele.map((k) => [k.kanal, k.nach, k.takte]), [['pad/1', -6, 2]]);
});

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 4000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };

test('B7: a container fader at or below -90 dB is not stored and is listed under warnung; a later laden leaves it alone', async (t) => {
  raeumen();
  t.after(raeumen);
  const s = await echterServer(t, 'auf3', 11);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  Object.assign(s.o.stand.regler, { 'deck/1/fader': -4, 'deck/2/fader': -200, 'pad/1/fader': -90, 'pad/2/fader': -2 });
  const r = await s.post('/aufbau', { aktion: 'sichern', name: 'zu' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.kanaele, { 'deck/1': -4, 'pad/2': -2 });
  assert.deepEqual(r.j.warnung, [{ kanal: 'deck/2', grund: 'geschlossen_nicht_gesichert' }, { kanal: 'pad/1', grund: 'geschlossen_nicht_gesichert' }]);
  const gespeichert = JSON.parse(fs.readFileSync(path.join(ORDNER, 'zu.json'), 'utf8'));
  assert.deepEqual(gespeichert.aufbau.kanaele, { 'deck/1': -4, 'pad/2': -2 });
  // the scene's own regler rows hold the -200 too: they are never sent as a fader move
  const { kanaele } = aufbauZumLaden(gespeichert);
  assert.deepEqual(kanaele.map((k) => k.kanal), ['deck/1', 'pad/2']);
  // nothing closed: no warnung field
  Object.assign(s.o.stand.regler, { 'deck/2/fader': -8, 'pad/1/fader': 0 });
  assert.equal((await s.post('/aufbau', { aktion: 'ersetzen', name: 'zu' }, CYPHER)).j.warnung, undefined);
});

test('B8: aufbau laden stops Cypher arcs and szene-* tracks first; the stream label is stored with the pattern and restored', { timeout: 60000 }, async (t) => {
  raeumen();
  t.after(raeumen);
  const s = await echterServer(t, 'auf4', 12);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  fs.mkdirSync(`${s.muster}1`, { recursive: true });
  assert.equal((await s.post('/strudel', { strom: 1, text: 's("bd*4")', bezeichnung: 'kick line' })).code, 200);
  let r = await s.post('/aufbau', { aktion: 'sichern', name: 'bz' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const gespeichert = JSON.parse(fs.readFileSync(path.join(ORDNER, 'bz.json'), 'utf8'));
  assert.deepEqual(gespeichert.szene.bezeichnung, { 1: 'kick line' });
  // the stream changes (other pattern, other label), and a Cypher arc and a leftover scene track run
  assert.equal((await s.post('/strudel', { strom: 1, text: 's("hh*8")', bezeichnung: 'hats' })).code, 200);
  r = await s.post('/bogen', { name: 'bg', takte: 8, schichten: [{ strom: 1, muster: 's("cp")', ab_takt: 1, name: 'clap' }], anker_takt: 10 }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  r = await s.post('/spur', { spur: { name: 'szene-alt', fahrten: [{ ziel: 'erz/1/fader', ab_takt: 2, takte: 2, nach: -6 }] }, anker_takt: 10 }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const namen = async () => (await (await fetch(`${s.url}/spur`)).json()).map((x) => x.name);
  assert.deepEqual((await namen()).sort(), ['bg', 'szene-alt']);
  r = await s.post('/aufbau', { aktion: 'laden', name: 'bz' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const danach = await namen();
  assert.ok(!danach.includes('bg') && !danach.includes('szene-alt'), `still running: ${danach}`);
  // the restore writes the pattern together with its label when the core beat reaches the anchor
  s.o.kern.uhr = { beat: (r.j.anker_takt - 1) * 4 - 2, bpm: 128, mono_ns: 0 };
  const bezeichnung = async () => (await (await fetch(`${s.url}/strudel?strom=1`)).json()).bezeichnung;
  assert.ok(await bis(async () => (await bezeichnung()) === 'kick line'), `label is ${await bezeichnung()}`);
});
