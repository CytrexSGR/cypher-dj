// Offline render of a small project through the export path (uebersetze -> schreibeWiedergabe -> cypherdj-render), the proof tool of the
// starter pack. Prints one JSON line {datei, frames, spitze_db, rms_db}.
//   node render_project.ts --projekt <project.json> --aus <file.wav> --von-beat V --bis-beat B [--nur <track-id>] [--bk-ordner D] [--kit-ordner D]
// Return: 0 written, 2 usage or invalid project, 3 cypherdj-render missing, 4 render failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { exportSicht, ohneFremdeLanen, reglerEinzeln } from '../ui/areas/proj/output.ts';
import { renderProgramm } from '../ui/paths.ts';
import { pruefeProjekt, sucheSpur } from '../ui/project/model.ts';
import { reglerAusProjekt, rendere, RenderFehler, schluesselPlan } from '../ui/project/render.ts';
import { schreibeWiedergabe, uebersetze, WiedergabeFehler } from '../ui/project/playback.ts';

const ende = (rc: number, text: string): never => { process.stderr.write(`render_projekt: ${text}\n`); process.exit(rc); };

function rmsDb(datei: string): number {
  const b = fs.readFileSync(datei);
  let pos = 12, daten: Buffer | null = null, fmt: number[] | null = null;
  while (pos + 8 <= b.length) {
    const k = b.toString('latin1', pos, pos + 4), g = b.readUInt32LE(pos + 4);
    if (k === 'fmt ') fmt = [b.readUInt16LE(pos + 8), b.readUInt16LE(pos + 22)];
    if (k === 'data') daten = b.subarray(pos + 8, Math.min(b.length, pos + 8 + g));
    pos += 8 + g + (g & 1);
  }
  if (!daten || !fmt || fmt[0] !== 3 || fmt[1] !== 32) return ende(4, `${datei}: not a 32-bit float WAV`);
  const n = Math.floor(daten.length / 4);
  let s = 0;
  for (let i = 0; i < n; i++) { const x = daten.readFloatLE(i * 4); s += x * x; }
  return n && s > 0 ? Math.round(20 * Math.log10(Math.sqrt(s / n)) * 100) / 100 : -200;
}

async function main(): Promise<void> {
  let a;
  try {
    a = parseArgs({ options: { projekt: { type: 'string' }, aus: { type: 'string' }, 'von-beat': { type: 'string' }, 'bis-beat': { type: 'string' },
      nur: { type: 'string' }, 'bk-ordner': { type: 'string' }, 'kit-ordner': { type: 'string' } }, allowPositionals: false }).values;
  } catch (e) { return ende(2, (e as Error).message); }
  if (!a.projekt || !a.aus || a['von-beat'] === undefined || a['bis-beat'] === undefined) return ende(2, '--projekt, --aus, --von-beat and --bis-beat are required');
  const von = Number(a['von-beat']), bis = Number(a['bis-beat']);
  if (!Number.isFinite(von) || !Number.isFinite(bis) || bis <= von || von < 0) return ende(2, 'beat range: 0 <= von < bis expected');
  let roh: unknown;
  try { roh = JSON.parse(fs.readFileSync(a.projekt, 'utf8')); } catch (e) { return ende(2, `${a.projekt}: ${(e as Error).message}`); }
  const g = pruefeProjekt(roh);
  if ('fehler' in g) return ende(2, g.fehler);
  const p = g.projekt;
  let regler: Record<string, number> = reglerAusProjekt(p), sicht = exportSicht(p), nurSchluessel: string[] = [];
  if (a.nur !== undefined) {
    const s = sucheSpur(p, a.nur);
    if (!s) return ende(2, `track ${a.nur}: not in the project`);
    sicht = exportSicht(ohneFremdeLanen(p, s) ?? p);
    regler = reglerEinzeln(s, p);
    nurSchluessel = schluesselPlan(p, s).ids;
  }
  const programm = renderProgramm();
  if (!fs.existsSync(programm)) return ende(3, `cypherdj-render not found at ${programm} (build the core or set CYPHERDJ_RENDER)`);
  if (a['bk-ordner']) process.env.CYPHERDJ_BK_ORDNER = a['bk-ordner'];
  if (a['kit-ordner']) process.env.CYPHERDJ_KIT_ORDNER = a['kit-ordner'];
  const arbeit = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-render-projekt-'));
  try {
    const reglerDatei = path.join(arbeit, 'regler.json');
    fs.writeFileSync(reglerDatei, JSON.stringify(regler));
    schreibeWiedergabe(arbeit, uebersetze(sicht, { nr: 1, audioOrdner: path.join(arbeit, 'audio'), arbeitsordner: arbeit }));
    const dauerMs = (bis - von) * 60_000 / p.tempo_bpm;
    const r = await rendere({ programm: [programm], nr: 1, von_beat: von, bis_beat: bis, bpm: p.tempo_bpm, aus: a.aus, arbeitsordner: arbeit,
      spurRegler: reglerDatei, ohneZustand: true, instanz: '', zeitlimitMs: Math.ceil(4 * dauerMs) + 120_000, abgriff: 'produktion', nurSchluessel });
    process.stdout.write(`${JSON.stringify({ datei: r.datei, frames: r.frames, spitze_db: r.spitze_db, rms_db: rmsDb(r.datei) })}\n`);
  } catch (e) {
    if (e instanceof RenderFehler || e instanceof WiedergabeFehler) { fs.rmSync(arbeit, { recursive: true, force: true }); return ende(4, e.message); }
    throw e;
  } finally { fs.rmSync(arbeit, { recursive: true, force: true }); }
}
await main();
