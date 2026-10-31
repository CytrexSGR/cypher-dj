// Zielabnahme Paket 1.13 Warp, Slice 2 (COMPLEX und TONES): derselbe Aufbau wie abnahme_w1.mjs (Prüfinstanz, nie g, h, i, nie der Betrieb; Kern und cypherdj-render mit Bungee;
// Katalog aus pruef/w1_aufbau.mjs), die Clips aber im Modus COMPLEX bzw. TONES. Die Messung geht über den Export (der Render treibt das Warp-Werk synchron, L2 „gerendert = gehört“):
//   node pruef/w1_aufbau.mjs --ziel /tmp/w2-ziel
//   CYPHERDJ_KATALOG=/tmp/w2-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz a --arr1
//   node pruef/abnahme_w2.mjs --url http://127.0.0.1:48300 --aufbau /tmp/w2-ziel/aufbau.json [--ausgabe <Ordner>]
//   Z1  Aufbau wie Slice 1, danach warp_setzen modus complex: der Server schreibt Modus 2, der Kern lädt (rev_geladen), kein warp_maschine_fehlt
//   Z7  Export 0..64 Beats bei 128 BPM: 64 Klicks; Abweichung vom Ausgleichsraster höchstens 96 Samples (2 ms, das Kriterium von test_dehner_bungee), mittlerer Abstand 22 500 ± 1
//       (keine Drift); das Maximum wird ausgewiesen (Spec AK6: 16, gemessen im Kern-Test 23 an Hann-Klicks); Vorher-Fall RE-PITCH wie Slice 1 (Abstand 22 500 ± 1)
//   Z8  Projekttempo 120: dasselbe, mittlerer Abstand 24 000 ± 1
//   Z9  Tonhöhe: Sinus-Loop in COMPLEX und in TONES klingt 1000 Hz ± 2 ct (die Tonhöhe bleibt, anders als RE-PITCH mit +41 ct)
//   NK  Ablehnungen: modus beats → warp_modus; transpose bei complex → transpose_spaeter; transpose bei repitch → transpose_repitch
// Rückgabe: 0 alle Punkte OK, 1 mindestens ein Punkt FEHL, 2 Aufruf. Aufräumen: nur die eigenen Projekte (Slug w2-...).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { leseWav, klicks, frequenz, cent } from './w1_wav.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, aufbau: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' } } });
const aufrufFehler = (t) => { process.stderr.write(`abnahme_w2: ${t}\n`); process.exit(2); };
if (!opt.url || !opt.aufbau) aufrufFehler('Aufruf: --url <http://127.0.0.1:port> --aufbau <aufbau.json> [--ausgabe <Ordner>] [--instanz <a..f>]');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('nie gegen den Betrieb (47300): eine Prüfinstanz wählen');
const port = Number(new globalThis.URL(opt.url).port), k = (port - 47300) / 1000;
const instanz = opt.instanz ?? (Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined);
if (!instanz || /^[ghi]$/.test(instanz)) aufrufFehler(`Instanz ${instanz ?? '?'} (Port ${port}) ist nicht erlaubt: g, h, i sind tabu`);
const AUFBAU = JSON.parse(fs.readFileSync(opt.aufbau, 'utf8'));
const zwei = (n) => String(n).padStart(2, '0'), d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-w2`);
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
const setzeTempo = async (bpm) => { await aendern(`W2 Tempo ${bpm}`, [{ befehl: 'tempo_setzen', bpm }], CYPHER); await warte(6000); };
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
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `w2-${name}-${zeit}` }));
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
// Ausgleichsgerade der Klick-Lagen über dem Klick-Index: größte Abweichung davon und mittlerer Abstand
const gerade = (xs) => {
  const n = xs.length, mx = (n - 1) / 2, my = xs.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  xs.forEach((y, i) => { sxy += (i - mx) * (y - my); sxx += (i - mx) * (i - mx); });
  const m = sxy / sxx, b0 = my - m * mx;
  return { abstand: m, max: Math.max(...xs.map((y, i) => Math.abs(y - (b0 + m * i)))) };
};

async function lauf() {
  // --- Z1: Aufbau, COMPLEX
  punkt = 'Z1';
  await neuesProjekt('klick');
  await setzeTempo(bpmProjekt);
  await aendern('W2 Aufbau', [{ befehl: 'spur_neu', art: 'audio', name: 'Klick' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: AUFBAU.sha_klick, warp: 'auto' }], CYPHER);
  const c1 = (await aktuell()).projekt.spuren[0].clips[0];
  await aendern('W2 Loop 64 Beats', [{ befehl: 'clip_aendern', clip_id: c1.id, laenge_beats: 64, loop_beats: 8 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 64 }]);
  await aendern('W2 Modus COMPLEX', [{ befehl: 'warp_setzen', clip_id: c1.id, modus: 'complex' }], CYPHER);
  await geladen();
  const z1 = await zustandKurz();
  notiere('Z1 warp_setzen modus complex: der Server hat den Modus, der Kern lädt die Wiedergabe', (await aktuell()).projekt.spuren[0].clips[0].warp.modus === 'complex' && z1.kern?.rev_geladen === z1.wiedergabe_rev,
    `modus ${(await aktuell()).projekt.spuren[0].clips[0].warp.modus}, rev_geladen ${z1.kern?.rev_geladen} gleich wiedergabe_rev ${z1.wiedergabe_rev}`);

  // --- Z7: Raster bei 128 BPM
  punkt = 'Z7';
  const w7 = await exportiere(0, 64, 'z7-complex-128');
  const k7 = klicks(w7.l), g7 = gerade(k7);
  notiere('Z7 COMPLEX Export 128 BPM: 64 Klicks, Abweichung vom Raster höchstens 96 Samples, mittlerer Abstand 22 500 ± 1', k7.length === 64 && g7.max <= 96 && Math.abs(g7.abstand - 22500) <= 1,
    `${k7.length} Klicks, größte Abweichung von der Ausgleichsgeraden ${fmt(g7.max)} Samples (Spec AK6: 16; Kern-Test 23), mittlerer Abstand ${fmt(g7.abstand)}, erster Klick bei Sample ${k7[0]}`);
  await aendern('W2 Modus RE-PITCH', [{ befehl: 'warp_setzen', clip_id: c1.id, modus: 'repitch' }]);
  const w7b = await exportiere(0, 64, 'z7-repitch-128');
  const k7b = klicks(w7b.l), a7b = abstaende(k7b), daneben7b = a7b.filter((a) => Math.abs(a - 22500) > 1).length;
  notiere('Z7b Vorher-Fall RE-PITCH: 64 Klicks im Abstand 22 500 ± 1 (die Messung sieht den Unterschied)', k7b.length === 64 && daneben7b === 0, `${k7b.length} Klicks, ${daneben7b} Abstände außerhalb ±1`);

  // --- Z8: Projekttempo 120
  punkt = 'Z8';
  await aendern('W2 Modus COMPLEX', [{ befehl: 'warp_setzen', clip_id: c1.id, modus: 'complex' }]);
  await setzeTempo(120);
  const w8 = await exportiere(0, 64, 'z8-complex-120');
  const k8 = klicks(w8.l), g8 = gerade(k8);
  notiere('Z8 COMPLEX Tempo 120: 64 Klicks, Abweichung vom Raster höchstens 96 Samples, mittlerer Abstand 24 000 ± 1', k8.length === 64 && g8.max <= 96 && Math.abs(g8.abstand - 24000) <= 1,
    `${k8.length} Klicks, größte Abweichung ${fmt(g8.max)} Samples, mittlerer Abstand ${fmt(g8.abstand)}`);

  // --- Z9: Tonhöhe
  punkt = 'Z9';
  await neuesProjekt('sinus');
  await setzeTempo(bpmProjekt);
  await aendern('W2 Sinus', [{ befehl: 'spur_neu', art: 'audio', name: 'Sinus' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: AUFBAU.sha_sinus, warp: 'auto' }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }], CYPHER);
  const ct = {};
  for (const modus of ['complex', 'tones']) {
    await aendern(`W2 Sinus ${modus}`, [{ befehl: 'warp_setzen', clip_id: 'c1', modus }], CYPHER);
    const w9 = await exportiere(0, 8, `z9-sinus-${modus}`);
    ct[modus] = cent(frequenz(w9.l, 20000, 150000), 1000);
  }
  notiere('Z9 Tonhöhe bleibt: COMPLEX und TONES je 1000 Hz ± 2 ct', Math.abs(ct.complex) <= 2 && Math.abs(ct.tones) <= 2, `complex ${fmt(ct.complex)} ct, tones ${fmt(ct.tones)} ct (RE-PITCH wäre +41,06 ct)`);

  // --- NK
  punkt = 'NK';
  const nk = async (befehl) => ruf('POST', '/proj/aendern', { rev: await holeRev(), label: 'NK', befehle: [befehl] }, CYPHER);
  const r1 = await nk({ befehl: 'warp_setzen', clip_id: 'c1', modus: 'beats' });
  notiere('NK1 modus beats → warp_modus', r1.code === 409 && r1.j?.fehler === 'warp_modus', grundVon(r1));
  const r2 = await nk({ befehl: 'warp_setzen', clip_id: 'c1', transpose_st: 2 });
  notiere('NK2 transpose bei tones → transpose_spaeter', r2.code === 409 && r2.j?.fehler === 'transpose_spaeter', grundVon(r2));
  await aendern('W2 Modus RE-PITCH', [{ befehl: 'warp_setzen', clip_id: 'c1', modus: 'repitch' }]);
  const r3 = await nk({ befehl: 'warp_setzen', clip_id: 'c1', transpose_st: 2 });
  notiere('NK3 transpose bei repitch → transpose_repitch', r3.code === 409 && r3.j?.fehler === 'transpose_repitch', grundVon(r3));
}

try {
  await lauf();
} catch (e) {
  if (e instanceof Fehl) notiere(punkt, false, e.message); else notiere('ABBRUCH', false, `${punkt}: ${e.stack ?? String(e)}`);
} finally {
  for (const slug of eigeneSlugs) {
    const d = path.join(wurzel, slug);
    if (!/^w2-(klick|sinus)-\d{8}t\d{6}/i.test(slug)) { info(`Slug ${slug} ist nicht von diesem Skript, nicht gelöscht`); continue; }
    try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`Projekt ${d} gelöscht`); } else info(`Projekt ${d} nicht gefunden`); } catch (e) { notiere('Aufräumen', false, e.message); }
  }
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Abnahme W2 Slice 2 ${zeit} (${URL}, Instanz ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
