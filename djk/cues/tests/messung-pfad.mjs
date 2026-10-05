// Messlauf für den ganzen Weg Seite(HTTP/SSE)→Server(server.ts)→UDP→Vorhörer (djk/vorhoerer), NICHT nur den
// Vorhörer allein (der ist schon in djk/vorhoerer/tests/messung.py belegt). Eigene Null-Senke, eigene OSC-Instanz
// 'g' (Andreas' laufende Instanz bleibt '', Port 47730/47740 unberührt). Kein hörbarer Ton, kein Fenster.
//
//   node tests/messung-pfad.mjs
//
// Misst mit dem echten Track "Freak" (44,1 kHz MP3, wie djk/vorhoerer/tests/messung.py sprung_mp3) über Kreuz-
// korrelation gegen die ffmpeg-Referenzdekodierung, weil der Cue-Server nur MP3 aus der Bibliothek lädt (kein
// Zähler-WAV wie beim reinen Vorhörer-Test). Ergebnis nach djk/cues/laeufe/pfad_<Zeitstempel>/ergebnis.json.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CueServer } from '../server.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const DJK = path.resolve(HIER, '..', '..');
const BIN = path.join(DJK, 'vorhoerer', 'build', 'cypherdj-vorhoerer');
const AUFNEHMER = path.join(DJK, 'pruefstand', 'aufnehmer', 'build', 'cypherdj-aufnehmer');
const WURZEL = process.env.CYPHERDJ_MUSIK ?? '';
const REL = '1002565_Freak_Original Mix.mp3';
if (!WURZEL || !fs.existsSync(path.join(WURZEL, REL))) {
  console.error(`SKIP: ${!WURZEL ? 'CYPHERDJ_MUSIK nicht gesetzt' : `Datei fehlt: ${path.join(WURZEL, REL)}`} (Messung braucht die echte Datei aus der Musiksammlung)`);
  process.exit(77);
}
// 48000, nicht die MP3-native 44100: der Vorhörer dekodiert auf die JACK-Graph-Rate (vorhoerer.c:354,
// jack_get_sample_rate) und der Aufnehmer zeichnet auf derselben Rate auf; die Referenz muss darum auch auf
// 48000 dekodiert werden, sonst laufen Aufnahme- und Referenz-Zeitachse systematisch auseinander (gemessen:
// mit 44100 angenommen kam eine Play-Latenz von ~98 ms heraus, mit 48000 korrekt ~10 ms, siehe cues-werkzeug.md).
const RATE = 48000;
const INSTANZ = 'g';
const SENKE = 'cypherdj-pruef-g-cuetest-messung';
const STEMPEL = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
const ORDNER = path.join(HIER, '..', 'laeufe', `pfad_${STEMPEL}`);

function jetztNs() { return process.hrtime.bigint(); }
function last1() { return Number.parseFloat(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); }

