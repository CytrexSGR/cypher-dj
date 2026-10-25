// Abnahmemessung 1.10 Slice 1 und 2 (Routing und Busse): Gruppen-Spuren, Produktions-Master und Export-Abgriff am echten Kern. Gegen einen laufenden Seiten-Server auf einer Prüfinstanz (nie g, h, i, nie der
// Betrieb) mit gebautem Kern und cypherdj-render des Checkouts, in dem der Server läuft:
//   DJK=<worktree>/djk djk/start/djk-start --instanz a --strudel          (stumm, ohne --ton-frei)
//   node pruef/abnahme_r1.mjs --url http://127.0.0.1:48300 [--ausgabe <Ordner>]                                  Slice 1 (Vorgabe, --teil 1)
//   node pruef/abnahme_r1.mjs --url http://127.0.0.1:48300 --teil 2 --iso-ref <iso_ref> [--bau <Kern-Bauordner>]  Slice 2
//
// Punkte Slice 1 (je mit Messwert; der Export läuft bei gestopptem Transport):
//   AK1/AK3   leere Gruppe ändert den Export nicht (sha256 gleich; Kontrolle: Wiederholung des Exports gleich), Projekt steht auf /2; Migration einer /1-Datei (Laden, Heben, Speichern als /2)
//   Gruppieren s2 und s3 in g1 (Fader 0 dB) ändert den Pegel nicht: größte Abweichung gegen den Export davor <= 3e-6 (-110 dBFS)
//   AK4       Gruppen-Fader -6,02 dB senkt die Spitze um 6,02 +-0,1 dB (Vorbedingung: Spitze vor der Änderung <= -3 dBFS, sonst ungültig); Negativ-Kontrolle: ohne Mitglieder ändert der Gruppen-Fader die Spitze um <= 0,05 dB
//   AK20      Master-Fader -6,02 dB senkt die Spitze um 6,02 +-0,1 dB
//   AK7       Zyklus -> 409 routing_zyklus, unbekanntes Ziel -> ziel_unbekannt, Negativ-Kontrolle s1 -> g1 -> 200
//   Pegel     Transport 3 s: grp/1 und pm melden Pegel > -60 dBFS, grp/2 fehlt
//   AK22/Zug  sechs Anfragen an Gruppen-Fader, Master-Fader, Spur-Fader (Referenz) = je ein Verlaufseintrag und ein Undo; Negativ-Kontrolle: der Name zählt nicht als Mixer-Feld
//   AK22/Rückweg  zwei Griffe an grp/1/fader landen im Projekt (+-0,5 dB), Quellen im Verlauf
//   AK28      variante_waehlen neben einer Gruppen-Spur lässt gruppen[0].mute unberührt
//   NK        /griff grp/9/fader -> 400, POST /regler grp/1/fader -> 409 ueber_projekt
//   Umweg     POST /spur mit Ziel grp/1/fader und pm/fader -> 409 ueber_projekt, nichts ändert sich; Negativ-Kontrolle erz/2/filter
//   I08       Regress: eine armierte Audio-Spur, die in eine Gruppe geht, nimmt einen Strudel-Strom auf: Take frames > 0, luecken 0, Spitze der Datei > -40 dBFS; Negativ-Kontrolle: Stille liefert Spitze 0 und gilt als nicht bestanden
//
// Punkte Slice 2 (--teil 2; jeder Export wartet SETTLE_MS, Nachzug N8):
//   AK17 live  Null-Test des Produktions-Exports gegen den Ring-Mitschnitt (Verfahren A7: cypherdj-mitschnitt, cypherdj-render --abgriff, cypherdj-nulltest aus --bau). Nachzug N7: erz/4 ist nur im Betrag
//              neutral (der LR8-Isolator dreht die Phase), darum ist die Referenz des Produktions-Abgriffs der Abgriff durch den Isolator (--iso-ref, cypherdj::dsp::Isolator, Gains 1,0, frisch ab Renderbeginn):
//              Rest < -90 dBFS, Selbstprüfung (um 1 Sample verschoben) rot, Phase live = Render; der Set-Export bestanden ohne Isolator. Gegenprobe: der Abgriff OHNE Isolator ist nie null (rot, Rest über -90).
//   AK17 Fehlerfall  heißes Material (der Set-Limiter greift): der Set-Export bleibt bestanden, der Produktions-Export mit Isolator wird rot (Rest = Eingriff des Limiters), limiter_db_max > 0.
//   AK18       Export mit abgriff: produktion liefert ueber_decke true und spitze_db > -1, set ueber_decke false und spitze_db <= -0,9 (Limiter hat eingegriffen: limiter_db_max > 0); ohne Angabe = produktion;
//              ungültiger abgriff -> 400 argument_ungueltig; leises Material: ueber_decke false, limiter_db_max 0 (Negativ-Kontrolle). Reicht das Material die Decke nicht, ist der Punkt ungültig (nicht bestanden).
//   AK19       Transport 3 s, SSE /strom: bei heißem Material mindestens ein /zustand/arr mit limiter_db < -0,5; bei leisem keines (und das Feld kommt an: Positivprobe)
// Rückgabe: 0 alle Punkte OK, 1 mindestens ein Punkt FEHL, 2 Aufruf. Aufräumen: die eigenen Projekte (nur die eigenen Slugs) werden gelöscht.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { midiRoh } from '../oeffentlich/kurven.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' }, teil: { type: 'string' }, bau: { type: 'string' }, 'iso-ref': { type: 'string' } } });
const aufrufFehler = (t) => { process.stderr.write(`abnahme_r1: ${t}\n`); process.exit(2); };
if (!opt.url) aufrufFehler('Aufruf: --url <http://127.0.0.1:port> [--teil 1|2] [--ausgabe <Ordner>] [--instanz <a..f>] [--bau <Kern-Bauordner>] [--iso-ref <Programm>]');
const TEIL = opt.teil ?? '1';
if (TEIL !== '1' && TEIL !== '2') aufrufFehler(`--teil ${TEIL}: 1 oder 2 erwartet`);
if (/:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('nie gegen den Betrieb (47300): eine Prüfinstanz wählen');
const port = Number(new globalThis.URL(opt.url).port);
const k = (port - 47300) / 1000;
const aus = Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined;
const instanz = opt.instanz ?? aus;
if (!instanz || /^[ghi]$/.test(instanz)) aufrufFehler(`Instanz ${instanz ?? '?'} (Port ${port}) ist nicht erlaubt: g, h, i sind tabu`);
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-r1-teil${TEIL}`);
// Programme des Verfahrens A7 (cypherdj-render, -mitschnitt, -nulltest): der Kern-Bauordner des Checkouts, in dem der Server läuft (djk-start verlangt ihn dort)
const BAU = path.resolve(opt.bau ?? path.join(HIER, '..', '..', 'kern', 'build'));
const ISO_REF = opt['iso-ref'] ? path.resolve(opt['iso-ref']) : null;
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (kz, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };

const URL = opt.url;
const CYPHER = { 'x-djk-quelle': 'cypher' };
const ruf = async (methode, weg, koerper, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
class Fehl extends Error {}
const grundVon = (r) => `${r.code} ${r.j?.fehler ?? r.j?.grund ?? ''}${r.j?.text ? `: ${r.j.text}` : ''}`.trim();
const erwarte200 = (weg, r) => { if (r.code !== 200) throw new Fehl(`${weg} → ${grundVon(r)}`); return r; };
const holeRev = async () => erwarte200('/proj/aktuell?nur=rev', await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
const aktuell = async () => erwarte200('/proj/aktuell', await ruf('GET', '/proj/aktuell')).j;
const projektJetzt = async () => (await aktuell()).projekt;
const aendern = async (label, befehle, kopf = CYPHER) => erwarte200(`/proj/aendern (${label})`, await ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, kopf)).j;
const aendernRoh = async (label, befehle, kopf = CYPHER) => ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, kopf);
const pegel = async (sek) => erwarte200('/pegel', await ruf('GET', `/pegel?sek=${sek}`)).j.kanaele;
const verlauf = async () => erwarte200('/proj/verlauf', await ruf('GET', '/proj/verlauf')).j;
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const warteAufKern = async () => {
  if (!(await bisWahr(async () => typeof (await ruf('GET', '/lage')).j?.uhr?.bpm === 'number', 8000))) throw new Fehl('kein Kern: /lage meldet keine Uhr');
  return (await ruf('GET', '/lage')).j.uhr.bpm;
};
const transport = async (aktion) => {
  const r = await ruf('POST', '/proj/transport', aktion === 'start' ? { aktion, beat: 0 } : { aktion });
  if (r.code !== 200) throw new Fehl(`/proj/transport ${aktion} → ${grundVon(r)}`);
};
let punkt = 'Aufbau';
const fmt = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));
const noten = (ton) => Array.from({ length: 8 }, (_, i) => ({ beat: i, laenge: 0.5, ton, vel: 110 }));
const eigeneSlugs = [];
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');

// WAV lesen: float32 (Export) oder PCM 16/24 Bit (Take); Rückgabe Float32Array der verschränkten Werte
function liesWav(datei) {
  const b = fs.readFileSync(datei);
  if (b.toString('latin1', 0, 4) !== 'RIFF') throw new Fehl(`${datei}: kein RIFF`);
  let o = 12, tag = 0, bits = 0, kanaele = 0;
  while (o + 8 <= b.length) {
    const id = b.toString('latin1', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { tag = b.readUInt16LE(o + 8); kanaele = b.readUInt16LE(o + 10); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') {
      const roh = b.subarray(o + 8, Math.min(b.length, o + 8 + n));
      // 0xfffe (erweitert) gilt nur mit 32 Bit als float32; andere Formate wirft der Rest unten
      if ((tag === 3 || tag === 0xfffe) && bits === 32) { const out = new Float32Array(roh.length / 4); for (let i = 0; i < out.length; i++) out[i] = roh.readFloatLE(i * 4); return { daten: out, kanaele }; }
      if (bits === 16) { const out = new Float32Array(roh.length / 2); for (let i = 0; i < out.length; i++) out[i] = roh.readInt16LE(i * 2) / 32768; return { daten: out, kanaele }; }
      if (bits === 24) { const out = new Float32Array(Math.floor(roh.length / 3)); for (let i = 0; i < out.length; i++) out[i] = roh.readIntLE(i * 3, 3) / 8388608; return { daten: out, kanaele }; }
      throw new Fehl(`${datei}: Format ${tag}/${bits} Bit nicht unterstützt`);
    }
    o += 8 + n + (n % 2);
  }
  throw new Fehl(`${datei}: kein data-Block`);
}
const maxAbw = (a, b) => { let m = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i])); return a.length === b.length ? m : Infinity; };
const spitzeLin = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };
const dbfs = (x) => (x > 0 ? 20 * Math.log10(x) : -200);
const sha = (datei) => createHash('sha256').update(fs.readFileSync(datei)).digest('hex');
// Der Export liest den Reglerstand aus dem Zustand-Fach des Kerns (render_main.cpp:122-141), das der Kern alle 50 ms schreibt (netz.cpp:654, 20 Hz).
// Unmittelbar nach einer Regleränderung kann es einen Zwischenwert der 10-ms-Rampe halten: gemessen 2 von 7 sofortigen Exporten nach einem Fader-Wechsel
// (-25,304 und -27,917 statt -27,052 dBFS), 0 von 7 nach 1,5 s Wartezeit. Darum wartet jeder Export SETTLE_MS, bevor er läuft.
const SETTLE_MS = 1000;
const exportiere = async (von, bis, abgriff) => { await warte(SETTLE_MS); return erwarte200('/proj/export', await ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis, ...(abgriff ? { abgriff } : {}) }, CYPHER)).j; };
// Slice 2: ein Export, dessen Antwort nicht 200 sein muss (Fehlerfälle); wartet ebenso SETTLE_MS
const exportiereRoh = async (koerper) => { await warte(SETTLE_MS); return ruf('POST', '/proj/export', koerper, CYPHER); };

async function neuesProjekt(name) {
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `${name}-${zeit}` }));
  const slug = r.j.slug ?? r.j.projekt?.slug;
  if (!slug) throw new Fehl(`/proj/neu ohne slug: ${JSON.stringify(r.j).slice(0, 200)}`);
  eigeneSlugs.push(slug);
  return slug;
}
const spurId = async (name) => { const s = (await projektJetzt()).spuren.find((x) => x.name === name); if (!s) throw new Fehl(`Spur ${name} fehlt`); return s.id; };

async function lauf() {
  const bpm = await warteAufKern();
  info(`Instanz ${instanz}, ${URL}, Kern ${bpm} BPM, Projektwurzel ${wurzel}`);

  // --- Aufbau: r1-s1 mit drei RB-338-Spuren (Ton 36, 43, 48), Loop 0..8 ---
  const slugS1 = await neuesProjekt('r1-s1');
  const befehle = [{ befehl: 'tempo_setzen', bpm }];
  for (let n = 1; n <= 3; n++) befehle.push({ befehl: 'spur_neu', art: 'instrument', name: `R${n}` });
  [36, 43, 48].forEach((ton, i) => befehle.push({ befehl: 'clip_neu', spur_id: `s${i + 1}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(ton) }));
  befehle.push({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 });
  const a0 = await aendern('R1 Aufbau', befehle);
  const ids = (await projektJetzt()).spuren.map((s) => s.id);
  info(`Aufbau: ${slugS1}, rev ${a0.rev}, Spuren ${ids.join(',')}`);
  const [S1, S2, S3] = ids;

  // --- AK1/AK3-live: leere Gruppe ändert nichts ---
  punkt = 'AK1/AK3';
  const E0 = await exportiere(0, 8);
  const E0b = await exportiere(0, 8);
  const kontrolle = sha(E0.datei) === sha(E0b.datei);
  notiere('AK1 Vorbedingung: zwei Exporte desselben Stands sind bitgleich (sonst sagt der Vergleich unten nichts)', kontrolle, `${sha(E0.datei).slice(0, 16)} gegen ${sha(E0b.datei).slice(0, 16)}; spitze_db ${fmt(E0.spitze_db)}, frames ${E0.frames}`);
  await aendern('R1 leere Gruppe', [{ befehl: 'gruppenspur_neu' }]);
  const E1 = await exportiere(0, 8);
  const p1 = await projektJetzt();
  notiere('AK1/AK3 leere Gruppe: Export bitgleich (sha256), Projekt im Speicher cypherdj-projekt/2', kontrolle && sha(E0.datei) === sha(E1.datei) && p1.format === 'cypherdj-projekt/2' && p1.gruppen.length === 1,
    `${sha(E0.datei).slice(0, 16)} gegen ${sha(E1.datei).slice(0, 16)}; format ${p1.format}; gruppen ${p1.gruppen.map((g) => g.id).join(',')}`);
  const gid = p1.gruppen[0].id;

  // --- Gruppieren ändert den Pegel nicht ---
  punkt = 'Gruppieren';
  await aendern('R1 s2 und s3 in die Gruppe', [{ befehl: 'ziel_setzen', strang_id: S2, ausgang: { art: 'gruppe', id: gid } }, { befehl: 'ziel_setzen', strang_id: S3, ausgang: { art: 'gruppe', id: gid } }]);
  const E2 = await exportiere(0, 8);
  const abw = maxAbw(liesWav(E0.datei).daten, liesWav(E2.datei).daten);
  notiere('Gruppieren s2, s3 in g1 (Fader 0 dB) ändert den Pegel nicht (Abweichung <= 3e-6, -110 dBFS)', abw <= 3e-6 && E2.frames === E0.frames,
    `größte Abweichung ${abw.toExponential(2)} (${fmt(dbfs(abw))} dBFS), frames ${E2.frames} gegen ${E0.frames}, Spitze ${fmt(E0.spitze_db)} → ${fmt(E2.spitze_db)} dBFS`);

  // --- AK4 und AK20 ---
  punkt = 'AK4';
  await aendern('R1 AK4 Spur 1 stumm', [{ befehl: 'spur_aendern', spur_id: S1, mute: true }]);
  let P0 = await exportiere(0, 8);
  let gueltig = true;
  if (P0.spitze_db > -3) {
    info(`P0.spitze_db ${fmt(P0.spitze_db)} > -3: Fader von s2 und s3 einmal um 6 dB senken`);
    await aendern('R1 AK4 Material leiser', [{ befehl: 'spur_aendern', spur_id: S2, fader_db: -6 }, { befehl: 'spur_aendern', spur_id: S3, fader_db: -6 }]);
    P0 = await exportiere(0, 8);
  }
  if (P0.spitze_db > -3) { gueltig = false; notiere('AK4/AK20 Vorbedingung', false, `Material zu heiß für AK4 (spitze_db ${fmt(P0.spitze_db)}), ungültig, nicht bestanden`); }
  if (gueltig) {
    await aendern('R1 AK4 Gruppen-Fader -6,02', [{ befehl: 'gruppenspur_aendern', gruppe_id: gid, fader_db: -6.0206 }]);
    const P1 = await exportiere(0, 8);
    const d4 = P1.spitze_db - P0.spitze_db;
    notiere('AK4 Gruppen-Fader -6,02 dB senkt die Export-Spitze um 6,02 ±0,1 dB', Math.abs(d4 + 6.02) <= 0.1 && sha(P0.datei) !== sha(P1.datei),
      `P0 ${fmt(P0.spitze_db)} dBFS, P1 ${fmt(P1.spitze_db)} dBFS, Differenz ${fmt(d4)} dB (verlangt -6,02 ±0,1); sha verschieden: ${sha(P0.datei) !== sha(P1.datei)}`);
    await aendern('R1 AK20 Gruppen-Fader zurück, Master -6,02', [{ befehl: 'gruppenspur_aendern', gruppe_id: gid, fader_db: 0 }, { befehl: 'master_aendern', fader_db: -6.0206 }]);
    punkt = 'AK20';
    const P2 = await exportiere(0, 8);
    const d20 = P2.spitze_db - P0.spitze_db;
    notiere('AK20 Master-Fader -6,02 dB senkt die Export-Spitze um 6,02 ±0,1 dB', Math.abs(d20 + 6.02) <= 0.1,
      `P0 ${fmt(P0.spitze_db)} dBFS, Master-Export ${fmt(P2.spitze_db)} dBFS, Differenz ${fmt(d20)} dB`);
    await aendern('R1 Master zurück', [{ befehl: 'master_aendern', fader_db: 0 }]);
    // Negativ-Kontrolle: Spur 1 laut, Spur 2 und 3 stumm, die Gruppe ist leer im Klang: der Gruppen-Fader ±6 dB ändert die Spitze nicht
    punkt = 'AK4-NK';
    await aendern('R1 AK4 NK Aufbau', [{ befehl: 'spur_aendern', spur_id: S1, mute: false }, { befehl: 'spur_aendern', spur_id: S2, mute: true }, { befehl: 'spur_aendern', spur_id: S3, mute: true }]);
    await aendern('R1 AK4 NK +6', [{ befehl: 'gruppenspur_aendern', gruppe_id: gid, fader_db: 6 }]);
    const Nhi = await exportiere(0, 8);
    await aendern('R1 AK4 NK -6', [{ befehl: 'gruppenspur_aendern', gruppe_id: gid, fader_db: -6 }]);
    const Nlo = await exportiere(0, 8);
    notiere('AK4 Negativ-Kontrolle: Gruppe ohne klingendes Mitglied, Gruppen-Fader ±6 dB ändert die Spitze um <= 0,05 dB', Math.abs(Nhi.spitze_db - Nlo.spitze_db) <= 0.05 && Nhi.spitze_db > -120,
      `+6 dB: ${fmt(Nhi.spitze_db)} dBFS, -6 dB: ${fmt(Nlo.spitze_db)} dBFS, Differenz ${fmt(Math.abs(Nhi.spitze_db - Nlo.spitze_db))} dB (Spur 1 klingt: Spitze > -120)`);
    await aendern('R1 Aufbau zurück', [{ befehl: 'gruppenspur_aendern', gruppe_id: gid, fader_db: 0 }, { befehl: 'spur_aendern', spur_id: S2, mute: false }, { befehl: 'spur_aendern', spur_id: S3, mute: false }]);
  }

  // --- AK7 ---
  punkt = 'AK7';
  const r7a = await aendernRoh('R1 AK7 Zyklus', [{ befehl: 'ziel_setzen', strang_id: gid, ausgang: { art: 'gruppe', id: gid } }]);
  notiere('AK7 Gruppe in sich selbst → 409 routing_zyklus', r7a.code === 409 && r7a.j?.fehler === 'routing_zyklus', grundVon(r7a));
  const r7b = await aendernRoh('R1 AK7 unbekannt', [{ befehl: 'ziel_setzen', strang_id: S1, ausgang: { art: 'gruppe', id: 'g9' } }]);
  notiere('AK7 Ziel g9 → ziel_unbekannt (404 oder 409)', (r7b.code === 404 || r7b.code === 409) && r7b.j?.fehler === 'ziel_unbekannt', grundVon(r7b));
  const rev7 = await holeRev();
  const r7c = await aendernRoh('R1 AK7 NK s1 → g1', [{ befehl: 'ziel_setzen', strang_id: S1, ausgang: { art: 'gruppe', id: gid } }]);
  notiere('AK7 Negativ-Kontrolle: s1 → g1 → 200, rev steigt', r7c.code === 200 && r7c.j.rev > rev7, `${grundVon(r7c)}; rev ${rev7} → ${r7c.j?.rev}`);
  const r7d = await aendernRoh('R1 AK7 s1 zurück', [{ befehl: 'ziel_setzen', strang_id: S1, ausgang: 'master' }]);
  if (r7d.code !== 200) throw new Fehl(`s1 zurück auf master → ${grundVon(r7d)}`);

  // --- Pegel/Anzeige ---
  punkt = 'Pegel';
  await transport('start');
  await warte(3000);
  const peg = await pegel(2);
  await transport('stopp');
  const gp = peg['grp/1'], pp = peg['pm'];
  notiere('Pegel: grp/1 und pm > -60 dBFS, grp/2 fehlt (kein Mitglied)', Boolean(gp) && Boolean(pp) && gp.max_db > -60 && pp.max_db > -60 && !('grp/2' in peg),
    `grp/1 ${JSON.stringify(gp)}, pm ${JSON.stringify(pp)}, grp/2 ${'grp/2' in peg ? JSON.stringify(peg['grp/2']) : 'fehlt'}; Kanäle ${Object.keys(peg).filter((x) => !x.startsWith('spur/')).sort().join(' ')}`);

  // --- I08-Regress: Aufnahme einer Audio-Spur, die in eine Gruppe geht ---
  // Steht vor dem Rückweg-Punkt: ein Griff der Hand an grp/1/fader sperrt den Regler für Cypher bis 32 Beats nach der letzten Berührung
  // (regler_beim_menschen, ablauf.cpp:120 und 134), und das neue Projekt des Regress legt wieder grp/1 an.
  punkt = 'I08';
  await aufnahmeRegress(bpm);
  erwarte200('/proj/oeffnen (zurück zu r1-s1)', await ruf('POST', '/proj/oeffnen', { slug: slugS1 }, CYPHER));
  await warte(1500);

  // --- AK22/Zug (der Weg der Seite: viele Einzelanfragen) ---
  punkt = 'AK22/Zug';
  const zug = async (befehlVon, wert0) => {
    const n0 = (await verlauf()).length, luecken = [];
    let t = Date.now();
    for (let i = 1; i <= 6; i++) {
      await aendern(`R1 Zug ${i}`, [befehlVon(wert0 - i)]);
      const j = Date.now(); luecken.push(j - t); t = j;
      await warte(100);
    }
    return { plus: (await verlauf()).length - n0, maxLuecke: Math.max(...luecken.slice(1)) };
  };
  const pv = await projektJetzt();
  const vor = { g: pv.gruppen[0].fader_db, m: pv.master.fader_db, s: pv.spuren.find((s) => s.id === S1).fader_db };
  const zg = await zug((w) => ({ befehl: 'gruppenspur_aendern', gruppe_id: gid, fader_db: w }), 0);
  const zm = await zug((w) => ({ befehl: 'master_aendern', fader_db: w }), 0);
  const zs = await zug((w) => ({ befehl: 'spur_aendern', spur_id: S1, fader_db: w }), 0);
  notiere('AK22/Zug: sechs Anfragen an den Gruppen-Fader = +1 Verlaufseintrag; Master +1; Referenz Spur-Fader +1', zg.plus === 1 && zm.plus === 1 && zs.plus === 1,
    `Gruppe +${zg.plus}, Master +${zm.plus}, Spur +${zs.plus} (längste Pause zwischen zwei Anfragen ${Math.max(zg.maxLuecke, zm.maxLuecke, zs.maxLuecke)} ms)`);
  const nach = await projektJetzt();
  const imZug = nach.gruppen[0].fader_db === -6 && nach.master.fader_db === -6 && nach.spuren.find((s) => s.id === S1).fader_db === -6;
  const undoEins = async () => erwarte200('/proj/undo', await ruf('POST', '/proj/undo', { rev: await holeRev() }, CYPHER));
  await undoEins(); const u1 = await projektJetzt();
  await undoEins(); const u2 = await projektJetzt();
  await undoEins(); const u3 = await projektJetzt();
  notiere('AK22/Zug: je ein Undo je Zug stellt den Wert vor dem Zug her (Spur, Master, Gruppe)',
    imZug && u1.spuren.find((s) => s.id === S1).fader_db === vor.s && u1.master.fader_db === -6 && u2.master.fader_db === vor.m && u2.gruppen[0].fader_db === -6 && u3.gruppen[0].fader_db === vor.g,
    `nach den Zügen g ${nach.gruppen[0].fader_db} m ${nach.master.fader_db} s ${nach.spuren.find((s) => s.id === S1).fader_db}; Undo 1 s ${u1.spuren.find((s) => s.id === S1).fader_db} (soll ${vor.s}); Undo 2 m ${u2.master.fader_db} (soll ${vor.m}); Undo 3 g ${u3.gruppen[0].fader_db} (soll ${vor.g})`);
  const n1 = (await verlauf()).length;
  await aendern('R1 NK Name 1', [{ befehl: 'gruppenspur_aendern', gruppe_id: gid, name: 'Eins' }]);
  await aendern('R1 NK Name 2', [{ befehl: 'gruppenspur_aendern', gruppe_id: gid, name: 'Zwei' }]);
  const n2 = (await verlauf()).length;
  notiere('AK22/Zug Negativ-Kontrolle: der Name ist kein Mixer-Feld, zwei Änderungen = +2 Einträge', n2 - n1 === 2, `+${n2 - n1}`);

  // --- AK22/Rückweg: Hand → Projekt ---
  punkt = 'AK22/Rückweg';
  await aendern('R1 Rückweg Fader auf 0', [{ befehl: 'gruppenspur_aendern', gruppe_id: gid, fader_db: 0 }]);
  await warte(600);
  const nVerl = (await verlauf()).length;
  const imProjekt = async () => (await projektJetzt()).gruppen[0].fader_db;
  const g1 = await ruf('POST', '/griff', { pfad: 'grp/1/fader', u: 1 });
  await warte(2500);
  const f1 = await imProjekt();
  const p = midiRoh('grp/1/fader', -20) / midiRoh('grp/1/fader', f1);
  const g2 = await ruf('POST', '/griff', { pfad: 'grp/1/fader', u: p });
  const angekommen = await bisWahr(async () => Math.abs((await imProjekt()) + 20) <= 0.5, 6000);
  await warte(1500);
  const vl = await verlauf();
  const neu = vl.slice(nVerl);
  const eigene = vl.filter((e) => /^R1 /.test(e.label));
  const griffEintrag = neu.find((e) => e.quelle === 'andreas' && /^Mixer: .* fader$/.test(e.label));
  notiere('AK22/Rückweg: zwei Griffe an grp/1/fader landen im Projekt (−20 dB ±0,5), Eintrag mit Quelle andreas, Änderungen von Cypher mit Quelle cypher',
    g1.code === 200 && g2.code === 200 && angekommen && Boolean(griffEintrag) && eigene.length > 0 && eigene.every((e) => e.quelle === 'cypher'),
    `/griff ${g1.code} (u 1) → Projekt ${fmt(f1)} dB; /griff ${g2.code} (u ${p.toFixed(4)}) → gruppen[0].fader_db = ${fmt(await imProjekt())}; Griff-Eintrag ${JSON.stringify(griffEintrag ? { quelle: griffEintrag.quelle, label: griffEintrag.label } : null)}; ${eigene.length} eigene Einträge, alle cypher: ${eigene.every((e) => e.quelle === 'cypher')}`);

  // --- AK28: Varianten neben einer Gruppen-Spur ---
  punkt = 'AK28';
  await aendern('R1 Varianten Aufbau', [{ befehl: 'spur_neu', art: 'instrument', name: 'V1', gruppe: 'bass' }, { befehl: 'spur_neu', art: 'instrument', name: 'V2', gruppe: 'bass' }]);
  const v1 = await spurId('V1'), v2 = await spurId('V2');
  await aendern('R1 Varianten stumm', [{ befehl: 'spur_aendern', spur_id: v2, mute: true }]);
  await aendern('R1 Variante V2', [{ befehl: 'variante_waehlen', gruppe: 'bass', spur_id: v1 }]);
  const pv28 = await projektJetzt();
  notiere('AK28 variante_waehlen neben einer Gruppen-Spur: Variante V1 laut, V2 stumm, gruppen[0].mute bleibt false',
    pv28.spuren.find((s) => s.id === v1).mute === false && pv28.spuren.find((s) => s.id === v2).mute === true && pv28.gruppen[0].mute === false,
    `V1 mute ${pv28.spuren.find((s) => s.id === v1).mute}, V2 mute ${pv28.spuren.find((s) => s.id === v2).mute}, gruppen[0].mute ${pv28.gruppen[0].mute}`);

  // --- NK ---
  punkt = 'NK';
  const gr = await ruf('POST', '/griff', { pfad: 'grp/9/fader', u: 0.5 });
  notiere('NK /griff grp/9/fader abgelehnt', gr.code === 400, `${gr.code} ${gr.j?.fehler ?? ''}`);
  const rg = await ruf('POST', '/regler', { pfad: 'grp/1/fader', nach: -3 }, CYPHER);
  const rp = await ruf('POST', '/regler', { pfad: 'pm/fader', nach: -3 }, CYPHER);
  notiere('NK POST /regler grp/1/fader und pm/fader → 409 ueber_projekt', rg.code === 409 && rg.j?.fehler === 'ueber_projekt' && rp.code === 409 && rp.j?.fehler === 'ueber_projekt', `grp ${grundVon(rg)}; pm ${grundVon(rp)}`);

  // --- Umweg über die Automationsspur ---
  punkt = 'Umweg';
  const pu0 = await projektJetzt(), nVerlU = (await verlauf()).length;
  const fader0 = pu0.gruppen[0].fader_db, master0 = pu0.master.fader_db;
  const umweg = async (ziel) => ruf('POST', '/spur', { spur: { name: 'r1-umweg', fahrten: [{ ziel, ab_takt: 1, takte: 1, nach: -20 }] } }, CYPHER);
  const ug = await umweg('grp/1/fader'), up = await umweg('pm/fader');
  const laufend = (await ruf('GET', '/spur')).j?.laufend ?? [];
  await warte(2000);
  const pu1 = await projektJetzt();
  notiere('Umweg: POST /spur mit Ziel grp/1/fader und pm/fader → 409 ueber_projekt, keine laufende Spur, Fader und Verlauf unverändert',
    ug.code === 409 && ug.j?.fehler === 'ueber_projekt' && ug.j?.ziel === 'grp/1/fader' && up.code === 409 && up.j?.fehler === 'ueber_projekt' && up.j?.ziel === 'pm/fader' &&
    laufend.length === 0 && pu1.gruppen[0].fader_db === fader0 && pu1.master.fader_db === master0 && (await verlauf()).length === nVerlU,
    `grp ${grundVon(ug)} (${ug.j?.ziel}); pm ${grundVon(up)} (${up.j?.ziel}); laufend ${laufend.length}; Gruppen-Fader ${fader0} → ${pu1.gruppen[0].fader_db}, Master ${master0} → ${pu1.master.fader_db}; Verlauf ${nVerlU} → ${(await verlauf()).length}`);
  const vorStopp = await ruf('POST', '/spur/stopp', { name: 'r1-umweg' }, CYPHER);   // sauberer Stand: die abgelehnten Versuche oben haben keine Spur angelegt (404 keine_spur)
  info(`Vor der Negativ-Kontrolle: /spur/stopp r1-umweg → ${grundVon(vorStopp)}`);
  let uk = await umweg('erz/2/filter');
  let ukText = grundVon(uk);
  if (uk.code === 409 && uk.j?.fehler === 'auto_aus') { uk = await ruf('POST', '/spur', { spur: { name: 'r1-umweg', fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: 0 }] } }); ukText += ` → ohne Cypher-Kopf: ${grundVon(uk)}`; }
  notiere('Umweg Negativ-Kontrolle: Ziel erz/2/filter → 200', uk.code === 200, ukText);
  await ruf('POST', '/spur/stopp', { name: 'r1-umweg' }, CYPHER);

  // --- Migration einer /1-Datei (zuletzt: sie ersetzt das offene Projekt) ---
  punkt = 'Migration';
  await migration(slugS1);
}

