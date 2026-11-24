// Collect all, kit part (browser plan 5, T5): the kits a project names are copied from the global kit folder into <project>/kits/<name>/,
// so the project folder carries them to another machine. Asynchronous copies, so a large kit does not stall the page server.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { KIT_NAME } from './model.ts';
import { KitFehler, braucheFreienPlatz, kitInhaltHash, kitsOrdnerVon, pruefeKitOrdner } from './kit_storage.ts';
import { kitNamenImProjekt } from './kit_bezug.ts';

export type KitEinsammelBericht = { kopiert: string[]; schon_da: string[]; fehlt: string[] };

const zufall = (): string => crypto.randomBytes(5).toString('hex');

export async function sammleKitsEin(a: { projekt: unknown; projektOrdner: string; kitsOrdner?: string;
  frei?: (ordner: string) => number }): Promise<KitEinsammelBericht> {
  const b: KitEinsammelBericht = { kopiert: [], schon_da: [], fehlt: [] };
  const global = kitsOrdnerVon(a.kitsOrdner !== undefined ? { kitsOrdner: a.kitsOrdner } : undefined);
  const ziele = path.join(a.projektOrdner, 'kits');
  const alt = path.join(ziele, `.alt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  for (const name of kitNamenImProjekt(a.projekt)) {
    if (!KIT_NAME.test(name)) continue;
    const von = path.join(global, name), nach = path.join(ziele, name);
    const p = fs.existsSync(path.join(von, 'kit.json')) ? await pruefeKitOrdner(von) : null;
    if (!p || !p.ok) { b.fehlt.push(name); continue; }
    const hatNach = fs.existsSync(path.join(nach, 'kit.json'));
    if (hatNach && (await kitInhaltHash(nach)) === (await kitInhaltHash(von))) { b.schon_da.push(name); continue; }
    braucheFreienPlatz(a.projektOrdner, p.bytes, a.frei);
    fs.mkdirSync(ziele, { recursive: true });
    const stage = path.join(ziele, `.einspielen-${zufall()}`);
    try {
      await fs.promises.cp(von, stage, { recursive: true, filter: (q) => q === von || !path.basename(q).startsWith('.') });
      const g = await pruefeKitOrdner(stage);
      if (!g.ok) throw new KitFehler(400, g.grund, g.text);
      // the global kit wins, the old copy is kept
      if (fs.existsSync(nach)) { fs.mkdirSync(alt, { recursive: true }); fs.renameSync(nach, path.join(alt, name)); }
      fs.renameSync(stage, nach);
    } catch (e) {
      fs.rmSync(stage, { recursive: true, force: true });
      throw e;
    }
    b.kopiert.push(name);
  }
  return b;
}
