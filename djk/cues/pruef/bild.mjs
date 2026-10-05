// Prüfung im kopflosen Chrome (kein Fenster, --mute-audio, ohne DISPLAY; Helfer aus djk/oberflaeche/pruef/cdp.mjs).
// 1. Ladezeit je Track: N Tracks kalt (leerer Wellenform-Cache) und warm, gemessen in der Seite (Klick bis gezeichnet).
// 2. Kein Abspielen ohne Taste: play()-Zähler über Öffnen, Trackwechsel, Cue-Setzen; Leertaste als Gegenprobe.
// 3. Cues per Tastatur auf einem echten Track setzen, Screenshot, gespeicherte Datei prüfen, Cues wieder löschen.
// 4. Andreas' MP3 unverändert (sha1 und mtime vorher/nachher).
// Daten und Cache in einem Temp-Ordner: Andreas' ~/cypher-dj/cues/daten bleibt unberührt und leer.
// Aufruf: node djk/cues/pruef/bild.mjs [--n 10] [--bild docs/architektur/stand/cues-screenshot.png]
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteBrowser } from '../../oberflaeche/pruef/cdp.mjs';
import { CueServer, VORGABE } from '../server.ts';
import { dateiName } from '../speicher.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..', '..');
const { values } = parseArgs({ options: { n: { type: 'string', default: '10' }, bild: { type: 'string', default: path.join(REPO, 'docs/architektur/stand/cues-screenshot.png') }, zeige: { type: 'string', default: '1113242_Siiet_Original Mix.mp3' } } });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

if (!VORGABE.wurzel) { console.error('CYPHERDJ_MUSIK nicht gesetzt (Wurzel der Musiksammlung): nicht gestartet'); process.exit(2); }

