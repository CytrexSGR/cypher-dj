// I08 Gesamtreview Teil A (m4): GET /geraete meldet "verbunden" nur, solange der Kern lebt (letztes /zustand/ein jünger als die Frist).
// Nach Ausbleiben ist der Stand unbekannt (null), nicht der alte Wert. Direkt am Bereich, mit angehaltener Uhr, ohne Server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { geraeteBereich } from '../bereiche/geraete/bereich.ts';
import { GeraeteSpeicher, standard } from '../bereiche/geraete/speicher.ts';

const BESCHR = 'Family 17h/19h HD Audio Controller Analoges Stereo';
const ERK = { audio: [{ knoten: 'alsa_input.pci-0000_16_00.6.analog-stereo', beschreibung: BESCHR, zustand: 'suspended', kanaele: 2, ports: [`${BESCHR}:capture_FL`, `${BESCHR}:capture_FR`], usb: null }], midi: [] };

function antworte(b) {
  const get = b.routen().find((r) => r.methode === 'GET' && r.pfad === '/geraete');
  return new Promise((ok) => {
    const a = { writeHead() {}, end: (t) => ok(JSON.parse(t)) };
    get.handler({}, a);
  });
}

test('geraete: verbunden hängt am Lebenszeichen des Kerns, nach 2 s ohne /zustand/ein ist es unbekannt (null)', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-gl-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const konfigPfad = path.join(d, 'geraete.json');
  const k0 = standard();
  k0.eingaenge[0].profil = 'pc-eingang';
  k0.eingaenge[0].audio = { knoten: 'alsa_input.pci-0000_16_00.6.analog-stereo', ports: ERK.audio[0].ports };
  new GeraeteSpeicher(konfigPfad).schreibe(k0);
  let jetzt = 1_000_000;
  const b = geraeteBereich({ log() {}, quelle: () => 'andreas' }, { konfigPfad, kantenPfad: path.join(d, 'kanten'), erkenne: async () => ERK, cacheMs: 0, jetzt: () => jetzt });

  const nie = await antworte(b);
  assert.deepEqual([nie.eingaenge[0].verbunden, nie.midi.verbunden, nie.kern.ein], [null, null, null], 'noch nie ein Lebenszeichen: unbekannt, nicht "nicht verbunden"');

  b.ereignis('/zustand/ein', { verbunden: 1 | 256, midi_gesehen: 3 });
  const lebt = await antworte(b);
  assert.deepEqual([lebt.eingaenge[0].verbunden, lebt.eingaenge[1].verbunden, lebt.midi.verbunden], [true, false, true], 'Positiv-Kontrolle: frisches Lebenszeichen, Maske gilt');

  jetzt += 1900;
  assert.equal((await antworte(b)).eingaenge[0].verbunden, true, 'knapp innerhalb der Frist');
  jetzt += 200;   // 2100 ms seit dem letzten Lebenszeichen
  const still = await antworte(b);
  assert.deepEqual([still.eingaenge[0].verbunden, still.eingaenge[1].verbunden, still.midi.verbunden, still.kern.ein], [null, null, null, null], 'Kern still: die alte Maske wird nicht weitergemeldet');

  b.ereignis('/zustand/ein', { verbunden: 0 });
  assert.equal((await antworte(b)).eingaenge[0].verbunden, false, 'Kern wieder da: Maske gilt wieder');
});
