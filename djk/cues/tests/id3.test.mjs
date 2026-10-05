// Tag-Lesen: Mixed-In-Key-Felder aus ID3v2.3/2.4, Ersatz aus dem Kommentar, Fehlerfälle ohne Absturz
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { leseTags, camelot } from '../id3.ts';
import { ladeBibliothek, ladeListen, titelAusName } from '../bibliothek.ts';
import { mp3, tmpOrdner } from './hilfen.mjs';

test('ID3v2.3 mit MIK-Tags: Titel, Artist, TBPM, TKEY, TXXX:EnergyLevel (UTF-16 Umlaute)', (t) => {
  const d = tmpOrdner(t);
  const p = mp3(path.join(d, 'a.mp3'), { meta: { title: 'Täst – Mix', artist: 'Ärtist', TBPM: '128', TKEY: '9A', EnergyLevel: '7' } });
  assert.deepEqual(leseTags(p), { titel: 'Täst – Mix', artist: 'Ärtist', bpm: 128, tonart: '9A', energie: 7, id3: '2.3' });
});

test('ID3v2.4 (Synchsafe-Framegrößen, UTF-8) liefert dieselben Felder, Dezimal-BPM', (t) => {
  const d = tmpOrdner(t);
  const p = mp3(path.join(d, 'b.mp3'), { id3: 4, meta: { title: 'Vier', artist: 'X', TBPM: '125.5', TKEY: '12B', EnergyLevel: '4' } });
  assert.deepEqual(leseTags(p), { titel: 'Vier', artist: 'X', bpm: 125.5, tonart: '12B', energie: 4, id3: '2.4' });
});

test('Ersatz: ohne TKEY/EnergyLevel greift der MIK-Kommentar "9A - 5"; klassischer Tonartname wird Camelot', (t) => {
  const d = tmpOrdner(t);
  const p = mp3(path.join(d, 'c.mp3'), { meta: { title: 'K', comment: '9A - 5', TBPM: '126' } });
  const x = leseTags(p);
  assert.equal(x.tonart, '9A');
  assert.equal(x.energie, 5);
  const q = mp3(path.join(d, 'd.mp3'), { meta: { title: 'K', TKEY: 'Am', comment: 'nur Text' } });
  assert.equal(leseTags(q).tonart, '8A');
  assert.equal(leseTags(q).energie, null, 'Negativ-Kontrolle: Kommentar ohne MIK-Muster setzt keine Energie');
});

test('camelot(): gültige und ungültige Werte', () => {
  assert.equal(camelot('09A'), '9A');
  assert.equal(camelot('F#m'), '11A');
  assert.equal(camelot('C major'), '8B');
  assert.equal(camelot('13A'), null);
  assert.equal(camelot('XYZ'), null);
  assert.equal(camelot(''), null);
});

test('Fehlerfall: Datei ohne ID3, Textdatei, abgeschnittener Tag: alles null, kein Wurf', (t) => {
  const d = tmpOrdner(t);
  const ohne = path.join(d, 'ohne.mp3');
  // ohne Tag: erzeugen und die ersten 10 Kopf-Bytes + Tag entfernen ist aufwendig, darum MP3 ohne Metadaten-Schreiben
  mp3(ohne, { id3: 3 });
  const roh = fs.readFileSync(ohne);
  const groesse = ((roh[6] & 0x7f) << 21) | ((roh[7] & 0x7f) << 14) | ((roh[8] & 0x7f) << 7) | (roh[9] & 0x7f);
  fs.writeFileSync(ohne, roh.subarray(10 + groesse));
  assert.deepEqual(leseTags(ohne), { titel: null, artist: null, bpm: null, tonart: null, energie: null, id3: null });
  const text = path.join(d, 'text.mp3');
  fs.writeFileSync(text, 'kein mp3');
  assert.equal(leseTags(text).id3, null);
  const kaputt = path.join(d, 'kaputt.mp3');
  const p = mp3(path.join(d, 'k0.mp3'), { meta: { title: 'Abgeschnitten', TBPM: '130' } });
  fs.writeFileSync(kaputt, fs.readFileSync(p).subarray(0, 40));
  const k = leseTags(kaputt);
  assert.equal(k.id3, '2.3');
  assert.equal(k.bpm, null);
  assert.throws(() => leseTags(path.join(d, 'gibtsnicht.mp3')), /ENOENT/);
});

test('Bibliothek: rekursiv, Titel aus Dateiname als Ersatz, Index-Cache, M3U mit Windows-Pfaden', async (t) => {
  const d = tmpOrdner(t);
  mp3(path.join(d, '1_Eins_Original Mix.mp3'), { meta: { TBPM: '128' } });
  mp3(path.join(d, 'unter', '2_Zwei_Remix.mp3'), { meta: { title: 'Zwei', TBPM: '130' } });
  fs.writeFileSync(path.join(d, 'liste.m3u'), '#EXTM3U\r\n#EXTINF:1,Zwei\r\nD:\\MP3\\x\\2_Zwei_Remix.mp3\r\nD:\\MP3\\fehlt.mp3\r\n');
  const idx = path.join(d, 'cache', 'index.json');
  const a = await ladeBibliothek(d, idx);
  assert.equal(a.tracks.length, 2);
  assert.equal(a.frisch, 2);
  assert.equal(a.tracks.find((x) => x.rel === '1_Eins_Original Mix.mp3').titel, 'Eins - Original Mix');
  assert.equal(a.tracks.find((x) => x.rel === path.join('unter', '2_Zwei_Remix.mp3')).bpm, 130);
  const b = await ladeBibliothek(d, idx);
  assert.equal(b.frisch, 0, 'zweiter Lauf kommt aus dem Index');
  const l = ladeListen(d, b.tracks);
  assert.deepEqual(l, [{ name: 'liste', rels: [path.join('unter', '2_Zwei_Remix.mp3')], fehlend: 1 }]);
  assert.equal(titelAusName('ohne-muster.mp3'), 'ohne-muster');
});

const MUSIK = process.env.CYPHERDJ_MUSIK;
const ECHT = MUSIK ? path.join(MUSIK, '1002565_Freak_Original Mix.mp3') : '';
const ECHT_SKIP = !MUSIK ? 'CYPHERDJ_MUSIK nicht gesetzt' : !fs.existsSync(ECHT) ? `Datei fehlt: ${ECHT}` : false;
test('echte Datei aus Andreas\' Ordner (nur lesen): 126 BPM, 9A, Energie 5', { skip: ECHT_SKIP }, () => {
  const vor = fs.statSync(ECHT).mtimeMs;
  const x = leseTags(ECHT);
  assert.equal(x.bpm, 126); assert.equal(x.tonart, '9A'); assert.equal(x.energie, 5); assert.equal(x.artist, 'Hans Bouffmyhre');
  assert.equal(fs.statSync(ECHT).mtimeMs, vor);
});
