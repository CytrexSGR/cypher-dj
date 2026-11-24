// A new kit from a folder of sound files (browser plan 5, B15), built on the kit writer of the sampler (legeKitAusAudio): kick first, at most 16 pads,
// everything else is listed. Only the folder's own audio files are read (no recursion). The folder must lie inside the roots the page may read.
import fs from 'node:fs';
import path from 'node:path';
import { KIT_NAME } from '../project/model.ts';
import { erlaubteWurzeln, type Wurzel } from '../importe.ts';
import { KitFehler, kitsOrdnerVon, pruefeKitOrdner } from '../project/kit_storage.ts';
import { dekodiereDateiAsync } from './file.ts';
import { SchnittFehler } from './schnitt.ts';
import { KLANG_MAX_FRAMES, baender, bankVorschlag, legeKitAusAudio } from './kit.ts';

export const KIT_PADS_MAX = 16;
export const DEKODIER_VERSUCHE_MAX = 32;
const AUDIO_ENDUNGEN = new Set(['wav', 'aif', 'aiff', 'flac', 'ogg', 'mp3', 'm4a', 'opus']);
const KLASSEN = ['bd', 'sd', 'cp', 'hh', 'perc', null] as const;
type Klasse = typeof KLASSEN[number];

// file-name words (tokens split at anything that is not a letter or digit; a trailing number is allowed: kick01)
const WORTE: Record<'bd' | 'sd' | 'cp' | 'hh' | 'perc', RegExp> = {
  bd: /^(kick|kik|bd|bassdrum)\d*$/,
  sd: /^(snare|snr|sd)\d*$/,
  cp: /^(clap|clp|cp)\d*$/,
  hh: /^(hat|hats|hh|hihat|hihats|ch|oh|openhat|closedhat)\d*$/,
  perc: /^(perc|percussion|tom|toms|rim|rimshot|shaker|conga|bongo|cowbell|clave|tambourine|tamb)\d*$/,
};

/** The class a file name hints at (first word that matches, class order bd, sd, cp, hh, perc), null when it names none. */
export function klasseAusName(datei: string): Klasse {
  const stamm = path.basename(datei, path.extname(datei)).toLowerCase();
  const worte = stamm.split(/[^a-z0-9]+/).filter(Boolean);
  for (const k of ['bd', 'sd', 'cp', 'hh', 'perc'] as const) if (worte.some((w) => WORTE[k].test(w))) return k;
  return null;
}

const drin = (wurzel: string, p: string): boolean => p === wurzel || p.startsWith(wurzel.endsWith(path.sep) ? wurzel : wurzel + path.sep);

export type AusOrdnerOpt = {
  kitsOrdner?: string;
  erlaubt?: () => Wurzel[];                                       // default erlaubteWurzeln()
  dekodiere?: (pfad: string) => Promise<Float32Array>;            // default: ffmpeg through the sampler decoder, at most 10.5 s
};

/** The realpath of `pfad`, inside an allowed root; 403 pfad_verboten otherwise. */
function innerhalb(pfad: unknown, wurzeln: Wurzel[]): string {
  if (typeof pfad !== 'string' || pfad === '' || pfad.includes('\0') || !path.isAbsolute(pfad)) throw new KitFehler(400, 'argument_ungueltig');
  let real: string;
  try { real = fs.realpathSync(path.resolve(pfad)); } catch (e) {
    const c = (e as NodeJS.ErrnoException).code;
    if ((c === 'ENOENT' || c === 'ENOTDIR') && wurzeln.some((w) => drin(w.pfad, path.resolve(pfad)))) throw new KitFehler(404, 'pfad_fehlt');
    throw new KitFehler(403, 'pfad_verboten');
  }
  if (!wurzeln.some((w) => drin(w.pfad, real))) throw new KitFehler(403, 'pfad_verboten');
  return real;
}

type Geladen = { name: string; klasse: Klasse; daten: Float32Array; frames: number };

