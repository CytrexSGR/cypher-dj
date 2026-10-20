#!/usr/bin/env node
// Test-Doppel von cypherdj-render (Paket K3 mit Nachtrag 6.20 und den Fix-Runden, gemergt als 05a91adb) für die S3-Tests. Ausgerichtet am Baum
// djk/kern/src/werkzeuge/render_main.cpp und djk/kern/src/render.cpp (gelesen 2026-10-16):
//   Optionen   --nr N --von-beat V --bis-beat B --bpm T --aus <wav> [--quantum Q] [--konfig kern.toml] [--zustand pfad | --ohne-zustand]
//              [--spur-regler datei.json] [--arr-ordner pfad] [--gegenprobe-spur S]; jede andere Option (oder ohne Wert) ist Rückgabe 2.
//   Rückgaben  0 geschrieben, 2 Aufruf (auch Spur-Regler-Datei unlesbar oder ungültig, bis − von außerhalb 1..2048 Beats, bpm außerhalb 60..200),
//              3 Konfiguration oder Zustand (auch weder Zustand noch --spur-regler), 4 Wiedergabe oder Render, 5 Wirt-Spur nicht eingefroren,
//              6 Schreiben, 7 Speicher, 8 Ziel besteht (der Render ersetzt nie).
//   Ausgabe    eine JSON-Zeile mit datei, frames, spitze_db, start_sample, phase, quantum, vorhalt, regler und regler_quelle (in JEDER Erfolgszeile).
//   Regler     Neustart-Zustand da → "kern" (die Spur-Regler-Datei wird trotzdem geprüft); fehlt er oder steht --ohne-zustand → "projekt" mit
//              --spur-regler, ohne --spur-regler Rückgabe 3.
// Statt des Kerns schreibt das Doppel einen Sinus (440 Hz, Spitze 0,5 = −6,02 dBFS) als WAV float32 Stereo 48 kHz mit (bis − von) Beats beim
// Tempo --bpm. Es prüft wie der echte Render: Wiedergabe-Datei vorhanden (sonst 4), keine Wirt-Spur darin (5). --arr-ordner braucht das Doppel
// (es liest keine kern.toml); S3 gibt ihn immer mit.
// Steuerung über die Umgebung:
//   RENDER_ATTRAPPE_ZUSTAND=da|fehlt   Neustart-Zustand gefunden (Vorgabe da → regler_quelle kern) oder nicht (→ --spur-regler, sonst 3)
//   RENDER_ATTRAPPE_RC=<n>             mit Rückgabe n und einer Zeile auf stderr enden, ohne Datei (nach dem Protokoll)
//   RENDER_ATTRAPPE_PROTOKOLL=<datei>  hängt je Aufruf eine JSON-Zeile an: argv, Instanz, Inhalt der Spur-Regler-Datei, Wiedergabe
//   RENDER_ATTRAPPE_SCHLAF_MS=<n>      vor dem Schreiben warten (Zeitlimit-Tests)
//   RENDER_ATTRAPPE_AUSGABE=kaputt     WAV schreiben, Rückgabe 0, aber keine JSON-Zeile (Aufräumen nach unlesbarer Antwort)
import fs from 'node:fs';
import path from 'node:path';

const RENDER_MAX_BEATS = 2048;
const MIT_WERT = ['--nr', '--von-beat', '--bis-beat', '--bpm', '--aus', '--quantum', '--konfig', '--zustand', '--arr-ordner', '--gegenprobe-spur', '--spur-regler'];
const ende = (rc, zeile) => { process.stderr.write(`${zeile}\n`); process.exit(rc); };
const hilfe = () => ende(2, 'Aufruf: cypherdj-render --nr N --von-beat V --bis-beat B --bpm T --aus <datei.wav> [--quantum Q] [--konfig kern.toml]'
  + ' [--zustand pfad | --ohne-zustand] [--spur-regler datei.json] [--arr-ordner pfad] [--gegenprobe-spur S]');
// streng wie aufruf_zahl.h: ganz verbraucht, endlich
const zahl = (k, s) => { const n = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? Number(s) : NaN; if (!Number.isFinite(n)) ende(2, `cypherdj-render: ${k} ${s}: endliche Zahl erwartet`); return n; };

const args = process.argv.slice(2);
const a = {};
for (let i = 0; i < args.length; i++) {
  const k = args[i];
  if (k === '--ohne-zustand') { a.ohne_zustand = true; continue; }
  if (!MIT_WERT.includes(k) || i + 1 >= args.length) hilfe();
  a[k.slice(2)] = args[++i];
}
const nr = a.nr === undefined ? -1 : zahl('--nr', a.nr);
if (!(Number.isInteger(nr) && nr >= 0) || !a.aus || (a.ohne_zustand && a.zustand !== undefined)) hilfe();
const von = zahl('--von-beat', a['von-beat'] ?? '0'), bis = zahl('--bis-beat', a['bis-beat'] ?? '0'), bpm = zahl('--bpm', a.bpm ?? '0');