const last = os.loadavg()[0];
if (last > 4) { console.error(`1-min-Last ${last.toFixed(2)} > 4: nicht gestartet`); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-cues-pruef-'));
const daten = path.join(tmp, 'daten');
const cache = path.join(tmp, 'cache');
// Tag-Index aus dem echten Cache mitnehmen (nur die Tags, keine Wellenformen): Start wie im Betrieb
try { fs.mkdirSync(cache, { recursive: true }); fs.copyFileSync(path.join(VORGABE.cache, 'index.json'), path.join(cache, 'index.json')); } catch { /* ohne Index */ }
const s = new CueServer({ port: 0, wurzel: VORGABE.wurzel, nml: VORGABE.nml, daten, cache });
await s.starte();
const basis = `http://127.0.0.1:${s.port}/`;
const zeige = s.tracks.find((t) => t.rel.toLowerCase() === values.zeige.toLowerCase())?.rel;
if (!zeige) throw new Error(`Zeige-Track fehlt: ${values.zeige}`);
const mp3 = path.join(VORGABE.wurzel, zeige);
const fp = (p) => ({ sha1: crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'), mtime: fs.statSync(p).mtimeMs });
const vorher = fp(mp3);

const b = await starteBrowser({ breite: 1920, hoehe: 1080 });
const ergebnis = { last_vorher: last, index_ms: s.laden.ms, tracks: s.tracks.length };
try {
  // play() zählen, bevor die Seite lädt
  await b.sende('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__plays = 0; const __p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__plays++; return __p.call(this); };' });
  await b.oeffne(basis);
  for (let i = 0; i < 100 && !(await b.werte('window.__cues && window.__cues.alle.length')); i++) await warte(50);
  ergebnis.layout = await b.werte('({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth, zeilen: document.querySelectorAll("#zeilen tr").length })');

  const taste = async (key, code, vk, mod = 0) => {
    await b.sende('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mod });
    await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mod });
    await warte(30);
  };
  const oeffneTrack = async (rel) => {
    const n0 = await b.werte('__cues.ladezeiten.length');
    await b.werte(`(() => { const tr = document.querySelector('#zeilen tr[data-rel=' + JSON.stringify(${JSON.stringify(rel)}) + ']'); tr.scrollIntoView({ block: 'center' }); })()`);
    await b.klick(`#zeilen tr[data-rel="${rel.replace(/"/g, '\\"')}"] td`);
    for (let i = 0; i < 400 && (await b.werte('__cues.ladezeiten.length')) === n0; i++) await warte(25);
    return b.werte('__cues.ladezeiten.at(-1)');
  };

  // 1. Ladezeit: gleichmäßig über die Liste verteilte Tracks, kalt dann warm
  const n = Number(values.n);
  const auswahl = Array.from({ length: n }, (_, i) => s.tracks[Math.floor((i + 0.5) * s.tracks.length / n)].rel);
  const kalt = []; const warm = [];
  for (const rel of auswahl) kalt.push(await oeffneTrack(rel));
  for (const rel of auswahl) warm.push(await oeffneTrack(rel));
  const stat = (a) => { const m = a.map((x) => x.ms).sort((x, y) => x - y); return { min: m[0], median: m[Math.floor(m.length / 2)], max: m.at(-1) }; };
  ergebnis.ladezeit = { kalt: stat(kalt), warm: stat(warm), kalt_aus_cache: kalt.filter((x) => x.aus_cache).length, warm_aus_cache: warm.filter((x) => x.aus_cache).length, einzeln_kalt: kalt.map((x) => ({ rel: x.rel, ms: x.ms, server_ms: x.server_ms })) };
  ergebnis.plays_nach_trackwechseln = await b.werte('window.__plays');

  // 2./3. Zeige-Track: Cues per Tastatur
  await oeffneTrack(zeige);
  const w = await b.werte('({ takt: 4 * 60 / __cues.raster.bpm, dauer: __cues.dauer, raster: { ...__cues.raster } })');
  // Tief-Energie je 4 Takte ab erster Eins, um Break und Drop per Tastatur anzufahren (nur für das Bild)
  const bloecke = await b.werte(`(() => { const z = __cues; const { v, rahmen, rahmenS } = z.welle; const t = 4 * 60 / z.raster.bpm;
    const e = z.raster.eins_s - Math.floor(z.raster.eins_s / t) * t; const aus = [];
    for (let k = 0; e + (k + 4) * t < z.dauer; k += 4) { let s = 0, n = 0; for (let i = Math.floor((e + k * t) / rahmenS); i < Math.floor((e + (k + 4) * t) / rahmenS) && i < rahmen; i++) { s += v[i * 6 + 1]; n++; } aus.push({ takt: k + 1, tief: s / n }); }
    return aus; })()`);
  const mx = Math.max(...bloecke.map((x) => x.tief));
  const iBreak = bloecke.findIndex((x, i) => i > 4 && x.tief < 0.45 * mx && bloecke[i - 1].tief > 0.7 * mx);
  const iDrop = bloecke.findIndex((x, i) => i > iBreak && iBreak > 0 && x.tief > 0.7 * mx && bloecke[i - 1].tief < 0.45 * mx);
  const iIn = bloecke.findIndex((x) => x.tief > 0.7 * mx);
  ergebnis.zeige = { rel: zeige, raster: w.raster, takt_s: w.takt, break_takt: bloecke[iBreak]?.takt, drop_takt: bloecke[iDrop]?.takt, bass_takt: bloecke[iIn]?.takt };
  const fahreZu = async (takt) => {
    await taste('Home', 'Home', 36);
    for (let k = 1; k + 16 <= takt; k += 16) await taste('ArrowRight', 'ArrowRight', 39, 8);
    const rest = (takt - 1) % 16;
    for (let k = 0; k < rest; k++) await taste('ArrowRight', 'ArrowRight', 39);
  };
  const ziffer = (d, mod = 0) => taste(String(d), `Digit${d}`, 48 + d, mod);
  await fahreZu(1); await ziffer(1); await taste('i', 'KeyI', 73);
  if (bloecke[iIn]) { await fahreZu(bloecke[iIn].takt); await ziffer(2); await taste('u', 'KeyU', 85); }
  if (bloecke[iBreak]) { await fahreZu(bloecke[iBreak].takt); await ziffer(3); await taste('b', 'KeyB', 66); }
  if (bloecke[iDrop]) { await fahreZu(bloecke[iDrop].takt); await ziffer(4); await taste('d', 'KeyD', 68); }
  // Vocal ohne Quantisierung, einen halben Takt nach dem Break (Q aus, Taste, Q wieder an)
  if (bloecke[iBreak]) { await fahreZu(bloecke[iBreak].takt + 8); await taste('ArrowRight', 'ArrowRight', 39); await taste('q', 'KeyQ', 81);
    await b.werte(`(() => { __cues.pos += ${w.takt / 2}; })()`); await ziffer(5); await taste('v', 'KeyV', 86); await taste('q', 'KeyQ', 81); }
  await warte(400); // Speichern (150 ms entprellt)
  const cuesSeite = await b.werte('[...__cues.cues.values()].map((c) => ({ slot: c.slot, s: c.s, takt: c.takt, schlag: c.schlag, name: c.name, quantisiert: c.quantisiert }))');
  const datei = JSON.parse(fs.readFileSync(path.join(daten, dateiName(zeige)), 'utf8'));
  ergebnis.gespeichert = { schema: datei.schema, schluessel: datei.schluessel, raster: datei.raster, cues: datei.cues.map((c) => ({ slot: c.slot, s: c.s, takt: c.takt, schlag: c.schlag, quell_beat: c.quell_beat, name: c.name, quantisiert: c.quantisiert })) };
  ergebnis.cues_seite_gleich_datei = cuesSeite.length === datei.cues.length && cuesSeite.every((c) => datei.cues.some((d) => d.slot === c.slot && Math.abs(d.s - c.s) < 1e-3 && d.name === c.name));
  ergebnis.zaehler_liste = await b.werte(`document.querySelector('#zeilen tr[data-rel=' + JSON.stringify(${JSON.stringify(zeige)}) + '] .cz').textContent`);
  // Bildausschnitt: Abspielkopf zwei Takte vor dem Break-Cue, damit Raster, Cue-Marken und Traktor-Vorschlag im Zoom stehen
  if (bloecke[iBreak]) await fahreZu(bloecke[iBreak].takt - 2);
  await b.werte(`document.querySelector('#zeilen tr.aktiv').scrollIntoView({ block: 'center' })`);
  await warte(300);
  ergebnis.plays_vor_leertaste = await b.werte('window.__plays');
  ergebnis.pausiert_vor_leertaste = await b.werte('window.__audio.paused');
  await b.bild(values.bild);

  // Gegenprobe Leertaste: genau ein play(), danach Pause
  await taste(' ', 'Space', 32);
  await warte(300);
  ergebnis.leertaste = { plays: await b.werte('window.__plays'), pausiert: await b.werte('window.__audio.paused'), knopf: await b.werte('document.getElementById("spiel").textContent') };
  await taste(' ', 'Space', 32);
  await warte(100);
  ergebnis.leertaste.danach_pausiert = await b.werte('window.__audio.paused');

  // Aufräumen per Tastatur: Shift+1..8 löscht; ohne Cues und ohne eigenes Raster verschwindet die Datei
  for (let d = 1; d <= 8; d++) await ziffer(d, 8);
  await warte(400);
  ergebnis.nach_loeschen = { datei_da: fs.existsSync(path.join(daten, dateiName(zeige))), dateien: fs.readdirSync(daten).length, zaehler: await b.werte(`document.querySelector('#zeilen tr[data-rel=' + JSON.stringify(${JSON.stringify(zeige)}) + '] .cz').textContent`) };

  // Traktor-Übernahme mit T auf demselben Track, dann wieder weg
  await taste('t', 'KeyT', 84);
  await warte(400);
  ergebnis.traktor_T = await b.werte('[...__cues.cues.values()].map((c) => c.slot + ":" + c.name + "@" + c.s.toFixed(2))');
  for (let d = 1; d <= 8; d++) await ziffer(d, 8);
  await warte(400);
  ergebnis.traktor_T_weg = !fs.existsSync(path.join(daten, dateiName(zeige)));

  // 5. Loop: L setzt einen 4-Takte-Loop ab Takt 1, Abspielen lässt ihn hörbar schleifen (<audio> + rAF-Rücksprung,
  // Übergang bis der native Vorhörer steht, siehe oeffentlich/spieler.js). Rücksprung-Fehler je Durchlauf gemessen.
  await fahreZu(1);
  await taste('l', 'KeyL', 76);
  const loopCue = await b.werte('(() => { const c = [...__cues.cues.values()].find((x) => x.laenge_takte); return c ? { slot: c.slot, s: c.s, ende_s: c.ende_s, laenge_takte: c.laenge_takte } : null; })()');
  await b.werte('window.__spieler.ruecksprünge.length = 0');
  await taste(' ', 'Space', 32); // play
  const laufzeit = loopCue ? Math.max(1500, (loopCue.ende_s - loopCue.s) * 1000 * 2 + 500) : 1500;
  await warte(laufzeit);
  await taste(' ', 'Space', 32); // pause
  const rueckspruenge = await b.werte('window.__spieler.ruecksprünge');
  const fehlerMs = rueckspruenge.map((r) => r.fehler_ms);
  ergebnis.loop = {
    cue: loopCue,
    ruecksprung_n: rueckspruenge.length,
    ruecksprung_fehler_ms: fehlerMs,
    ruecksprung_fehler_median_ms: fehlerMs.length ? [...fehlerMs].sort((a, b) => a - b)[Math.floor(fehlerMs.length / 2)] : null,
    ruecksprung_fehler_max_ms: fehlerMs.length ? Math.max(...fehlerMs) : null,
  };
  await taste('Escape', 'Escape', 27);
  await warte(200);
  ergebnis.loop.nach_esc_aktiv = await b.werte('!!window.__cues.aktivLoop');
  ergebnis.loop.audio_laeuft_weiter_nach_esc = !(await b.werte('window.__audio.paused'));
  await taste(' ', 'Space', 32); // wieder pausieren
  await warte(150);
  for (let d = 1; d <= 8; d++) await ziffer(d, 8); // Loop-Slot wieder löschen
  await warte(400);
  ergebnis.loop.nach_loeschen_datei_da = fs.existsSync(path.join(daten, dateiName(zeige)));

  // 6. Grid mit der Maus ziehen (Andreas, 2026-09-26: "flüssiger das grid links rechts schieben"): Shift+Ziehen im
  // Zoom verschiebt eins_s live, ohne Neuladen; N Pixel Zug muss eins_s exakt um N/px_pro_s verschieben. Dazu
  // Zeichenzeit je Live-Neuzeichnung (wie beim Ziehen) für die Bildrate.
  await fahreZu(1);
  const fenster = await b.werte("window.__zoomFenster(document.getElementById('zoom').getBoundingClientRect().width)");
  const zoomMitte = await b.mitte('#zoom');
  const startX = zoomMitte.x;
  const startY = zoomMitte.y + 30; // unterhalb der Taktzahl-Leiste (oben=22px in zeichneZoom), Shift entscheidet den Modus
  await b.maus('mouseMoved', startX, startY, { buttons: 0 });
  await b.maus('mousePressed', startX, startY, { modifiers: 8 });
  const einsVorZug = await b.werte('__cues.raster.eins_s');
  const dxPx = 40;
  for (let i = 1; i <= 8; i++) await b.maus('mouseMoved', startX + (dxPx * i) / 8, startY, { modifiers: 8 });
  const einsNachZug = await b.werte('__cues.raster.eins_s');
  await b.maus('mouseReleased', startX + dxPx, startY, { modifiers: 8 });
  await warte(250); // Speichern beim Loslassen (150 ms entprellt)
  const nachZugGespeichert = JSON.parse(fs.readFileSync(path.join(daten, dateiName(zeige)), 'utf8')).raster.eins_s;
  const zeichenzeiten = await b.werte('window.__benchZeichnen(120)');
  const zzSort = [...zeichenzeiten].sort((a, b) => a - b);
  ergebnis.grid_zug = {
    dx_px: dxPx, px_pro_s: fenster.pxS,
    eins_vor: einsVorZug, eins_nach: einsNachZug,
    erwartete_verschiebung_s: dxPx / fenster.pxS,
    gemessene_verschiebung_s: einsNachZug - einsVorZug,
    fehler_s: Math.abs((einsNachZug - einsVorZug) - dxPx / fenster.pxS),
    gespeichert_nach_loslassen_gleich_eins_nach: Math.abs(nachZugGespeichert - einsNachZug) < 1e-6,
    zeichenzeit_ms: { median: zzSort[Math.floor(zzSort.length / 2)], max: zzSort.at(-1) },
    geschaetzte_fps_aus_zeichenzeit: 1000 / zzSort[Math.floor(zzSort.length / 2)],
  };
  // Grid zurückschieben, damit der Track-Zustand nach der Prüfung dem vor der Prüfung entspricht
  await b.maus('mouseMoved', startX + dxPx, startY, { modifiers: 8 });
  await b.maus('mousePressed', startX + dxPx, startY, { modifiers: 8 });
  await b.maus('mouseMoved', startX, startY, { modifiers: 8 });
  await b.maus('mouseReleased', startX, startY, { modifiers: 8 });
  await warte(250);

  ergebnis.konsole_fehler = b.konsole.filter((k) => k.typ === 'error' || k.typ === 'exception');
} finally {
  await b.zu();
  await s.stoppe();
}
const nachher = fp(mp3);
ergebnis.mp3_unveraendert = vorher.sha1 === nachher.sha1 && vorher.mtime === nachher.mtime;
ergebnis.andreas_daten = fs.existsSync(VORGABE.daten) ? fs.readdirSync(VORGABE.daten).length : 'fehlt';
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify(ergebnis, null, 2));
