// S19 (MIDI learn): routes /lernen in the real server with the kern stand-in. Own geraete.json and controller folder in the test's temp
// folder, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, CYPHER, anKern } from './support/proj_stack.mjs';
import { innen } from './support/inside.mjs';

async function aufbau(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-lernen-route-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const konfigPfad = path.join(d, 'geraete.json'), ordner = path.join(d, 'controller');
  const s = await stapel(t, { geraete: { konfigPfad, kantenPfad: path.join(d, 'kanten'), cacheMs: 0 }, lernen: { ordner, geraeteKonfig: konfigPfad } });
  return { ...s, d, ordner };
}

test('S19 route: GET /lernen on a fresh setup: no assignments, nothing waiting, no MIDI port, no file', async (t) => {
  const { url } = await aufbau(t);
  const g = await ruf(url, 'GET', '/lernen');
  assert.equal(g.code, 200);
  assert.deepEqual(g.j, { zuordnungen: [], wartet: null, midi: { port: null }, controller: [], datei: 'fehlt' });
});

test('S19 route: POST /lernen needs a MIDI input (409 kein_midi_eingang), arms with the generic profile, Cypher is 403, bad targets are 400, null cancels', async (t) => {
  const { url, log } = await aufbau(t);
  const ohne = await ruf(url, 'POST', '/lernen', { pfad: 'erz/5/bk/3' });
  assert.deepEqual([ohne.code, ohne.j.fehler], [409, 'kein_midi_eingang']);
  assert.equal(anKern(log, '/k/lernen').length, 0, 'nothing armed without a MIDI input');
  const zu = await ruf(url, 'POST', '/geraete/midi', { profil: 'midi-controller', port: 'X:Y' });
  assert.equal(zu.code, 200);
  const cy = await ruf(url, 'POST', '/lernen', { pfad: 'erz/5/bk/3' }, CYPHER);
  assert.deepEqual([cy.code, cy.j.fehler], [403, 'nur_andreas']);
  assert.equal(anKern(log, '/k/lernen').length, 0, 'Cypher arms nothing');
  for (const pfad of ['erz/4/bk/1', 'erz/5/bk/65', 'erz/5/bk/0', 'erz/5/bk/1x', 7, undefined]) {
    const r = await ruf(url, 'POST', '/lernen', { pfad });
    assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig'], String(pfad));
  }
  const ja = await ruf(url, 'POST', '/lernen', { pfad: 'erz/5/bk/3' });
  assert.equal(ja.code, 200);
  assert.equal(ja.j.wartet.pfad, 'erz/5/bk/3');
  assert.equal(anKern(log, '/k/lernen').filter((z) => z.felder.an === 1).length, 1, 'the kern was armed once');
  assert.equal((await ruf(url, 'GET', '/lernen')).j.wartet.pfad, 'erz/5/bk/3');
  const weg = await ruf(url, 'POST', '/lernen', { pfad: null });
  assert.equal(weg.code, 200);
  assert.equal(weg.j.wartet, null);
  assert.equal(anKern(log, '/k/lernen').filter((z) => z.felder.an === 0).length, 1, 'cancel disarms the kern');
  // any continuous target of the control table can be armed
  for (const pfad of ['deck/1/fader', 'master/pegel', 'deck/1/eq/tief', 'xfader', 'erz/5/fader']) assert.equal((await ruf(url, 'POST', '/lernen', { pfad })).code, 200, pfad);
  // switches and paths that are no knob are refused with a reason, nothing is armed
  const vorher = anKern(log, '/k/lernen').filter((z) => z.felder.an === 1).length;
  for (const pfad of ['deck/1/kill/tief', 'deck/1/pfl', 'deck/1/play', 'deck/1/hotcue/1', 'deck/9/fader']) {
    const r = await ruf(url, 'POST', '/lernen', { pfad });
    assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig'], pfad);
  }
  // a delete knows the same targets as a direct assignment (a switch or a deck action can be learned from a tile), so only a non-target is a 400 there
  for (const pfad of ['deck/1/hotcue/1', 'deck/9/fader']) {
    const l = await ruf(url, 'POST', '/lernen/loeschen', { pfad });
    assert.deepEqual([l.code, l.j.fehler], [400, 'argument_ungueltig'], `delete ${pfad}`);
  }
  for (const pfad of ['deck/1/kill/tief', 'deck/1/pfl', 'deck/1/play']) {
    const l = await ruf(url, 'POST', '/lernen/loeschen', { pfad });
    assert.deepEqual([l.code, l.j.fehler], [404, 'keine_zuordnung'], `delete ${pfad} without an entry`);
  }
  assert.equal((await ruf(url, 'POST', '/lernen', { pfad: 'deck/1/kill/tief' })).j.text, 'pfad: a switch needs a button; only knobs can be learned (notes are not learnable yet)');
  assert.equal(anKern(log, '/k/lernen').filter((z) => z.felder.an === 1).length, vorher, 'nothing was armed by the refused paths');
  // 64 knobs: knobs 9, 32, 33 and 64 can be armed
  for (const pfad of ['erz/5/bk/9', 'deck/1/bk/32', 'erz/5/bk/33', 'erz/5/bk/64']) assert.equal((await ruf(url, 'POST', '/lernen', { pfad })).code, 200, pfad);
});

