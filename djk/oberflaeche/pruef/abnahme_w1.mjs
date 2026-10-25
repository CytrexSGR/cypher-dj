// Zielabnahme Paket 1.13 Warp, Slice 1 (RE-PITCH): ein 125-BPM-Loop im Projekt, gegen einen laufenden Seiten-Server auf einer Prüfinstanz (nie g, h, i, nie der
// Betrieb) mit gebautem Kern und cypherdj-render des Checkouts und dem Katalog aus pruef/w1_aufbau.mjs:
//   node pruef/w1_aufbau.mjs --ziel /tmp/w1-ziel
//   CYPHERDJ_KATALOG=/tmp/w1-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz a --arr1
//   node pruef/abnahme_w1.mjs --url http://127.0.0.1:48300 --aufbau /tmp/w1-ziel/aufbau.json [--ausgabe <Ordner>]
// Die Messung geht über den Export (derselbe Kern im Freilauf, L2 „gerendert = gehört“), nicht über Mikrofon und Kabel:
//   Z1  Aufbau: clip_neu mit warp "auto" legt den 125-BPM-Loop (2 Takte) mit Warp quelle takte und 8 Beats Länge ab; als Loop auf 64 Beats gezogen
//   Z2  AK4 Export 0..64 Beats bei 128 BPM: 64 Klicks, Abstand jeweils 22 500 Samples ± 1 (das Projektraster), Lage der Klicks über 64 Beats
//   Z3  Vorher-Fall: Warp aus, derselbe Export: Abstand 23 040 (45 ms später nach 4 Beats), das Instrument sieht den Fehler
//   Z4  AK16 Projekttempo 120: Warp wieder an, Export: Abstand 24 000 ± 1, Länge in Beats gleich
//   Z5  AK5 Tonhöhe: Sinus-Loop gewarpt klingt +41,06 ct ± 0,5 (1024 Hz), ungewarpt ± 0,5 ct um 1000 Hz
//   Z6  Cypher (Quelle cypher): warp_setzen aus und an, proj_warp liest Marker, Segment-Tempo 125 und die Gegenprobe W(4) = 1,92 s; Verlauf trägt cypher; Undo
//   NK  Ablehnungen: modus complex → warp_modus, transpose bei repitch → transpose_repitch
// Rückgabe: 0 alle Punkte OK, 1 mindestens ein Punkt FEHL, 2 Aufruf. Aufräumen: nur die eigenen Projekte (Slug w1-...).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { leseWav, klicks, frequenz, cent } from './w1_wav.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, aufbau: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' } } });
const aufrufFehler = (t) => { process.stderr.write(`abnahme_w1: ${t}\n`); process.exit(2); };
if (!opt.url || !opt.aufbau) aufrufFehler('Aufruf: --url <http://127.0.0.1:port> --aufbau <aufbau.json> [--ausgabe <Ordner>] [--instanz <a..f>]');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('nie gegen den Betrieb (47300): eine Prüfinstanz wählen');
const port = Number(new globalThis.URL(opt.url).port), k = (port - 47300) / 1000;
const instanz = opt.instanz ?? (Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined);
if (!instanz || /^[ghi]$/.test(instanz)) aufrufFehler(`Instanz ${instanz ?? '?'} (Port ${port}) ist nicht erlaubt: g, h, i sind tabu`);
const AUFBAU = JSON.parse(fs.readFileSync(opt.aufbau, 'utf8'));
const zwei = (n) => String(n).padStart(2, '0'), d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-w1`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0, punkt = 'Aufbau';
const notiere = (kz, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };
const URL = opt.url, CYPHER = { 'x-djk-quelle': 'cypher' };
class Fehl extends Error {}
const ruf = async (methode, weg, koerper, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
const grundVon = (r) => `${r.code} ${r.j?.fehler ?? r.j?.grund ?? ''}${r.j?.text ? `: ${r.j.text}` : ''}`.trim();
const erwarte200 = (weg, r) => { if (r.code !== 200) throw new Fehl(`${weg} → ${grundVon(r)}`); return r; };
const aktuell = async () => erwarte200('/proj/aktuell', await ruf('GET', '/proj/aktuell')).j;
const holeRev = async () => erwarte200('/proj/aktuell?nur=rev', await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
const aendern = async (label, befehle, kopf = {}) => erwarte200(`/proj/aendern (${label})`, await ruf('POST', '/proj/aendern', { rev: await holeRev(), label, befehle }, kopf)).j;
const bisWahr = async (f, ms = 40000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const zustandKurz = async () => {
  const a = await aktuell();
  return { kern: a.kern, wiedergabe_rev: a.projekt.wiedergabe_rev, dekodiert: a.projekt.spuren.flatMap((s) => s.clips).map((c) => c.dekodiert) };
};
// Ein Tempowechsel läuft als Rampe ab dem nächsten Takt (Spec 6.33); solange sie offen ist, schiebt der Server das Laden auf. Darum steht das Tempo in einem
// eigenen Schritt vor allem anderen, mit Wartezeit.
const setzeTempo = async (bpm) => { await aendern(`W1 Tempo ${bpm}`, [{ befehl: 'tempo_setzen', bpm }], CYPHER); await warte(6000); };
// Alle Clips dekodiert und die Wiedergabe im Kern geladen (rev_geladen = wiedergabe_rev); sonst Abbruch mit dem Stand, damit man sieht, woran es hing
const geladen = async () => {
  const ok = await bisWahr(async () => {
    const z = await zustandKurz();
    return z.dekodiert.every((d) => d === 'fertig') && z.kern?.rev_geladen === z.wiedergabe_rev && z.kern?.status === 0;
  });
  if (!ok) throw new Fehl(`Wiedergabe nicht geladen nach 40 s: ${JSON.stringify(await zustandKurz())}`);
};
const eigeneSlugs = [];
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');
async function neuesProjekt(name) {
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `w1-${name}-${zeit}` }));
  const slug = r.j.slug ?? r.j.projekt?.slug;
  if (!slug) throw new Fehl(`/proj/neu ohne slug: ${JSON.stringify(r.j).slice(0, 200)}`);
  eigeneSlugs.push(slug);
  await warte(1500);
}
async function exportiere(von, bis, name) {
  await geladen();
  const r = erwarte200('/proj/export', await ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis }, CYPHER));
  const w = leseWav(r.j.datei);
  fs.copyFileSync(r.j.datei, path.join(ORDNER, `${name}.wav`));
  return w;
}
const abstaende = (xs) => xs.slice(1).map((x, i) => x - xs[i]);
const fmt = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));
const bpmProjekt = 128;

async function lauf() {
  // --- Z1: Aufbau
  punkt = 'Z1';
  await neuesProjekt('klick');
  await setzeTempo(bpmProjekt);
  await aendern('W1 Aufbau', [{ befehl: 'spur_neu', art: 'audio', name: 'Klick' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: AUFBAU.sha_klick, warp: 'auto' }], CYPHER);
  const c1 = (await aktuell()).projekt.spuren[0].clips[0];
  notiere('Z1 clip_neu warp "auto": Warp aus den Katalogdaten, Länge 8 Beats', c1.warp?.an === true && c1.warp.quelle === 'takte' && c1.laenge_beats === 8
    && c1.warp.marker.length === 2 && Math.abs(c1.warp.marker[1][0] - AUFBAU.dauer_s) < 1e-9 && c1.warp.marker[1][1] === 8, `warp ${JSON.stringify(c1.warp)}, Länge ${c1.laenge_beats}`);
  await aendern('W1 Loop 64 Beats', [{ befehl: 'clip_aendern', clip_id: c1.id, laenge_beats: 64, loop_beats: 8 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 64 }]);
  await geladen();

  // --- Z2: Projektraster
  punkt = 'Z2';
  const w = await exportiere(0, 64, 'z2-warp-128');
  const k2 = klicks(w.l);
  const a2 = abstaende(k2), daneben2 = a2.filter((a) => Math.abs(a - 22500) > 1).length;
  notiere('Z2 AK4 Export 128 BPM: 64 Klicks im Abstand 22 500 ± 1', k2.length === 64 && daneben2 === 0,
    `${k2.length} Klicks, ${daneben2} Abstände außerhalb ±1, Abstand ${Math.min(...a2)}..${Math.max(...a2)}, erster Klick bei Sample ${k2[0]} (Material: Frame ${AUFBAU.klick_vor_frames}, bei 125 zu 128 rund ${Math.round(AUFBAU.klick_vor_frames * 125 / 128)})`);

  // --- Z3: Vorher-Fall
  punkt = 'Z3';
  await aendern('W1 Warp aus', [{ befehl: 'warp_setzen', clip_id: c1.id, an: false }]);
  const w3 = await exportiere(0, 64, 'z3-ohne-warp-128');
  const k3 = klicks(w3.l), a3 = abstaende(k3.slice(0, 8));
  notiere('Z3 Vorher-Fall Warp aus: innerhalb einer Kopie Abstand 23 040 (der Loop läuft aus dem Raster)', a3.slice(0, 7).every((a) => Math.abs(a - 23040) <= 1),
    `Abstände der ersten Kopie: ${a3.join(' ')}; 4 Beats später: ${4 * 23040 - 4 * 22500} Samples = ${((4 * 23040 - 4 * 22500) / 48).toFixed(0)} ms`);

  // --- Z4: Projekttempo 120
  punkt = 'Z4';
  await aendern('W1 Warp an', [{ befehl: 'warp_setzen', clip_id: c1.id, an: true }]);
  await setzeTempo(120);
  const w4 = await exportiere(0, 64, 'z4-warp-120');
  const k4 = klicks(w4.l), a4 = abstaende(k4), daneben4 = a4.filter((a) => Math.abs(a - 24000) > 1).length;
  notiere('Z4 AK16 Tempo 120: 64 Klicks im Abstand 24 000 ± 1, Länge in Beats gleich', k4.length === 64 && daneben4 === 0 && (await aktuell()).projekt.spuren[0].clips[0].laenge_beats === 64,
    `${k4.length} Klicks, ${daneben4} Abstände außerhalb ±1, Abstand ${Math.min(...a4)}..${Math.max(...a4)}`);

  // --- Z5: Tonhöhe
  punkt = 'Z5';
  await neuesProjekt('sinus');
  await setzeTempo(bpmProjekt);
  await aendern('W1 Sinus', [{ befehl: 'spur_neu', art: 'audio', name: 'Sinus' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: AUFBAU.sha_sinus, warp: 'auto' }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }], CYPHER);
  const w5 = await exportiere(0, 8, 'z5-sinus-warp');
  const f5 = frequenz(w5.l, 20000, 150000), soll = 1200 * Math.log2(128 / 125);
  await aendern('W1 Sinus Warp aus', [{ befehl: 'warp_setzen', clip_id: 'c1', an: false }]);
  const w5b = await exportiere(0, 8, 'z5-sinus-ohne');
  const f5b = frequenz(w5b.l, 20000, 150000);
  notiere('Z5 AK5 Tonhöhe gewarpt +41,06 ct ± 0,5; ungewarpt 1000 Hz ± 0,5 ct', Math.abs(cent(f5, 1000) - soll) <= 0.5 && Math.abs(cent(f5b, 1000)) <= 0.5,
    `gewarpt ${fmt(f5)} Hz = ${fmt(cent(f5, 1000))} ct (soll ${fmt(soll)}); ungewarpt ${fmt(f5b)} Hz = ${fmt(cent(f5b, 1000))} ct`);

  // --- Z6: Cypher
  punkt = 'Z6';
  await aendern('W1 Cypher Warp an', [{ befehl: 'warp_setzen', clip_id: 'c1', an: true }], CYPHER);
  const lage = erwarte200('/proj/warp', await ruf('GET', '/proj/warp?clip_id=c1&bei_beat=4', null, CYPHER)).j;
  notiere('Z6a proj_warp: 2 Marker, Segment-Tempo 125, W(4) = 1,92 s', lage.warp?.marker_zahl === 2 && Math.abs(lage.warp.marker[0].segment_bpm - 125) < 1e-6 && Math.abs(lage.bei.quell_s - 1.92) < 1e-9,
    `marker_zahl ${lage.warp?.marker_zahl}, segment_bpm ${lage.warp?.marker?.[0]?.segment_bpm}, W(4) = ${lage.bei?.quell_s}`);
  const verlauf = erwarte200('/proj/verlauf', await ruf('GET', '/proj/verlauf')).j;
  const cypherEintraege = verlauf.filter((e) => e.quelle === 'cypher' && /Warp/.test(e.label)).length;
  notiere('Z6b Verlauf trägt die Quelle cypher für die Warp-Änderungen', cypherEintraege >= 1, `${cypherEintraege} Einträge mit Quelle cypher und Warp im Label`);
  const rev = await holeRev();
  erwarte200('/proj/undo', await ruf('POST', '/proj/undo', { rev }, CYPHER));
  notiere('Z6c Undo nimmt die Warp-Änderung zurück (Warp wieder aus)', (await aktuell()).projekt.spuren[0].clips[0].warp.an === false, 'warp.an nach Undo false');

  // --- NK
  punkt = 'NK';
  const r1 = await ruf('POST', '/proj/aendern', { rev: await holeRev(), label: 'NK', befehle: [{ befehl: 'warp_setzen', clip_id: 'c1', modus: 'complex' }] }, CYPHER);
  notiere('NK1 modus complex → warp_modus', r1.code === 409 && r1.j?.fehler === 'warp_modus', grundVon(r1));
  const r2 = await ruf('POST', '/proj/aendern', { rev: await holeRev(), label: 'NK', befehle: [{ befehl: 'warp_setzen', clip_id: 'c1', transpose_st: 2 }] }, CYPHER);
  notiere('NK2 transpose bei repitch → transpose_repitch', r2.code === 409 && r2.j?.fehler === 'transpose_repitch', grundVon(r2));
}

try {
  await lauf();
} catch (e) {
  if (e instanceof Fehl) notiere(punkt, false, e.message); else notiere('ABBRUCH', false, `${punkt}: ${e.stack ?? String(e)}`);
} finally {
  for (const slug of eigeneSlugs) {
    const d = path.join(wurzel, slug);
    if (!/^w1-(klick|sinus)-\d{8}t\d{6}/i.test(slug)) { info(`Slug ${slug} ist nicht von diesem Skript, nicht gelöscht`); continue; }
    try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`Projekt ${d} gelöscht`); } else info(`Projekt ${d} nicht gefunden`); } catch (e) { notiere('Aufräumen', false, e.message); }
  }
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Abnahme W1 Slice 1 ${zeit} (${URL}, Instanz ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
