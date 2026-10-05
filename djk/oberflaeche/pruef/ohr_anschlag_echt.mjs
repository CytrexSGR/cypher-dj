// Ohr T7 Step 5 (Pflicht-Beleg für Mischungen, Plan Rev. 3): `anschlagPhase` über echtes Material aus dem Bestand,
// gemessen mit dem Kern-Werkzeug `messer_baender_datei` (nicht synthetisch). Aufruf: node pruef/ohr_anschlag_echt.mjs
// Abnahme Rev. 3 (nach dem Befund des Umsetzers, ~/messungen/2026-09-28-ohr-slice2/profil.txt): eine absolute
// Wahrheit für die Kick-Lage gibt es im Bestand nicht (Raster aus `beat_this`, Fehler unbekannt; zwei
// Tiefband-Gegeninstrumente der Hauptinstanz lagen am bekannt sauberen b507 bei −35 ms, sind also selbst blind).
// Geprüft werden nur Eigenschaften mit Wahrheit: (1) relativ: Sätze um +20 ms verschoben → Differenz 20 ± 1 ms je
// Fassung; (2) stabil: zwei unabhängige Fenster derselben Fassung (Beat 64–128 und 192–256) auf 1,5 ms einig. Die
// Absolutwerte werden weiter gebucht (Befund über die Rasterqualität), zählen aber nicht mehr als Kriterium.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { anschlagPhase } from '../ohr.ts';

const REPO = path.resolve(new URL('.', import.meta.url).pathname, '..', '..', '..');
const MESSER = path.join(REPO, 'djk/kern/dsp/build-ohr-messer/messer/messer_baender_datei');
const RASTER_ORDNER = path.join(os.homedir(), '.config', 'cypherdj', 'raster');
const AUS_PFAD = path.join(os.homedir(), 'messungen', '2026-09-28-ohr-slice2', 'anschlag_echt.json');

// Fünf Fassungen (drei aus dem ersten Lauf plus zwei weitere, die die Hauptinstanz bei der Rev.-3-Entscheidung schon
// mit demselben Verfahren nachgemessen hat, Absolutwerte lt. Plan Zeile 452 b507 +0,5, 929d +4,3, 9b44 +4,5,
// 9fe4 −3,8, a63a −10,4 ms). Zwei davon (929d8039c3732eed, 9b444bee7d0805b8) mit Andreas' Grid-Korrektur im
// Config-Ordner (versatz_frames != 0), damit die Stichprobe nicht trivial ist.
const FASSUNGEN = [
  { material_id: 'b507ff85b65e14dc', fassung: 1 },
  { material_id: '929d8039c3732eed', fassung: 1 },
  { material_id: '9b444bee7d0805b8', fassung: 1 },
  { material_id: '9fe420361439e5cb', fassung: 1 },
  { material_id: 'a63abf52694671bb', fassung: 1 },
];

function liesFassung(material_id, fassung) {
  const ordner = path.join(REPO, 'bestand', material_id, 'fassungen', `128000_r${fassung}`);
  const f = JSON.parse(fs.readFileSync(path.join(ordner, 'fassung.json'), 'utf8'));
  return { ordner, f };
}

function liesVersatz(material_id, basis_bpm, fassung) {
  const p = path.join(RASTER_ORDNER, `${material_id}_${Math.round(basis_bpm * 1000)}_r${fassung}.json`);
  if (!fs.existsSync(p)) return 0;
  return JSON.parse(fs.readFileSync(p, 'utf8')).versatz_frames ?? 0;
}

// Ausgabe von messer_baender_datei: je Fenster 8 float32 (band[0..5], k, spitze); Fenster i endet auf Frame 48·i+47.
function liesBaender(ausPfad) {
  const buf = fs.readFileSync(ausPfad);
  const SATZ_BYTES = 32; // 8 float32
  const n = Math.floor(buf.length / SATZ_BYTES);
  const saetze = [];
  for (let i = 0; i < n; ++i) {
    const off = i * SATZ_BYTES;
    const band = [0, 1, 2, 3, 4, 5].map((b) => buf.readFloatLE(off + b * 4));
    saetze.push({ frame: 48 * i + 47, band });
  }
  return saetze;
}

