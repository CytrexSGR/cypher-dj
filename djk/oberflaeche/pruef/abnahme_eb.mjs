// Abnahmemessung AK-b des Pakets 1.18 (E-b): proj_lautheit gegen proj_export. Gegen einen laufenden Seiten-Server auf einer Prüfinstanz (nie g, nie
// der Betrieb) mit gebautem cypherdj-render (djk/kern/build/cypherdj-render des Checkouts, in dem der Server läuft). Zwei Betriebsarten:
//
// 1. ABNAHMETRACK (der echte Lauf, --projekt-aus): AK-b verlangt den Abnahmetrack von D1 (Kick = Audio-Clip, Bass = RB-338, Lead = Surge im Wirt arr1).
//      djk/start/djk-start --instanz a --arr1
//      node pruef/abnahme_eb.mjs --url http://127.0.0.1:48300 --projekt-aus ~/cypherdj-projekte/first-track
//    Das Skript liest NUR project.json aus dem Ordner (kein export/, kein undo.jsonl, nicht die Sperre .lauf), legt unter dem Slug ak-b-first-track in
//    der Projektwurzel der Instanz eine Kopie an (Instanz aus dem Port der URL oder --instanz; Wurzel projektWurzelVorgabe, /dev/shm/cypherdj-<i>/projekte),
//    nimmt der Kopie den Freeze der Surge-Spur (sonst käme der Wirt nie vor: der Freeze steckte schon im Projekt, und die Messung bewiese nichts über den Wirt) und öffnet sie über
//    /proj/oeffnen. Dann: lautheit und export über den Loop-Bereich, Kick-Fader −6 dB, Bass gemutet; jede Änderung kommt per /proj/undo zurück,
//    und am Ende (auch bei Abbruch) steht kein Rest mehr da: die Kopie, ihre Freeze-Dateien im Arbeitsordner und das zuvor offene Projekt (wird
//    wieder geöffnet; war keines offen, bleibt die Kopie im Speicher des Servers offen bis djk-stop, die API kennt kein Schließen).
//    Der Kick-Clip hängt an einer sha256: die Prüfinstanz findet die Datei über den Katalog (/stoebern/detail) oder, wenn der den Eintrag nicht kennt
//    (katalog_fehlt, sha_unbekannt), über den pfad_hinweis im Projekt; trägt keines von beiden, steht FEHL mit dem Grund. Der Wirt arr1 muss laufen
//    (sonst endet 3.1 mit FEHL 409 wirt_fehlt).
//
// 2. ZWEI SPUREN (Trockenlauf, ohne --projekt-aus): zwei interne RB-338-Spuren (laut, leise). Gegen einen Test-Stapel mit dem Render-Doppel (kein Beleg
//    für den echten Render; beweist nicht, dass der Wirt genutzt wird):
//      CYPHERDJ_RENDER=tests/hilfen/render_attrappe.mjs RENDER_ATTRAPPE_MISCHUNG=1 node pruef/abnahme_eb.mjs --stapel a
//    Mit --projekt-aus und --stapel läuft der Abnahmetrack gegen das Doppel; --wirt-attrappe legt dem Stapel dazu einen Stellvertreter für den Wirt
//    arr1 hin (ohne ihn endet der Lauf mit 409 wirt_fehlt, das ist der erwartete Befund).
//
// Punkte (die Nummern folgen dem Plan, Task 18; ein 3.3 gibt es nicht): 3.1 je Spur lufs_i (Abnahmetrack: alle drei Spuren, keine null), 3.2 Summe gegen
// proj_export ≤ 0,1 LU, 3.4 Fader der ersten Spur −6 dB: sie −6 LU (±0,3), die anderen unverändert (±0,1), 3.5 gemutete Spur: stumm, lufs_i null (nicht −70).
// Annahme (ungeprüft bis zum Lauf): der Master des Kerns steht auf den Vorgaben; sonst weicht der Export (Regler des Kerns) von der Summe (Vorgaben) ab.
// Rückgabe: 0 alle Punkte OK, 1 mindestens ein Punkt FEHL, 2 Aufruf. Ergebnis: pruef/ergebnisse/<zeit>-abnahme-eb/bericht.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, stapel: { type: 'string' }, 'projekt-aus': { type: 'string' }, instanz: { type: 'string' },
  'wirt-attrappe': { type: 'boolean' } } });