test('S19 route: POST /lernen/loeschen without an entry is 404 keine_zuordnung; Cypher is 403', async (t) => {
  const { url } = await aufbau(t);
  const r = await ruf(url, 'POST', '/lernen/loeschen', { pfad: 'deck/1/bk/2' });
  assert.deepEqual([r.code, r.j.fehler], [404, 'keine_zuordnung']);
  const cy = await ruf(url, 'POST', '/lernen/loeschen', { pfad: 'deck/1/bk/2' }, CYPHER);
  assert.deepEqual([cy.code, cy.j.fehler], [403, 'nur_andreas']);
});

test('S19 route: an existing file shows in GET; a broken file is reported (datei kaputt) and refuses to arm with 409 lernen_datei_kaputt', async (t) => {
  const { url, ordner } = await aufbau(t);
  await ruf(url, 'POST', '/geraete/midi', { profil: 'midi-controller', port: 'X:Y' });
  fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(path.join(ordner, 'lernen.json'), '{"version":1,"geraet":"lernen","quelle_port":"midi_ein_1","eintraege":[\n {"nachricht":{"typ":"cc","kanal":1,"nr":74},"ziel":"erz/5/bk/3","art":"absolut"}\n]}\n');
  const g = await ruf(url, 'GET', '/lernen');
  assert.deepEqual([g.j.datei, g.j.zuordnungen, g.j.midi.port], ['ok', [{ pfad: 'erz/5/bk/3', kanal: 1, nr: 74, platz: 1, name: 'erz/5/bk/3' }], 'X:Y']);
  fs.writeFileSync(path.join(ordner, 'lernen.json'), '{"version":1,');
  const k = await ruf(url, 'GET', '/lernen');
  assert.equal(k.j.datei, 'kaputt');
  const r = await ruf(url, 'POST', '/lernen', { pfad: 'erz/5/bk/3' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'lernen_datei_kaputt']);
  assert.equal(fs.readFileSync(path.join(ordner, 'lernen.json'), 'utf8'), '{"version":1,', 'untouched');
});

test('learn any target: after the kern reports the captured CC the entry is stored and GET /lernen lists it', async (t) => {
  const { o, url, log, ordner } = await aufbau(t);
  await ruf(url, 'POST', '/geraete/midi', { profil: 'midi-controller', port: 'X:Y' });
  assert.equal((await ruf(url, 'POST', '/lernen', { pfad: 'deck/1/fader' })).code, 200);
  const arm = anKern(log, '/k/lernen').filter((z) => z.felder.an === 1).at(-1);
  innen(o).vomKern('/e/gelernt', { id: arm.felder.id, quelle: 1, kanal: 2, nr: 21, wert: 64, belegt: 0 });
  let g;
  for (let i = 0; i < 100; i++) { g = (await ruf(url, 'GET', '/lernen')).j; if (g.zuordnungen.length) break; await new Promise((r) => setTimeout(r, 20)); }
  assert.deepEqual(g.zuordnungen, [{ pfad: 'deck/1/fader', kanal: 2, nr: 21, platz: 1, name: 'deck/1/fader' }]);
  const datei = JSON.parse(fs.readFileSync(path.join(ordner, 'lernen.json'), 'utf8'));
  assert.deepEqual(datei.eintraege, [{ nachricht: { typ: 'cc', kanal: 2, nr: 21 }, ziel: 'deck/1/fader', art: 'absolut' }]);
});

