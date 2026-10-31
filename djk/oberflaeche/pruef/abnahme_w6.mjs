// Zielabnahme Paket 1.13 Warp, Slice 6 (Stems) gegen eine PRÜFINSTANZ mit echtem Katalog (Kern, Export-Senke, werkstatt.stems mit demucs, nur CPU):
//   echo '{"sha":"<sha256 des Katalog-Tracks>","von_beat":16,"bis_beat":48,"bpm":124}' > /dev/shm/w6-ziel/aufbau.json
//   node pruef/abnahme_w6.mjs --url <Prüfinstanz> --aufbau /dev/shm/w6-ziel/aufbau.json [--ausgabe <Ordner>] [--wav-behalten]
// Vor dem Lauf das Echtzeit-Schloss nehmen; die Hauptinstanz startet und räumt die Instanz.
//   Z1  Ende fertig: vier neue Spuren direkt unter der Quellspur (Drums, Bass, Other, Vocals), Gruppe „Stems: <Name>“, Mittelstück stumm, rest_db im Stand
//   Z0  das Original ist gewarpt (warp.an): die Abnahme belegt den Warp-Fall, sonst wäre Z3 trivial wahr
//   Z2  jede Stem-WAV hat exakt n Frames (n aus der Startantwort)
//   Z3  Lage der Marker: |W_stem(b) + F0/48000 − W_orig(b)| ≤ 1 Sample an 129 Beats im Bereich (F0 aus W_orig am Bereichsanfang)
//   NK3 dieselbe Rechnung mit F0 um 48 Frames verschoben: ≥ 40 Samples
//   M1  Wirkung von Mute und stumm: Export nur Drums (B), vier Stems (C), nur Original (O), je Kanal: rms(B−C)/rms(C) und rms(B−O)/rms(O) ≥ −30 dB,
//       Pegel C gegen O höchstens 3 dB (wirkt stumm nicht, steigt er um 6 dB)
//   Z4a Vorab: Zahl der Drums-Anschläge und der im Original wiedergefundenen (je Kanal) ≥ 16 und ≥ 75 %
//   Z4  AK24 Anschläge: Export nur Original gegen Export nur Drums-Stem, beide hochgepasst (500 Hz), je Drums-Anschlag der Einsatz im Original lokal (±20 ms)
//       gesucht (w6_messen.mjs, Begründung dort): p90 |Δ| ≤ 1 ms, beide Kanäle
//   Z4b dasselbe gegen das feste 1/16-Raster des Projekts: Median mit Vorzeichen von Drums und Original unterscheiden sich um ≤ 1 ms
//   NK4 Drums um 5 ms verschoben gerechnet: p90 > 4 ms
//   Z5  Restsignal je Kanal: Export der vier Stems zusammen gegen Export nur Original, 20·log10(rms(Summe − Original)/rms(Original));
//       Richtwert ≤ −20 dB, INFO, kein Tor (Spec AK24)
//   NK5 Original gegen Stille: 0 dB
//   Z6  ein Undo: Spurenliste, stumm und Gruppen exakt wie vor dem Lauf (NK6: der Stand nach dem Lauf war ein anderer)
// Die Rechnung steht rein in pruef/w6_messen.mjs und ist geeicht in tests/pruef_w6_messen.test.mjs (jede Negativ-Kontrolle schlägt dort an).
// Rückgabe: 0 alle OK, 1 FEHL, 2 Aufruf. Rohdaten rohdaten.json, bericht.md; WAVs nur mit --wav-behalten. Aufräumen nur eigene Projekte (Slug w6-…).
import fs from 'node:fs';
import path from 'node:path';
import { starte, Fehl } from './w3a_ziel.mjs';
import { leseWav } from './w1_wav.mjs';
import { SR, lageMax, f0Von, z3Ok, nk3Ok, f64, anschlagMessung, z4aOk, z4Ok, z4bOk, nk4Ok, restDb, Z5_RICHTWERT_DB, standSchluessel, wirkung, wirkungOk }
  from './w6_messen.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_w6: Aufruf: --url <Prüfinstanz> --aufbau <aufbau.json> [--ausgabe <Ordner>] [--instanz <a..f>] [--wav-behalten]\n'
    + '  aufbau.json: {"sha":"<sha256>","von_beat":16,"bis_beat":48,"bpm":124}\n');
  process.exit(2);
}
const z = starte('abnahme_w6', 'w6', { 'wav-behalten': { type: 'boolean' } });
const { AUFBAU: A, CYPHER, notiere, info, aendern, aktuell, exportiere } = z;
const roh = {};
const ms = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const FRIST_MS = 15 * 60_000;
const STEMS = ['drums', 'bass', 'other', 'vocals'];
const rueck = async (art) => z.erwarte200(`/proj/${art}`, await z.ruf('POST', `/proj/${art}`, { rev: await z.holeRev() }));
let laufId = null, laufBeendet = false;   // eigener Lauf: bei Zeitüberschreitung oder Ausnahme per /proj/stems/abbrechen beenden
const abbrechen = async (grund) => {
  if (laufId === null || laufBeendet) return;
  try {
    const r = await z.ruf('POST', '/proj/stems/abbrechen', { auftrag_id: laufId }, CYPHER);
    info(`Abbruch des eigenen Laufs ${laufId} (${grund}): ${z.grundVon(r)}`);
  }
  catch (e) { info(`Abbruch des eigenen Laufs ${laufId} (${grund}) nicht möglich: ${e.message}`); }
  laufBeendet = true;
};
const sp = (p, id) => p.spuren.find((s) => s.id === id);

