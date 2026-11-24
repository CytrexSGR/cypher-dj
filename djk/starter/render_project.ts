// Offline render of a small project through the export path (uebersetze -> schreibeWiedergabe -> cypherdj-render), the proof tool of the
// starter pack. Prints one JSON line {datei, frames, spitze_db, rms_db}. The work is done by rendereProjektDatei (djk/ui/project/render_file.ts).
//   node render_project.ts --projekt <project.json> --aus <file.wav> --von-beat V --bis-beat B [--nur <track-id>] [--bk-ordner D] [--kit-ordner D]
// Return: 0 written, 2 usage or invalid project, 3 cypherdj-render missing, 4 render failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { RenderDateiFehler, rendereProjektDatei } from '../ui/project/render_file.ts';

const ende = (rc: number, text: string): never => { process.stderr.write(`render_projekt: ${text}\n`); process.exit(rc); };
const RC: Record<RenderDateiFehler['grund'], number> = { projekt_ungueltig: 2, render_fehlt: 3, render_fehlgeschlagen: 4 };

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
  const env: Record<string, string> = {};
  if (a['bk-ordner']) env.CYPHERDJ_BK_ORDNER = a['bk-ordner'];
  if (a['kit-ordner']) env.CYPHERDJ_KIT_ORDNER = a['kit-ordner'];
  const arbeit = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-render-projekt-'));
  try {
    const r = await rendereProjektDatei({ projekt: roh as never, ziel: a.aus, vonBeat: von, bisBeat: bis, ...(a.nur !== undefined ? { nur: a.nur } : {}), arbeitsOrdner: arbeit, env });
    process.stdout.write(`${JSON.stringify({ datei: r.datei, frames: r.frames, spitze_db: r.spitze_db, rms_db: r.rms_db })}\n`);
  } catch (e) {
    if (e instanceof RenderDateiFehler) { fs.rmSync(arbeit, { recursive: true, force: true }); return ende(RC[e.grund], e.message); }
    throw e;
  } finally { fs.rmSync(arbeit, { recursive: true, force: true }); }
}
await main();