test('POST /lernen/setzen assigns a CC to a target without a capture: validated like POST /lernen, same file and kern reload, Cypher is 403', async (t) => {
  const { url, log, ordner } = await aufbau(t);
  const sende = (d, kopf) => ruf(url, 'POST', '/lernen/setzen', d, kopf);
  const ohne = await sende({ pfad: 'deck/1/filter', platz: 1, kanal: 16, nr: 13 });
  assert.deepEqual([ohne.code, ohne.j.fehler], [409, 'kein_midi_eingang']);
  await ruf(url, 'POST', '/geraete/midi', { profil: 'midi-controller', port: 'X:Y' });
  const cy = await sende({ pfad: 'deck/1/filter', platz: 1, kanal: 16, nr: 13 }, CYPHER);
  assert.deepEqual([cy.code, cy.j.fehler], [403, 'nur_andreas']);
  for (const d of [{ pfad: 'deck/1/hotcue/1', platz: 1, kanal: 1, nr: 1 }, { pfad: 'erz/4/bk/1', platz: 1, kanal: 1, nr: 1 }, { pfad: 'deck/1/filter', platz: 1, kanal: 1, nr: 1, typ: 'note' },
    { pfad: 'deck/1/pfl', platz: 1, kanal: 1, nr: 1, typ: 'sysex' }, { pfad: 'deck/1/pfl', platz: 1, kanal: 1, nr: 1, typ: null }, { pfad: 'deck/1/filter', platz: 1, kanal: 0, nr: 1 },
    { pfad: 'deck/1/filter', platz: 1, kanal: 17, nr: 1 }, { pfad: 'deck/1/filter', platz: 1, kanal: 1, nr: 128 }, { pfad: 'deck/1/filter', platz: 1, kanal: 1.5, nr: 1 },
    { pfad: 'deck/1/filter', platz: 1, kanal: '1', nr: 1 }, { pfad: 'deck/1/filter', platz: 0, kanal: 1, nr: 1 }, { pfad: 'deck/1/filter', platz: 9, kanal: 1, nr: 1 },
    { pfad: 'deck/1/filter', platz: 3, kanal: 1, nr: 1 }, { pfad: 'deck/1/filter', kanal: 1, nr: 1 }]) {
    const r = await sende(d);
    assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig'], JSON.stringify(d));
  }
  assert.equal(anKern(log, '/k/mapping').length, 0, 'nothing reached the kern');
  assert.equal(fs.existsSync(path.join(ordner, 'lernen.json')), false, 'nothing was written');
  const ja = await sende({ pfad: 'deck/1/filter', platz: 1, kanal: 16, nr: 13 });
  assert.equal(ja.code, 200);
  assert.deepEqual(ja.j.zuordnungen, [{ pfad: 'deck/1/filter', kanal: 16, nr: 13, platz: 1, name: 'deck/1/filter' }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ordner, 'lernen.json'), 'utf8')).eintraege, [{ nachricht: { typ: 'cc', kanal: 16, nr: 13 }, ziel: 'deck/1/filter', art: 'absolut' }]);
  assert.deepEqual(anKern(log, '/k/mapping').map((z) => z.felder.geraet), ['lernen'], 'the kern reloads the table of the place');
  // the same target on another CC moves it; the same CC on another target replaces the first
  const um = await sende({ pfad: 'deck/1/filter', platz: 1, kanal: 16, nr: 14 });
  assert.deepEqual(um.j.zuordnungen.map((z) => [z.pfad, z.nr]), [['deck/1/filter', 14]]);
  const ersatz = await sende({ pfad: 'deck/2/filter', platz: 1, kanal: 16, nr: 14 });
  assert.deepEqual(ersatz.j.zuordnungen.map((z) => [z.pfad, z.nr]), [['deck/2/filter', 14]]);
  // a broken file is refused and left alone
  fs.writeFileSync(path.join(ordner, 'lernen.json'), '{"version":1,');
  const kaputt = await sende({ pfad: 'deck/1/filter', platz: 1, kanal: 16, nr: 13 });
  assert.deepEqual([kaputt.code, kaputt.j.fehler], [409, 'lernen_datei_kaputt']);
  assert.equal(fs.readFileSync(path.join(ordner, 'lernen.json'), 'utf8'), '{"version":1,');
});

