#!/usr/bin/env node
// Test-Doppel von cypherdj-render (Paket K3 mit Nachtrag 6.20 und den Fix-Runden, gemergt als 05a91adb) für die S3-Tests. Ausgerichtet am Baum
// djk/core/src/tools/render_main.cpp und djk/core/src/render.cpp (gelesen 2026-10-16):
//   Optionen   --nr N --von-beat V --bis-beat B --bpm T --aus <wav> [--quantum Q] [--konfig kern.toml] [--zustand pfad | --ohne-zustand]
//              [--spur-regler datei.json] [--nur-schluessel ids] [--trocken-aus] [--arr-ordner pfad] [--gegenprobe-spur S] [--abgriff produktion|set]; jede andere Option (oder ohne Wert) ist Rückgabe 2.
//   Rückgaben  0 geschrieben, 2 Aufruf (auch Spur-Regler-Datei unlesbar oder ungültig, bis − von außerhalb 1..2048 Beats, bpm außerhalb 60..200),
//              3 Konfiguration oder Zustand (auch weder Zustand noch --spur-regler), 4 Wiedergabe oder Render, 5 Wirt-Spur nicht eingefroren,
//              6 Schreiben, 7 Speicher, 8 Ziel besteht (der Render ersetzt nie).
//   Ausgabe    eine JSON-Zeile mit datei, frames, spitze_db, start_sample, phase, quantum, vorhalt, regler und regler_quelle (in JEDER Erfolgszeile);
//              1.10: dazu abgriff, ueber_decke und limiter_db_max, aber NUR wenn der Aufrufer --abgriff übergab (Altaufrufer sehen die Zeile wie vorher).
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
//   RENDER_ATTRAPPE_HEISS=1            1.10: Standard-Sinus heiß: Amplitude 1,4125 (+3 dBFS) am Abgriff produktion, 0,8913 (−1 dBFS, wie hinter dem Set-Limiter) am Abgriff set;
//                                      ueber_decke ist nur am Abgriff produktion wahr, limiter_db_max 3 (sonst 0)
//   RENDER_ATTRAPPE_ABGRIFF_FALSCH=1   1.10: die Ausgabe nennt den jeweils anderen Abgriff (ein älteres Programm, das still den Ring las)
//   RENDER_ATTRAPPE_MISCHUNG=1         Paket 1.18 E-b: statt eines Sinus eine Mischung aus den Spuren der Wiedergabe-Datei, je Spur ein Sinus von 220 · nr Hz
//                                      mit Spitze 0,2 · 10^(Fader/20), nur für Spuren mit Inhalt im Bereich, still bei Mute 1. Fader und Mute kommen aus --spur-regler (Vorgabe 0 dB, nicht stumm),
//                                      in JEDEM Modus, auch mit Zustand (der echte Render nähme dann die Regler des Kerns; das prüft nur der Lauf auf einer Prüfinstanz).
//                                      spitze_db ist die echte Spitze der Mischung (−200 bei Stille).
//                                      1.10 T9: a track with a stage key {q: spur, punkt: post} is 12 dB lower while the source runs (clip in range, mute 0, fader > -120,
//                                      or a fader/mute lane in the playback: then the source runs where the lane has it above -120 dB / unmuted); --nur-schluessel spur/<n>
//                                      (bare or :sends) lets the source run without sounding, :ziel lets it sound.
//                                      1.10 T10: a track in group n is scaled by grp/n/fader and silenced by grp/n/mute = 1 (a group strip); a send spur/<n>/send/<r> above -120 dB
//                                      adds the track's sine times the send times ret/<r>/fader into the output unless ret/<r>/mute = 1 (a return, Hall off); --trocken-aus drops
//                                      every dry (target) part and keeps the wet parts (a track listed bare or with :ziel in --nur-schluessel does not send).
import fs from 'node:fs';
import path from 'node:path';

const RENDER_MAX_BEATS = 2048;
const MIT_WERT = ['--nr', '--von-beat', '--bis-beat', '--bpm', '--aus', '--quantum', '--konfig', '--zustand', '--arr-ordner', '--gegenprobe-spur', '--spur-regler', '--abgriff', '--nur-schluessel'];
const ende = (rc, zeile) => { process.stderr.write(`${zeile}\n`); process.exit(rc); };
const hilfe = () => ende(2, 'Aufruf: cypherdj-render --nr N --von-beat V --bis-beat B --bpm T --aus <datei.wav> [--quantum Q] [--konfig kern.toml]'
  + ' [--zustand pfad | --ohne-zustand] [--spur-regler datei.json] [--nur-schluessel ids] [--trocken-aus] [--arr-ordner pfad] [--gegenprobe-spur S] [--abgriff produktion|set]');
// streng wie call_number.h: ganz verbraucht, endlich
const zahl = (k, s) => { const n = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? Number(s) : NaN; if (!Number.isFinite(n)) ende(2, `cypherdj-render: ${k} ${s}: endliche Zahl erwartet`); return n; };

