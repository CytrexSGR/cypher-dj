// Abnahmemessung E3 S3a/S3b: Spur N (Vorgabe 10, S3b: --spuren 32) am echten Kern. Gegen einen laufenden Seiten-Server auf einer Prüfinstanz (nie g, h, i, nie der Betrieb) mit gebautem
// Kern und cypherdj-render des Checkouts, in dem der Server läuft:
//   DJK=<worktree>/djk djk/start/djk-start --instanz a --arr1
//   node pruef/abnahme_e3.mjs --url http://127.0.0.1:48300 [--ausgabe <Ordner>]
//
// Warum Spur 10 (Vorgabe): bei 9 Spuren greifen die Einziffern-Fehler noch nicht (Plan E3, Scheibe S3a). Fehlerbild vor den Fixes aus Task 1 und 2: der Pegelname
// heißt "spur/:" (Zeichenarithmetik '0' + 10) und der Fader von Spur 10 regelt eine falsche Spur (Spur 1).
//
// Punkte (je mit Messwert):
//   AK1 /proj/oeffnen ist ok, /proj/aktuell zeigt 10 Spuren, der Kern nimmt die Wiedergabe an (kern.status 2 nach Transport-Start, 4 Beats Lauf).
//   AK2 /pegel meldet spur/10 mit Spitze über −120 dBFS; kein Pegelname spur/<Nicht-Zahl>.
//   AK3 Fader über das Projekt (spur_aendern fader_db −60 für Spur 10): spur/10 sinkt um mindestens 40 dB, spur/1 bleibt innerhalb von 1 dB.
//   AK4 Rückweg Hand → Projekt: zwei Griffe an spur/10/fader (der erste setzt nur die Stellung der Hand, hand.cpp:73-78 "erster Wert setzt nur die Stellung";
//       der zweite bewegt den Wert skaliert, hand.cpp:90-95), danach steht im Projekt spuren[nr=${N}].fader_db innerhalb ±0,5 dB von −20.
//   AK5 /proj/lautheit: 10 Spuren plus Summe, je ein Wert; Spur 10 allein gegen einen Referenz-Render (Projekt e3-allein mit nur dieser Spur) innerhalb ±0,5 LU.
//   AK6 /proj/export: die Lautheit der WAV gleicht der Summe aus AK5 auf ±0,2 LU.
//   NK  Negativ-Kontrollen: Spur MAX+1 → 409 spur_bereich (nur bei --spuren = MAX); /griff spur/<MAX+1>/fader wird abgelehnt.
//   AK7a (nur bei --spuren = MAX, E3 Task 12, Lastteil) /proj/oeffnen eines Projekts mit MAX Spuren und je Spur eigenen Werten (fader, pan, mute, solo; zwei Varianten): danach steht jeder der
//       4 · MAX Spur-Regler im Stand des Seiten-Servers (erstes Ereignis von GET /strom) auf dem Wert des Projekts (alleSpurRegler). Das ist der vom Kern gemeldete Stellwerk-Wert;
//       ob der Mixer die Änderung bekam, zeigt AK7a NICHT (Mutante MAX_BEWEGT 128 bleibt grün, Review Task 12 Runde 1).
//   AK7b (nur bei --spuren = MAX) Mixer: nach /proj/oeffnen folgt der Pegel jeder der MAX klingenden Spuren ihrem Fader (−3 bis −18 dB), gerade Spuren sind stumm (b1), ein Solo auf der letzten Spur lässt nur sie klingen (b2); vorher stand der Mixer auf der Vorgabe.
//       Das ist das Instrument für E3 Task 7 am echten Kern (Verlaufs-Slot je Regler, MAX_BEWEGT).
// Rückgabe: 0 alle Punkte OK, 1 mindestens ein Punkt FEHL, 2 Aufruf. Aufräumen: die beiden Projekte (nur die eigenen Slugs) werden gelöscht.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { midiRoh } from '../oeffentlich/kurven.js';
import { MAX_SPUREN } from '../projekt/modell.ts';
import { alleSpurRegler } from '../bereiche/proj/abbildung.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' }, spuren: { type: 'string' } } });
const aufrufFehler = (t) => { process.stderr.write(`abnahme_e3: ${t}\n`); process.exit(2); };
if (!opt.url) aufrufFehler('Aufruf: --url <http://127.0.0.1:port> [--ausgabe <Ordner>] [--instanz <a..f>] [--spuren <1..32, Vorgabe 10>]');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('nie gegen den Betrieb (47300): eine Prüfinstanz wählen');
const N = opt.spuren === undefined ? 10 : Number(opt.spuren);
if (!Number.isInteger(N) || N < 1 || N > MAX_SPUREN) aufrufFehler(`--spuren ${opt.spuren}: ganze Zahl 1 bis ${MAX_SPUREN}`);
const port = Number(new globalThis.URL(opt.url).port);
const k = (port - 47300) / 1000;
const aus = Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined;
const instanz = opt.instanz ?? aus;
if (!instanz || /^[ghi]$/.test(instanz)) aufrufFehler(`Instanz ${instanz ?? '?'} (Port ${port}) ist nicht erlaubt: g, h, i sind tabu`);
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-e3`);
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
const aendern = async (label, befehle, kopf = CYPHER) => erwarte200(`/proj/aendern (${label})`, await ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, kopf)).j;
const lautheit = async (von, bis) => erwarte200('/proj/lautheit', await ruf('POST', '/proj/lautheit', { von_beat: von, bis_beat: bis }, CYPHER)).j;
const pegel = async (sek) => erwarte200('/pegel', await ruf('GET', `/pegel?sek=${sek}`)).j.kanaele;
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const warteAufKern = async () => {
  if (!(await bisWahr(async () => typeof (await ruf('GET', '/lage')).j?.uhr?.bpm === 'number', 8000))) throw new Fehl('kein Kern: /lage meldet keine Uhr');
  return (await ruf('GET', '/lage')).j.uhr.bpm;
};
const transport = async (aktion) => {
  const r = await ruf('POST', '/proj/transport', aktion === 'start' ? { aktion, beat: 0 } : { aktion });
  if (r.code !== 200) throw new Fehl(`/proj/transport ${aktion} → ${grundVon(r)}`);
};
const status = async () => (await ruf('GET', '/proj/aktuell')).j?.kern?.status;
let punkt = 'Aufbau';

const SPUR1_TON = 36, LETZT_TON = 43;                                                  // Spur 1 bis N−1 Ton 36, die letzte Spur Ton 43
const noten = (ton) => Array.from({ length: 8 }, (_, i) => ({ beat: i, laenge: 0.5, ton, vel: 110 }));
const fmt = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));
const eigeneSlugs = [];
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');

// AK7 (nur bei N = MAX), zwei Instrumente mit verschiedener Reichweite:
//  AK7a Regler: nach /proj/oeffnen steht jeder der 4 · MAX Spur-Regler im Stand des Seiten-Servers auf dem Wert des Projekts. Der Stand kommt aus /e/regler (server.ts:485)
//       und zeigt den Stellwerk-Wert, den der Kern bei jeder Setzung meldet, auch wenn kein Verlaufs-Slot frei war (kern.cpp:254-262). AK7a sieht deshalb NICHT, ob der
//       Mixer die Änderung bekam (E3 Task 7, MAX_BEWEGT: Mutante 128 statt 256 am echten Kern, Review Task 12 Runde 1). Zwei Varianten (Mute/Solo wechselweise), damit jeder
//       Regler in mindestens einer Variante von der Vorgabe abweicht.
//  AK7b Mixer: nach /proj/oeffnen eines Projekts mit MAX klingenden Spuren folgt der Pegel dem Fader, stumme Spuren schweigen, ein Solo lässt nur die Solo-Spur klingen.
//       Hat der Mixer einen Regler nicht bekommen, bleibt die Spur auf der Vorgabe (0 dB, hörbar).
const abweichung = (soll, stand) => soll.filter((x) => typeof stand[x.pfad] !== 'number' || Math.abs(stand[x.pfad] - x.wert) > 0.06);
async function neuesProjekt(name) {
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `${name}-${zeit}` }));
  const slug = r.j.slug ?? r.j.projekt?.slug;
  if (!slug) throw new Fehl(`/proj/neu ohne slug: ${JSON.stringify(r.j).slice(0, 200)}`);
  eigeneSlugs.push(slug);
  return slug;
}
// ein leeres Projekt öffnen: alle Slots stehen auf der Vorgabe, so ändert /proj/oeffnen danach wirklich jeden Regler. Ohne eigenen Slug bricht die Kontrolle ab.
async function leerMachen() {
  await neuesProjekt('e3-leer');
  await warte(3000);
}
async function ak7a(bpm, variante) {
  const slug = await neuesProjekt('e3-regler');
  const b = [{ befehl: 'tempo_setzen', bpm }];
  for (let n = 1; n <= N; n++) b.push({ befehl: 'spur_neu', art: 'audio', name: `R${n}` });
  // Fader und Pan sind für jede Spur verschieden und nie auf der Vorgabe; Mute und Solo wechseln mit der Variante (A: Mute ungerade, Solo gerade; B: umgekehrt)
  for (let n = 1; n <= N; n++) b.push({ befehl: 'spur_aendern', spur_id: `s${n}`, fader_db: -0.5 * n, pan: (n % 2 ? 1 : -1) * (0.05 + 0.02 * n), mute: (n % 2 === 1) === (variante === 'A'), solo: (n % 2 === 0) === (variante === 'A') });
  await aendern(`E3 AK7a Aufbau ${N} Spuren, Variante ${variante}`, b);
  const soll = alleSpurRegler((await aktuell()).projekt);                              // Sollwerte des Reglerprojekts, solange es offen ist
  await leerMachen();
  const standVor = await ersteStandRegler();
  const vorher = abweichung(soll, standVor);                                           // Kontrolle: der Vergleich muss anschlagen, sonst prüft AK7a nichts
  const op = await ruf('POST', '/proj/oeffnen', { slug }, CYPHER);
  await warte(3000);
  const stand = await ersteStandRegler();
  const falsch = abweichung(soll, stand);
  const verschieden = new Set(soll.filter((x) => x.pfad.endsWith('/fader')).map((x) => x.wert)).size;
  notiere(`AK7a${variante} /proj/oeffnen: alle ${soll.length} Spur-Regler stehen auf dem Wert des Projekts (Stellwerk-Wert)`,
    op.code === 200 && soll.length === 4 * MAX_SPUREN && vorher.length >= 2 * N && falsch.length === 0 && verschieden === N,
    `oeffnen ${op.code}; Kontrolle vor dem Öffnen: ${vorher.length} von ${soll.length} Reglern weichen ab (verlangt ≥ ${2 * N}); danach ${soll.length - falsch.length} gleich (±0,06); ${verschieden} verschiedene Fader-Werte; abweichend: ${falsch.slice(0, 8).map((x) => `${x.pfad} soll ${x.wert} ist ${stand[x.pfad] ?? 'fehlt'}`).join('; ') || 'keine'}`);
  return new Set(vorher.map((x) => x.pfad));
}
// Warum Mute und Solo: Fader und Pan laufen als 10-ms-Rampe über mehrere Zyklen, Mute und Solo setzen ohne Rampe in einem Sample (kern.cpp:262, setze_wert).
// Warum ein Gegenprojekt: wird ein Regler im Kern abgelehnt (kein Verlaufs-Slot), behält der Mixer seinen alten Wert. Ein leeres Projekt (/proj/neu) setzt die Vorgaben mit
// demselben Stoß von Teilen und würde den Fehler verdecken, weil auch dort die letzten Regler abgelehnt werden. Gemessen an der Mutante MAX_BEWEGT = 128 am echten Kern:
// die abgelehnten Slots sind regler 548 bis 563 = spur/29..32/{fader,pan,mute,solo}, und ein Mixer, der vor dem Öffnen schon den Wert des Projekts hatte, blieb darum richtig.
// Darum bekommt der Mixer vor dem Öffnen in kleinen Schritten (4 Spuren je Änderung, bleibt unter dem Deckel) die GEGENTEILIGEN Werte: jeder Wert, der beim Öffnen
// nicht ankommt, bleibt sichtbar falsch.
const STILL_DB = -100;
async function ak7bProjekt(bpm, name, sollWerte, gegenWerte) {
  const slug = await neuesProjekt(name);
  const b = [{ befehl: 'tempo_setzen', bpm }];
  for (let n = 1; n <= N; n++) b.push({ befehl: 'spur_neu', art: 'instrument', name: `M${n}` });
  for (let n = 1; n <= N; n++) b.push({ befehl: 'spur_aendern', spur_id: `s${n}`, ...sollWerte(n) });
  for (let n = 1; n <= N; n++) b.push({ befehl: 'clip_neu', spur_id: `s${n}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(SPUR1_TON) });
  b.push({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 });
  await aendern(`E3 AK7b Aufbau ${N} klingende Spuren (${name})`, b);
  await neuesProjekt(`${name}-gegen`);                                                 // wird das offene Projekt; sein Aufbau stellt den Mixer auf die Gegenwerte
  await aendern(`E3 AK7b Gegenprojekt Aufbau`, [{ befehl: 'tempo_setzen', bpm }, ...Array.from({ length: N }, (_, i) => ({ befehl: 'spur_neu', art: 'audio', name: `G${i + 1}` }))]);
  for (let n0 = 1; n0 <= N; n0 += 4) {
    const bg = [];
    for (let n = n0; n < n0 + 4 && n <= N; n++) bg.push({ befehl: 'spur_aendern', spur_id: `s${n}`, ...gegenWerte(n) });
    await aendern(`E3 AK7b Gegenwerte Spur ${n0} bis ${Math.min(N, n0 + 3)}`, bg);
  }
  await warte(1500);
  const op = await ruf('POST', '/proj/oeffnen', { slug }, CYPHER);
  await transport('start');
  await warte(Math.ceil((8 * 60 / bpm) * 1000) + 6800);                                // ein voller Loop vergeht, dann liegt ein 6-s-Fenster ganz im Zustand nach dem Öffnen
  const peg = await pegel(6);
  await transport('stopp');
  return { op, db: (n) => peg[`spur/${n}`]?.max_db };
}
async function ak7b(bpm) {
  // b1: Fader −3 bis −18 dB, gerade Spuren stumm. Pegel minus Fader ist für alle hörbaren Spuren gleich (derselbe Ton); der kleinste Rest ist die Bezugsmarke.
  const faderVon = (n) => -3 * (1 + ((n - 1) % 6));
  const stummVon = (n) => n % 2 === 0;
  const r1 = await ak7bProjekt(bpm, 'e3-mixer', (n) => ({ fader_db: faderVon(n), mute: stummVon(n) }), (n) => ({ fader_db: -30, mute: !stummVon(n) }));
  const hoer = Array.from({ length: N }, (_, i) => i + 1).filter((n) => !stummVon(n));
  const stumm = Array.from({ length: N }, (_, i) => i + 1).filter(stummVon);
  const rest = hoer.map((n) => ({ n, db: r1.db(n), d: typeof r1.db(n) === 'number' ? r1.db(n) - faderVon(n) : null }));
  const gueltig = rest.filter((x) => x.d !== null && x.db > -120);
  const ref = gueltig.length ? Math.min(...gueltig.map((x) => x.d)) : NaN;
  const abweich = rest.filter((x) => x.d === null || x.db <= -120 || x.d - ref > 1.5);
  const spreizung = gueltig.length ? Math.max(...gueltig.map((x) => x.db)) - Math.min(...gueltig.map((x) => x.db)) : 0;
  const laut = stumm.filter((n) => !(typeof r1.db(n) !== 'number' || r1.db(n) <= STILL_DB));
  notiere(`AK7b1 /proj/oeffnen: im Mixer folgen ${hoer.length} Spuren ihrem Fader (±1,5 dB), ${stumm.length} gerade Spuren sind stumm (≤ ${STILL_DB} dBFS)`,
    r1.op.code === 200 && gueltig.length === hoer.length && abweich.length === 0 && spreizung >= 12 && laut.length === 0,
    `oeffnen ${r1.op.code}; ${gueltig.length} von ${hoer.length} hörbaren Spuren mit Pegel; Bezugsmarke ${fmt(ref)} dB (Pegel minus Fader); Spreizung ${fmt(spreizung)} dB (verlangt ≥ 12); Fader abweichend: ${abweich.slice(0, 8).map((x) => `spur/${x.n} Fader ${faderVon(x.n)} Pegel ${x.db === undefined ? 'fehlt' : fmt(x.db)}`).join('; ') || 'keine'}; stumm erwartet, aber laut: ${laut.slice(0, 8).map((n) => `spur/${n} ${fmt(r1.db(n))}`).join('; ') || 'keine'}`);
  // b2: Solo nur auf der letzten Spur: nur sie klingt, alle anderen sind still
  const r2 = await ak7bProjekt(bpm, 'e3-solo', (n) => ({ solo: n === N }), (n) => ({ solo: n === 1 }));   // Gegenwert: Solo auf Spur 1 statt auf Spur N
  const andere = Array.from({ length: N - 1 }, (_, i) => i + 1);
  const lautAndere = andere.filter((n) => !(typeof r2.db(n) !== 'number' || r2.db(n) <= STILL_DB));
  const dN = r2.db(N);
  notiere(`AK7b2 /proj/oeffnen: Solo auf Spur ${N} im Mixer, die anderen ${andere.length} Spuren still (≤ ${STILL_DB} dBFS)`, r2.op.code === 200 && typeof dN === 'number' && dN > -60 && lautAndere.length === 0,
    `oeffnen ${r2.op.code}; spur/${N} ${dN === undefined ? 'fehlt' : fmt(dN)} dBFS (verlangt > −60); laut trotz Solo auf ${N}: ${lautAndere.slice(0, 8).map((n) => `spur/${n} ${fmt(r2.db(n))}`).join('; ') || 'keine'}${lautAndere.length > 8 ? ` und ${lautAndere.length - 8} weitere` : ''}`);
}
async function ak7(bpm) {
  punkt = 'AK7';
  const vonA = await ak7a(bpm, 'A');
  const vonB = await ak7a(bpm, 'B');
  const gedeckt = new Set([...vonA, ...vonB]);
  notiere(`AK7a Abdeckung: jeder der ${4 * MAX_SPUREN} Spur-Regler wich in mindestens einer Variante vorher von der Vorgabe ab`, gedeckt.size === 4 * MAX_SPUREN,
    `${gedeckt.size} von ${4 * MAX_SPUREN} Reglern (A ${vonA.size}, B ${vonB.size})`);
  punkt = 'AK7b';
  await ak7b(bpm);
}
// erstes Ereignis von GET /strom ist {a:'stand', f:{..., regler}}
async function ersteStandRegler() {
  const ac = new AbortController();
  try {
    const frist = setTimeout(() => ac.abort(), 10000);                                 // kommt auf /strom kein Ereignis, bricht das Lesen ab
    const r = await fetch(`${URL}/strom`, { signal: ac.signal });
    const dec = new TextDecoder(); let puffer = '';
    for await (const teil of r.body) {
      puffer += dec.decode(teil, { stream: true });
      const i = puffer.indexOf('\n\n');
      if (i >= 0) { clearTimeout(frist); return JSON.parse(puffer.slice(6, i)).f.regler ?? {}; }
    }
    clearTimeout(frist);
    return {};
  } finally { ac.abort(); }
}

