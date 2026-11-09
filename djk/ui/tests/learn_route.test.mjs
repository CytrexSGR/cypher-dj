// S19 (MIDI learn): routes /lernen in the real server with the kern stand-in. Own geraete.json and controller folder in the test's temp
// folder, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, CYPHER, anKern } from './support/proj_stack.mjs';

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
  assert.deepEqual(g.j, { zuordnungen: [], wartet: null, midi: { port: null }, datei: 'fehlt' });
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
  for (const pfad of ['erz/4/bk/1', 'erz/5/fader', 'erz/5/bk/9', 7, undefined]) {
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
  assert.deepEqual([g.j.datei, g.j.zuordnungen, g.j.midi.port], ['ok', [{ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 }], 'X:Y']);
  fs.writeFileSync(path.join(ordner, 'lernen.json'), '{"version":1,');
  const k = await ruf(url, 'GET', '/lernen');
  assert.equal(k.j.datei, 'kaputt');
  const r = await ruf(url, 'POST', '/lernen', { pfad: 'erz/5/bk/3' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'lernen_datei_kaputt']);
  assert.equal(fs.readFileSync(path.join(ordner, 'lernen.json'), 'utf8'), '{"version":1,', 'untouched');
});
