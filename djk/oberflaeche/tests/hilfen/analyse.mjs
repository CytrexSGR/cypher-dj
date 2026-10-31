// Paket 1.13 Warp, Slice 3a (Task 12, 13): Testhelfer für die Analyse auf Abruf. fakeStarter ersetzt WerkstattAnalyse: er startet nichts, die Tests beenden die
// Aufträge selbst (beende); platz = wie viele Läufe zugleich. aufbau: Katalog mit sieben Tracks, eine Mediathek mit einem Traktor-Raster, eine Ablage mit einer Karte.
import path from 'node:path';
import { sitzung, wav } from './proj_kontext.mjs';
import { baueKatalog, ksha } from './katalog.mjs';
import { tmpOrdner } from './projekt.mjs';
import { baueMarken, karteLinear, schreibeKarte } from './karte.mjs';

export function fakeStarter(platz = 1) {
  const f = { aufrufe: [], fertig: new Map(), belegt: 0 };
  f.starte = (sha, pfad, fertig) => {
    if (f.fertig.has(sha)) { f.fertig.get(sha).push(fertig); return 'laeuft'; }
    if (f.belegt >= platz) return 'ausgelastet';
    f.belegt++; f.aufrufe.push([sha, pfad]); f.fertig.set(sha, [fertig]);
    return 'gestartet';
  };
  f.beende = (sha, e = { ok: true }) => { const l = f.fertig.get(sha); f.fertig.delete(sha); f.belegt--; for (const g of l) g(e); };
  f.stoppe = () => {};
  return f;
}
// 1 Track mit BPM, 100 s; 2 Track ohne Tempo, 100 s; 3 Track ohne Tempo, 30 s (zu kurz); 4 Loop ohne Tempo; 5 Track mit Karte; 6 Track mit Traktor; 7 Track mit BPM, 100 s (zweiter)
export function aufbau(t, { platz = 1, ...extra } = {}) {
  const d = tmpOrdner(t, 'djk-analyse-');
  const w = wav(path.join(d, 'daten'), 'x.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [
    { n: 1, typ: 'track', werk_id: 1, bpm: 120, dauer_s: 100, pfad: w }, { n: 2, typ: 'track', werk_id: 2, dauer_s: 100, pfad: w },
    { n: 3, typ: 'track', werk_id: 3, dauer_s: 30, pfad: w }, { n: 4, typ: 'loop', dauer_s: 3.84, pfad: w },
    { n: 5, typ: 'track', werk_id: 5, bpm: 120, dauer_s: 100, pfad: w }, { n: 6, typ: 'track', werk_id: 6, bpm: 120, dauer_s: 100, pfad: w },
    { n: 7, typ: 'track', werk_id: 7, bpm: 128, dauer_s: 100, pfad: w },
  ]);
  const mediathek = baueMarken(path.join(d, 'mt.sqlite'), [{ sha: ksha(6), start_s: 0.1, bpm: 128 }]);
  const analyse = path.join(d, 'analyse');
  schreibeKarte(analyse, ksha(5), { karte: karteLinear(40), dauer_s: 100 });
  const starter = fakeStarter(platz);
  const e = sitzung(t, { katalog, analyse, mediathek, analysierer: starter, analyseWarteMs: 20, ...extra });
  return { ...e, analyse, starter, katalog };
}
