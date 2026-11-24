// Offline render of a project object to a WAV file through the export path (uebersetze -> schreibeWiedergabe -> cypherdj-render).
// Extracted from the starter CLI (djk/starter/render_project.ts) so the preview service can call it as a library: every failure is thrown
// as RenderDateiFehler, nothing here exits the process. Paths for one render travel in `env`, process.env is never written.
import fs from 'node:fs';
import path from 'node:path';
import { exportSicht, ohneFremdeLanen, reglerEinzeln } from '../areas/proj/output.ts';
import { geraetFx } from '../devices_parameter.ts';
import { renderProgramm } from '../paths.ts';
import { pruefeProjekt, sucheSpur, type Projekt } from './model.ts';
import { reglerAusProjekt, rendere, RenderFehler, schluesselPlan } from './render.ts';
import { schreibeWiedergabe, uebersetze, WiedergabeFehler } from './playback.ts';

export class RenderDateiFehler extends Error {
  readonly grund: 'render_fehlt' | 'render_fehlgeschlagen' | 'projekt_ungueltig';
  constructor(grund: RenderDateiFehler['grund'], meldung: string) { super(meldung); this.grund = grund; }
}

export interface RenderDateiAuftrag {
  projekt: Projekt; ziel: string; vonBeat: number; bisBeat: number; nur?: string; arbeitsOrdner: string;
  env?: Record<string, string>; timeoutMs?: number; abbruch?: AbortSignal;
}
export interface RenderDateiErgebnis { datei: string; frames: number; spitze_db: number; rms_db: number }

/** RMS in dB of a 32-bit float WAV (silent = -200); throws RenderDateiFehler('render_fehlgeschlagen') for anything else. */
export function rmsDb(datei: string): number {
  const schief = (t: string): never => { throw new RenderDateiFehler('render_fehlgeschlagen', `${datei}: ${t}`); };
  let b: Buffer;
  try { b = fs.readFileSync(datei); } catch (e) { return schief((e as Error).message); }
  if (b.length < 12 || b.toString('latin1', 0, 4) !== 'RIFF') return schief('not a WAV file');
  let pos = 12, daten: Buffer | null = null, fmt: number[] | null = null;
  while (pos + 8 <= b.length) {
    const k = b.toString('latin1', pos, pos + 4), g = b.readUInt32LE(pos + 4);
    if (k === 'fmt ' && pos + 24 <= b.length) fmt = [b.readUInt16LE(pos + 8), b.readUInt16LE(pos + 22)];
    if (k === 'data') daten = b.subarray(pos + 8, Math.min(b.length, pos + 8 + g));
    pos += 8 + g + (g & 1);
  }
  if (!daten || !fmt || fmt[0] !== 3 || fmt[1] !== 32) return schief('not a 32-bit float WAV');
  const n = Math.floor(daten.length / 4);
  let s = 0;
  for (let i = 0; i < n; i++) { const x = daten.readFloatLE(i * 4); s += x * x; }
  return n && s > 0 ? Math.round(20 * Math.log10(Math.sqrt(s / n)) * 100) / 100 : -200;
}

export async function rendereProjektDatei(a: RenderDateiAuftrag): Promise<RenderDateiErgebnis> {
  if (!(Number.isFinite(a.vonBeat) && Number.isFinite(a.bisBeat) && a.bisBeat > a.vonBeat && a.vonBeat >= 0)) {
    throw new RenderDateiFehler('projekt_ungueltig', 'beat range: 0 <= von < bis expected');
  }
  const g = pruefeProjekt(JSON.parse(JSON.stringify(a.projekt)));
  if ('fehler' in g) throw new RenderDateiFehler('projekt_ungueltig', g.fehler);
  const p = g.projekt;
  let regler: Record<string, number> = reglerAusProjekt(p), sicht = exportSicht(p), nurSchluessel: string[] = [];
  if (a.nur !== undefined) {
    const s = sucheSpur(p, a.nur);
    if (!s) throw new RenderDateiFehler('projekt_ungueltig', `track ${a.nur}: not in the project`);
    sicht = exportSicht(ohneFremdeLanen(p, s) ?? p);
    regler = reglerEinzeln(s, p);
    nurSchluessel = schluesselPlan(p, s).ids;
  }
  const programm = renderProgramm();
  if (!fs.existsSync(programm)) throw new RenderDateiFehler('render_fehlt', `cypherdj-render not found at ${programm} (build the core or set CYPHERDJ_RENDER)`);
  fs.mkdirSync(a.arbeitsOrdner, { recursive: true });
  try {
    const reglerDatei = path.join(a.arbeitsOrdner, 'regler.json');
    fs.writeFileSync(reglerDatei, JSON.stringify(regler));
    schreibeWiedergabe(a.arbeitsOrdner, uebersetze(sicht, {
      geraetFx, nr: 1, audioOrdner: path.join(a.arbeitsOrdner, 'audio'), arbeitsordner: a.arbeitsOrdner }));
    const dauerMs = (a.bisBeat - a.vonBeat) * 60_000 / p.tempo_bpm;
    const r = await rendere({ programm: [programm], nr: 1, von_beat: a.vonBeat, bis_beat: a.bisBeat, bpm: p.tempo_bpm, aus: a.ziel,
      arbeitsordner: a.arbeitsOrdner, spurRegler: reglerDatei, ohneZustand: true, instanz: '',
      zeitlimitMs: a.timeoutMs ?? Math.ceil(4 * dauerMs) + 120_000, abgriff: 'produktion', nurSchluessel,
      ...(a.env ? { env: a.env } : {}), ...(a.abbruch ? { abbruch: a.abbruch } : {}) });
    return { datei: r.datei, frames: r.frames, spitze_db: r.spitze_db, rms_db: rmsDb(r.datei) };
  } catch (e) {
    if (e instanceof RenderDateiFehler) throw e;
    if (e instanceof RenderFehler || e instanceof WiedergabeFehler) throw new RenderDateiFehler('render_fehlgeschlagen', e.message);
    throw e;
  }
}
