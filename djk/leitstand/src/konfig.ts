// leitstand.toml lesen (SCHNITTSTELLEN §2.1) und gegen das Schema aus Scheibe 02 prüfen; Vorgaben kommen aus
// dessen "default"-Werten. Unbekannte Schlüssel sind ein Startfehler, jede Datei beginnt mit version = 1.
// Prüfinstanzen nach ROADMAP Z2: CYPHERDJ_INSTANZ=a..i verschiebt Ports um 1000·k, cypherdj/ wird cypherdj-<i>/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { pruefer, SCHEMA_KONFIG } from './vertrag.ts';

export interface Konfig {
  version: number;
  ws_port: number;
  abo_port: number;
  set_basis_bpm: number;
  autonomie_start: number;
  bestand: string;
  sets: string;
  rechner_socket: string;
  zug_vorlauf_takte: number;
  antwort_frist_takte: number;
  nachrender_ruhe_takte: number;
  grenzen_tief_verriegeln: boolean;
}

export interface Laufzeit {
  konfig: Konfig;              // Werte wie in der Datei, Lücken aus den Vorgaben (Ports ohne Z2-Versatz)
  quelle: string;              // Pfad der Datei oder "vorgaben"
  instanz: string;             // "" oder a bis i (Z2)
  versatz: number;             // 1000·k
  ws_port: number;             // mit Versatz
  abo_port: number;            // mit Versatz
  kern_port: number;           // 47100 + Versatz (§2), oder --kern-port
  sets_pfad: string;           // aufgelöst
  bestand_pfad: string;        // aufgelöst (§13, Scheibe 21+: Werkzeug bestand liest index.sqlite von dort)
  rechner_socket_pfad: string; // aufgelöst, mit Z2
}

const pruefe = pruefer(SCHEMA_KONFIG, '#/$defs/leitstand.toml', true);

// Prüft und füllt Lücken aus den Vorgaben des Schemas; wirft mit Dateiname und Schlüssel.
export function pruefeKonfig(roh: Record<string, unknown>, quelle: string): Konfig {
  const k = structuredClone(roh);
  const p = pruefe(k);
  if (!p.ok) throw new Error(`${quelle}: ${p.fehler} (SCHNITTSTELLEN §2.1)`);
  return k as unknown as Konfig;
}

export const VORGABEN: Konfig = pruefeKonfig({ version: 1 }, 'vorgaben');

export function instanzVersatz(instanz: string): number {
  if (instanz === '') return 0;
  if (!/^[a-i]$/.test(instanz)) throw new Error(`CYPHERDJ_INSTANZ=${instanz}: erlaubt sind a bis i (ROADMAP Z2)`);
  return 1000 * (instanz.charCodeAt(0) - 'a'.charCodeAt(0) + 1);
}

// "/cypherdj/" wird bei gesetzter Instanz zu "/cypherdj-<i>/" (Z2); "cypher-dj/" bleibt.
export function mitInstanz(p: string, instanz: string): string {
  return instanz === '' ? p : p.split('/cypherdj/').join(`/cypherdj-${instanz}/`);
}

export function aufloesen(p: string, env: NodeJS.ProcessEnv): string {
  let r = p;
  if (r === '~' || r.startsWith('~/')) r = path.join(os.homedir(), r.slice(1));
  return r.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name: string) => {
    const w = env[name];
    if (w === undefined) throw new Error(`Umgebungsvariable ${name} fehlt für Pfad ${p}`);
    return w;
  });
}

export function ladeKonfig(opt: { pfad?: string; kernPort?: number; env?: NodeJS.ProcessEnv }): Laufzeit {
  const env = opt.env ?? process.env;
  const instanz = env.CYPHERDJ_INSTANZ ?? '';
  const versatz = instanzVersatz(instanz);
  const standard = path.join(os.homedir(), '.config', instanz ? `cypherdj-${instanz}` : 'cypherdj', 'leitstand.toml');
  const pfad = opt.pfad ?? standard;
  let konfig: Konfig;
  let quelle: string;
  if (fs.existsSync(pfad)) {
    konfig = pruefeKonfig(parse(fs.readFileSync(pfad, 'utf8')) as Record<string, unknown>, pfad);
    quelle = pfad;
  } else if (opt.pfad) {
    throw new Error(`Konfiguration ${pfad} fehlt`);
  } else {
    konfig = { ...VORGABEN };
    quelle = 'vorgaben';
  }
  return {
    konfig,
    quelle,
    instanz,
    versatz,
    ws_port: konfig.ws_port + versatz,
    abo_port: konfig.abo_port + versatz,
    kern_port: opt.kernPort ?? 47100 + versatz,
    sets_pfad: aufloesen(konfig.sets, env),
    bestand_pfad: aufloesen(konfig.bestand, env),
    rechner_socket_pfad: mitInstanz(aufloesen(konfig.rechner_socket, env), instanz),
  };
}