async function aufnahmeRegress(bpm) {
  await neuesProjekt('r1-rec');
  await aendern('R1 I08 Aufbau', [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'audio', name: 'Rec1' }]);
  const rec = await spurId('Rec1');
  await aendern('R1 I08 Gruppe, Eingang, Arm', [{ befehl: 'gruppenspur_neu', name: 'Aufnahme', mitglieder: [rec] }]);
  await aendern('R1 I08 Eingang und Arm', [{ befehl: 'spur_aendern', spur_id: rec, eingang: { art: 'intern', name: 'erz/1' }, arm: true }]);
  const p = await projektJetzt();
  const s = p.spuren.find((x) => x.id === rec);
  info(`I08 Aufbau: Spur ${rec} ausgang ${JSON.stringify(s.ausgang)}, aufnahme ${JSON.stringify(s.aufnahme)}`);
  const nimmAuf = async (strudel, ms) => {
    const st = await ruf('POST', '/strudel', { text: strudel, strom: 1 });
    await warte(2500);
    const start = await ruf('POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
    await warte(ms);
    const stopp = await ruf('POST', '/proj/aufnahme', { aktion: 'stopp' });
    await ruf('POST', '/proj/transport', { aktion: 'stopp' });
    let z = null;
    for (let i = 0; i < 100; i++) { z = (await ruf('GET', '/proj/aufnahme')).j; if (z?.lauf === null) break; await warte(50); }
    const takes = stopp.j?.takes ?? z?.letzte?.takes ?? z?.letzte?.antwort?.takes ?? [];
    return { strudel: st.code, start, stopp, takes, z };
  };
  const SIG = 's("bd*4, hh*8, ~ cp").gain(0.9)';
  const a = await nimmAuf(SIG, 6000);
  const t = a.takes[0];
  let spitze = -200, wavFrames = 0;
  if (t?.datei && fs.existsSync(t.datei)) { const w = liesWav(t.datei); wavFrames = w.daten.length / (w.kanaele || 1); spitze = dbfs(spitzeLin(w.daten)); }
  notiere('I08 Aufnahme einer Audio-Spur in einer Gruppe: Start 200, Take frames > 0, luecken 0, Datei-Spitze > -40 dBFS',
    a.start.code === 200 && a.stopp.code === 200 && Boolean(t) && !t.fehler && t.frames > 0 && t.luecken === 0 && spitze > -40 && wavFrames === t.frames,
    `start ${grundVon(a.start)}; stopp ${grundVon(a.stopp)}; Take ${JSON.stringify(t ?? null)}; WAV-Frames ${wavFrames}, Spitze ${fmt(spitze)} dBFS`);
  const clips = (await projektJetzt()).spuren.find((x) => x.id === rec).clips?.length ?? 0;
  notiere('I08 der Take liegt als Clip auf der Spur', clips >= 1, `${clips} Clip(s) auf ${rec}`);
  // Negativ-Kontrolle: Stille. Der Test muss sie erkennen (Spitze 0 → "nicht bestanden"), sonst prüfte er nichts
  const b = await nimmAuf('silence', 3000);
  const tb = b.takes[0];
  let spitzeB = -200;
  if (tb?.datei && fs.existsSync(tb.datei)) spitzeB = dbfs(spitzeLin(liesWav(tb.datei).daten));
  const wuerdeBestehen = Boolean(tb) && !tb.fehler && tb.frames > 0 && tb.luecken === 0 && spitzeB > -40;
  notiere('I08 Negativ-Kontrolle: derselbe Ablauf mit Stille liefert Spitze <= -90 dBFS, die Bewertung "bestanden" träfe nicht zu', !wuerdeBestehen && spitzeB <= -90,
    `Take ${JSON.stringify(tb ?? null)}; Spitze ${fmt(spitzeB)} dBFS`);
  await ruf('POST', '/strudel', { text: 'silence', strom: 1 });
}

