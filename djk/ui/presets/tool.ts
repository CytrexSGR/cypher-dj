// Command line for the preset register (presets/DECISIONS.md, P-R4):
//   node presets/tool.ts bauen   [--werk DIR] [--nutzer DIR] [--register FILE]   rebuild and write the register
//   node presets/tool.ts pruefen [--werk DIR] [--nutzer DIR] [--register FILE]   report drift, exit 1 if not clean
//   node presets/tool.ts frage '<json query>' [...]                               query, prints JSON
//   node presets/tool.ts schema                                                    tool definition for agents
//   node presets/tool.ts pruefsumme                                                checksum of vokabular.json content
// Without options only the factory presets (presets/factory) and presets/register.json are used; --nutzer adds a user folder
// (the store's folder layout, store.ts), so the register then covers both origins.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ladeVokabular, inhaltPruefsumme, VOKABULAR_DATEI, fehlerText } from './vocabulary.ts';
import { bauen, pruefe, frage, frageSchema, liesRegister, schreibeRegister, WERK_REGISTER, FrageFehler } from './register.ts';
import { PresetSpeicher, WERK_VORGABE } from './store.ts';
import type { Herkunft } from './model.ts';

export function hauptprogramm(argv: string[], aus: (s: string) => void = (s) => process.stdout.write(`${s}\n`)): number {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { nutzer: { type: 'string' }, register: { type: 'string' }, werk: { type: 'string' } },
  });
  const [befehl, arg] = positionals;
  if (befehl === 'pruefsumme') {
    aus(inhaltPruefsumme(JSON.parse(fs.readFileSync(VOKABULAR_DATEI, 'utf8')).inhalt));
    return 0;
  }
  const vok = ladeVokabular();
  const werk = values.werk ?? WERK_VORGABE;
  // without --nutzer the store's user folder is never read (only the werk origin is asked for)
  const speicher = new PresetSpeicher({ werk, nutzer: values.nutzer ?? path.join(werk, '.kein-nutzer'), vok });
  const herkuenfte: Herkunft[] = values.nutzer ? ['werk', 'nutzer'] : ['werk'];
  const datei = values.register ?? WERK_REGISTER;
  switch (befehl) {
    case 'bauen': {
      const r = bauen(speicher, herkuenfte);
      schreibeRegister(datei, r.register);
      aus(`${r.register.eintraege.length} presets written to ${datei}`);
      for (const u of r.ungueltig) aus(`invalid ${u.id}: ${u.fehler.map(fehlerText).join('; ')}`);
      for (const d of r.doppelt) aus(`same sound: ${d.ids.join(', ')}`);
      return r.ungueltig.length ? 1 : 0;
    }
    case 'pruefen': {
      const d = pruefe(liesRegister(datei), speicher, herkuenfte);
      aus(JSON.stringify(d, null, 2));
      return d.sauber ? 0 : 1;
    }
    case 'frage': {
      try { aus(JSON.stringify(frage(liesRegister(datei), JSON.parse(arg ?? '{}'), vok), null, 2)); return 0; }
      catch (e) { if (e instanceof FrageFehler) { aus(JSON.stringify({ fehler: e.fehler }, null, 2)); return 2; } throw e; }
    }
    case 'schema':
      aus(JSON.stringify(frageSchema(vok), null, 2));
      return 0;
    default:
      aus('usage: node presets/tool.ts bauen|pruefen|frage <json>|schema|pruefsumme [--werk DIR] [--nutzer DIR] [--register FILE]');
      return 2;
  }
}

if (import.meta.main) process.exitCode = hauptprogramm(process.argv.slice(2));
