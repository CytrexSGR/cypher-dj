// djk-exporte [--ausfuehren] [--genannt-in DIR]...: keeps the three newest exports of every project, the older ones move to the bin.
// Without --ausfuehren nothing moves. Linked projects are read through their link.
import fs from 'node:fs';
import path from 'node:path';
import { genanntOrdnerAusUmgebung, genannteExporte, papierkorbVon, raeumeExporteAuf } from './exporte.ts';
import { projektWurzelVorgabe } from './storage.ts';

const HILFE = 'usage: djk-exporte [--ausfuehren] [--genannt-in DIR]... [--wurzel DIR]\n'
  + '  keeps the three newest exports per project; older ones move to <projects root>/.papierkorb/exporte/<slug>/ (nothing is deleted).\n'
  + '  A name written in a .md file below a --genannt-in folder (default: the folders of CYPHERDJ_EXPORT_GENANNT, colon separated) stays and does\n'
  + '  not count. Without --ausfuehren nothing moves.\n';

function main(argv: string[]): number {
  let ausfuehren = false, wurzel: string | null = null;
  const genanntIn: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ausfuehren') ausfuehren = true;
    else if (a === '--genannt-in' && argv[i + 1] !== undefined) genanntIn.push(argv[++i]);
    else if (a === '--wurzel' && argv[i + 1] !== undefined) wurzel = argv[++i];
    else if (a === '--help' || a === '-h') { process.stdout.write(HILFE); return 0; }
    else { process.stderr.write(`unknown argument ${a}\n${HILFE}`); return 2; }
  }
  const w = wurzel ?? projektWurzelVorgabe('');
  const suche = genanntIn.length > 0 ? genanntIn : genanntOrdnerAusUmgebung();   // --genannt-in wins over CYPHERDJ_EXPORT_GENANNT
  for (const o of suche) {
    let ok = false;
    try { ok = fs.statSync(o).isDirectory(); } catch { /* missing */ }
    if (!ok) { process.stderr.write(`the folder of named exports does not exist: ${o}; nothing was tidied\n`); return 2; }
  }
  const genannt = genannteExporte(suche);
  let namen: string[] = [];
  try { namen = fs.readdirSync(w).filter((n) => !n.startsWith('.')).sort(); } catch { /* no projects root: nothing to do */ }
  process.stdout.write(`slug  kept  moved${ausfuehren ? '' : '  (dry run)'}\n`);
  for (const slug of namen) {
    const ordner = path.join(w, slug, 'export');
    try { if (!fs.statSync(ordner).isDirectory()) continue; } catch { continue; }
    const r = raeumeExporteAuf({ exportOrdner: ordner, papierkorb: papierkorbVon(w, slug), genannt, trocken: !ausfuehren,
      log: (z) => process.stderr.write(`${JSON.stringify(z)}\n`) });
    process.stdout.write(`${slug}  ${r.behalten}  ${r.verschoben.length}\n`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