function beatVon(frame, erster_schlag_frame, versatz_frames, basis_bpm) {
  return ((frame - erster_schlag_frame - versatz_frames) * basis_bpm) / (60 * 48000);
}

function messeFassung({ material_id, fassung }) {
  const { ordner, f } = liesFassung(material_id, fassung);
  const versatz_frames = liesVersatz(material_id, f.basis_bpm, fassung);
  const basisPfad = path.join(ordner, f.datei ?? 'basis.f32');
  const ausPfad = fs.mkdtempSync(path.join(os.tmpdir(), 'ohr-anschlag-echt-')) + '/aus.f32';
  execFileSync(MESSER, [basisPfad, ausPfad]);
  const roh = liesBaender(ausPfad);
  const saetze = roh.map((r) => ({
    sample: r.frame,
    beat: beatVon(r.frame, f.erster_schlag_frame, versatz_frames, f.basis_bpm),
    quell: NaN,
    band: r.band,
    k: 1e-6,
    spitze: 0,
  }));
  // 64 Beats ab Beat 64 (Absolutwert, nur noch als Befund über die Rasterqualität gebucht, kein Kriterium mehr)
  const fenster = saetze.filter((s) => s.beat >= 64 && s.beat < 128);
  const r = anschlagPhase(fenster, f.basis_bpm);

  // Kriterium 1 (relativ): dieselben Sätze mit `beat` um 20 ms verschoben -> Differenz zum unverschobenen Wert 20 ± 1 ms.
  const verschiebungBeat = (20 * f.basis_bpm) / 60000;
  const fensterVerschoben = fenster.map((s) => ({ ...s, beat: s.beat + verschiebungBeat }));
  const rVerschoben = anschlagPhase(fensterVerschoben, f.basis_bpm);
  const relative_differenz_ms = rVerschoben.anschlag_ms - r.anschlag_ms;

  // Kriterium 2 (stabil): zweites, unabhängiges Fenster (Beat 192–256) derselben Fassung, auf 1,5 ms mit dem ersten einig.
  const fenster2 = saetze.filter((s) => s.beat >= 192 && s.beat < 256);
  const r2 = anschlagPhase(fenster2, f.basis_bpm);
  const stabilitaet_differenz_ms = r2.anschlag_ms - r.anschlag_ms;

  return { material_id, fassung, basis_bpm: f.basis_bpm, versatz_frames,
    anschlag_ms: r.anschlag_ms, n: r.n,
    anschlag_ms_fenster2: r2.anschlag_ms, n_fenster2: r2.n,
    fehlerfall_20ms: { anschlag_ms: rVerschoben.anschlag_ms, n: rVerschoben.n },
    relative_differenz_ms, stabilitaet_differenz_ms };
}

const ergebnisse = FASSUNGEN.map(messeFassung);
fs.mkdirSync(path.dirname(AUS_PFAD), { recursive: true });
fs.writeFileSync(AUS_PFAD, JSON.stringify(ergebnisse, null, 2));
console.log(JSON.stringify(ergebnisse, null, 2));

let fehler = false;
for (const e of ergebnisse) {
  const okRelativ = Math.abs(e.relative_differenz_ms - 20) <= 1;
  const okStabil = Math.abs(e.stabilitaet_differenz_ms) <= 1.5;
  console.log(`${e.material_id}: anschlag_ms=${e.anschlag_ms} (Fenster2 ${e.anschlag_ms_fenster2}) n=${e.n}/${e.n_fenster2} | ` +
    `relativ=${e.relative_differenz_ms} ok=${okRelativ} | stabil=${e.stabilitaet_differenz_ms} ok=${okStabil}`);
  if (!okRelativ || !okStabil) fehler = true;
}
if (fehler) {
  console.log('STOPP: mindestens eine Fassung erfüllt Kriterium (1) relativ oder (2) stabil nicht.');
  process.exit(1);
}
console.log('ALLE BELEGE GRÜN');
