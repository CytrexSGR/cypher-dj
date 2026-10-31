// Slice 4, T9: die Grenze MAX_WARP_PUNKTE gilt in fuehreListeAus mit denselben Transienten wie in uebersetze
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus, BefehlFehler } from '../projekt/befehle.ts';
import { neuesProjekt } from '../projekt/modell.ts';
import { zaehleWarpMarker } from '../projekt/wiedergabe.ts';
import { SHA_A } from './hilfen/projekt.mjs';

// 2 Beats je Sekunde; Loop von 200 Beats (100 s) in 100 Kopien; 3000 Transienten alle 33 ms je Kopie → 300 000 Einheiten, 1/16 dagegen 80 000
const transienten = Array.from({ length: 3000 }, (_, i) => 0.5 + i * 0.033);
const befehle = (raster) => [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'tempo_setzen', bpm: 120 },
  { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 20000, loop_beats: 200, sha256: SHA_A, pfad_hinweis: '/x/l.wav',
    warp: { an: true, modus: 'beats', marker: [[0, 0], [120, 240]], versatz_beats: 0, quelle: 'hand', transpose_st: 0, detune_ct: 0, beats: { raster, loop: 'vor', huelle: 100 } } }];
const grund = (f) => { try { f(); } catch (e) { return e instanceof BefehlFehler ? e.grund : String(e); } return null; };

test('fuehreListeAus zählt die Einheiten nach Transienten mit, wenn die Quelle mitkommt; ohne Quelle gilt 1/16 (D7)', () => {
  assert.equal(grund(() => fuehreListeAus(neuesProjekt('Z'), befehle('transienten'), { transienten: () => transienten })), 'zu_gross');
  assert.equal(grund(() => fuehreListeAus(neuesProjekt('Z'), befehle('transienten'), { transienten: () => null })), null, 'ohne Transienten gilt 1/16: 80 000');
  assert.equal(grund(() => fuehreListeAus(neuesProjekt('Z'), befehle('transienten'))), null, 'ohne Quelle gilt 1/16');
});
test('Negativ-Kontrolle: wenige Transienten und Raster 1/16 bleiben unter der Grenze', () => {
  assert.equal(grund(() => fuehreListeAus(neuesProjekt('Z'), befehle('transienten'), { transienten: () => transienten.slice(0, 100) })), null);
  assert.equal(grund(() => fuehreListeAus(neuesProjekt('Z'), befehle('1/16'), { transienten: () => transienten })), null, 'Raster ignoriert die Transienten');
  const p = fuehreListeAus(neuesProjekt('Z'), befehle('transienten')).projekt;
  assert.ok(zaehleWarpMarker(p, { transienten: () => transienten }) > 262144 && zaehleWarpMarker(p) < 262144);
});