// Spur-Regler: immer geprüft, auch wenn der Zustand gilt (render_main.cpp: „ein kaputter Aufruf fällt sofort auf“)
const GRENZE = { fader: [-200, 6, false], pan: [-1, 1, false], mute: [0, 1, true], solo: [0, 1, true] };
let regler = null;
if (a['spur-regler'] !== undefined) {
  try { regler = JSON.parse(fs.readFileSync(a['spur-regler'], 'utf8')); } catch (e) { ende(2, `Spur-Regler: ${a['spur-regler']}: fehlt, nicht lesbar oder kein JSON (${e.message})`); }
  if (regler === null || typeof regler !== 'object' || Array.isArray(regler)) ende(2, `Spur-Regler: ${a['spur-regler']}: kein JSON-Objekt Pfad -> Wert`);
  for (const [p, v] of Object.entries(regler)) {
    const m = /^spur\/([1-8])\/(fader|pan|mute|solo)$/.exec(p);
    if (!m) ende(2, `Spur-Regler: ${p} ist kein Spur-Regler (spur/<1..8>/{fader,pan,mute,solo})`);
    if (typeof v !== 'number') ende(2, `Spur-Regler: ${p} ist keine Zahl`);
    const [lo, hi, ganz] = GRENZE[m[2]];
    if (!Number.isFinite(v) || v < lo || v > hi || (ganz && v !== Math.floor(v))) ende(2, `Spur-Regler: ${p} = ${v} außerhalb ${lo}..${hi}`);
  }
}
if (!a['arr-ordner']) ende(3, 'Attrappe: braucht --arr-ordner (liest keine kern.toml)');
const wdatei = path.join(a['arr-ordner'], `wiedergabe-${nr}.json`);
let w = null;
try { w = JSON.parse(fs.readFileSync(wdatei, 'utf8')); } catch { /* unten: Rückgabe 4 */ }
if (process.env.RENDER_ATTRAPPE_PROTOKOLL) {
  fs.appendFileSync(process.env.RENDER_ATTRAPPE_PROTOKOLL, JSON.stringify({ argv: args, instanz: process.env.CYPHERDJ_INSTANZ ?? '', regler, wiedergabe: w }) + '\n');
}
const rc = Number(process.env.RENDER_ATTRAPPE_RC ?? 0);
if (rc) ende(rc, `Render: abgelehnt: Attrappe endet mit ${rc}`);
// Zustand (render_main.cpp): fehlt er (oder --ohne-zustand), gilt --spur-regler, ohne sie Rückgabe 3
const fehlt = a.ohne_zustand || process.env.RENDER_ATTRAPPE_ZUSTAND === 'fehlt' || (a.zustand !== undefined && !fs.existsSync(a.zustand));
if (fehlt && regler === null) ende(3, a.ohne_zustand ? '--ohne-zustand braucht --spur-regler (Spec 6.20)' : 'Neustart-Zustand: fehlt, und keine --spur-regler (Spec 6.20)');
const quelle = fehlt ? 'projekt' : 'kern';
if (fs.existsSync(a.aus)) ende(8, `WAV: ${a.aus} besteht schon (cypherdj-render ersetzt nie)`);
if (!(von >= 0) || !(bis - von >= 1) || !(bis - von <= RENDER_MAX_BEATS) || !(bpm >= 60 && bpm <= 200)) {
  ende(2, 'Render: aufruf: von >= 0, bis - von 1..2048 Beats, bpm 60..200, quantum 16..8192, nr >= 0');
}
if (!w) ende(4, `Render: datei_fehlt: ${wdatei}`);
const wirt = (w.spuren ?? []).find((s) => s.art === 'wirt');
if (wirt) ende(5, `Render: wirt_nicht_eingefroren: Spur ${wirt.nr} ist eine Wirt-Spur (erst einfrieren)`);
const schlaf = Number(process.env.RENDER_ATTRAPPE_SCHLAF_MS ?? 0);
if (schlaf > 0) await new Promise((r) => setTimeout(r, schlaf));

const frames = Math.round((bis - von) * 60 / bpm * 48000);
const daten = Buffer.alloc(frames * 8);
for (let i = 0; i < frames; i++) {
  const x = 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000);
  daten.writeFloatLE(x, i * 8); daten.writeFloatLE(x, i * 8 + 4);
}
const kopf = Buffer.alloc(44);
kopf.write('RIFF', 0); kopf.writeUInt32LE(36 + daten.length, 4); kopf.write('WAVE', 8);
kopf.write('fmt ', 12); kopf.writeUInt32LE(16, 16); kopf.writeUInt16LE(3, 20); kopf.writeUInt16LE(2, 22);
kopf.writeUInt32LE(48000, 24); kopf.writeUInt32LE(48000 * 8, 28); kopf.writeUInt16LE(8, 32); kopf.writeUInt16LE(32, 34);
kopf.write('data', 36); kopf.writeUInt32LE(daten.length, 40);
try { fs.writeFileSync(a.aus, Buffer.concat([kopf, daten]), { flag: 'wx' }); } catch (e) { ende(e.code === 'EEXIST' ? 8 : 6, `WAV: ${e.message}`); }
if (process.env.RENDER_ATTRAPPE_AUSGABE === 'kaputt') { process.stdout.write('fertig, aber ohne JSON\n'); process.exit(0); }
process.stdout.write(JSON.stringify({ datei: a.aus, frames, spitze_db: -6.021, start_sample: 793, phase: 25, quantum: Number(a.quantum ?? 256), vorhalt: 84,
  regler: quelle === 'kern' ? 436 : Object.keys(regler).length, regler_quelle: quelle }) + '\n');
