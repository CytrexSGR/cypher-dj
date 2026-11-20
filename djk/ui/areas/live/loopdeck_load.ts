// Loop deck sources (loop deck plan M5): where the audio of a cell comes from. Each source ends as a WAV inside the live project
// (`<project folder>/loops/<n>-L<deck>-<name>.wav`), so the cell's `pfad_hinweis` is project-relative and a project backup holds everything.
//   { loop: name }           the loop library (the way POST /modul/loop writes its WAV), 128 bpm
//   { sha }                  a catalogue loop: the library import behind POST /loops/aus-katalog (128 bpm), then as { loop }; a catalogue one-shot:
//                            its file is copied into the project as it is (art 'einmal', no beats, no bpm)
//   { modul: id, stem? }     the module library: the main loop of the module, or the original of the named stem
//   { von_deck: 1..4 }       the active loop of a DJ deck (the audio part of POST /modul/export)
// A refusal is a LadenFehler; what was written before it is removed by the helper, what the helper returns belongs to the caller.
import fs from 'node:fs';
import path from 'node:path';
import { leseLoopQuelle } from '../../loops.ts';
import { schreibeWavAusF32Stueckweise } from '../../project/recording.ts';
import { liesModul, modulBasis, modulOrdner } from '../../project/module_storage.ts';
import { LOOP_SPUR } from '../../project/live.ts';
import { TEMPO_MAX, TEMPO_MIN, type AudioClip } from '../../project/model.ts';
import { leseWavF32Bloecke } from '../../sampler/wav.ts';
import type { ProjZugang } from '../proj/area.ts';
import { exportiereDeckLoop, type ExportOptionen } from './export.ts';

export class LadenFehler extends Error {
  readonly code: number;
  readonly grund: string;
  readonly text: string;
  constructor(code: number, grund: string, text: string) { super(grund); this.code = code; this.grund = grund; this.text = text; }
}
const unbekannt = (text: string): LadenFehler => new LadenFehler(409, 'quelle_unbekannt', text);
const ungueltig = (text: string): LadenFehler => new LadenFehler(400, 'argument_ungueltig', text);

export interface LadeAbhaengig {
  loopOrdner?(): string;                                          // the loop library
  modulBasis?(): string;                                          // the module library (default: modulBasis())
  katalogLoop?(sha: string): Promise<{ name: string; einmal?: Einmal }>;   // the catalogue import (server.ts); a refusal is thrown; `einmal` = a one-shot
  deckLoop?: ExportOptionen['deckLoop'];                          // the active loop of a DJ deck (server.ts deckLoopAusschnitt)
  zugang: ProjZugang;
}
// a catalogue one-shot: the file to copy, its identity and the length the catalogue knows (frames at 48 kHz, 0 = unknown)
export interface Einmal { datei: string; sha: string; frames: number }
export type Quelle = { loop: string } | { sha: string } | { modul: string; stem?: string } | { von_deck: number };
export interface Geladen { name: string; sha256: string; pfad: string; abs: string; frames: number; art: 'loop' | 'einmal'; beats?: number; bpm?: number }

const dateiTeil = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cell';
const klemmeBpm = (b: number): number => Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, b));
const viertel = (b: number): boolean => Number.isFinite(b) && b >= 0.25 && b <= 64 && Number.isInteger(b * 4);

export function pruefeQuelle(q: unknown): Quelle {
  if (q === null || typeof q !== 'object' || Array.isArray(q)) throw ungueltig('quelle: {loop}, {sha}, {modul, stem?} or {von_deck} expected');
  const o = q as Record<string, unknown>, k = Object.keys(o);
  const nur = (...erlaubt: string[]): void => { for (const x of k) if (!erlaubt.includes(x)) throw new LadenFehler(400, 'argument_unbekannt', `Unknown argument: quelle.${x}`); };
  if ('loop' in o) { nur('loop'); if (typeof o.loop !== 'string') throw ungueltig('quelle.loop: loop name expected'); return { loop: o.loop }; }
  if ('sha' in o) { nur('sha'); if (typeof o.sha !== 'string') throw ungueltig('quelle.sha: string expected'); return { sha: o.sha }; }
  if ('modul' in o) {
    nur('modul', 'stem');
    if (typeof o.modul !== 'string') throw ungueltig('quelle.modul: module id expected');
    if (o.stem !== undefined && typeof o.stem !== 'string') throw ungueltig('quelle.stem: stem name expected');
    return { modul: o.modul, ...(o.stem !== undefined ? { stem: o.stem as string } : {}) };
  }
  if ('von_deck' in o) {
    nur('von_deck');
    if (typeof o.von_deck !== 'number' || !Number.isInteger(o.von_deck) || o.von_deck < 1 || o.von_deck > 4) throw ungueltig('quelle.von_deck: integer 1..4 expected');
    return { von_deck: o.von_deck };
  }
  throw ungueltig('quelle: {loop}, {sha}, {modul, stem?} or {von_deck} expected');
}