const args = process.argv.slice(2);
const a = {};
for (let i = 0; i < args.length; i++) {
  const k = args[i];
  if (k === '--ohne-zustand') { a.ohne_zustand = true; continue; }
  if (k === '--trocken-aus') { a.trocken_aus = true; continue; }   // 1.10 T10: no value
  if (!MIT_WERT.includes(k) || i + 1 >= args.length) hilfe();
  a[k.slice(2)] = args[++i];
}
const nr = a.nr === undefined ? -1 : zahl('--nr', a.nr);
if (!(Number.isInteger(nr) && nr >= 0) || !a.aus || (a.ohne_zustand && a.zustand !== undefined)) hilfe();
const abgriff = a.abgriff ?? 'set';   // wie das Programm (P11): ohne Angabe der Ring
if (abgriff !== 'set' && abgriff !== 'produktion') hilfe();
const von = zahl('--von-beat', a['von-beat'] ?? '0'), bis = zahl('--bis-beat', a['bis-beat'] ?? '0'), bpm = zahl('--bpm', a.bpm ?? '0');

// Spur-Regler: immer geprüft, auch wenn der Zustand gilt (render_main.cpp: „ein kaputter Aufruf fällt sofort auf“)
const GRENZE = { fader: [-200, 6, false], pan: [-1, 1, false], mute: [0, 1, true], solo: [0, 1, true] };
let regler = null;
if (a['spur-regler'] !== undefined) {
  try { regler = JSON.parse(fs.readFileSync(a['spur-regler'], 'utf8')); } catch (e) { ende(2, `Spur-Regler: ${a['spur-regler']}: fehlt, nicht lesbar oder kein JSON (${e.message})`); }
  if (regler === null || typeof regler !== 'object' || Array.isArray(regler)) ende(2, `Spur-Regler: ${a['spur-regler']}: kein JSON-Objekt Pfad -> Wert`);
  for (const [p, v] of Object.entries(regler)) {
    // 1.10 slices 3 and 4 (render.cpp mixer_pfad): sends, returns, insert rows and rack rows are mixer controls too; the double checks the name and that the value is a number
    if (/^(spur|grp)\/\d+\/send\/\d+$/.test(p) || /^ret\/\d+\//.test(p) || /^ins\/(komp|eq|saett|lim|host)\/\d+\//.test(p) || /^rack\/\d+\//.test(p)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) ende(2, `Spur-Regler: ${p} ist keine Zahl`);
      continue;
    }
    const m = /^spur\/([1-9]|[12][0-9]|3[0-2])\/(fader|pan|mute|solo)$/.exec(p) ?? /^grp\/([1-8])\/(fader|pan|mute|solo)$/.exec(p) ?? (p === 'pm/fader' ? [p, '0', 'fader'] : null);
    if (!m) ende(2, `Spur-Regler: ${p} ist kein Mixer-Regler (spur/<1..32>, grp/<1..8>/{fader,pan,mute,solo}, pm/fader)`);
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
const heiss = process.env.RENDER_ATTRAPPE_HEISS === '1';
const amp = heiss ? (abgriff === 'produktion' ? 1.4125 : 0.8913) : 0.5;
let spitze = amp;
if (process.env.RENDER_ATTRAPPE_MISCHUNG === '1') {
  const regel = (n, k, vorgabe) => (regler && regler[`spur/${n}/${k}`] !== undefined ? regler[`spur/${n}/${k}`] : vorgabe);
  // nur Spuren mit Inhalt im Bereich [von, bis): Audio-Clips und Noten tragen absolute Beats (Wiedergabe-Format, playback.ts)
  const klingt = (sp) => [...(sp.clips ?? []), ...(sp.noten ?? [])].some((x) => x.beat === undefined ? x.start_beat < bis && x.start_beat + x.laenge_beats > von
    : x.beat < bis && x.beat + x.laenge > von);
  const laeuft = (sp) => klingt(sp) && regel(sp.nr, 'mute', 0) !== 1;
  // a track with a fader or mute lane in the playback: the lane replaces the base value (fader above -120 dB at some point, unmuted at some point)
  const lane = (sp, ziel) => (sp.auto ?? []).find((l) => l.ziel === ziel);
  const quelleLaeuft = (sp) => klingt(sp)
    && (lane(sp, 'mute') ? lane(sp, 'mute').punkte.some((q) => q[1] < 0.5) : regel(sp.nr, 'mute', 0) !== 1)
    && (lane(sp, 'fader') ? lane(sp, 'fader').punkte.some((q) => q[1] > -120) : regel(sp.nr, 'fader', 0) > -120);
  const maskiert = (n) => (a['nur-schluessel'] ?? '').split(',').some((id) => { const [kopf, suf] = id.split(':'); return kopf === `spur/${n}` && suf !== 'ziel'; });
  const gesenkt = (sp) => (sp.chain ?? []).some((st) => st.key?.q === 'spur' && st.key.punkt === 'post'
    && (w.spuren ?? []).some((q) => q.nr === st.key.nr && quelleLaeuft(q)));
  const sendet = (n) => (a['nur-schluessel'] ?? '').split(',').every((id) => { const [kopf, suf] = id.split(':'); return kopf !== `spur/${n}` || suf === 'sends'; });
  const db = (pfad, vorgabe) => (regler && regler[pfad] !== undefined ? regler[pfad] : vorgabe);
  const stimmen = [];
  // 1.10 T10 fix 1: a PM stage keyed by a return (post) ducks the whole output by 12 dB while that return is alive (not muted, some running track sends to it)
  const retMaske = (n) => (a['nur-schluessel'] ?? '').split(',').includes(`ret/${n}`);
  const retLebt = (n) => db(`ret/${n}/mute`, 0) !== 1 && (w.spuren ?? []).some((q) => laeuft(q) && db(`spur/${q.nr}/send/${n}`, -200) > -120);
  const pmDuck = ((w.pm?.chain) ?? []).some((st) => st.key?.q === 'ret' && st.key.punkt === 'post' && retLebt(st.key.nr)) ? 10 ** (-12 / 20) : 1;
  for (const sp of (w.spuren ?? []).filter((x) => laeuft(x))) {
    const basis = 0.2 * 10 ** (regel(sp.nr, 'fader', 0) / 20) * (gesenkt(sp) ? 10 ** (-12 / 20) : 1);
    const gn = sp.ausgang?.art === 'gruppe' ? sp.ausgang.nr : 0;
    const gruppe = gn && db(`grp/${gn}/mute`, 0) === 1 ? 0 : gn ? 10 ** (db(`grp/${gn}/fader`, 0) / 20) : 1;
    if (!maskiert(sp.nr) && !a.trocken_aus) stimmen.push([220 * sp.nr, basis * gruppe * pmDuck]);
    if (sendet(sp.nr)) {
      for (const r of w.returns ?? []) {
        const send = db(`spur/${sp.nr}/send/${r.nr}`, -200);
        if (send > -120 && db(`ret/${r.nr}/mute`, 0) !== 1 && !retMaske(r.nr)) stimmen.push([220 * sp.nr, basis * 10 ** (send / 20) * 10 ** (db(`ret/${r.nr}/fader`, 0) / 20) * pmDuck]);
      }
    }
  }
  spitze = 0;
  for (let i = 0; i < frames; i++) {
    let x = 0;
    for (const [hz, amp] of stimmen) x += amp * Math.sin(2 * Math.PI * hz * i / 48000);
    daten.writeFloatLE(x, i * 8); daten.writeFloatLE(x, i * 8 + 4);
    spitze = Math.max(spitze, Math.abs(x));
  }
} else {
  for (let i = 0; i < frames; i++) {
    const x = amp * Math.sin(2 * Math.PI * 440 * i / 48000);
    daten.writeFloatLE(x, i * 8); daten.writeFloatLE(x, i * 8 + 4);
  }
}
const kopf = Buffer.alloc(44);
kopf.write('RIFF', 0); kopf.writeUInt32LE(36 + daten.length, 4); kopf.write('WAVE', 8);
kopf.write('fmt ', 12); kopf.writeUInt32LE(16, 16); kopf.writeUInt16LE(3, 20); kopf.writeUInt16LE(2, 22);
kopf.writeUInt32LE(48000, 24); kopf.writeUInt32LE(48000 * 8, 28); kopf.writeUInt16LE(8, 32); kopf.writeUInt16LE(32, 34);
kopf.write('data', 36); kopf.writeUInt32LE(daten.length, 40);
try { fs.writeFileSync(a.aus, Buffer.concat([kopf, daten]), { flag: 'wx' }); } catch (e) { ende(e.code === 'EEXIST' ? 8 : 6, `WAV: ${e.message}`); }
if (process.env.RENDER_ATTRAPPE_AUSGABE === 'kaputt') { process.stdout.write('fertig, aber ohne JSON\n'); process.exit(0); }
process.stdout.write(JSON.stringify({ datei: a.aus, frames, spitze_db: process.env.RENDER_ATTRAPPE_MISCHUNG === '1' ? (spitze > 0 ? Math.round(20 * Math.log10(spitze) * 1000) / 1000 : -200) : (heiss ? Math.round(20 * Math.log10(amp) * 1000) / 1000 : -6.021), start_sample: 793, phase: 25, quantum: Number(a.quantum ?? 256), vorhalt: 84,
  regler: quelle === 'kern' ? 436 : Object.keys(regler).length, regler_quelle: quelle,
  ...(a.abgriff === undefined ? {} : {
    abgriff: process.env.RENDER_ATTRAPPE_ABGRIFF_FALSCH === '1' ? (abgriff === 'set' ? 'produktion' : 'set') : abgriff,
    ueber_decke: heiss && abgriff === 'produktion', limiter_db_max: heiss ? 3 : 0 }) }) + '\n');
