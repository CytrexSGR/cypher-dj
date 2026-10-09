import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leseAusgang, WACHE_STUMM_S } from '../ausgang.ts';
import { ausgangAnzeige } from '../oeffentlich/meldungen.js';

const datei = (inhalt) => { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-ausgang-')), 'digitalout.json'); fs.writeFileSync(p, inhalt); return p; };
export const stand = (zustand, alterS, faelle = 0) => JSON.stringify({ version: 1, karte: 2, zustand, faelle,
  letzter: faelle ? { quelle: 'ereignis', erkannt_bis_an_ms: 12 } : null, lebenszeichen: new Date(Date.now() - alterS * 1000).toISOString() });

test('Glanz 2.1 F22: leseAusgang unterscheidet gut, aus, unbewacht und eine stumme Wache', () => {
  assert.equal(leseAusgang(undefined).zustand, 'unbewacht');
  assert.equal(leseAusgang('/nicht/da.json').zustand, 'unbewacht');
  assert.equal(leseAusgang(datei('{kaputt')).zustand, 'unbewacht');
  assert.equal(leseAusgang(datei('null')).zustand, 'unbewacht');      // gültiges JSON, aber kein Objekt
  assert.equal(leseAusgang(datei('5')).zustand, 'unbewacht');
  assert.deepEqual({ ...leseAusgang(datei(stand('gut', 0.5, 3))), alter_s: null },
    { zustand: 'gut', karte: 2, faelle: 3, letzter: { quelle: 'ereignis', erkannt_bis_an_ms: 12 }, alter_s: null });
  assert.equal(leseAusgang(datei(stand('aus', 0.5))).zustand, 'aus');
  assert.equal(leseAusgang(datei(stand('gut', WACHE_STUMM_S + 1))).zustand, 'wache_stumm');   // Fehlerfall: Wache steht
  assert.equal(leseAusgang(datei(stand('gut', WACHE_STUMM_S - 1))).zustand, 'gut');           // Negativ-Kontrolle
  assert.equal(leseAusgang(datei(stand('quatsch', 0.5))).zustand, 'unlesbar');
});

test('Glanz 2.1 F22: Punkt OUT grün nur bei gut, rot bei jedem Ausfall, Meldung nur bei neuem Fall', () => {
  const gut = { zustand: 'gut', karte: 2, faelle: 1, letzter: { quelle: 'ereignis', erkannt_bis_an_ms: 12 }, alter_s: 0.1 };
  assert.equal(ausgangAnzeige(gut, null).klasse, 'an');
  assert.equal(ausgangAnzeige(gut, null).meldung, null);             // erster Abruf: alter Fall, keine Meldung
  assert.equal(ausgangAnzeige(gut, 1).meldung, null);                // Negativ-Kontrolle: kein neuer Fall
  assert.match(ausgangAnzeige(gut, 0).meldung.text, /after 12 ms/);  // neuer Fall
  for (const z of ['aus', 'kampf', 'karte_fehlt', 'unlesbar', 'wache_stumm']) {
    const a = ausgangAnzeige({ zustand: z, karte: 2, faelle: 0, letzter: null, alter_s: 6 }, 0);
    assert.equal(a.klasse, 'alarm', z); assert.equal(a.meldung.dauerhaft, true, z);
  }
  assert.equal(ausgangAnzeige({ zustand: 'unbewacht', karte: null, faelle: 0, letzter: null, alter_s: null }, null).klasse, 'leer');
});