// `laenge(frames)` runs before any audio is written whenever the length is known up front (it throws zu_lang); the caller checks again on the result.
export async function ladeQuelle(dep: LadeAbhaengig, ordner: string, deck: number, q: Quelle, laenge: (frames: number) => void): Promise<Geladen> {
  const ziel = (name: string, ext = '.wav'): { abs: string; rel: string } => {
    const datei = `${dep.zugang.naechsteNummer()}-L${deck}-${dateiTeil(name)}${ext}`;
    return { abs: path.join(ordner, 'loops', datei), rel: `loops/${datei}` };
  };
  const ausLoop = async (loopName: string): Promise<Geladen> => {
    const dir = dep.loopOrdner?.();
    const l = dir === undefined ? null : leseLoopQuelle(dir, loopName);
    if (!l) throw unbekannt(`No loadable loop named '${loopName}' in the loop library.`);
    laenge(l.frames);
    const z = ziel(l.name);
    fs.mkdirSync(path.dirname(z.abs), { recursive: true });
    try {
      const w = await schreibeWavAusF32Stueckweise(l.datei, z.abs);
      if (w.frames !== l.frames) throw new Error(`${w.frames} frames written, ${l.frames} expected`);
      return { name: l.name.slice(0, 64), sha256: w.sha256, pfad: z.rel, abs: z.abs, frames: l.frames, art: 'loop', beats: l.beats, bpm: 128 };
    } catch (e) { fs.rmSync(z.abs, { force: true }); throw e; }
  };
  if ('loop' in q) return ausLoop(q.loop);
  if ('sha' in q) {
    if (!/^[0-9a-f]{64}$/.test(q.sha) || !dep.katalogLoop) throw unbekannt('No catalogue sound with that sha.');
    let r: Awaited<ReturnType<NonNullable<LadeAbhaengig['katalogLoop']>>>;
    try { r = await dep.katalogLoop(q.sha); } catch (e) {
      throw unbekannt(`The catalogue sound cannot be loaded: ${(e as { fehler?: string }).fehler ?? (e as Error).message}`);
    }
    if (!r.einmal) return ausLoop(r.name);
    laenge(r.einmal.frames);
    const ext = /^\.[A-Za-z0-9]{1,5}$/.test(path.extname(r.einmal.datei)) ? path.extname(r.einmal.datei).toLowerCase() : '.wav';
    const z = ziel(r.name, ext);
    fs.mkdirSync(path.dirname(z.abs), { recursive: true });
    try { fs.copyFileSync(r.einmal.datei, z.abs); } catch (e) { fs.rmSync(z.abs, { force: true }); throw e; }
    return { name: r.name.slice(0, 64), sha256: r.einmal.sha, pfad: z.rel, abs: z.abs, frames: r.einmal.frames, art: 'einmal' };
  }
  if ('von_deck' in q) {
    if (!dep.deckLoop) throw unbekannt('No deck loop available.');
    const a = dep.deckLoop(q.von_deck);
    if ('fehler' in a) throw unbekannt(`Deck ${q.von_deck} has no active loop (${a.fehler}).`);
    laenge(a.frames);
    const x = await exportiereDeckLoop({ deckLoop: dep.deckLoop, zugang: dep.zugang, ordner }, q.von_deck,
      { ausschnitt: a, wavName: `L${deck}-deck${q.von_deck}.wav` });
    return { name: `Deck ${q.von_deck} loop`, sha256: x.sha256, pfad: path.relative(ordner, x.pfad), abs: x.pfad, frames: x.frames,
      art: 'loop', beats: x.beats, bpm: klemmeBpm(x.bpm) };
  }
  // module: the Loop track's loop clip, or the original track of the named stem group
  const j = liesModul(q.modul, dep.modulBasis?.() ?? modulBasis());
  const mo = j ? modulOrdner(q.modul, dep.modulBasis?.() ?? modulBasis()) : null;
  if (!j || mo === null) throw unbekannt(`No module '${q.modul}' in the module library.`);
  const top = j.gruppen[0];
  let spurId: string | undefined;
  if (q.stem === undefined) spurId = j.spuren.find((s) => s.ausgang?.id === top.id && s.name === LOOP_SPUR)?.id;
  else {
    const g = j.gruppen.find((x) => x.ausgang?.id === top.id && x.name.toLowerCase() === q.stem!.toLowerCase());
    spurId = g ? j.spuren.find((s) => s.ausgang?.id === g.id)?.id : undefined;
  }
  const spur = j.spuren.find((s) => s.id === spurId);
  const clips = (spur?.clips ?? []).filter((c): c is AudioClip => c.art === 'audio');
  const clip = clips.find((c) => !c.warp?.versatz_beats) ?? clips[0];
  if (!clip) throw unbekannt(q.stem === undefined ? `Module '${q.modul}' has no main loop.` : `Module '${q.modul}' has no stem '${q.stem}'.`);
  const hinweis = clip.quelle.pfad_hinweis;
  if (hinweis === '' || path.isAbsolute(hinweis) || hinweis.split(/[\\/]/).includes('..')) throw unbekannt('The module audio is not stored in the module folder.');
  const quellDatei = path.join(mo, hinweis);
  let frames: number;
  try { frames = leseWavF32Bloecke(quellDatei, 48000, () => {}); } catch { throw unbekannt('The module audio is missing or unreadable.'); }
  laenge(frames);
  const ende = clip.warp?.marker?.at(-1);
  const m = j.herkunft ?? {};
  const beats = ende && viertel(ende[1]) ? ende[1] : viertel(Number(m.laenge_beats)) ? Number(m.laenge_beats) : 4;
  const roh = ende && ende[0] > 0 ? (ende[1] * 60) / ende[0] : Number(m.basis_bpm);
  const titel = (m.titel ?? top.name ?? 'module').toString().trim();
  const name = (q.stem === undefined ? titel : (j.gruppen.find((x) => x.name.toLowerCase() === q.stem!.toLowerCase())?.name ?? q.stem)).slice(0, 64) || 'module';
  const z = ziel(name);
  fs.mkdirSync(path.dirname(z.abs), { recursive: true });
  try { fs.copyFileSync(quellDatei, z.abs); } catch (e) { fs.rmSync(z.abs, { force: true }); throw e; }
  return { name, sha256: clip.quelle.sha256, pfad: z.rel, abs: z.abs, frames, art: 'loop', beats, bpm: klemmeBpm(Number.isFinite(roh) ? roh : 128) };
}