async function lauf() {
  const bpm = await warteAufKern();
  info(`Instanz ${instanz}, ${URL}, Kern ${bpm} BPM, Projektwurzel ${wurzel}, ${N} Spuren`);
  if (N === MAX_SPUREN) await ak7(bpm);

  // --- Aufbau: e3-spuren mit N RB-338-Spuren, Spur 1 bis N−1 mit Muster Ton 36, Spur N mit Muster Ton 43 ---
  const neu = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `e3-spuren-${zeit}` }));
  const slugViel = neu.j.slug ?? neu.j.projekt?.slug;
  if (!slugViel) throw new Fehl(`/proj/neu ohne slug: ${JSON.stringify(neu.j).slice(0, 200)}`);
  eigeneSlugs.push(slugViel);
  const befehle = [{ befehl: 'tempo_setzen', bpm }];
  for (let n = 1; n <= N; n++) befehle.push({ befehl: 'spur_neu', art: 'instrument', name: `Spur ${n}` });
  for (let n = 1; n <= N; n++) befehle.push({ befehl: 'clip_neu', spur_id: `s${n}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(n === N ? LETZT_TON : SPUR1_TON) });
  befehle.push({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 });
  const a = await aendern(`E3 Aufbau ${N} Spuren`, befehle);
  info(`Aufbau: ${slugViel}, rev ${a.rev}`);

  // --- AK1 ---
  punkt = 'AK1';
  const op = await ruf('POST', '/proj/oeffnen', { slug: slugViel }, CYPHER);
  const p1 = (await aktuell()).projekt;
  const nrs = p1.spuren.map((s) => s.nr).sort((x, y) => x - y);
  await transport('start');
  const lief = await bisWahr(async () => (await status()) === 2, 8000);
  await warte(Math.ceil((4 * 60 / bpm) * 1000) + 1500);                                 // 4 Beats und etwas Luft
  const st = await status();
  notiere(`AK1 /proj/oeffnen ok, ${N} Spuren, Kern spielt`, op.code === 200 && nrs.join(',') === Array.from({ length: N }, (_, i) => i + 1).join(',') && lief && st === 2,
    `oeffnen ${op.code}, Spurnummern ${nrs.join(',')}, kern.status ${st} (2 = läuft), Transport lief ${lief}`);

  // --- AK2 ---
  punkt = 'AK2';
  const sek = 6;
  await warte(500);
  const vor = await pegel(sek);
  const namen = Object.keys(vor);
  const spurNamen = namen.filter((x) => x.startsWith('spur/'));
  const schlecht = spurNamen.filter((x) => !/^spur\/[1-9][0-9]?$/.test(x) || Number(x.slice(5)) > N);
  const zN = vor[`spur/${N}`];
  const kN = zN ? `spur/${N}` : 'spur/:';                                              // Fehlerbild vor Task 2: der Pegel von Spur 10 heißt "spur/:"
  const vN = vor[kN];
  const fehlen = Array.from({ length: N }, (_, i) => `spur/${i + 1}`).filter((x) => !(x in vor));
  notiere(`AK2 spur/${N} im Pegel mit Spitze > −120 dBFS, kein Nicht-Zahl-Name, alle ${N} Namen da`, Boolean(zN) && zN.max_db > -120 && schlecht.length === 0 && fehlen.length === 0,
    `spur/${N} ${JSON.stringify(zN)}; ${spurNamen.length} Spurnamen ${spurNamen.sort().join(' ')}; unzulässig: ${schlecht.length ? schlecht.join(' ') : 'keine'}; fehlend: ${fehlen.length ? fehlen.join(' ') : 'keine'}`);

  // --- AK3: Fader über das Projekt ---
  punkt = 'AK3';
  const p3a = (await aktuell()).projekt.spuren.find((s) => s.nr === N);
  await aendern(`E3 AK3 Fader Spur ${N} -60`, [{ befehl: 'spur_aendern', spur_id: p3a.id, fader_db: -60 }]);
  await warte(sek * 1000 + 800);
  const nach = await pegel(sek);
  const dN = (nach[kN]?.max_db ?? -200) - (vN?.max_db ?? -200);
  const d1 = (nach['spur/1']?.max_db ?? -200) - (vor['spur/1']?.max_db ?? -200);
  notiere(`AK3 Fader Spur ${N} −60 dB: spur/${N} sinkt ≥ 40 dB, spur/1 bleibt ±1 dB`, dN <= -40 && Math.abs(d1) <= 1,
    `${kN} ${fmt(vN?.max_db)} → ${fmt(nach[kN]?.max_db)} dBFS (Δ ${fmt(dN)} dB), spur/1 ${fmt(vor['spur/1']?.max_db)} → ${fmt(nach['spur/1']?.max_db)} dBFS (Δ ${fmt(d1)} dB)`);

  // --- AK4: Rückweg Hand → Projekt ---
  punkt = 'AK4';
  // Plan: ein Griff mit u für −20 dB. Gemessen 2026-10-22: ein einzelner Griff ändert nichts (der erste Wert setzt nur die Stellung der Hand, hand.cpp:73-78).
  // Darum zwei Griffe: erst u = 1 (Hand ganz oben, setzt die Stellung oder hebt den Wert auf +6 dB), dann u = x(−20) / x(Wert danach): bei Stellung 1 gilt
  // u_neu = u_alt · p (hand.cpp:93-94), also landet der Wert auf −20 dB, unabhängig davon, welcher der beiden Fälle eintrat.
  await aendern(`E3 AK4 Fader Spur ${N} auf 0`, [{ befehl: 'spur_aendern', spur_id: p3a.id, fader_db: 0 }]);
  await warte(600);
  const imProjekt = async () => (await aktuell()).projekt.spuren.find((s) => s.nr === N)?.fader_db;
  const g1 = await ruf('POST', '/griff', { pfad: `spur/${N}/fader`, u: 1 });
  await warte(2500);                                                                  // Rückweg wird höchstens alle RUECKWEG_MS gespeichert
  const f1 = await imProjekt();
  const p = midiRoh(`spur/${N}/fader`, -20) / midiRoh(`spur/${N}/fader`, f1);
  const g2 = await ruf('POST', '/griff', { pfad: `spur/${N}/fader`, u: p });
  const angekommen = await bisWahr(async () => Math.abs((await imProjekt()) + 20) <= 0.5, 6000);
  notiere(`AK4 Hand-Regler spur/${N}/fader landet im Projekt (−20 dB ±0,5)`, g1.code === 200 && g2.code === 200 && angekommen,
    `/griff ${g1.code} (u 1) → Projekt ${fmt(f1)} dB; /griff ${g2.code} (u ${p.toFixed(4)}) → Projekt spuren[nr=${N}].fader_db = ${fmt(await imProjekt())}`);

  // --- AK5: Lautheit je Spur, Spur 10 gegen Einzel-Render ---
  punkt = 'AK5';
  await transport('stopp');
  const t0 = Date.now();
  const l = await lautheit(0, 8);
  const dauer = ((Date.now() - t0) / 1000).toFixed(1);
  const eintraege = [...l.spuren, l.summe];
  const alle = eintraege.length === N + 1 && eintraege.every((e) => typeof e.lufs_i === 'number');
  const sN = l.spuren.find((s) => s.nr === N);
  const faderLetzt = (await aktuell()).projekt.spuren.find((s) => s.nr === N).fader_db;
  info(`AK5 /proj/lautheit dauerte ${dauer} s; Spuren ${JSON.stringify(l.spuren.map((s) => [s.nr, s.lufs_i]))}, Summe ${l.summe.lufs_i} (${l.summe.regler_quelle ?? '-'})`);
  notiere(`AK5a ${N} Spuren plus Summe, je ein Wert`, alle, `${eintraege.length} Einträge, lufs_i: ${eintraege.map((e) => fmt(e.lufs_i)).join(' ')}`);

  // AK6 gehört zu e3-spuren und läuft vor dem Referenz-Projekt
  punkt = 'AK6';
  const ex = await ruf('POST', '/proj/export', { von_beat: 0, bis_beat: 8 }, CYPHER);
  if (ex.code !== 200) throw new Fehl(`/proj/export → ${grundVon(ex)}`);
  notiere('AK6 Export-WAV gleicht der Summe aus AK5 (±0,2 LU)', Math.abs(ex.j.lufs_i - l.summe.lufs_i) <= 0.2,
    `Export ${fmt(ex.j.lufs_i)} LUFS (${ex.j.regler_quelle}), Summe ${fmt(l.summe.lufs_i)} LUFS (${l.summe.regler_quelle}), Abstand ${fmt(Math.abs(ex.j.lufs_i - l.summe.lufs_i))} LU`);

  // Negativ-Kontrollen am vollen Projekt
  punkt = 'NK';
  if (N === MAX_SPUREN) {
    const ueber = await ruf('POST', '/proj/aendern', { rev: await holeRev(), label: 'E3 Spur über der Grenze', befehle: [{ befehl: 'spur_neu', art: 'instrument', name: 'Zu viel' }] }, CYPHER);
    notiere(`NK1 Spur ${MAX_SPUREN + 1} → 409 spur_bereich`, ueber.code === 409 && ueber.j?.fehler === 'spur_bereich', `${ueber.code} ${ueber.j?.fehler ?? ''} ${ueber.j?.text ?? ''}`);
  } else info(`NK1 übersprungen: ${N} < MAX_SPUREN ${MAX_SPUREN}`);
  const gr = await ruf('POST', '/griff', { pfad: `spur/${MAX_SPUREN + 1}/fader`, u: 0.5 });
  notiere(`NK2 /griff spur/${MAX_SPUREN + 1}/fader abgelehnt`, gr.code === 400, `${gr.code} ${gr.j?.fehler ?? ''}`);

  // Referenz-Render: nur Spur N (Ton 43, derselbe Fader)
  punkt = 'AK5';
  const neu2 = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `e3-allein-${zeit}` }));
  const slugAllein = neu2.j.slug ?? neu2.j.projekt?.slug;
  eigeneSlugs.push(slugAllein);
  await aendern(`E3 Referenz Spur ${N} allein`, [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'instrument', name: `Spur ${N} allein` },
    { befehl: 'spur_aendern', spur_id: 's1', fader_db: faderLetzt },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(LETZT_TON) },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }]);
  const ref = await lautheit(0, 8);
  const abstand = sN.lufs_i - ref.summe.lufs_i;
  notiere(`AK5b Spur ${N} allein gegen Referenz-Render (±0,5 LU)`, Math.abs(abstand) <= 0.5,
    `Spur ${N} in e3-spuren ${fmt(sN.lufs_i)} LUFS, Referenz (nur diese Spur, Fader ${fmt(faderLetzt)} dB) ${fmt(ref.summe.lufs_i)} LUFS, Abstand ${fmt(abstand)} LU (ab +3 LU wären andere Spuren mitgerendert)`);
}

try {
  await lauf();
} catch (e) {
  if (e instanceof Fehl) notiere(punkt, false, e.message); else notiere('ABBRUCH', false, `${punkt}: ${e.stack ?? String(e)}`);
} finally {
  try { await transport('stopp'); } catch { /* läuft nicht oder Server weg */ }
  for (const slug of eigeneSlugs) {
    const d = path.join(wurzel, slug);
    if (!/^e3-(spuren|allein|regler|leer|mixer|solo)(-gegen)?-\d{8}t\d{6}/i.test(slug)) { info(`Slug ${slug} ist nicht von diesem Skript, nicht gelöscht`); continue; }
    try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`Projekt ${d} gelöscht: ${fs.existsSync(d) ? 'NEIN, besteht noch' : 'ja'}`); } else info(`Projekt ${d} nicht gefunden (nichts zu löschen)`); }
    catch (e) { notiere('Aufräumen', false, e.message); }
  }
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Abnahme E3 S3a ${zeit} (${URL}, Instanz ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
