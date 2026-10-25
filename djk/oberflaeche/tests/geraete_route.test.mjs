// I08 Task 9: Routen /geraete im echten Server. Eigene Erkennung (kein pw-dump), eigene Pfade (nie ~/.config oder /dev/shm der Instanz).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf, CYPHER } from './hilfen/proj_stapel.mjs';

const PC = 'alsa_input.pci-0000_16_00.6.analog-stereo';
const BESCHR = 'Family 17h/19h HD Audio Controller Analoges Stereo';   // Gesamtreview B1: Ports in der Form des Kerns unter pw-jack (node.description), nicht node.name
const ERK = { audio: [{ knoten: PC, beschreibung: BESCHR, zustand: 'suspended', kanaele: 2, ports: [`${BESCHR}:capture_FL`, `${BESCHR}:capture_FR`], usb: null }], midi: [] };

test('geraete: GET zeigt vier leere Eingänge, POST ordnet zu und schreibt Datei und Kanten, Cypher bekommt 403, Hotplug ändert die Datei nicht', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-gr-route-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  let erk = { audio: [], midi: [] };
  const konfigPfad = path.join(d, 'geraete.json'), kantenPfad = path.join(d, 'eingaenge-kanten');
  const { url } = await stapel(t, { geraete: { konfigPfad, kantenPfad, cacheMs: 0, erkenne: async () => erk } });
  const g0 = await ruf(url, 'GET', '/geraete');
  assert.equal(g0.code, 200);
  assert.deepEqual([g0.j.erkennung, g0.j.eingaenge.length, g0.j.eingaenge.every((e) => e.profil === null && e.frei_fuer_cypher === false)], ['ok', 4, true]);
  assert.deepEqual(g0.j.profile.map((p) => p.id), ['pc-eingang', 'xdj-xz']);
  assert.ok(!fs.existsSync(konfigPfad) && !fs.existsSync(kantenPfad), 'Lesen schreibt nichts');
  // Gerät nicht da: Zuordnung wird mit 409 abgelehnt, nichts geschrieben
  const nein = await ruf(url, 'POST', '/geraete/eingang', { k: 1, profil: 'pc-eingang' });
  assert.deepEqual([nein.code, nein.j.fehler], [409, 'geraet_nicht_da']);
  assert.ok(!fs.existsSync(konfigPfad));
  erk = ERK;
  const cy = await ruf(url, 'POST', '/geraete/eingang', { k: 1, profil: 'pc-eingang' }, CYPHER);
  assert.deepEqual([cy.code, cy.j.fehler], [403, 'nur_andreas']);
  assert.ok(!fs.existsSync(konfigPfad), 'Cyphers Versuch ändert nichts');
  const ja = await ruf(url, 'POST', '/geraete/eingang', { k: 1, profil: 'pc-eingang' });
  assert.equal(ja.code, 200);
  assert.equal(ja.j.eingaenge[0].profil, 'pc-eingang');
  assert.deepEqual([ja.j.eingaenge[0].da, ja.j.eingaenge[0].frei_fuer_cypher], [true, false]);
  assert.equal(JSON.parse(fs.readFileSync(konfigPfad, 'utf8')).eingaenge[0].audio.knoten, PC);
  const kante = fs.readFileSync(kantenPfad, 'utf8');
  assert.equal(kante, `${BESCHR}:capture_FL\tein_1_L\n${BESCHR}:capture_FR\tein_1_R\n`);
  // Hotplug: das Gerät verschwindet; GET sagt da:false, die Kanten-Datei bleibt (der Verbinder des Kerns holt die Kante nach, sobald es wiederkommt)
  erk = { audio: [], midi: [] };
  const weg = await ruf(url, 'GET', '/geraete');
  assert.equal(weg.j.eingaenge[0].da, false);
  assert.equal(fs.readFileSync(kantenPfad, 'utf8'), kante);
  // Freigabe: Cypher nein, Andreas ja, und sie hängt am Eingang
  assert.equal((await ruf(url, 'POST', '/geraete/eingang', { k: 1, frei_fuer_cypher: true }, CYPHER)).j.fehler, 'freigabe_nur_andreas');
  const frei = await ruf(url, 'POST', '/geraete/eingang', { k: 1, frei_fuer_cypher: true });
  assert.equal(frei.j.eingaenge[0].frei_fuer_cypher, true);
});

test('geraete: Körper kaputt = 400, fremde Herkunft = 403, Erkennung ausgefallen = 200 mit erkennung nicht_verfuegbar', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-gr-route2-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const { url } = await stapel(t, { geraete: { konfigPfad: path.join(d, 'g.json'), kantenPfad: path.join(d, 'k'), cacheMs: 0, erkenne: async () => { throw new Error('pw-dump fehlt'); } } });
  const kopf = { 'content-type': 'application/json' };
  const kaputt = await fetch(`${url}/geraete/eingang`, { method: 'POST', headers: kopf, body: '{"k":' });
  assert.deepEqual([kaputt.status, (await kaputt.json()).fehler], [400, 'json']);
  const fremd = await fetch(`${url}/geraete/eingang`, { method: 'POST', headers: { ...kopf, origin: 'https://boese.example' }, body: '{}' });
  assert.deepEqual([fremd.status, (await fremd.json()).fehler], [403, 'fremde_herkunft']);
  const g = await ruf(url, 'GET', '/geraete');
  assert.deepEqual([g.code, g.j.erkennung, g.j.quellen], [200, 'nicht_verfuegbar', { audio: [], midi: [] }]);
});

test('geraete: POST /geraete/latenz über HTTP - Cypher kabel = 403 und nichts geschrieben, Cypher software = 200, Andreas kabel = 200 mit Zeitpunkt vom Server in der Datei', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-gr-lat-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const konfigPfad = path.join(d, 'geraete.json');
  const { url } = await stapel(t, { geraete: { konfigPfad, kantenPfad: path.join(d, 'k'), cacheMs: 0, erkenne: async () => ERK } });
  const m = { k: 1, samples: 480, streuung: 1.5, min: 478, max: 483, laeufe: 20, quantum: 256, rate: 48000, art: 'kabel' };
  assert.equal((await ruf(url, 'POST', '/geraete/eingang', { k: 1, profil: 'pc-eingang' })).code, 200);
  const vor = fs.readFileSync(konfigPfad, 'utf8');
  const cy = await ruf(url, 'POST', '/geraete/latenz', m, CYPHER);
  assert.deepEqual([cy.code, cy.j.fehler], [403, 'latenz_nur_andreas']);
  assert.equal(fs.readFileSync(konfigPfad, 'utf8'), vor, 'abgelehnt: Datei unverändert');
  const sw = await ruf(url, 'POST', '/geraete/latenz', { ...m, art: 'software' }, CYPHER);
  assert.deepEqual([sw.code, sw.j.eingaenge[0].latenz.art], [200, 'software']);
  const an = await ruf(url, 'POST', '/geraete/latenz', { ...m, gemessen_am: '1999-01-01T00:00:00.000Z' });
  assert.equal(an.code, 200);
  const l = JSON.parse(fs.readFileSync(konfigPfad, 'utf8')).eingaenge[0].latenz;
  assert.deepEqual([l.art, l.samples], ['kabel', 480]);
  assert.ok(l.gemessen_am > '2026-', 'Zeitpunkt vom Server, nicht vom Client');
});