const exportNamen = [];   // Dateinamen der eigenen Export-WAVs im Ausgabeordner
async function lauf() {
  for (const k of ['sha', 'von_beat', 'bis_beat', 'bpm']) if (A[k] === undefined) throw new Fehl(`aufbau.json: ${k} fehlt`);
  info(`Kern der Instanz: ${JSON.stringify((await aktuell()).kern ?? null)}`);

  // --- Aufbau: ein Projekt, eine Spur, ein Clip über 64 Beats mit Auto-Warp aus dem Katalog
  z.punkt = 'Aufbau';
  await z.neuesProjekt('stems');
  await z.setzeTempo(A.bpm);
  await aendern('W6 Aufbau', [{ befehl: 'spur_neu', art: 'audio', name: 'Quelle' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 64, sha256: A.sha, warp: 'auto' }], CYPHER);
  await z.geladen();
  const vor = await aktuell();
  const quelleSpur = vor.projekt.spuren[0], clip0 = quelleSpur.clips[0];
  roh.vor = { spuren: vor.projekt.spuren.length, gruppen: (vor.projekt.gruppen ?? []).length, clip: clip0.id, warp_an: clip0.warp?.an === true };
  z.punkt = 'Z0';
  notiere('Z0 das Original ist gewarpt (warp.an): die Abnahme belegt den Warp-Fall, für ungewarpt gilt P7 und Z3 wäre trivial wahr',
    clip0.warp?.an === true, `warp ${JSON.stringify(clip0.warp ? { an: clip0.warp.an, modus: clip0.warp.modus, marker: clip0.warp.marker?.length } : null)}`);

  // --- Lauf
  z.punkt = 'Lauf';
  const start = z.erwarte200('POST /proj/stems', await z.ruf('POST', '/proj/stems',
    { clip_id: clip0.id, von_beat: A.von_beat, bis_beat: A.bis_beat }, CYPHER)).j;
  const n = start.frames, t0 = Date.now(), verlauf = [];
  laufId = start.auftrag_id;
  info(`Start: auftrag ${start.auftrag_id}, ${n} Frames`);
  let ende = null;
  for (let t = 0; t < FRIST_MS; t += 1000) {
    const st = (await aktuell()).stems;
    if (st?.auftrag_id === start.auftrag_id) {
      const marke = `${st.zustand}/${st.stufe ?? '-'}/${st.prozent ?? '-'}`;
      if (verlauf.at(-1)?.marke !== marke) verlauf.push({ s: Math.round((Date.now() - t0) / 1000), marke });
      if (st.zustand !== 'laeuft') { ende = st; laufBeendet = true; break; }
    }
    await z.warte(1000);
  }
  roh.lauf = { auftrag_id: start.auftrag_id, frames: n, dauer_s: Math.round((Date.now() - t0) / 1000), verlauf, ende };
  if (!ende) await abbrechen('Zeitüberschreitung');
  if (!ende) throw new Fehl(`Lauf nicht beendet nach ${FRIST_MS / 60000} min: ${JSON.stringify(verlauf.at(-1))}`);
  z.punkt = 'Z1';
  if (ende.zustand !== 'fertig') {
    notiere('Z1 Ende fertig', false, `Zustand ${ende.zustand}, Grund ${ende.grund ?? '-'}: ${ende.text ?? ''} ${ende.detail ?? ''}`);
    return;
  }
  await z.geladen();
  const nach = await aktuell();
  const p1 = nach.projekt, stemIds = ende.spuren ?? [];

  // --- Z1: Spuren, Gruppe, Mittelstück, rest_db
  const iq = p1.spuren.findIndex((s) => s.id === quelleSpur.id);
  const direkt = stemIds.length === 4 && stemIds.every((id, i) => p1.spuren[iq + 1 + i]?.id === id);
  const namen = stemIds.map((id) => sp(p1, id)?.name ?? '');
  const reihe = namen.length === 4 && ['Drums', 'Bass', 'Other', 'Vocals'].every((s, i) => namen[i].endsWith(` ${s}`));
  const grp = (p1.gruppen ?? []).find((g) => g.name === `Stems: ${clip0.name}`.slice(0, 80));
  const inGruppe = !!grp && stemIds.every((id) => sp(p1, id)?.ausgang?.art === 'gruppe' && sp(p1, id).ausgang.id === grp.id);
  const mitte = sp(p1, quelleSpur.id).clips.filter((c) => c.stumm === true);
  const mitteOk = mitte.length === 1 && Math.abs(mitte[0].start_beat - A.von_beat) < 1e-6 
    && Math.abs(mitte[0].start_beat + mitte[0].laenge_beats - A.bis_beat) < 1e-6;
  const restOk = typeof ende.rest_db === 'number' && Number.isFinite(ende.rest_db);
  roh.z1 = { stemIds, namen, gruppe: grp ?? null, mitte, rest_db: ende.rest_db, hinweis: ende.hinweis ?? null };
  notiere('Z1 Ende fertig: vier neue Spuren (Drums, Bass, Other, Vocals) direkt unter der Quellspur, Gruppe „Stems: <Name>“ mit allen vieren,'
    + ' Mittelstück stumm, rest_db im Stand',
    p1.spuren.length === vor.projekt.spuren.length + 4 && direkt && reihe && inGruppe && mitteOk && restOk,
    `Spuren ${vor.projekt.spuren.length} → ${p1.spuren.length}, direkt unter der Quelle ${direkt},`
    + ` Namen ${namen.join(' | ')}, Gruppe ${grp?.id ?? 'FEHLT'} (alle vier drin: ${inGruppe}), `
    + `stumm: ${mitte.map((c) => `${c.id} ${c.start_beat}..${c.start_beat + c.laenge_beats}`).join(', ') || 'keiner'},`
    + ` rest_db ${ende.rest_db}${ende.hinweis ? `, Hinweis ${ende.hinweis}` : ''}`);
  if (!restOk || stemIds.length !== 4) return;
  info(`rest_db des Laufs (Auskunft aus der Werkstatt): ${ms(ende.rest_db)} dB`);

  // --- Z2: Frames je Stem-WAV (Kopf 58 Bytes wie Task 6, n Frames à 8 Bytes) und Header-Frames
  z.punkt = 'Z2';
  const stemClips = stemIds.map((id) => sp(p1, id).clips[0]);
  const dateien = stemClips.map((c) => c.quelle.pfad_hinweis);
  const z2 = dateien.map((f, i) => {
    const gr = fs.existsSync(f) ? fs.statSync(f).size : -1;
    let fr = -1;
    try { fr = leseWav(f).frames; } catch { /* fr bleibt -1 */ }
    return { stem: STEMS[i], datei: f, bytes: gr, frames: fr };
  });
  roh.z2 = z2;
  notiere(`Z2 jede der vier Stem-WAVs hat exakt n = ${n} Frames (Dateigröße 58 + n·8, Kopf-Frames = n)`,
    z2.every((e) => e.bytes === 58 + n * 8 && e.frames === n),
    z2.map((e) => `${e.stem} ${e.frames} Frames/${e.bytes} B`).join(', '));

  // --- Z3 und NK3: Lage der Marker gegen die Quelle (Original-Warp aus dem Stand VOR dem Lauf)
  z.punkt = 'Z3';
  const drumsClip = stemClips[0], echtF0 = f0Von(clip0, A.von_beat, A.bpm);
  const r3 = lageMax(clip0, drumsClip, A.von_beat, A.bis_beat, A.bpm);
  const r3b = lageMax(clip0, drumsClip, A.von_beat, A.bis_beat, A.bpm, { f0: echtF0 + 48 });
  const r3n = stemClips.map((c) => lageMax(clip0, c, A.von_beat, A.bis_beat, A.bpm).max);   // alle vier Stems tragen denselben Warp
  roh.z3 = { f0: echtF0, drums: r3, alle_vier_max: r3n, nk3: r3b, gewarpt: clip0.warp?.an === true };
  notiere('Z3 Lage der Marker: |W_stem(b) + F0/48000 − W_orig(b)| ≤ 1 Sample an 129 Beats, alle vier Stems', z3Ok(r3) && r3n.every((m) => m <= 1),
    `F0 ${echtF0}, größte Abweichung Drums ${ms(r3.max)} Samples bei Beat ${r3.stelle}, alle vier ${r3n.map(ms).join('/')},`
    + ` Original ${clip0.warp?.an === true ? 'gewarpt' : 'ungewarpt'}`);
  notiere('NK3 Negativ-Kontrolle: dieselbe Rechnung mit F0 um 48 Frames verschoben liegt ≥ 40 Samples daneben', nk3Ok(r3b),
    `größte Abweichung ${ms(r3b.max)} Samples`);

  // --- M1, Z4a, Z4, Z4b, NK4, Z5, NK5: drei Exporte des Bereichs (C = Stand nach dem Lauf, B = nur Drums, O = nur Original), danach alles per Undo zurück
  z.punkt = 'Z4';
  let schritte = 0;
  const aend = async (label, befehle) => { await aendern(label, befehle, CYPHER); schritte++; };
  const muteSpur = (id, mute) => ({ befehl: 'spur_aendern', spur_id: id, mute });
  const exp = async (name) => { exportNamen.push(`${name}.wav`); return exportiere(A.von_beat, A.bis_beat, name); };
  const C = await exp('z5-stems-summe');                               // Original-Mittelstück stumm, alle vier Stems hörbar
  await aend('W6 nur Drums', [muteSpur(quelleSpur.id, true), ...stemIds.slice(1).map((id) => muteSpur(id, true))]);
  const B = await exp('z4-drums');
  await aend('W6 nur Original', [muteSpur(quelleSpur.id, false), muteSpur(stemIds[0], true), { befehl: 'clip_aendern', clip_id: mitte[0].id, stumm: false }]);
  const O = await exp('z4-original');
  roh.exporte = { summe: C.frames, drums: B.frames, original: O.frames };
  const kanaele = ['l', 'r'];

  // --- M1: wirken Mute und stumm im Export? (sonst wären Drums- und Original-Export gleich und Z4 trivial wahr)
  z.punkt = 'M1';
  const wk = kanaele.map((k) => wirkung(f64(B[k]), f64(C[k]), f64(O[k])));
  roh.m1 = wk;
  notiere('M1 Mute und stumm wirken im Export, je Kanal: rms(Drums−Summe)/rms(Summe)'
    + ' und rms(Drums−Original)/rms(Original) ≥ −30 dB, Pegel Summe gegen Original ≤ 3 dB',
    wk.every(wirkungOk), kanaele.map((k, i) => `${k.toUpperCase()}: Drums/Summe ${ms(wk[i].b_c_db)} dB, Drums/Original ${ms(wk[i].b_o_db)} dB,`
      + ` Pegel Summe/Original ${ms(wk[i].c_o_pegel_db)} dB`).join('; '));

  // --- Z4a, Z4, Z4b, NK4 je Kanal
  const v = kanaele.map((k) => anschlagMessung(f64(B[k]), f64(O[k]), A.bpm, A.von_beat));
  const vn = kanaele.map((k) => anschlagMessung(f64(B[k]), f64(O[k]), A.bpm, A.von_beat, Math.round(0.005 * SR)));
  roh.z4 = { v, nk4: vn };
  z.punkt = 'Z4a';
  notiere('Z4a Vorab: mindestens 16 Drums-Anschläge, davon mindestens 16 und 75 % im Original lokal (±20 ms) wiedergefunden, beide Kanäle', v.every(z4aOk),
    kanaele.map((k, i) => `${k.toUpperCase()}: Drums ${v[i].n_drums}, im Original gefunden ${v[i].n}`).join('; '));
  z.punkt = 'Z4';
  notiere('Z4 AK24 Anschläge: je Drums-Anschlag der Einsatz im Original, p90 |Δ| ≤ 1 ms, beide Kanäle', v.every(z4Ok),
    kanaele.map((k, i) => `${k.toUpperCase()}: n ${v[i].n}, p90 ${ms(v[i].p90_ms)} ms, größter ${ms(v[i].max_ms)} ms,`
      + ` Median Δ ${ms(v[i].median_delta_ms)} ms`).join('; '));
  z.punkt = 'Z4b';
  notiere('Z4b gegen das feste 1/16-Raster des Projekts: Median mit Vorzeichen von Drums und Original unterscheiden sich um ≤ 1 ms, beide Kanäle',
    v.every(z4bOk), kanaele.map((k, i) => `${k.toUpperCase()}: Drums ${ms(v[i].median_drums_ms)} ms,`
      + ` Original ${ms(v[i].median_orig_ms)} ms (+ = nach dem Raster),`
      + ` Unterschied ${ms(v[i].median_diff_ms)} ms`).join('; '));
  notiere('NK4 Negativ-Kontrolle: das Drums-Signal um 5 ms später gerechnet hat bei genug Treffern p90 > 4 ms (das Messgerät sieht es), beide Kanäle',
    vn.every(nk4Ok), kanaele.map((k, i) => `${k.toUpperCase()}: n ${vn[i].n}, p90 ${ms(vn[i].p90_ms)} ms`).join('; '));

  z.punkt = 'Z5';
  const dB = kanaele.map((k) => restDb(f64(C[k]), f64(O[k])));
  const nullDb = kanaele.map((k) => restDb(new Float64Array(Math.min(C.frames, O.frames)), f64(O[k])));
  roh.z5 = { rest_db: dB, nk5_db: nullDb };
  const richt = dB.every((d) => d <= Z5_RICHTWERT_DB);
  info(`Z5 Restsignal (Richtwert ≤ ${Z5_RICHTWERT_DB} dB, kein Tor, Spec AK24):`
    + ` Export der vier Stems gegen Export nur Original = L ${ms(dB[0])} dB, R ${ms(dB[1])} dB`
    + ` ${richt ? '(unter dem Richtwert)' : '(ÜBER dem Richtwert)'}; Werkstatt meldete ${ms(ende.rest_db)} dB`);
  notiere('Z5 Restsignal ist je Kanal eine Zahl (Messung lief, Original nicht stumm)', dB.every(Number.isFinite), `L ${ms(dB[0])} dB, R ${ms(dB[1])} dB`);
  notiere('NK5 Negativ-Kontrolle: das Original gegen Stille gerechnet gibt 0 dB, je Kanal', nullDb.every((d) => Math.abs(d) < 1e-6),
    `L ${ms(nullDb[0])} dB, R ${ms(nullDb[1])} dB`);

  // --- Z6: Undo. Erst die eigenen Mute/stumm-Änderungen zurück (Zahl mitgezählt), dann der Stand nach dem Lauf, dann EIN Undo des Laufs
  z.punkt = 'Z6';
  for (let i = 0; i < schritte; i++) await rueck('undo');
  const nachLauf = standSchluessel((await aktuell()).projekt);
  notiere('Z6a nach den Undo der eigenen Mute- und stumm-Änderungen steht wieder der Stand direkt nach dem Lauf',
    nachLauf === standSchluessel(p1), `${schritte} Undo-Schritte`);
  await rueck('undo');
  const danach = (await aktuell()).projekt;
  roh.z6 = { schritte, vor: standSchluessel(vor.projekt), nach_lauf: nachLauf, nach_undo: standSchluessel(danach) };
  notiere('Z6 ein Undo: Spurenliste, stumm und Gruppen exakt wie vor dem Lauf', standSchluessel(danach) === standSchluessel(vor.projekt),
    `Spuren ${p1.spuren.length} → ${danach.spuren.length} (vor dem Lauf ${vor.projekt.spuren.length}), Gruppen ${(danach.gruppen ?? []).length}`);
  notiere('NK6 Negativ-Kontrolle: der Stand nach dem Lauf war ein anderer als der davor (der Lauf hat etwas verändert)',
    standSchluessel(p1) !== standSchluessel(vor.projekt), 'verschieden');
}

