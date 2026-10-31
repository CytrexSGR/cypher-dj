// Zielabnahme Paket 1.13 Warp, Slice 4 (BEATS, Transienten, Quantize Audio) gegen eine PRÜFINSTANZ (Seiten-Server mit Kern, Bungee ON, Export-Senke), Material aus w4_aufbau.mjs:
//   node pruef/w4_aufbau.mjs --ziel /dev/shm/w4-ziel --instanz a > /dev/shm/w4-ziel/aufbau.json
//   CYPHERDJ_PYTHON=$HOME/cypher-dj/djk/werkstatt/.venv/bin/python CYPHERDJ_ANALYSE=/dev/shm/w4-ziel/analyse CYPHERDJ_MEDIATHEK=/dev/shm/w4-ziel/mediathek.sqlite \
//     CYPHERDJ_KATALOG=/dev/shm/w4-ziel/katalog.sqlite DJK=<worktree>/djk djk/start/djk-start --instanz a --arr1
//   node pruef/abnahme_w4.mjs --url http://127.0.0.1:48300 --aufbau /dev/shm/w4-ziel/aufbau.json [--ausgabe <Ordner>] [--wav-behalten]
// Vor dem Lauf das Echtzeit-Schloss nehmen (djk/konfig/echtzeit_schloss.sh); die Hauptinstanz startet und räumt die Instanz.
//   Z1  AK8   BEATS Einsatz: Quelle a (Ein-Sample-Klicks), Clip BEATS 1/16 (loop aus), Projekt 100 und 150 BPM, Export; rasterAbweichung (w3b_messen) gegen das 1/16-Raster
//             des Projekts ≤ 2 Samples, n = 32 (D12: bei Raster 1/16 ohne Vorlauf)
//   NK1       derselbe Clip mit ausgeschaltetem Warp: > 200 Samples neben dem Raster
//   Z2  AK8   BEATS Form: Quelle a2 (Schlag mit Körper), sonst wie Z1; Korrelation der ersten 10 ms jedes Schlags mit der Quelle ≥ 0,99 (Verzug 0 oder 1 Sample, D6a); kleinster Wert
//   NK2       derselbe Clip COMPLEX: kleinster Wert nur als Auskunft (INFO, ohne Grenze)
//   Z3        Lückenmodi: Quelle a2 bei 100 BPM; loop aus: RMS im Lückenfenster < −80 dBFS, vor und vor_zurueck: > −40 dBFS; Kontrolle: im Klang der Einheit > −40 dBFS
//   Z4        Transienten: transienten_zahl = Zahl der Schläge exakt (a 32, b 64, b2 64); NK4 Sinus (s): 0
//   Z5a AK23  Quantize: Quelle b (Ein-Sample-Klicks ±20 ms), Clip auf start_beat 0,5 (D13), Projekt 128, COMPLEX, audio_quantisieren 1/16: Rest zum Raster mit Phasenfit (w3a_messen messe) p90 ≤ 1 ms
//   NK5a      ohne Quantisieren: p90 ≥ 10 ms
//   Z5b       Quantize: Quelle b2 (Burst mit 1 ms Anstieg), Rest zum festen 1/4-Raster des Projekts ohne Phasenfit p90 ≤ 2 ms; der Median mit Vorzeichen (+ = nach dem Raster) wird mitgeteilt
//   NK5b      ohne Quantisieren: p90 ≥ 10 ms
//   Z6        Stärke 0,5: p90 (wie Z5a) = 0,5 · p90 ohne ± 10 %
//   Z7        Undo nach Z5a: die Marker (der ganze Warp) sind exakt wie vor Z5a; NK7 der quantisierte Stand war ein anderer
// Rückgabe: 0 alle Punkte OK, 1 mindestens ein Punkt FEHL, 2 Aufruf. Letzte Zeile: ALLES OK oder FEHL n. Rohdaten: rohdaten.json und bericht.md im Ausgabeordner; die WAVs der Exporte
// nur mit --wav-behalten. Aufräumen: nur die eigenen Projekte (Slug w4-...).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { starte, Fehl } from './w3a_ziel.mjs';
import { messe } from './w3a_messen.mjs';
import { klickStellen, rasterAbweichung } from './w3b_messen.mjs';
import { db, formKorrelation, restFest, rms, z5bOk } from './w4_messen.mjs';
import { leseWav } from './w1_wav.mjs';