function referenz(pfad) {
  const buf = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', pfad, '-map', '0:a:0', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

function liesWav(pfad) {
  const b = fs.readFileSync(pfad);
  let o = 12;
  while (o < b.length) {
    const cid = b.toString('ascii', o, o + 4);
    const n = b.readUInt32LE(o + 4);
    if (cid === 'data') return new Float32Array(b.buffer, b.byteOffset + o + 8, n / 4);
    o += 8 + n + (n & 1);
  }
  throw new Error('kein data-Chunk');
}

// erster Übergang von "lange nur exakte Nullen" zu "Inhalt" ab Sample `ab` (mono aus Kanal 0, stride 2)
function ersteAudioAb(stereo, ab, stilleFrames = 4800) {
  const n = stereo.length / 2;
  let stille = 0;
  for (let i = ab; i < n; i++) {
    if (stereo[i * 2] === 0 && stereo[i * 2 + 1] === 0) stille++; else stille = 0;
  }
  // rückwärts eigentlich einfacher: erster Index nach einer Stille-Kette der Länge stilleFrames
  stille = 0;
  for (let i = ab; i < n; i++) {
    if (stereo[i * 2] === 0 && stereo[i * 2 + 1] === 0) { stille++; continue; }
    if (stille >= stilleFrames || i === ab) return i;
    stille = 0;
  }
  return -1;
}

// Normierte Kreuzkorrelation, Fenster w, Suche ±such um k0 in ref; liefert {lag, korrelation}
function lagSuche(seg, ref, refStart, w = 4096, such = 3000) {
  const s = new Float64Array(w);
  for (let i = 0; i < w; i++) s[i] = seg[i * 2]; // Kanal L
  let ns = 0; for (let i = 0; i < w; i++) ns += s[i] * s[i]; ns = Math.sqrt(ns);
  let beste = -2, besterLag = null;
  for (let l = -such; l <= such; l++) {
    const start = refStart + l;
    if (start < 0 || start + w > ref.length / 2) continue;
    let dot = 0, nr = 0;
    for (let i = 0; i < w; i++) { const r = ref[(start + i) * 2]; dot += s[i] * r; nr += r * r; }
    nr = Math.sqrt(nr);
    const c = nr > 1e-12 && ns > 1e-12 ? dot / (ns * nr) : -2;
    if (c > beste) { beste = c; besterLag = l; }
  }
  return { lag: besterLag, korrelation: beste };
}

function stat(a) {
  if (!a.length) return { n: 0 };
  const s = [...a].sort((x, y) => x - y);
  return { n: a.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}

async function main() {
  fs.mkdirSync(ORDNER, { recursive: true });
  const log = [];
  const logZeile = (z) => { log.push(z); process.stdout.write(`${JSON.stringify(z)}\n`); };

  const lastVor = last1();
  execFileSync(path.join(DJK, 'pruefstand', 'senke', 'senke_an.sh'), [SENKE]);
  try {
    const s = new CueServer({
      port: 0, wurzel: WURZEL, nml: null, daten: path.join(ORDNER, 'daten'), cache: path.join(ORDNER, 'cache'),
      ausgang: `${SENKE}:playback_F`, ohneBlende: true, vorhoererInstanz: INSTANZ, vorhoererBin: BIN,
      log: (z) => logZeile({ quelle: 'server', t_ns: jetztNs().toString(), ...z }),
    });
    await s.starte();
    if (!s.vorhoerer) throw new Error('Vorhörer nicht gestartet');
    const basis = `http://127.0.0.1:${s.port}/`;
    const status = async () => fetch(`${basis}api/vorhoerer/status`).then((r) => r.json());

    // ---- Aufnahme starten (40 s: Play-Latenz, danach Loop-Läufe, danach freie Wiedergabe für den Strich-Fehler)
    const wav = path.join(ORDNER, 'aufnahme.wav');
    const bereitDatei = path.join(ORDNER, 'bereit');
    const auf = spawn('pw-jack', ['-p', '256', AUFNEHMER, '--quelle', `${SENKE}:monitor_F`, '--datei', wav, '--sekunden', '22', '--bereit', bereitDatei],
      { env: { ...process.env, CYPHERDJ_INSTANZ: INSTANZ }, stdio: ['ignore', 'inherit', 'inherit'] });
    for (let i = 0; i < 100 && !(fs.existsSync(bereitDatei) && fs.readFileSync(bereitDatei, 'utf8').trim()); i++) await new Promise((r) => setTimeout(r, 50));

    // ---- SSE mitlesen (Positionen für den Strich-Fehler)
    const http = await import('node:http');
    const sseEvents = [];
    let sseRes = null;
    await new Promise((ok) => {
      http.get(`${basis}api/vorhoerer/stream`, (r) => {
        sseRes = r; let buf = ''; r.setEncoding('utf8');
        r.on('data', (chunk) => {
          buf += chunk; let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const stueck = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (\w+)/m.exec(stueck); const da = /^data: (.*)$/m.exec(stueck);
            if (ev && da) sseEvents.push({ empfangen_ns: jetztNs(), ev: ev[1], daten: JSON.parse(da[1]) });
          }
        });
        ok();
      });
    });

    await fetch(`${basis}api/vorhoerer/laden?rel=${encodeURIComponent(REL)}`, { method: 'POST' });
    for (let i = 0; i < 200 && !(await status()).geladen; i++) await new Promise((r) => setTimeout(r, 50));
    const geladen = (await status()).geladen;
    logZeile({ quelle: 'lauf', schritt: 'geladen', geladen });

    // ---- 1) Play-Latenz: aus dem Stand, Position mitten im Track (nicht Intro), t0 = Sende-Zeitpunkt (CLOCK_MONOTONIC)
    const springZiel = 60.0;
    await fetch(`${basis}api/vorhoerer/springe?s=${springZiel}`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 400));
    const tPlaySend = jetztNs();
    await fetch(`${basis}api/vorhoerer/play`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 700));

    // ---- 2) Loop-Naht: A/B nicht auf Blockgrenzen, Position bereits davor (kein Vorsprung-Pfad), mehrere Runden
    const A = 65.0, B = 66.5;
    const rLoop = await fetch(`${basis}api/vorhoerer/loop?a=${A}&b=${B}`, { method: 'POST' });
    const loopStatus = rLoop.status;
    await new Promise((r) => setTimeout(r, 8000)); // mehrere Runden bei B - A = 1,5 s
    const tLoopAusSend = jetztNs();
    await fetch(`${basis}api/vorhoerer/loop_aus`, { method: 'POST' });

    // ---- 3) Strich-Fehler: freie Wiedergabe (ohne Loop) eine Weile weiterlaufen lassen, SSE-Positionen mitschreiben
    await new Promise((r) => setTimeout(r, 6000));
    const tVorPause = jetztNs(); // Anker für den Strich-Fehler: kurz vor dem Pause-Befehl, noch in freier Wiedergabe
    await fetch(`${basis}api/vorhoerer/pause`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 500));

    sseRes?.destroy();
    // Der Aufnehmer schreibt die .wav.json erst beim eigenen, natürlichen Ende (--sekunden); ein SIGTERM vorher
    // lässt die Datei fehlen (gemessen: ENOENT beim ersten Lauf). Darum hier abwarten statt abzuwürgen.
    await new Promise((r) => auf.once('exit', r));
    await s.stoppe();

    // ---- Auswertung ----
    const meta = JSON.parse(fs.readFileSync(`${wav}.json`, 'utf8'));
    const rec = liesWav(wav);
    const ref = referenz(path.join(WURZEL, REL));

    // 1) Play-Latenz: erster Nicht-Null-Frame nach dem Sende-Zeitpunkt-Fenster (Aufnahme startete vor dem Laden)
    const abSample0 = Math.max(0, Math.floor(Number(tPlaySend - BigInt(meta.erster_mono_ns)) / 1e9 * RATE) - RATE);
    const ersterTonSample = ersteAudioAb(rec, abSample0, Math.round(0.05 * RATE));
    const ersterTonNs = BigInt(meta.erster_mono_ns) + BigInt(Math.round(ersterTonSample / RATE * 1e9));
    const latenzMs = Number(ersterTonNs - tPlaySend) / 1e6;
    logZeile({ quelle: 'debug', abSample0, ersterTonSample, tPlaySend: tPlaySend.toString(), ersterTonNs: ersterTonNs.toString() });
    // Fehlerfall-Beleg (kein Ton ohne Play): Summe |Samples| in einem 100-ms-Fenster VOR dem Play-Sendezeitpunkt
    const vorSample = Math.max(0, abSample0);
    let summeVorPlay = 0; const vorFensterN = Math.min(Math.round(0.1 * RATE), (rec.length / 2) - vorSample);
    for (let i = 0; i < vorFensterN; i++) { const k = vorSample + i; summeVorPlay += Math.abs(rec[k * 2]) + Math.abs(rec[k * 2 + 1]); }

    // 2) Loop-Naht: erste Audio-Landung nach dem Play als "Loop-Start" (Wiedergabe beginnt bei springZiel, nicht
    // bei A); die erste Rücksprung-Landung kommt darum erst nach (B - springZiel) Sekunden, danach alle (B-A).
    const loopStartSample = ersterTonSample; // derselbe Übergang, kein zweiter Suchlauf nötig (der fände die Play-Naht nicht wieder: danach folgt Dauerton, keine erneute 50-ms-Stille)
    const periodeSamples = Math.round((B - A) * RATE);
    const ersteLandungOffset = Math.round((B - springZiel) * RATE);
    const aFrame = Math.round(A * RATE);
    const nahtFehler = [];
    for (let n = 0; ersteLandungOffset + n * periodeSamples + loopStartSample + 4096 < rec.length / 2; n++) {
      const kAppr = loopStartSample + ersteLandungOffset + n * periodeSamples;
      if (kAppr < 0 || kAppr + 4096 > rec.length / 2) continue;
      const seg = rec.subarray(kAppr * 2, (kAppr + 4096) * 2);
      const { lag, korrelation } = lagSuche(seg, ref, aFrame);
      if (korrelation > 0.9) nahtFehler.push({ n, sample_ungefaehr: kAppr, lag_samples: lag, korrelation });
    }

    // 3) Strich-Fehler: geschätzte Position (wie spieler.js SpielerVorhoerer.position(), konstante Geschwindigkeit
    //    zwischen zwei 30-Hz-Meldungen) gegen die tatsächliche Playhead-Position aus der Aufnahme. Nur das Fenster
    //    NACH loop_aus (freie, monotone Wiedergabe) ist mit dem linearen Ankermodell vergleichbar — während der
    //    Loop-Phase springt die gemeldete Position periodisch zurück, das wäre kein Strich-Fehler, sondern der Loop
    //    selbst (gemessen: ohne diesen Filter Fehler bis −56 s, Artefakt der Rücksprünge, kein echter Befund).
    const margin = 250_000_000n; // 250 ms Sicherheitsabstand zum letzten möglichen Rücksprung nach loop_aus
    const posEvents = sseEvents.filter((e) => e.ev === 'position' && e.empfangen_ns >= tLoopAusSend + margin && e.empfangen_ns <= tVorPause);
    const strichFehlerMs = [];
    if (posEvents.length > 2) {
      // Anker: Sample kurz vor dem Pause-Befehl (tVorPause), noch mitten in der freien Wiedergabe, gegen Referenz
      // korrelieren (nicht das Dateiende — die Aufnahme läuft nach pause() noch als Stille weiter, siehe --sekunden).
      const ankerK = Math.max(0, Math.round(Number(tVorPause - BigInt(meta.erster_mono_ns)) / 1e9 * RATE) - 4096);
      const posBeiAnker = posEvents.filter((e) => e.empfangen_ns <= tVorPause).at(-1)?.daten.s ?? posEvents[0].daten.s;
      const ankerSuchMitte = Math.round(posBeiAnker * RATE);
      const { lag: ankerLag, korrelation: ankerKorr } = lagSuche(rec.subarray(ankerK * 2, (ankerK + 4096) * 2), ref, ankerSuchMitte, 4096, 5000);
      if (ankerKorr > 0.9) {
        const ankerRefFrame = ankerSuchMitte + ankerLag; // Datei-Frame, das bei Aufnahme-Sample ankerK ankam
        const ankerNs = BigInt(meta.erster_mono_ns) + BigInt(Math.round(ankerK / RATE * 1e9));
        for (const e of posEvents) {
          const wahreSekundeJetzt = ankerRefFrame / RATE + Number(e.empfangen_ns - ankerNs) / 1e9;
          strichFehlerMs.push((e.daten.s - wahreSekundeJetzt) * 1000);
        }
      }
    }

    const ergebnis = {
      lauf: { rel: REL, instanz: INSTANZ, senke: SENKE, last_vorher: lastVor, last_nachher: last1(), vorlaeufig: lastVor > 4 || last1() > 4 },
      geladen,
      play_latenz_ms: latenzMs,
      play_latenz_fehlerfall_summe_vor_play: summeVorPlay,
      loop: { A, B, periode_samples: periodeSamples, loop_status: loopStatus, landungen: nahtFehler, fehler_samples: stat(nahtFehler.map((x) => x.lag_samples)) },
      strich_fehler_ms: stat(strichFehlerMs),
      sse_position_ereignisse_gesamt: sseEvents.filter((e) => e.ev === 'position').length,
      sse_position_ereignisse_frei_ausgewertet: posEvents.length,
    };
    fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 1));
    fs.writeFileSync(path.join(ORDNER, 'log.jsonl'), log.map((z) => JSON.stringify(z)).join('\n'));
    console.log(JSON.stringify(ergebnis, null, 1));
  } finally {
    try { execFileSync(path.join(DJK, 'pruefstand', 'senke', 'senke_ab.sh'), [SENKE]); } catch { /* schon weg */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