try {
  await lauf();
} catch (e) {
  await abbrechen('Ausnahme');
  if (e instanceof Fehl) notiere(z.punkt, false, e.message); else notiere('ABBRUCH', false, `${z.punkt}: ${e.stack ?? String(e)}`);
}
// Ende wie abnahme_w4.mjs: eigene Projekte räumen, Rohdaten, Bericht, Schlusszeile
const wurzel = path.join('/dev/shm', `cypherdj-${z.instanz}`, 'projekte');
for (const slug of z.eigeneSlugs) {
  const d = path.join(wurzel, slug);
  if (!/^w6-[a-z0-9-]+-\d{8}t\d{6}/i.test(slug)) { z.info(`Slug ${slug} ist nicht von diesem Skript, nicht gelöscht`); continue; }
  try {
    if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); z.info(`Projekt ${d} gelöscht`); } else z.info(`Projekt ${d} nicht gefunden`);
  } catch (e) { z.notiere('Aufräumen', false, e.message); }
}
fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), `${JSON.stringify({ zeit: z.zeit, url: z.URL, instanz: z.instanz,
  aufbau: { sha: A.sha, von_beat: A.von_beat, bis_beat: A.bis_beat, bpm: A.bpm }, roh }, null, 1)}\n`);
if (!z.opt['wav-behalten']) for (const f of exportNamen) fs.rmSync(path.join(z.ORDNER, f), { force: true });   // nur die eigenen Exporte
const schluss = z.fehl === 0 ? 'ALLES OK' : `FEHL ${z.fehl}`;
fs.writeFileSync(path.join(z.ORDNER, 'bericht.md'), `# Abnahme W6 Slice 6 Stems ${z.zeit} (${z.URL}, Instanz ${z.instanz})\n\n`
  + `${z.zeilen.join('\n')}\n\n${schluss}\n`);
process.stdout.write(`\n${schluss}\n`);
process.exit(z.fehl === 0 ? 0 : 1);