const aufrufFehler = (t) => { process.stderr.write(`abnahme_eb: ${t}\n`); process.exit(2); };
if ((!opt.url) === (!opt.stapel)) aufrufFehler('Aufruf: --url <http://127.0.0.1:port> | --stapel <a..i>   [--projekt-aus <Projektordner>] [--instanz <a..i>] [--wirt-attrappe]');
if (opt.url && /:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('nie gegen den Betrieb (47300): eine Prüfinstanz wählen');
if (opt['wirt-attrappe'] && !opt.stapel) aufrufFehler('--wirt-attrappe gibt es nur mit --stapel');
if (opt.instanz !== undefined && !/^[a-i]$/.test(opt.instanz)) aufrufFehler(`--instanz ${opt.instanz}: erlaubt sind a bis i`);
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-abnahme-eb`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (k, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };
const aufraeumen = [];
let URL = opt.url;
let stapelErgebnis = null;
if (opt.stapel) {
  process.env.CYPHERDJ_TEST_INSTANZ = opt.stapel;
  const m = await import('../tests/hilfen/mediathek.mjs');
  const t = { after: (f) => aufraeumen.push(f) };
  stapelErgebnis = await m.stapel(t);
  if (opt['wirt-attrappe']) await m.startArr1(stapelErgebnis, t);
  URL = stapelErgebnis.url;
}
const CYPHER = { 'x-djk-quelle': 'cypher' };
const ruf = async (methode, weg, koerper, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};

// Ein Aufruf, der nicht den erwarteten Code hat, ist ein Punkt mit Grund (FEHL <Punkt>: <Weg> → <Code> <Grund>: <Text>), nie ein Folgetext aus falschen Daten.
class Fehl extends Error {}
const grundVon = (r) => `${r.code} ${r.j?.fehler ?? r.j?.grund ?? ''}${r.j?.text ? `: ${r.j.text}` : ''}`.trim() || `${r.code}`;
const WIRT_HINWEIS = ' (der Wirt arr1 läuft nicht: djk-start --instanz <i> --arr1; im Stapel --wirt-attrappe)';
const erwarte200 = (weg, r) => { if (r.code !== 200) throw new Fehl(`${weg} → ${grundVon(r)}${r.j?.detail ? ` (${r.j.detail})` : ''}${r.j?.fehler === 'wirt_fehlt' ? WIRT_HINWEIS : ''}`); return r; };
const holeRev = async () => { const r = erwarte200('/proj/aktuell?nur=rev', await ruf('GET', '/proj/aktuell?nur=rev')); return r.j; };
const aendern = async (label, befehle) => {
  const { rev } = await holeRev();
  return erwarte200(`/proj/aendern (${label})`, await ruf('POST', '/proj/aendern', { rev, label, befehle }, CYPHER)).j;
};
const lautheit = async (von, bis) => erwarte200('/proj/lautheit', await ruf('POST', '/proj/lautheit', { von_beat: von, bis_beat: bis }, CYPHER)).j;
const nr = (r, n) => r.spuren.find((s) => s.nr === n);
const warteAufKern = async () => {
  for (let t = 0; t < 8000 && typeof (await ruf('GET', '/lage')).j?.uhr?.bpm !== 'number'; t += 100) await warte(100);
  const bpm = (await ruf('GET', '/lage')).j?.uhr?.bpm;
  if (typeof bpm !== 'number') throw new Fehl('kein Kern: /lage meldet keine Uhr');
  return bpm;
};
let punkt = 'Aufbau';                                                        // der Punkt, der gerade gemessen wird (für FEHL bei einer Ausnahme)

// --- Betriebsart 2: zwei interne RB-338-Spuren (Trockenlauf, Vorgängerfassung; Rückgabecodes jetzt geprüft) -------------------------------------
const noten = (ton) => Array.from({ length: 8 }, (_, i) => ({ beat: i, laenge: 0.75, ton, vel: 110 }));
async function zweiSpuren() {
  const bpm = await warteAufKern();
  const neu = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `abnahme-eb-${zeit}` }));
  const a = erwarte200('/proj/aendern (Aufbau)', await ruf('POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Aufbau', befehle: [
    { befehl: 'tempo_setzen', bpm },
    { befehl: 'spur_neu', art: 'instrument', name: 'Laut', geraet: { art: 'intern', parameter: { lautstaerke: 1 } } },
    { befehl: 'spur_neu', art: 'instrument', name: 'Leise', geraet: { art: 'intern', parameter: { lautstaerke: 0.3 } } },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(36) },
    { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(43) },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, CYPHER));
  if (!a.j) throw new Fehl('Aufbau ohne Antwort');
  await warte(1500);                                                       // der Kern lädt die Wiedergabe
  punkt = '3.1';
  const l1 = await lautheit(0, 8);
  const ex = await ruf('POST', '/proj/export', { von_beat: 0, bis_beat: 8 }, CYPHER);
  notiere('3.1 beide Spuren gemessen', l1.spuren.length === 2 && l1.spuren.every((s) => typeof s.lufs_i === 'number' && !s.stumm), JSON.stringify(l1.spuren.map((s) => [s.nr, s.lufs_i, s.true_peak_dbtp])));
  punkt = '3.2';
  erwarte200('/proj/export', ex);
  notiere('3.2 Summe gegen proj_export ≤ 0,1 LU', Math.abs(l1.summe.lufs_i - ex.j.lufs_i) <= 0.1,
    `Summe ${l1.summe.lufs_i} LUFS (${l1.summe.regler_quelle}), Export ${ex.j.lufs_i} LUFS (${ex.j.regler_quelle})`);
  punkt = '3.4';
  await aendern('Fader Laut', [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }]);
  const l2 = await lautheit(0, 8);
  const d1 = nr(l2, 1).lufs_i - nr(l1, 1).lufs_i, d2 = nr(l2, 2).lufs_i - nr(l1, 2).lufs_i;
  notiere('3.4 Fader −6 dB: Spur 1 −6 LU (±0,3), Spur 2 unverändert (±0,1)', Math.abs(d1 + 6) <= 0.3 && Math.abs(d2) <= 0.1, `Spur 1 ${d1.toFixed(2)} LU, Spur 2 ${d2.toFixed(2)} LU`);
  punkt = '3.5';
  await aendern('Leise stumm', [{ befehl: 'spur_aendern', spur_id: 's2', mute: true }]);
  const l3 = await lautheit(0, 8);
  notiere('3.5 gemutete Spur: stumm, lufs_i null (nicht −70)', nr(l3, 2).stumm === true && nr(l3, 2).lufs_i === null, JSON.stringify(nr(l3, 2)));
}

// --- Betriebsart 1: der Abnahmetrack von D1 als Kopie ----------------------------------------------------------------------------------------
const SLUG = 'ak-b-first-track';
const FREEZE_NAME = /^freeze-\d+-\d+\.f32$/;
const sicht = (p) => p.spuren.map((s) => ({ id: s.id, fader_db: s.fader_db, pan: s.pan, mute: s.mute, solo: s.solo, freeze: Boolean(s.freeze) }));
const abnahme = { slugOrdner: null, angelegt: false, tiefe: 0, vorher: null, vorOffen: null, arbeit: null, freezeVorher: new Set(), freezeEigene: new Set(), geoeffnet: false };

// Instanz, Projektwurzel und Arbeitsordner des Ziels. Stapel: eigene Ordner des Stapels. URL: die Vorgaben der Instanz (der Port +1000·k sagt den Buchstaben).
async function zielOrdner() {
  if (stapelErgebnis) return { wurzel: stapelErgebnis.optionen.proj.wurzel, arbeit: stapelErgebnis.optionen.proj.arbeitsordner };
  const port = Number(new globalThis.URL(URL).port);
  const k = (port - 47300) / 1000;
  const aus = Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined;
  const instanz = opt.instanz ?? aus;
  if (!instanz) throw new Fehl(`aus dem Port ${port} lässt sich keine Instanz ableiten (--instanz a..i angeben)`);
  if (opt.instanz && aus && opt.instanz !== aus) throw new Fehl(`--instanz ${opt.instanz} passt nicht zum Port ${port} (Instanz ${aus})`);
  const { projektWurzelVorgabe } = await import('../projekt/ablage.ts');
  const { arrOrdner } = await import('../bereiche/proj/konfig.ts');
  return { wurzel: projektWurzelVorgabe(instanz), arbeit: arrOrdner(instanz) };
}

const freezeDateien = (ordner) => { try { return fs.readdirSync(ordner).filter((n) => FREEZE_NAME.test(n)); } catch { return []; } };
const merkeFreezes = (p) => { for (const s of p.spuren) if (s.freeze?.datei && FREEZE_NAME.test(s.freeze.datei) && !abnahme.freezeVorher.has(s.freeze.datei)) abnahme.freezeEigene.add(s.freeze.datei); };
const aktuell = async () => erwarte200('/proj/aktuell', await ruf('GET', '/proj/aktuell')).j;

// Undo-Schritte bis zur Tiefe 0. rev kommt jeweils frisch; ein Fehlschlag ist ein Fehl mit dem Code des Servers.
async function undoBis(ziel) {
  while (abnahme.tiefe > ziel) {
    const { rev } = await holeRev();
    erwarte200('/proj/undo', await ruf('POST', '/proj/undo', { rev }, CYPHER));
    abnahme.tiefe -= 1;
  }
}
// Zählt Änderungen, die ein Aufruf am Projekt gemacht hat (rev-Sprung), damit jede wieder zurückgenommen werden kann; auch der Freeze der Surge-Spur
// im Lautheitsweg ist eine solche Änderung (Spec 3.3).
async function zaehlend(f) {
  const vor = (await holeRev()).rev;
  try { return await f(); } finally { const nach = (await holeRev()).rev; if (nach > vor) abnahme.tiefe += nach - vor; }
}

async function abnahmeTrack() {
  const quelle = path.resolve(opt['projekt-aus'].replace(/^~(?=\/|$)/, os.homedir()));
  punkt = 'Aufbau';
  let roh;
  try { roh = fs.readFileSync(path.join(quelle, 'project.json'), 'utf8'); } catch (e) { throw new Fehl(`${quelle}/project.json nicht lesbar (${e.code ?? e.message})`); }
  const p0 = JSON.parse(roh);
  const kick = p0.spuren?.find((s) => s.art === 'audio'), bass = p0.spuren?.find((s) => s.art === 'instrument' && s.geraet?.art === 'intern'),
    lead = p0.spuren?.find((s) => s.art === 'instrument' && s.geraet?.art === 'wirt');
  const clip = kick?.clips?.find((c) => c.art === 'audio');
  if (p0.spuren?.length !== 3 || !kick || !bass || !lead || !clip) {
    throw new Fehl(`${quelle} ist nicht der Abnahmetrack (erwartet: eine Audio-Spur mit Clip, eine interne und eine Wirt-Spur; gefunden ${JSON.stringify(p0.spuren?.map((s) => [s.name, s.art, s.geraet?.art]))})`);
  }
  info(`Abnahmetrack ${quelle}: ${kick.name} (Audio, ${kick.clips.length} Clip, ${kick.fader_db} dB), ${bass.name} (${bass.geraet.name}, ${bass.fader_db} dB), ${lead.name} (${lead.geraet.name} im Wirt, ${lead.fader_db} dB, Freeze ${lead.freeze ? 'im Original' : 'nein'}), ${p0.tempo_bpm} BPM, Loop ${p0.loop.von_beat} bis ${p0.loop.bis_beat}`);
  const bpm = await warteAufKern();

  // Das Sample des Kick-Clips: Katalog (sha256) oder pfad_hinweis; keines von beiden ist FEHL mit Grund
  const sha = clip.quelle.sha256, hinweis = clip.quelle.pfad_hinweis;
  const det = await ruf('GET', `/stoebern/detail?sha=${sha}`);
  const imKatalog = det.code === 200 && typeof det.j?.pfad === 'string' && fs.existsSync(det.j.pfad);
  const hinweisDa = typeof hinweis === 'string' && hinweis !== '' && fs.existsSync(hinweis);
  info(`Kick-Sample ${sha.slice(0, 12)}…: Katalog ${det.code === 200 ? (imKatalog ? 'kennt es, Datei da' : `kennt es, Datei fehlt (${det.j?.pfad})`) : `→ ${grundVon(det)}`}; Hinweis-Pfad ${hinweisDa ? 'da' : `fehlt (${hinweis})`}`);
  if (!imKatalog && !hinweisDa) {
    throw new Fehl(`das Sample des Kick-Clips ist auf dieser Instanz nicht zu finden: Katalog ${det.code === 200 ? 'Datei fehlt' : grundVon(det)}, pfad_hinweis ${hinweis} fehlt (quelle_fehlt). `
      + 'Für den echten Lauf: die Prüfinstanz mit CYPHERDJ_MEDIATHEK=<Pfad der mediathek.sqlite des Betriebs> starten (der Katalog liegt daneben) oder das Sample an den Hinweis-Pfad legen.');
  }

  // Ziel und Kopie. Die Kopie ist project.json allein (kein export/, kein undo.jsonl, keine Sperre .lauf des Betriebs): ein fehlendes undo.jsonl ist ein
  // leerer Verlauf (verlauf.ts). Der Freeze der Surge-Spur fällt weg, wiedergabe_rev geht auf 0 (kein Wiederanlauf-Vergleich mit dem Kern der Instanz).
  const ziel = await zielOrdner();
  if (path.resolve(ziel.wurzel) === path.dirname(quelle)) throw new Fehl(`die Projektwurzel des Ziels ${ziel.wurzel} ist der Ordner der Quelle; abgebrochen`);
  abnahme.arbeit = ziel.arbeit;
  abnahme.freezeVorher = new Set(freezeDateien(ziel.arbeit));
  fs.mkdirSync(ziel.wurzel, { recursive: true });
  abnahme.slugOrdner = path.join(ziel.wurzel, SLUG);
  try { fs.mkdirSync(abnahme.slugOrdner); } catch (e) {
    throw new Fehl(`${abnahme.slugOrdner} anlegen: ${e.code === 'EEXIST' ? 'besteht schon (ein Rest eines früheren Laufs? von Hand prüfen und entfernen, das Skript überschreibt nichts)' : e.message}`);
  }
  abnahme.angelegt = true;
  const kopie = structuredClone(p0);
  kopie.name = 'AK-b First Track (Kopie)';
  kopie.wiedergabe_rev = 0;
  for (const s of kopie.spuren) if (s.geraet?.art === 'wirt') s.freeze = null;                  // das Modell verlangt null, nicht ein fehlendes Feld
  fs.writeFileSync(path.join(abnahme.slugOrdner, 'project.json'), JSON.stringify(kopie, null, 1) + '\n');
  info(`Kopie ${abnahme.slugOrdner}/project.json (Freeze der Wirt-Spur entfernt, wiedergabe_rev 0)`);

  const vor = await aktuell();
  abnahme.vorOffen = vor.slug;
  const liste = erwarte200('/proj/liste', await ruf('GET', '/proj/liste')).j;
  if (!(Array.isArray(liste) ? liste : liste.projekte ?? []).some((x) => x.slug === SLUG)) {
    throw new Fehl(`/proj/liste kennt ${SLUG} nicht (Projektwurzel des Servers ist nicht ${ziel.wurzel}?)`);
  }
  const op = erwarte200('/proj/oeffnen', await ruf('POST', '/proj/oeffnen', { slug: SLUG }, CYPHER));
  abnahme.geoeffnet = true;
  // die Kick-Quelle wird dekodiert, bevor etwas gemessen wird (sonst 409 audio_fehlt, "still being prepared")
  let p = op.j.projekt;
  for (let t = 0; t < 60_000; t += 250) {
    p = (await aktuell()).projekt;
    const z = p.spuren.flatMap((s) => s.clips).find((c) => c.art === 'audio')?.dekodiert;
    if (z === 'fertig' || z === 'fehler') break;
    await warte(250);
  }
  const zDek = p.spuren.flatMap((s) => s.clips).find((c) => c.art === 'audio')?.dekodiert;
  if (zDek !== 'fertig') throw new Fehl(`der Kick-Clip ist nicht dekodiert (dekodiert: ${zDek}; Datei ${imKatalog ? det.j.pfad : hinweis})`);
  abnahme.vorher = sicht(p);
  const von = p.loop.von_beat, bis = p.loop.bis_beat;
  const idKick = kick.id, idBass = bass.id, nrKick = kick.nr, nrBass = bass.nr, nrLead = lead.nr;
  const vorherKick = p.spuren.find((s) => s.id === idKick).fader_db;
  info(`geöffnet: ${SLUG} rev ${p.rev}, Bereich ${von} bis ${bis} Beat (${((bis - von) * 60 / p.tempo_bpm).toFixed(1)} s bei ${p.tempo_bpm} BPM, Kern ${bpm} BPM)`);

  // 3.1: je Spur lufs_i. Die erste Messung friert die Surge-Spur im Wirt ein (kein Freeze im Projekt); ohne laufenden Wirt endet sie mit 409 wirt_fehlt.
  punkt = '3.1';
  const l1 = await zaehlend(() => lautheit(von, bis));
  merkeFreezes((await aktuell()).projekt);
  const eingefroren = (await aktuell()).projekt.spuren.find((s) => s.id === lead.id)?.freeze;
  notiere('3.1 alle drei Spuren gemessen (lufs_i nicht null)', l1.spuren.length === 3 && l1.spuren.every((s) => typeof s.lufs_i === 'number' && !s.stumm) && Boolean(eingefroren),
    `${JSON.stringify(l1.spuren.map((s) => [s.nr, s.name, s.lufs_i, s.true_peak_dbtp]))}; Freeze der Wirt-Spur ${eingefroren ? `${eingefroren.datei} (${eingefroren.frames} Frames)` : 'FEHLT'}`);
  punkt = '3.2';
  const ex = erwarte200('/proj/export', await zaehlend(() => ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis }, CYPHER)));
  notiere('3.2 Summe gegen proj_export ≤ 0,1 LU', Math.abs(l1.summe.lufs_i - ex.j.lufs_i) <= 0.1,
    `Summe ${l1.summe.lufs_i} LUFS (${l1.summe.regler_quelle}), Export ${ex.j.lufs_i} LUFS (${ex.j.regler_quelle}), Abstand ${Math.abs(l1.summe.lufs_i - ex.j.lufs_i).toFixed(3)} LU`);

  // 3.4: Kick-Fader −6 dB relativ
  punkt = '3.4';
  await zaehlend(() => aendern('AK-b Fader Kick', [{ befehl: 'spur_aendern', spur_id: idKick, fader_db: vorherKick - 6 }]));
  const l2 = await lautheit(von, bis);
  const dK = nr(l2, nrKick).lufs_i - nr(l1, nrKick).lufs_i, dB = nr(l2, nrBass).lufs_i - nr(l1, nrBass).lufs_i, dL = nr(l2, nrLead).lufs_i - nr(l1, nrLead).lufs_i;
  notiere('3.4 Kick-Fader −6 dB: Kick −6 LU (±0,3), Bass und Lead unverändert (±0,1)', Math.abs(dK + 6) <= 0.3 && Math.abs(dB) <= 0.1 && Math.abs(dL) <= 0.1,
    `Kick ${dK.toFixed(2)} LU, Bass ${dB.toFixed(2)} LU, Lead ${dL.toFixed(2)} LU`);
  await undoBis(abnahme.tiefe - 1);
  const nachFader = (await aktuell()).projekt.spuren.find((s) => s.id === idKick).fader_db;
  notiere('3.4 Undo stellt den Kick-Fader wieder her', nachFader === vorherKick, `Fader ${nachFader} dB (vorher ${vorherKick} dB)`);

  // 3.5: gemutete Spur
  punkt = '3.5';
  await zaehlend(() => aendern('AK-b Bass stumm', [{ befehl: 'spur_aendern', spur_id: idBass, mute: true }]));
  const l3 = await lautheit(von, bis);
  const mb = nr(l3, nrBass);
  notiere('3.5 gemutete Spur (Bass): stumm, lufs_i null (nicht −70)', mb.stumm === true && mb.lufs_i === null, JSON.stringify(mb));
  await undoBis(abnahme.tiefe - 1);

  // alles zurück, auch der Freeze der Wirt-Spur; der Mixer-Stand muss dem nach dem Öffnen gleichen
  punkt = 'Undo';
  await undoBis(0);
  const jetzt = sicht((await aktuell()).projekt);
  const ohneFreeze = (x) => JSON.stringify(x.map(({ freeze, ...r }) => r));
  notiere('Undo: Mixer-Stand wie nach dem Öffnen', ohneFreeze(jetzt) === ohneFreeze(abnahme.vorher) && jetzt.every((s) => !s.freeze), JSON.stringify(jetzt));
}

try {
  if (opt['projekt-aus']) await abnahmeTrack(); else await zweiSpuren();
} catch (e) {
  if (e instanceof Fehl) notiere(punkt, false, e.message); else notiere('ABBRUCH', false, `${punkt}: ${e.stack ?? String(e)}`);
} finally {
  // Aufräumen in dieser Reihenfolge: offene Änderungen zurück, das zuvor offene Projekt wieder öffnen (gibt die Sperre der Kopie frei), dann nur den eigenen
  // Slug-Ordner und die eigenen Freeze-Dateien löschen. Jeder Schritt für sich, damit ein Fehler die übrigen nicht verhindert.
  if (abnahme.geoeffnet) {
    try { await undoBis(0); } catch (e) { notiere('Aufräumen: Undo', false, e.message); }
    if (abnahme.vorOffen && abnahme.vorOffen !== SLUG) {
      try { erwarte200('/proj/oeffnen', await ruf('POST', '/proj/oeffnen', { slug: abnahme.vorOffen }, CYPHER)); info(`zuvor offenes Projekt ${abnahme.vorOffen} wieder geöffnet`); }
      catch (e) { notiere('Aufräumen: altes Projekt öffnen', false, e.message); }
    } else info('kein Projekt war zuvor offen: die Kopie bleibt im Speicher des Servers offen bis djk-stop (die API kennt kein Schließen)');
    try { const a = await aktuell(); merkeFreezes(a.projekt ?? { spuren: [] }); } catch { /* der Server ist vielleicht weg */ }
  }
  if (abnahme.angelegt && abnahme.slugOrdner && path.basename(abnahme.slugOrdner) === SLUG) {
    try { fs.rmSync(abnahme.slugOrdner, { recursive: true, force: true }); info(`Kopie ${abnahme.slugOrdner} gelöscht: ${fs.existsSync(abnahme.slugOrdner) ? 'NEIN, sie besteht noch' : 'ja'}`); }
    catch (e) { notiere('Aufräumen: Kopie löschen', false, e.message); }
  }
  for (const n of abnahme.freezeEigene) {
    const d = path.join(abnahme.arbeit, n);
    try { fs.rmSync(d, { force: true }); info(`Freeze-Datei ${n} gelöscht: ${fs.existsSync(d) ? 'NEIN' : 'ja'}`); } catch (e) { notiere('Aufräumen: Freeze-Datei', false, e.message); }
  }
  for (const f of aufraeumen.reverse()) await f();
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Abnahme AK-b ${zeit} (${opt.url ?? `Stapel ${opt.stapel}`}${opt['projekt-aus'] ? `, Abnahmetrack aus ${opt['projekt-aus']}` : ', zwei interne Spuren'})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