test('POST /lernen/setzen: a switch or a deck action takes a button (CC) or a pad (note) with art taste, the server picks the art, a continuous target refuses a note', async (t) => {
  const { url, log, ordner } = await aufbau(t);
  const sende = (d) => ruf(url, 'POST', '/lernen/setzen', d);
  await ruf(url, 'POST', '/geraete/midi', { profil: 'midi-controller', port: 'X:Y' });
  const datei = () => JSON.parse(fs.readFileSync(path.join(ordner, 'lernen.json'), 'utf8')).eintraege;
  // a pad (note) drives a switch and a deck action
  const pfl = await sende({ pfad: 'deck/1/pfl', platz: 1, kanal: 1, nr: 36, typ: 'note' });
  assert.equal(pfl.code, 200);
  assert.deepEqual(datei(), [{ nachricht: { typ: 'note', kanal: 1, nr: 36 }, ziel: 'deck/1/pfl', art: 'taste' }]);
  assert.deepEqual(pfl.j.zuordnungen, [{ pfad: 'deck/1/pfl', kanal: 1, nr: 36, platz: 1, typ: 'note', art: 'taste', name: 'deck/1/pfl' }], 'typ and art are listed for a pad');
  assert.equal((await sende({ pfad: 'deck/2/play', platz: 1, kanal: 1, nr: 37, typ: 'note' })).code, 200);
  // a button (CC) drives them too, also without a typ in the body; a CC knob keeps art absolut
  const kill = await sende({ pfad: 'deck/1/kill/tief', platz: 1, kanal: 16, nr: 37 });
  assert.equal(kill.code, 200);
  assert.deepEqual(datei().find((e) => e.ziel === 'deck/1/kill/tief'), { nachricht: { typ: 'cc', kanal: 16, nr: 37 }, ziel: 'deck/1/kill/tief', art: 'taste' });
  assert.deepEqual(kill.j.zuordnungen.find((z) => z.pfad === 'deck/1/kill/tief'), { pfad: 'deck/1/kill/tief', kanal: 16, nr: 37, platz: 1, art: 'taste', name: 'deck/1/kill/tief' });
  await sende({ pfad: 'deck/1/cue', platz: 1, kanal: 16, nr: 38, typ: 'cc' });
  await sende({ pfad: 'deck/1/filter', platz: 1, kanal: 16, nr: 13 });
  assert.deepEqual(datei().filter((e) => e.nachricht.nr >= 13 && e.nachricht.kanal === 16).map((e) => [e.ziel, e.art]), [['deck/1/kill/tief', 'taste'], ['deck/1/cue', 'taste'], ['deck/1/filter', 'absolut']]);
  // a note on a continuous target is refused with a readable text, nothing is written
  const n = datei().length, mapping = anKern(log, '/k/mapping').length;
  const nein = await sende({ pfad: 'deck/1/fader', platz: 1, kanal: 1, nr: 40, typ: 'note' });
  assert.deepEqual([nein.code, nein.j.fehler], [400, 'argument_ungueltig']);
  assert.match(nein.j.text, /a note has no value for a continuous target/);
  assert.equal(datei().length, n);
  assert.equal(anKern(log, '/k/mapping').length, mapping, 'nothing reached the kern');
  // one source drives one target: the same pad on another target replaces the first; the same target on another pad moves it
  await sende({ pfad: 'deck/3/pfl', platz: 1, kanal: 1, nr: 36, typ: 'note' });
  assert.deepEqual(datei().filter((e) => e.nachricht.typ === 'note').map((e) => [e.nachricht.nr, e.ziel]), [[37, 'deck/2/play'], [36, 'deck/3/pfl']]);
  await sende({ pfad: 'deck/3/pfl', platz: 1, kanal: 1, nr: 39, typ: 'note' });
  assert.deepEqual(datei().filter((e) => e.nachricht.typ === 'note').map((e) => [e.nachricht.nr, e.ziel]), [[37, 'deck/2/play'], [39, 'deck/3/pfl']]);
  // a note and a CC with the same number are two sources
  await sende({ pfad: 'deck/4/play', platz: 1, kanal: 1, nr: 37 });
  assert.equal(datei().filter((e) => e.nachricht.nr === 37 && e.nachricht.kanal === 1).length, 2);
  // a learned switch is deleted like a learned knob
  const weg = await ruf(url, 'POST', '/lernen/loeschen', { pfad: 'deck/3/pfl' });
  assert.equal(weg.code, 200);
  assert.ok(!datei().some((e) => e.ziel === 'deck/3/pfl'));
});

test('POST /lernen (the capture) stays continuous and CC only: a switch or a deck action is refused with the knob text', async (t) => {
  const { url, log } = await aufbau(t);
  await ruf(url, 'POST', '/geraete/midi', { profil: 'midi-controller', port: 'X:Y' });
  for (const pfad of ['deck/1/pfl', 'deck/1/kill/tief', 'deck/1/play', 'deck/1/cue']) {
    const r = await ruf(url, 'POST', '/lernen', { pfad });
    assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig'], pfad);
  }
  assert.equal(anKern(log, '/k/lernen').length, 0, 'nothing was armed');
});