export async function legeKitAusOrdner(a: { pfad: string; name: string }, o: AusOrdnerOpt = {}): Promise<{ name: string; pads: number; uebrig: string[] }> {
  if (typeof a.name !== 'string' || !KIT_NAME.test(a.name)) throw new KitFehler(400, 'kit_name_ungueltig');
  const wurzeln = (o.erlaubt ?? erlaubteWurzeln)();
  const ordner = innerhalb(a.pfad, wurzeln);
  let st: fs.Stats;
  try { st = fs.statSync(ordner); } catch { throw new KitFehler(403, 'pfad_verboten'); }
  if (!st.isDirectory()) throw new KitFehler(400, 'kein_ordner');
  const kitsWurzel = kitsOrdnerVon(o);
  try { fs.lstatSync(path.join(kitsWurzel, a.name)); throw new KitFehler(409, 'kit_vorhanden'); } catch (e) { if (e instanceof KitFehler) throw e; }

  // candidates: the folder's own audio files, as readable as the roots allow (a link that leaves them is not read)
  const uebrig: string[] = [];
  const kandidaten: { name: string; pfad: string; klasse: Klasse }[] = [];
  let eintraege: string[];
  try { eintraege = fs.readdirSync(ordner); } catch { throw new KitFehler(403, 'pfad_verboten'); }
  for (const n of eintraege.sort()) {
    if (n.startsWith('.')) continue;
    if (!AUDIO_ENDUNGEN.has(path.extname(n).slice(1).toLowerCase())) continue;
    let real: string;
    try { real = fs.realpathSync(path.join(ordner, n)); if (!fs.statSync(real).isFile()) continue; } catch { uebrig.push(n); continue; }
    if (!wurzeln.some((w) => drin(w.pfad, real))) { uebrig.push(n); continue; }
    kandidaten.push({ name: n, pfad: real, klasse: klasseAusName(n) });
  }
  const rang = (k: Klasse): number => KLASSEN.indexOf(k);
  kandidaten.sort((x, y) => rang(x.klasse) - rang(y.klasse) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));

  // decode in that order until there are 16 pads or 32 tries; a failure, a silent or too long file goes to `uebrig`
  const dekodiere = o.dekodiere ?? ((p: string) => dekodiereDateiAsync(p, (KLANG_MAX_FRAMES + 24000) / 48000));
  const geladen: Geladen[] = [];
  let versuche = 0, i = 0;
  for (; i < kandidaten.length && geladen.length < KIT_PADS_MAX && versuche < DEKODIER_VERSUCHE_MAX; i++, versuche++) {
    const k = kandidaten[i];
    try {
      const daten = await dekodiere(k.pfad);
      const frames = daten.length >> 1;
      let spitze = 0;
      for (let j = 0; j < daten.length; j++) { const v = Math.abs(daten[j]); if (v > spitze) spitze = v; }
      if (frames === 0 || frames > KLANG_MAX_FRAMES || spitze === 0 || !Number.isFinite(spitze)) { uebrig.push(k.name); continue; }
      geladen.push({ name: k.name, klasse: k.klasse, daten, frames });
    } catch (e) {
      if (e instanceof SchnittFehler || e instanceof Error) { uebrig.push(k.name); continue; }
      throw e;
    }
  }
  for (; i < kandidaten.length; i++) uebrig.push(kandidaten[i].name);
  if (geladen.length === 0) throw new KitFehler(400, 'ordner_leer');

  // banks: the name's class, else the proposal from the band balance; the first pad is a kick (the deepest file when no name said kick)
  const banken = geladen.map((g) => g.klasse ?? bankVorschlag(baender(g.daten, 0, g.frames)));
  let kick = banken.indexOf('bd');
  if (kick < 0) {
    let tiefste = -1, wert = -1;
    geladen.forEach((g, j) => { const t = baender(g.daten, 0, g.frames).tief; if (t > wert) { wert = t; tiefste = j; } });
    banken[tiefste] = 'bd';
    kick = tiefste;
  }
  const reihe = geladen.map((_, j) => j);
  reihe.splice(reihe.indexOf(kick), 1);
  reihe.unshift(kick);

  const gesamt = reihe.reduce((s, j) => s + geladen[j].frames, 0);
  const daten = new Float32Array(gesamt * 2);
  const scheiben: { von: number; bis: number }[] = [];
  let pos = 0;
  for (const j of reihe) { daten.set(geladen[j].daten, pos * 2); scheiben.push({ von: pos, bis: pos + geladen[j].frames }); pos += geladen[j].frames; }
  let r: ReturnType<typeof legeKitAusAudio>;
  try {
    r = legeKitAusAudio({ name: a.name, kit: a.name, daten, scheiben, quelle: `ordner:${path.basename(ordner)}`, banken: reihe.map((j) => banken[j]) }, { kits: kitsWurzel });
  } catch (e) {
    if (e instanceof SchnittFehler) throw new KitFehler(e.code, e.grund, e.text);
    throw e;
  }
  const p = await pruefeKitOrdner(path.join(kitsWurzel, r.kit));
  if (!p.ok) { fs.rmSync(path.join(kitsWurzel, r.kit), { recursive: true, force: true }); throw new KitFehler(400, p.grund, p.text); }
  return { name: r.kit, pads: p.pads, uebrig };
}
