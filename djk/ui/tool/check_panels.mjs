// Checks panel files of the repo against the installed graphs (~/cypherdj/werke/geraete, read only), with the page server's own check (graphs.ts pruefePanel).
// usage: node djk/ui/tool/check_panels.mjs <repo> <graph> [<graph> ...]: checks repo panel files against the installed graphs (read only)
import fs from 'node:fs'; import path from 'node:path';
const [repo, ...namen] = process.argv.slice(2);
const { pruefePanel, reglerBereiche, normalisierePanel } = await import(path.join(repo, 'djk/ui/graphs.ts'));
const GR = path.join(process.env.HOME, 'cypherdj/werke/geraete');
let problems = 0;
for (const n of namen) {
  const g = JSON.parse(fs.readFileSync(path.join(GR, `${n}.json`), 'utf8'));
  const pf = path.join(repo, 'djk/instruments/modular_dsp/paneele', `${n}.json`);
  if (!fs.existsSync(pf)) { console.log(n, 'NO PANEL FILE'); problems++; continue; }
  const f = pruefePanel(JSON.parse(fs.readFileSync(pf, 'utf8')), n, reglerBereiche(g));
  console.log(n, f.length ? 'PROBLEM ' + f.join(' | ') : 'ok'); problems += f.length;
}
process.exit(problems ? 1 : 0);