const z = starte('abnahme_w4', 'w4', { 'wav-behalten': { type: 'boolean' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, exportiere } = z;
const SR = 48000;
const roh = {};
const ms = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const projektClips = async () => (await aktuell()).projekt.spuren.flatMap((s) => s.clips);
const clipMit = async (sha) => (await projektClips()).find((c) => c.quelle.sha256 === sha);
const warpLage = async (id) => z.erwarte200('/proj/warp', await z.ruf('GET', `/proj/warp?clip_id=${id}&marker_max=4096`)).j;
const rueck = async (art) => z.erwarte200(`/proj/${art}`, await z.ruf('POST', `/proj/${art}`, { rev: await z.holeRev() }));

// ein Projekt mit einer Spur und einem Clip der Quelle `q` (Auto-Warp aus dem Katalog) auf start_beat `start`
async function neu(name, tempo, quellen) {
  await z.neuesProjekt(name);
  await z.setzeTempo(tempo);
  const befehle = [{ befehl: 'spur_neu', art: 'audio', name: 'W4' }];
  for (const [q, start] of quellen) befehle.push({ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: start, laenge_beats: 1, sha256: A.shas[q], warp: 'auto' });
  await aendern(`W4 Aufbau ${name}`, befehle, CYPHER);
  await z.geladen();
  return Object.fromEntries(await Promise.all(quellen.map(async ([q]) => [q, (await clipMit(A.shas[q])).id])));
}
const beatsSetzen = (id, raster, loop, huelle = 100) => aendern(`W4 BEATS ${raster} ${loop}`, [{ befehl: 'warp_setzen', clip_id: id, modus: 'beats', beats: { raster, loop, huelle } }], CYPHER);
async function lauf() {
  try { info(`Kern-Stand: git log -1 -- djk/kern = ${execFileSync('git', ['log', '-1', '--format=%h %s', '--', 'djk/kern'], { cwd: path.join(path.dirname(new globalThis.URL(import.meta.url).pathname), '..', '..', '..'), encoding: 'utf8' }).trim()}`); } catch { info('Kern-Stand: git nicht lesbar'); }
  info(`Kern der Instanz: ${JSON.stringify((await aktuell()).kern ?? null)}`);

  // --- Z1 und Z2: Lage und Form (AK8), Projekt 100 und 150 BPM
  const quelleA2 = leseWav(A.wav.a2).l, quellPer = 60 / A.bpm.a2 * 0.25 * SR;
  for (const tempo of [100, 150]) {
    const P = 0.25 * 60 / tempo * SR;
    z.punkt = 'Z1';
    const ids = await neu(`z1-${tempo}`, tempo, [['a', 0]]);
    await beatsSetzen(ids.a, '1/16', 'aus');
    await z.geladen();
    const laenge = (await clipMit(A.shas.a)).laenge_beats;
    const x = await exportiere(0, laenge, `z1-beats-${tempo}`);
    // Nullpunkt aus dem bekannten Quell-Frame des ersten Klicks (A.lagen.a[0] = 960) und dem Clip-Start (start_beat 0, der Export beginnt bei 0), nicht aus dem
    // ersten gemessenen Klick: mit diesem sähe die Messung einen Versatz des ganzen Exports nie (Eichung: tests/pruef_w4_signal.test.mjs, 3 Samples werden rot)
    const nullpunkt = A.lagen.a[0] + 0, r = rasterAbweichung(x.l, nullpunkt, P);
    roh[`z1_${tempo}`] = { n: r.n, max: r.max, stelle: r.stelle, periode: P, laenge_beats: laenge };
    notiere(`Z1 AK8 BEATS Einsatz bei ${tempo} BPM: jeder Klick liegt höchstens 2 Samples neben dem 1/16-Raster des Projekts (${P} Samples), 32 Klicks`, r.n === 32 && r.max <= 2, `Klicks ${r.n}, größte Abweichung ${r.max} Samples (bei Sample ${r.stelle})`);
    await aendern('W4 Warp aus', [{ befehl: 'warp_setzen', clip_id: ids.a, an: false }], CYPHER);
    const k = await exportiere(0, laenge, `z1-warp-aus-${tempo}`);
    const rk = rasterAbweichung(k.l, klickErst(k.l), P);
    roh[`nk1_${tempo}`] = { n: rk.n, max: rk.max };
    notiere(`NK1 Negativ-Kontrolle bei ${tempo} BPM: derselbe Clip mit Warp aus liegt mehr als 200 Samples neben dem Raster (das Messgerät sieht es)`, rk.max > 200, `Klicks ${rk.n}, größte Abweichung ${rk.max} Samples`);

    z.punkt = 'Z2';
    const i2 = await neu(`z2-${tempo}`, tempo, [['a2', 0]]);
    await beatsSetzen(i2.a2, '1/16', 'aus');
    await z.geladen();
    const l2 = (await clipMit(A.shas.a2)).laenge_beats;
    const y = await exportiere(0, l2, `z2-beats-${tempo}`);
    const f = formKorrelation(y.l, quelleA2, A.lagen.a2, P, quellPer, SR);
    roh[`z2_${tempo}`] = f;
    notiere(`Z2 AK8 BEATS Form bei ${tempo} BPM: die ersten 10 ms jedes der 32 Schläge korrelieren mit der Quelle ≥ 0,99`, f.min >= 0.99, `kleinster Wert ${f.min.toFixed(5)} (Schlag ${f.schlag}, Verzug ${f.lag} Sample)`);
    await aendern('W4 COMPLEX', [{ befehl: 'warp_setzen', clip_id: i2.a2, modus: 'complex' }], CYPHER);
    const c = await exportiere(0, l2, `z2-complex-${tempo}`);
    const fc = formKorrelation(c.l, quelleA2, A.lagen.a2, P, quellPer, SR);
    roh[`nk2_${tempo}`] = fc;
    info(`NK2 Auskunft bei ${tempo} BPM: derselbe Clip COMPLEX, kleinster Wert der Form-Korrelation ${fc.min.toFixed(5)} (Schlag ${fc.schlag}), ohne Grenze`);
  }

  // --- Z3: Lückenmodi bei 100 BPM
  z.punkt = 'Z3';
  {
    const P = 0.25 * 60 / 100 * SR, quell = quellPer;                       // 7200 Frames Platz, 5760 Frames Quelle: die Lücke dahinter ist 1440 Frames
    const ids = await neu('z3', 100, [['a2', 0]]);
    const l3 = (await clipMit(A.shas.a2)).laenge_beats;
    const werte = {};
    for (const loop of ['aus', 'vor', 'vor_zurueck']) {
      await beatsSetzen(ids.a2, '1/16', loop);
      await z.geladen();
      const x = await exportiere(0, l3, `z3-${loop}`);
      const luecke = [], klang = [];
      for (let u = 8; u <= 28; u++) { luecke.push(db(rms(x.l, u * P + quell + 200, u * P + P - 50))); klang.push(db(rms(x.l, u * P + 1000, u * P + 2800))); }
      werte[loop] = { luecke_max: Math.max(...luecke), luecke_min: Math.min(...luecke), klang_min: Math.min(...klang) };
    }
    roh.z3 = werte;
    const w = werte;
    notiere('Z3 Lückenmodus aus: RMS im Lückenfenster (Frames 5960..7150 jeder Einheit, Einheiten 8..28) unter −80 dBFS', w.aus.luecke_max < -80, `größter Wert ${w.aus.luecke_max.toFixed(1)} dBFS`);
    notiere('Z3 Lückenmodus vor: RMS im Lückenfenster über −40 dBFS', w.vor.luecke_min > -40, `kleinster Wert ${w.vor.luecke_min.toFixed(1)} dBFS`);
    notiere('Z3 Lückenmodus vor_zurueck: RMS im Lückenfenster über −40 dBFS', w.vor_zurueck.luecke_min > -40, `kleinster Wert ${w.vor_zurueck.luecke_min.toFixed(1)} dBFS`);
    notiere('Z3 Kontrolle: im Klang der Einheiten (Frames 1000..2800) liegt in allen drei Exporten Signal über −40 dBFS (das Fenster misst am richtigen Ort)',
      Object.values(w).every((v) => v.klang_min > -40), `kleinste Werte aus ${w.aus.klang_min.toFixed(1)}, vor ${w.vor.klang_min.toFixed(1)}, vor_zurueck ${w.vor_zurueck.klang_min.toFixed(1)} dBFS`);
  }

  // --- Z4: Transienten
  z.punkt = 'Z4';
  {
    const ids = await neu('z4', 128, [['a', 0], ['s', 12], ['b', 24], ['b2', 90]]);
    const soll = { a: 32, b: 64, b2: 64 };
    for (const [q, n] of Object.entries(soll)) {
      const l = (await warpLage(ids[q])).warp;
      let abw = Infinity;
      if (l.transienten?.length === A.lagen[q].length) abw = Math.max(...l.transienten.map((t, k) => Math.abs(t - A.lagen[q][k] / SR) * 1000));
      roh[`z4_${q}`] = { zahl: l.transienten_zahl, gezeigt: l.transienten_gezeigt, abweichung_ms: abw };
      notiere(`Z4 Transienten der Quelle ${q}: transienten_zahl = ${n} (Zahl der Schläge) exakt`, l.transienten_zahl === n, `transienten_zahl ${l.transienten_zahl}, größte Abweichung der Lage zum bestellten Schlag ${ms(abw)} ms (Auskunft)`);
    }
    const s = (await warpLage(ids.s)).warp;
    roh.z4_s = { zahl: s.transienten_zahl };
    notiere('NK4 Negativ-Kontrolle Transienten: der Sinus 440 Hz hat 0 Transienten (nicht null = Quelle nicht dekodiert)', s.transienten_zahl === 0, `transienten_zahl ${s.transienten_zahl}`);
  }

  // --- Z5a, Z6, Z7 (Quelle b) und Z5b (Quelle b2): Quantize Audio, Projekt 128, COMPLEX, Clip auf start_beat 0,5
  for (const q of ['b', 'b2']) {
    z.punkt = q === 'b' ? 'Z5a' : 'Z5b';
    const ids = await neu(`z5${q === 'b' ? 'a' : 'b'}`, 128, [[q, 0.5]]);
    const id = ids[q];
    await aendern('W4 COMPLEX', [{ befehl: 'warp_setzen', clip_id: id, modus: 'complex' }], CYPHER);
    await z.geladen();
    const bis = 0.5 + (await clipMit(A.shas[q])).laenge_beats + 1;
    const warpVor = JSON.stringify((await clipMit(A.shas[q])).warp);
    const ohne = await exportiere(0, bis, `z5${q}-ohne`);
    const quantisiere = (staerke) => aendern(`W4 Quantize ${staerke}`, [{ befehl: 'audio_quantisieren', clip_id: id, raster: '1/16', ...(staerke === 1 ? {} : { staerke }) }], CYPHER);
    await quantisiere(1);
    await z.geladen();
    const mit = await exportiere(0, bis, `z5${q}-quantisiert`);
    const warpNach = JSON.stringify((await clipMit(A.shas[q])).warp);
    if (q === 'b') {
      const u = messe(ohne.l, 128), m = messe(mit.l, 128);
      roh.z5a = { ohne: { n: u.n, p90: u.p90, median: u.median, max: u.max }, mit: { n: m.n, p90: m.p90, median: m.median, max: m.max } };
      notiere('Z5a AK23 Quantize Audio: der Rest der 64 Anschläge zum Raster (Phasenfit) hat p90 ≤ 1 ms', m.n === 64 && m.p90 <= 1, `Anschläge ${m.n}, p90 ${ms(m.p90)} ms, Median ${ms(m.median)}, größter ${ms(m.max)}`);
      notiere('NK5a Negativ-Kontrolle: ohne Quantisieren hat derselbe Clip p90 ≥ 10 ms', u.n === 64 && u.p90 >= 10, `Anschläge ${u.n}, p90 ${ms(u.p90)} ms`);
      // Z7: Undo
      z.punkt = 'Z7';
      await rueck('undo'); await z.geladen();
      const warpUndo = JSON.stringify((await clipMit(A.shas[q])).warp);
      roh.z7 = { gleich: warpUndo === warpVor, quantisierter_stand_anders: warpNach !== warpVor };
      notiere('Z7 Undo nach Quantize Audio: der Warp (alle Marker) ist exakt wie vor dem Befehl', warpUndo === warpVor, `gleich ${warpUndo === warpVor}, Länge ${warpUndo.length} / ${warpVor.length}`);
      notiere('NK7 Negativ-Kontrolle: der quantisierte Stand war ein anderer als der davor (der Befehl hat Marker verändert)', warpNach !== warpVor, `verschieden ${warpNach !== warpVor}`);
      // Z6: Stärke 0,5
      z.punkt = 'Z6';
      await quantisiere(0.5);
      await z.geladen();
      const halb = await exportiere(0, bis, 'z6-halb');
      const h = messe(halb.l, 128), soll = 0.5 * u.p90;
      roh.z6 = { n: h.n, p90: h.p90, soll, ohne_p90: u.p90 };
      notiere('Z6 Stärke 0,5: p90 (wie Z5a) = 0,5 · p90 ohne Quantisieren ± 10 %', h.n === 64 && Math.abs(h.p90 - soll) <= 0.1 * soll, `Anschläge ${h.n}, p90 ${ms(h.p90)} ms, Soll ${ms(soll)} ms (0,5 · ${ms(u.p90)}), Abstand ${((h.p90 / soll - 1) * 100).toFixed(1)} %`);
    } else {
      const u = restFest(ohne.l, 128, SR), m = restFest(mit.l, 128, SR);
      roh.z5b = { ohne: u, mit: m };
      // Ehrliche Grenze: kommt hier FEHL heraus, ist das ein Befund über Kern oder Detektor, kein Werkzeugfehler (Eichung: z5bOk in w4_messen.mjs)
      notiere('Z5b Quantize Audio: der Rest der 64 Anschläge zum festen 1/4-Raster des Projekts (ohne Phasenfit): |Median mit Vorzeichen| ≤ 0,5 ms und p90 ≤ 2 ms', z5bOk(m),
        `Anschläge ${m.n}, p90 ${ms(m.p90)} ms, Median mit Vorzeichen ${m.median >= 0 ? '+' : ''}${ms(m.median)} ms (${m.median >= 0 ? 'nach' : 'vor'} dem Raster), größter ${ms(m.max)} ms`);
      notiere('NK5b Negativ-Kontrolle: ohne Quantisieren hat derselbe Clip p90 ≥ 10 ms zum festen Raster', u.n === 64 && u.p90 >= 10, `Anschläge ${u.n}, p90 ${ms(u.p90)} ms, Median ${ms(u.median)} ms`);
    }
  }
}
// erster Klick des Exports (Klick = Spitze über 30 % des Maximums, w3b_messen)
function klickErst(x) { return klickStellen(x)[0] ?? 0; }

try {
  await lauf();
} catch (e) {
  if (e instanceof Fehl) notiere(z.punkt, false, e.message); else notiere('ABBRUCH', false, `${z.punkt}: ${e.stack ?? String(e)}`);
}
// Ende wie z.ende (w3a_ziel.mjs), mit der Schlusszeile ALLES OK / FEHL n und den Rohdaten
const wurzel = path.join('/dev/shm', `cypherdj-${z.instanz}`, 'projekte');
for (const slug of z.eigeneSlugs) {
  const d = path.join(wurzel, slug);
  if (!/^w4-[a-z0-9-]+-\d{8}t\d{6}/i.test(slug)) { z.info(`Slug ${slug} ist nicht von diesem Skript, nicht gelöscht`); continue; }
  try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); z.info(`Projekt ${d} gelöscht`); } else z.info(`Projekt ${d} nicht gefunden`); } catch (e) { z.notiere('Aufräumen', false, e.message); }
}
fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), `${JSON.stringify({ zeit: z.zeit, url: z.URL, instanz: z.instanz, aufbau: { shas: A.shas, bpm: A.bpm }, roh }, null, 1)}\n`);
if (!z.opt['wav-behalten']) for (const f of fs.readdirSync(z.ORDNER)) if (f.endsWith('.wav')) fs.rmSync(path.join(z.ORDNER, f));
const schluss = z.fehl === 0 ? 'ALLES OK' : `FEHL ${z.fehl}`;
fs.writeFileSync(path.join(z.ORDNER, 'bericht.md'), `# Abnahme W4 Slice 4 ${z.zeit} (${z.URL}, Instanz ${z.instanz})\n\n${z.zeilen.join('\n')}\n\n${schluss}\n`);
process.stdout.write(`\n${schluss}\n`);
process.exit(z.fehl === 0 ? 0 : 1);