async function migration(slugOffen) {
  const slugAlt = await neuesProjekt('r1-alt');
  await aendern('R1 alt Aufbau', [{ befehl: 'spur_neu', art: 'audio', name: 'Alt1' }]);
  await ruf('POST', '/proj/oeffnen', { slug: slugOffen }, CYPHER);              // gibt r1-alt frei, bevor die Datei auf der Platte umgeschrieben wird
  const datei = path.join(wurzel, slugAlt, 'project.json');
  const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  j.format = 'cypherdj-projekt/1';
  delete j.gruppen; delete j.master;
  if (j.naechste_id) delete j.naechste_id.gruppe;
  for (const s of j.spuren) delete s.ausgang;
  fs.writeFileSync(datei, JSON.stringify(j, null, 2));
  const platteVorOeffnen = JSON.parse(fs.readFileSync(datei, 'utf8')).format;
  const op = await ruf('POST', '/proj/oeffnen', { slug: slugAlt }, CYPHER);
  const platteNachOeffnen = JSON.parse(fs.readFileSync(datei, 'utf8')).format;
  const p = (await ruf('GET', '/proj/aktuell')).j?.projekt;
  notiere('Migration: /1-Datei öffnen → 200, im Speicher /2 mit gruppen [] und master 0 dB, die Spur bleibt',
    op.code === 200 && p?.format === 'cypherdj-projekt/2' && Array.isArray(p.gruppen) && p.gruppen.length === 0 && p.master?.fader_db === 0 && p.spuren.length === 1,
    `oeffnen ${grundVon(op)}; format ${p?.format}; gruppen ${JSON.stringify(p?.gruppen)}; master ${JSON.stringify(p?.master)}; spuren ${p?.spuren?.length}`);
  await aendern('R1 alt Änderung', [{ befehl: 'spur_aendern', spur_id: p.spuren[0].id, fader_db: -3 }]);
  const nachher = JSON.parse(fs.readFileSync(datei, 'utf8'));
  notiere('Migration: die Datei war /1 (Negativ-Kontrolle: so geschrieben), nach einer Änderung steht auf der Platte cypherdj-projekt/2 mit gruppen und master', platteVorOeffnen === 'cypherdj-projekt/1' && nachher.format === 'cypherdj-projekt/2' && Array.isArray(nachher.gruppen) && nachher.master?.fader_db === 0,
    `Platte vor dem Öffnen ${platteVorOeffnen}, direkt nach dem Öffnen ${platteNachOeffnen}, nach der Änderung ${nachher.format}, gruppen ${JSON.stringify(nachher.gruppen)}, master ${JSON.stringify(nachher.master)}`);
}

