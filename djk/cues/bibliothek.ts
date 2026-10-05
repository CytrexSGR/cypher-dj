// Trackliste: rekursiver Scan des Ordners, Tags je MP3 (id3.ts), Index-Cache nach (Pfad, Größe, mtime),
// M3U-Listen (Windows-Pfade, Abgleich über den Dateinamen) und alte Traktor-Cues aus collection.nml (nur lesen).
import fs from 'node:fs';
import path from 'node:path';
import { leseTags, type Tags } from './id3.ts';
import { schreibeAtomar } from './welle.ts';

export interface Track extends Tags { rel: string; groesse: number; mtime: number; }

async function sammle(wurzel: string): Promise<string[]> {
  const aus: string[] = [];
  const geh = async (dir: string): Promise<void> => {
    let eintraege: fs.Dirent[];
    try { eintraege = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await geh(p);
      else if (e.isFile() && /\.mp3$/i.test(e.name)) aus.push(p);
    }
  };
  await geh(wurzel);
  return aus.sort((a, b) => a.localeCompare(b));
}

// Liest alle Tags; Unverändertes kommt aus dem Index-Cache. Liefert auch, wie viele frisch gelesen wurden.
export async function ladeBibliothek(wurzel: string, indexDatei: string | null): Promise<{ tracks: Track[]; frisch: number; ms: number }> {
  const t0 = performance.now();
  let alt: Record<string, Track> = {};
  if (indexDatei) { try { alt = Object.fromEntries((JSON.parse(fs.readFileSync(indexDatei, 'utf8')).tracks as Track[]).map((t) => [t.rel, t])); } catch { /* erster Lauf */ } }
  const dateien = await sammle(wurzel);
  const tracks: Track[] = [];
  let frisch = 0;
  for (const p of dateien) {
    const rel = path.relative(wurzel, p);
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { continue; }
    const a = alt[rel];
    if (a && a.groesse === st.size && a.mtime === st.mtimeMs) { tracks.push(a); continue; }
    let tags: Tags;
    try { tags = leseTags(p); } catch { tags = { titel: null, artist: null, bpm: null, tonart: null, energie: null, id3: null }; }
    frisch++;
    tracks.push({ rel, groesse: st.size, mtime: st.mtimeMs, ...tags, titel: tags.titel ?? titelAusName(path.basename(p)) });
  }
  if (indexDatei && frisch > 0) schreibeAtomar(indexDatei, JSON.stringify({ wurzel, erzeugt: new Date().toISOString(), tracks }));
  return { tracks, frisch, ms: performance.now() - t0 };
}

// "1002565_Freak_Original Mix.mp3" -> "Freak - Original Mix"
export function titelAusName(name: string): string {
  const b = name.replace(/\.mp3$/i, '');
  const m = /^\d+_(.+?)_(.+)$/.exec(b);
  return m ? `${m[1]} - ${m[2]}` : b;
}

export interface Liste { name: string; rels: string[]; fehlend: number; }

export function ladeListen(wurzel: string, tracks: Track[]): Liste[] {
  const nachName = new Map<string, string>();
  for (const t of tracks) nachName.set(path.basename(t.rel).toLowerCase(), t.rel);
  let dateien: string[] = [];
  try { dateien = fs.readdirSync(wurzel).filter((f) => /\.m3u8?$/i.test(f)).sort(); } catch { /* leer */ }
  return dateien.map((f) => {
    const zeilen = fs.readFileSync(path.join(wurzel, f), 'utf8').split(/\r?\n/).map((z) => z.trim()).filter((z) => z && !z.startsWith('#'));
    const rels: string[] = [];
    let fehlend = 0;
    for (const z of zeilen) {
      const name = z.split(/[\\/]/).pop()!.toLowerCase();
      const rel = nachName.get(name);
      if (rel) rels.push(rel); else fehlend++;
    }
    return { name: f.replace(/\.m3u8?$/i, ''), rels, fehlend };
  });
}

// ---- Traktor collection.nml ----
export interface TraktorCue { name: string; typ: number; typ_name: string; s: number; laenge_s: number; hotcue: number; }
export interface TraktorEintrag { cues: TraktorCue[]; raster_s: number | null; bpm: number | null; }

const TYP = ['cue', 'fade-in', 'fade-out', 'load', 'grid', 'loop'];

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
}

// Schlüssel: Dateiname klein; bei Doppelten gewinnt der Eintrag, dessen DIR den Ordnernamen enthält
export function ladeTraktor(nml: string, ordnerName: string): Map<string, TraktorEintrag> {
  const aus = new Map<string, TraktorEintrag & { imOrdner: boolean }>();
  let text: string;
  try { text = fs.readFileSync(nml, 'utf8'); } catch { return new Map(); }
  const re = /<ENTRY\b[\s\S]*?<\/ENTRY>/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const e = m[0];
    const loc = /<LOCATION\b[^>]*>/.exec(e)?.[0];
    if (!loc) continue;
    const datei = attr(loc, 'FILE');
    if (!datei) continue;
    const imOrdner = (attr(loc, 'DIR') ?? '').includes(ordnerName);
    const cues: TraktorCue[] = [];
    let raster: number | null = null;
    for (const c of e.match(/<CUE_V2\b[^>]*>/g) ?? []) {
      const typ = Number(attr(c, 'TYPE'));
      const s = Number(attr(c, 'START')) / 1000;
      if (!Number.isFinite(s)) continue;
      if (typ === 4) { if (raster === null) raster = s; continue; }
      cues.push({ name: attr(c, 'NAME') ?? '', typ, typ_name: TYP[typ] ?? String(typ), s, laenge_s: Number(attr(c, 'LEN') ?? 0) / 1000, hotcue: Number(attr(c, 'HOTCUE') ?? -1) });
    }
    const bpm = Number(/<TEMPO\b[^>]*BPM="([\d.]+)"/.exec(e)?.[1]);
    const k = datei.toLowerCase();
    const alt = aus.get(k);
    if (alt && alt.imOrdner && !imOrdner) continue;
    aus.set(k, { cues: cues.sort((a, b) => a.s - b.s), raster_s: raster, bpm: Number.isFinite(bpm) ? bpm : null, imOrdner });
  }
  return new Map([...aus].map(([k, v]) => [k, { cues: v.cues, raster_s: v.raster_s, bpm: v.bpm }]));
}

// Traktor zählt den Encoder-Vorlauf der MP3 mit, ffmpeg und der Browser schneiden ihn ab (stream start_time). Darum
// liegen Traktors Grid und Cues auf unserer Zeitachse um den Vorlauf früher (Messung 2026-09-26, tests/vorlauf.test.mjs).
export function verschiebeTraktor<T extends { raster_s: number | null; cues: { s: number }[] }>(tr: T | null, vorlauf_s: number): (T & { vorlauf_s: number }) | null {
  if (!tr) return null;
  const v = (s: number) => Math.max(0, s - vorlauf_s);
  return { ...tr, raster_s: tr.raster_s == null ? null : v(tr.raster_s), cues: tr.cues.map((c) => ({ ...c, s: v(c.s) })), vorlauf_s };
}