// ===================================================================================================================================================================
// Slice 2 (E2): Export-Abgriff vor dem Set-Limiter, Lampe SET LIMITER
// ===================================================================================================================================================================

// SSE /strom mitlesen; sammelt jede Meldung {a, f} mit Zeitstempel, bis stop() gerufen wird
function stromLesen() {
  const ac = new AbortController();
  const meldungen = [];
  let streamFehler = null;
  const fertig = (async () => {
    try {
      const r = await fetch(URL + '/strom', { signal: ac.signal });
      const dec = new globalThis.TextDecoder();
      let puf = '';
      for await (const stueck of r.body) {
        puf += dec.decode(stueck, { stream: true });
        let i;
        while ((i = puf.indexOf('\n\n')) >= 0) {
          const block = puf.slice(0, i);
          puf = puf.slice(i + 2);
          if (!block.startsWith('data: ')) continue;
          try { meldungen.push({ t: Date.now(), ...JSON.parse(block.slice(6)) }); } catch { /* halbe Zeile */ }
        }
      }
    } catch (e) { if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') streamFehler = e; }
  })();
  return { meldungen, stop: async () => { ac.abort(); await fertig; if (streamFehler) throw new Fehl(`/strom: ${streamFehler.message}`); } };
}

// Programm des Verfahrens A7 (oder die Isolator-Referenz) mit CYPHERDJ_INSTANZ; Ausgabe und Rückgabe wörtlich
const prog = (programm, args) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const letzteZeile = (t) => t.trim().split('\n').filter(Boolean).pop() ?? '';
const jsonZeile = (t) => { try { return JSON.parse(letzteZeile(t)); } catch { return null; } };
const geladen = async () => { const a = await aktuell(); return a.kern?.rev_geladen === a.projekt.wiedergabe_rev; };
const warteGeladen = async () => {
  if (!(await bisWahr(geladen, 60000))) throw new Fehl('der Kern hat die Wiedergabe nicht geladen (kern.rev_geladen gleich projekt.wiedergabe_rev blieb aus)');
  await warte(5000);   // Zustand-Fach und Neustart-Zustand des Kerns nachführen lassen (N8; die Vorbedingung liest den Neustart-Zustand)
};
const notenN = (ton, n) => Array.from({ length: n }, (_, i) => ({ beat: i, laenge: 0.5, ton, vel: 110 }));

// Aufbau eines Projekts mit n RB-338-Spuren gleicher Tonhöhe (gleichphasig: die Spitzen addieren sich), Clips der Länge laenge, optional Loop 0..laenge
async function projektAufbauen(name, bpm, n, ton, laenge, fader, master, loop) {
  const slug = await neuesProjekt(name);
  await aendern(`R1 ${name} Spuren`, [{ befehl: 'tempo_setzen', bpm }, ...Array.from({ length: n }, (_, i) => ({ befehl: 'spur_neu', art: 'instrument', name: `R${i + 1}` }))]);
  const ids = (await projektJetzt()).spuren.map((s) => s.id);
  const b = ids.map((id) => ({ befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: 0, laenge_beats: laenge, noten: notenN(ton, laenge) }));
  if (loop) b.push({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: laenge });
  for (const id of ids) b.push({ befehl: 'spur_aendern', spur_id: id, fader_db: fader });
  if (master !== 0) b.push({ befehl: 'master_aendern', fader_db: master });
  await aendern(`R1 ${name} Clips und Fader`, b);
  return { slug, ids };
}

// Null-Test des Produktions-Exports gegen den Ring-Mitschnitt (A7 mit Nachzug N7). Das Projekt ist offen und geladen, der Transport steht.
// Rückgabe die Messwerte; geurteilt wird im Aufrufer.
async function nullLive(kz, bpm, beats, sekunden) {
  const dir = path.join(ORDNER, kz);
  fs.mkdirSync(path.join(dir, 'w'), { recursive: true });
  const nr = (await aktuell()).projekt.wiedergabe_rev;
  const werkzeug = (n) => path.join(BAU, n);
  const vb = await prog(werkzeug('cypherdj-nulltest'), ['--vorbedingung', '--bpm', String(bpm)]);
  fs.writeFileSync(path.join(dir, 'vorbedingung.json'), `${vb.out}${vb.err}rc=${vb.rc}\n`);
  const vbj = jsonZeile(vb.out);
  if (vb.rc !== 0 || vbj?.vorbedingung !== 'erfuellt') return { ungueltig: `Vorbedingung des Null-Tests nicht erfüllt (rc ${vb.rc}): ${letzteZeile(vb.out) || letzteZeile(vb.err)}` };
  // Mitschnitt des Ring-Masters, Transport-Start nach 0,5 s, SSE für ursprung_sample
  const sse = stromLesen();
  const mit = prog(werkzeug('cypherdj-mitschnitt'), ['--sekunden', String(sekunden), '--aus', path.join(dir, 'live.f32')]);
  await warte(500);
  const start = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);
  const m = await mit;
  await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
  await warte(300);
  await sse.stop();
  fs.writeFileSync(path.join(dir, 'live.json'), m.out);
  fs.writeFileSync(path.join(dir, 'mitschnitt.err'), `${m.err}rc=${m.rc}\n`);
  fs.writeFileSync(path.join(dir, 'strom.jsonl'), sse.meldungen.map((x) => JSON.stringify(x)).join('\n'));
  const live = jsonZeile(m.out);
  if (start.code !== 200 || m.rc !== 0 || !live) return { ungueltig: `Mitschnitt gescheitert: Transport ${grundVon(start)}, cypherdj-mitschnitt rc ${m.rc} ${m.err.trim()}` };
  const arrM = sse.meldungen.filter((x) => x.a === '/zustand/arr' && typeof x.f?.limiter_db === 'number');
  const einsatz = sse.meldungen.find((x) => x.a === '/zustand/arr' && x.f?.status === 2);
  if (!einsatz) return { ungueltig: 'kein /zustand/arr mit status 2 im Strom (ursprung_sample unbekannt)' };
  const ursprung = einsatz.f.ursprung_sample;
  const limiterMin = arrM.length ? Math.min(...arrM.map((x) => x.f.limiter_db)) : null;
  // Render des Produktions-Abgriffs und des Set-Abgriffs mit demselben Zustand
  const render = async (name, abgriff) => {
    const r = await prog(werkzeug('cypherdj-render'), ['--nr', String(nr), '--von-beat', '0', '--bis-beat', String(beats), '--bpm', String(bpm), '--aus', path.join(dir, 'w', `${name}.wav`), '--abgriff', abgriff]);
    fs.writeFileSync(path.join(dir, 'w', `${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const p = await render('p', 'produktion'), s = await render('s', 'set');
  if (p.rc !== 0 || s.rc !== 0 || !p.j || !s.j) return { ungueltig: `Render gescheitert: produktion rc ${p.rc} ${p.err}; set rc ${s.rc} ${s.err}` };
  const iso = await prog(ISO_REF, [path.join(dir, 'w', 'p.wav'), path.join(dir, 'w', 'p_iso.wav')]);
  if (iso.rc !== 0) return { ungueltig: `Isolator-Referenz gescheitert (rc ${iso.rc}): ${iso.err.trim()}` };
  const vergleich = async (name, wav, rj) => {
    const r = await prog(werkzeug('cypherdj-nulltest'), ['--live', path.join(dir, 'live.f32'), '--live-s0', String(live.s0), '--grenze', String(live.grenze), '--ursprung', String(ursprung), '--render', wav,
      '--start-sample', String(rj.start_sample), '--frames', String(rj.frames), '--vorhalt', String(rj.vorhalt), '--quantum', String(rj.quantum)]);
    fs.writeFileSync(path.join(dir, `nulltest-${name}.json`), `${r.out}${r.err}rc=${r.rc}\n`);
    return { rc: r.rc, j: jsonZeile(r.out), err: r.err.trim() };
  };
  const vPI = await vergleich('produktion-isolator', path.join(dir, 'w', 'p_iso.wav'), p.j);
  const vS = await vergleich('set', path.join(dir, 'w', 's.wav'), s.j);
  const vPR = await vergleich('produktion-roh', path.join(dir, 'w', 'p.wav'), p.j);   // Gegenprobe N7: ohne Isolator nie null
  return { dir, nr, live, ursprung, p: p.j, s: s.j, vPI, vS, vPR, limiterMin, arrN: arrM.length };
}

const nl = (v) => (v?.j ? `${v.j.urteil}${v.j.ursache ? `/${v.j.ursache}` : ''} rest ${fmt(v.j.rest_db)} dBFS, 1 Sample verschoben ${fmt(v.j.verschoben_db)} dBFS, Signal ${fmt(v.j.signal_db)} dBFS, Phase live ${v.j.phase_live} gegen Render ${v.j.phase_render}, Fenster ${v.j.fenster} (rc ${v.rc})` : `keine Ausgabe (rc ${v?.rc}: ${v?.err})`);

// Ein Abschnitt, der scheitern darf, ohne die anderen zu verhindern (im Vorher-Lauf scheitert jeder)
async function abschnitt(name, f) {
  punkt = name;
  try { await f(); } catch (e) { notiere(name, false, e instanceof Fehl ? e.message : `ABBRUCH: ${e.stack ?? String(e)}`); }
}

async function lauf2() {
  const bpm = await warteAufKern();
  info(`Instanz ${instanz}, ${URL}, Kern ${bpm} BPM, Projektwurzel ${wurzel}, Bauordner ${BAU}, Isolator-Referenz ${ISO_REF ?? '(fehlt)'}`);
  if (!ISO_REF || !fs.existsSync(ISO_REF)) notiere('Aufbau', false, `--iso-ref ${ISO_REF ?? '(nicht angegeben)'} fehlt: AK17 live nach Nachzug N7 ist ohne die Isolator-Referenz nicht auswertbar`);
  for (const n of ['cypherdj-render', 'cypherdj-mitschnitt', 'cypherdj-nulltest']) if (!fs.existsSync(path.join(BAU, n))) { notiere('Aufbau', false, `${path.join(BAU, n)} fehlt`); }
  const ak19 = async () => {
    const sse = stromLesen();
    await warte(300);
    await transport('start');
    await warte(3000);
    await transport('stopp');
    await warte(300);
    await sse.stop();
    const arr = sse.meldungen.filter((x) => x.a === '/zustand/arr' && typeof x.f?.limiter_db === 'number');
    return { n: arr.length, min: arr.length ? Math.min(...arr.map((x) => x.f.limiter_db)) : null, alle: sse.meldungen.filter((x) => x.a === '/zustand/arr').length };
  };

  // --- leises Material: zwei RB-338-Spuren (Ton 36 und 43), Fader -12 dB, Master 0 dB ---
  let leise = null;
  await abschnitt('Aufbau leise', async () => {
    const slug = await neuesProjekt('r1-s2-leise');
    await aendern('R1 leise Spuren', [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'instrument', name: 'L1' }, { befehl: 'spur_neu', art: 'instrument', name: 'L2' }]);
    const ids = (await projektJetzt()).spuren.map((s) => s.id);
    await aendern('R1 leise Clips und Fader', [
      { befehl: 'clip_neu', spur_id: ids[0], art: 'midi', start_beat: 0, laenge_beats: 16, noten: notenN(36, 16) },
      { befehl: 'clip_neu', spur_id: ids[1], art: 'midi', start_beat: 0, laenge_beats: 16, noten: notenN(43, 16) },
      { befehl: 'spur_aendern', spur_id: ids[0], fader_db: -12 }, { befehl: 'spur_aendern', spur_id: ids[1], fader_db: -12 }]);
    await warteGeladen();
    leise = { slug, ids };
    info(`Aufbau leise: ${slug}, Spuren ${ids.join(',')}, Fader -12 dB, Master 0 dB, 16 Beats`);
  });

  // AK17 live, leises Material. Steht VOR jedem anderen Transportlauf: der Isolator von erz/4 im Kern ist dann frisch (Nachzug N7)
  await abschnitt('AK17 live', async () => {
    if (!leise || !ISO_REF) throw new Fehl('ohne Projekt oder Isolator-Referenz nicht ausgeführt');
    const sek = Math.ceil((16 * 60) / bpm) + 4;
    let a = await nullLive('ak17-live-leise', bpm, 16, sek);
    for (let v = 2; v <= 3 && a.vPI?.j?.urteil === 'ungueltig'; v++) { info(`AK17 live: Versuch ${v - 1} ungültig (${a.vPI.j.ursache}), noch einmal`); a = await nullLive(`ak17-live-leise-v${v}`, bpm, 16, sek); }
    if (a.ungueltig) throw new Fehl(`AK17 live ungültig, nicht bestanden: ${a.ungueltig}`);
    notiere('AK17 live: Produktions-Export (durch den Isolator von erz/4, Nachzug N7) gegen den Ring-Mitschnitt: bestanden, Rest < -90 dBFS, Selbstprüfung rot, Phase live = Render',
      a.vPI.j?.urteil === 'bestanden' && a.vPI.j.rest_db < -90 && a.vPI.j.verschoben_db > -90 && a.vPI.j.phase_live === a.vPI.j.phase_render && a.vPI.j.signal_db > -60, `${nl(a.vPI)}; Render ${a.p.abgriff}, Spitze ${fmt(a.p.spitze_db)} dBFS, Vorhalt ${a.p.vorhalt}`);
    notiere('AK17 live: Set-Export gegen den Ring-Mitschnitt: bestanden (Rest < -90 dBFS, Selbstprüfung rot)',
      a.vS.j?.urteil === 'bestanden' && a.vS.j.rest_db < -90 && a.vS.j.verschoben_db > -90 && a.vS.j.phase_live === a.vS.j.phase_render, `${nl(a.vS)}; Render ${a.s.abgriff}, Spitze ${fmt(a.s.spitze_db)} dBFS`);
    notiere('AK17 live Gegenprobe (Nachzug N7): der Produktions-Abgriff OHNE Isolator ist nie null (rot, Rest über -90 dBFS)',
      a.vPR.j?.urteil === 'rot' && a.vPR.j.rest_db > -90, nl(a.vPR));
    notiere('AK17 live: leises Material, der Set-Limiter greift nicht ein (limiter_db_max beider Renders <= 0,05, Strom ohne limiter_db < -0,5)',
      a.p.ueber_decke === false && a.s.ueber_decke === false && a.p.limiter_db_max <= 0.05 && a.s.limiter_db_max <= 0.05 && a.arrN > 0 && a.limiterMin > -0.5,
      `limiter_db_max produktion ${a.p.limiter_db_max}, set ${a.s.limiter_db_max}; ${a.arrN} /zustand/arr mit limiter_db im Mitschnitt-Strom, kleinster Wert ${a.limiterMin}`);
  });

  // AK18 Negativ-Kontrolle und AK19 am leisen Material
  await abschnitt('AK18 leise', async () => {
    if (!leise) throw new Fehl('ohne Projekt nicht ausgeführt');
    const P = await exportiere(0, 8, 'produktion');
    notiere('AK18 Negativ-Kontrolle leises Material: abgriff produktion, ueber_decke false, limiter_db_max 0, Spitze unter der Decke',
      P.abgriff === 'produktion' && P.ueber_decke === false && P.limiter_db_max <= 0.05 && P.spitze_db < -1, `abgriff ${P.abgriff}, ueber_decke ${P.ueber_decke}, limiter_db_max ${P.limiter_db_max}, spitze_db ${fmt(P.spitze_db)}`);
  });
  await abschnitt('AK19 leise', async () => {
    if (!leise) throw new Fehl('ohne Projekt nicht ausgeführt');
    const a = await ak19();
    notiere('AK19 leises Material: kein /zustand/arr mit limiter_db < -0,5 (Negativ-Kontrolle), das Feld kommt an (Positivprobe)', a.n > 0 && a.min > -0.5,
      `${a.n} von ${a.alle} /zustand/arr-Meldungen tragen limiter_db, kleinster Wert ${a.min}`);
  });

  // --- heißes Material: RB-338-Spuren gleicher Tonhöhe (Ton 24), alle Fader +6 dB, Master +6 dB, Loop 0..8 ---
  let heiss = null;
  await abschnitt('Aufbau heiß', async () => {
    heiss = await projektAufbauen('r1-s2-heiss', bpm, 3, 24, 8, 6, 6, true);
    await warteGeladen();
    info(`Aufbau heiß: ${heiss.slug}, ${heiss.ids.length} Spuren (Ton 24, Fader +6 dB), Master +6 dB, Loop 0..8`);
  });
  await abschnitt('AK18', async () => {
    if (!heiss) throw new Fehl('ohne Projekt nicht ausgeführt');
    let P = await exportiere(0, 8, 'produktion');
    // Reicht das Material die Decke nicht, ein zweiter Lauf mit mehr Spuren (bis 8 RB-338), sonst ungültig
    if (!(P.spitze_db > -1) && heiss.ids.length < 8) {
      info(`AK18: produktion spitze_db ${fmt(P.spitze_db)} <= -1 mit ${heiss.ids.length} Spuren (+6/+6), Material erreicht die Decke nicht; zweiter Lauf mit 8 Spuren`);
      const mehr = 8 - heiss.ids.length;
      await aendern('R1 heiß mehr Spuren', Array.from({ length: mehr }, (_, i) => ({ befehl: 'spur_neu', art: 'instrument', name: `R${heiss.ids.length + i + 1}` })));
      const alle = (await projektJetzt()).spuren.map((s) => s.id);
      const neu = alle.filter((id) => !heiss.ids.includes(id));
      await aendern('R1 heiß mehr Spuren Clips', [...neu.map((id) => ({ befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: 0, laenge_beats: 8, noten: notenN(24, 8) })), ...neu.map((id) => ({ befehl: 'spur_aendern', spur_id: id, fader_db: 6 }))]);
      heiss.ids = alle;
      await warteGeladen();
      P = await exportiere(0, 8, 'produktion');
    }
    if (!(P.spitze_db > -1)) { notiere('AK18', false, `FEHL: Material erreicht die Decke nicht (spitze_db ${fmt(P.spitze_db)}), ungültig, nicht bestanden`); return; }
    const S = await exportiere(0, 8, 'set');
    const D = await exportiere(0, 8);   // ohne abgriff: Vorgabe des Servers
    notiere('AK18 produktion: abgriff produktion, ueber_decke true, spitze_db > -1, limiter_db_max > 0', P.abgriff === 'produktion' && P.ueber_decke === true && P.spitze_db > -1 && P.limiter_db_max > 0,
      `${heiss.ids.length} Spuren; abgriff ${P.abgriff}, ueber_decke ${P.ueber_decke}, spitze_db ${fmt(P.spitze_db)}, limiter_db_max ${P.limiter_db_max}, true_peak_dbtp ${P.true_peak_dbtp}, lufs_i ${P.lufs_i}`);
    notiere('AK18 set: abgriff set, ueber_decke false, spitze_db <= -0,9, der Limiter hat eingegriffen (limiter_db_max > 0)', S.abgriff === 'set' && S.ueber_decke === false && S.spitze_db <= -0.9 && S.limiter_db_max > 0,
      `abgriff ${S.abgriff}, ueber_decke ${S.ueber_decke}, spitze_db ${fmt(S.spitze_db)}, limiter_db_max ${S.limiter_db_max}, true_peak_dbtp ${S.true_peak_dbtp}, lufs_i ${S.lufs_i}`);
    notiere('AK18 ohne Angabe gilt produktion (Vorgabe des Servers): gleiche Antwort wie mit abgriff produktion', D.abgriff === 'produktion' && D.ueber_decke === true && Math.abs(D.spitze_db - P.spitze_db) <= 0.001,
      `abgriff ${D.abgriff}, spitze_db ${fmt(D.spitze_db)} gegen ${fmt(P.spitze_db)}`);
    notiere('AK18 Lautheit am PM: true_peak_dbtp des Produktions-Exports über dem des Set-Exports (der Set-Limiter hält die Decke), WAV-Messung des Sets <= -0,9',
      typeof P.true_peak_dbtp === 'number' && typeof S.true_peak_dbtp === 'number' && P.true_peak_dbtp > S.true_peak_dbtp && S.true_peak_dbtp <= -0.9, `produktion ${P.true_peak_dbtp} dBTP, set ${S.true_peak_dbtp} dBTP`);
    const bad = await exportiereRoh({ von_beat: 0, bis_beat: 8, abgriff: 'mitte' });
    notiere('AK18 Negativ-Kontrolle: abgriff "mitte" → 400 argument_ungueltig', bad.code === 400 && bad.j?.fehler === 'argument_ungueltig', grundVon(bad));
  });
  await abschnitt('AK17 Fehlerfall', async () => {
    if (!heiss || !ISO_REF) throw new Fehl('ohne Projekt oder Isolator-Referenz nicht ausgeführt');
    const a = await nullLive('ak17-fehlerfall-heiss', bpm, 8, Math.ceil((8 * 60) / bpm) + 5);
    if (a.ungueltig) throw new Fehl(`AK17 Fehlerfall ungültig, nicht bestanden: ${a.ungueltig}`);
    notiere('AK17 Fehlerfall (Set-Limiter greift): der Set-Export bleibt bestanden', a.vS.j?.urteil === 'bestanden' && a.vS.j.rest_db < -90 && a.vS.j.phase_live === a.vS.j.phase_render, `${nl(a.vS)}; limiter_db_max set ${a.s.limiter_db_max}`);
    notiere('AK17 Fehlerfall (Set-Limiter greift): der Produktions-Export mit Isolator wird rot (Rest = Eingriff des Limiters), limiter_db_max > 0, ueber_decke true',
      a.vPI.j?.urteil === 'rot' && a.vPI.j.rest_db > -90 && a.p.limiter_db_max > 0 && a.p.ueber_decke === true, `${nl(a.vPI)}; limiter_db_max produktion ${a.p.limiter_db_max}, ueber_decke ${a.p.ueber_decke}, Spitze ${fmt(a.p.spitze_db)} dBFS`);
    notiere('AK19 im Mitschnitt-Lauf: der Kern meldete limiter_db < -0,5', a.limiterMin !== null && a.limiterMin < -0.5, `${a.arrN} /zustand/arr mit limiter_db, kleinster Wert ${a.limiterMin}`);
  });
  await abschnitt('AK19 heiß', async () => {
    if (!heiss) throw new Fehl('ohne Projekt nicht ausgeführt');
    const a = await ak19();
    notiere('AK19 heißes Material: mindestens ein /zustand/arr mit limiter_db < -0,5', a.n > 0 && a.min < -0.5, `${a.n} von ${a.alle} /zustand/arr-Meldungen tragen limiter_db, kleinster Wert ${a.min}`);
  });
}

try {
  await (TEIL === '2' ? lauf2() : lauf());
} catch (e) {
  if (e instanceof Fehl) notiere(punkt, false, e.message); else notiere('ABBRUCH', false, `${punkt}: ${e.stack ?? String(e)}`);
} finally {
  try { await transport('stopp'); } catch { /* läuft nicht oder Server weg */ }
  try { await ruf('POST', '/spur/stopp', { name: 'r1-umweg' }, CYPHER); } catch { /* Server weg */ }
  try { await ruf('POST', '/strudel', { text: 'silence', strom: 1 }); } catch { /* Server weg */ }
  for (const slug of eigeneSlugs) {
    const d = path.join(wurzel, slug);
    if (!/^r1-(s1|alt|rec|s2-leise|s2-heiss)-\d{8}t\d{6}/i.test(slug)) { info(`Slug ${slug} ist nicht von diesem Skript, nicht gelöscht`); continue; }
    try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`Projekt ${d} gelöscht: ${fs.existsSync(d) ? 'NEIN, besteht noch' : 'ja'}`); } else info(`Projekt ${d} nicht gefunden (nichts zu löschen)`); }
    catch (e) { notiere('Aufräumen', false, e.message); }
  }
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Abnahme 1.10 Slice ${TEIL} ${zeit} (${URL}, Instanz ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
