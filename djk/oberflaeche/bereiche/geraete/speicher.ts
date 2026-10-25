// I08: Konfiguration ~/.config/cypherdj[-<i>]/geraete.json. Gerätekonfiguration, kein Projektinhalt. Strikt geprüft; eine defekte Datei wird gemeldet,
// nie überschrieben. Schreiben: Temp-Datei + rename.
import fs from 'node:fs';
import path from 'node:path';
import { profil } from './profile.ts';

export const FORMAT = 'cypherdj-geraete/1';
export interface Latenz { samples: number; streuung: number; min: number; max: number; laeufe: number; quantum: number; rate: number; art: 'software' | 'kabel'; gemessen_am: string }
export interface AudioZuordnung { knoten: string; ports: string[] }
export interface Eingang { k: number; name: string; profil: string | null; audio: AudioZuordnung | null; frei_fuer_cypher: boolean; latenz: Latenz | null }
export interface MidiZuordnung { profil: string | null; port: string | null; frei_fuer_cypher: boolean }
export interface Konfig { format: typeof FORMAT; eingaenge: Eingang[]; midi: MidiZuordnung }

export class GeraeteFehler extends Error {
  readonly grund: string;
  readonly code: number;
  readonly text: string;
  constructor(grund: string, code = 400, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; this.code = code; this.text = text; }
}
export const standard = (): Konfig => ({
  format: FORMAT,
  eingaenge: [1, 2, 3, 4].map((k) => ({ k, name: `Input ${k}`, profil: null, audio: null, frei_fuer_cypher: false, latenz: null })),
  midi: { profil: null, port: null, frei_fuer_cypher: false },
});

const defekt = (text: string): never => { throw new GeraeteFehler('konfig_defekt', 500, text); };
const objekt = (x: unknown, wo: string): Record<string, unknown> => (typeof x === 'object' && x !== null && !Array.isArray(x) ? x as Record<string, unknown> : defekt(`${wo}: object expected`));
const nurSchluessel = (o: Record<string, unknown>, erlaubt: string[], wo: string): void => { for (const k of Object.keys(o)) if (!erlaubt.includes(k)) defekt(`${wo}: unknown key ${k}`); };
export const portName = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200 && !/[\t\r\n]/.test(x);

export function pruefeKonfig(j: unknown): Konfig {
  const o = objekt(j, 'file');
  nurSchluessel(o, ['format', 'eingaenge', 'midi'], 'file');
  if (o.format !== FORMAT) defekt(`format: ${FORMAT} expected`);
  if (!Array.isArray(o.eingaenge) || o.eingaenge.length !== 4) defekt('eingaenge: exactly 4 expected');
  o.eingaenge.forEach((x, i) => {
    const e = objekt(x, `eingaenge[${i}]`);
    nurSchluessel(e, ['k', 'name', 'profil', 'audio', 'frei_fuer_cypher', 'latenz'], `eingaenge[${i}]`);
    if (e.k !== i + 1) defekt(`eingaenge[${i}].k: ${i + 1} expected`);
    if (typeof e.name !== 'string' || e.name.length < 1 || e.name.length > 40) defekt(`eingaenge[${i}].name`);
    if (e.profil !== null && (typeof e.profil !== 'string' || !profil(e.profil))) defekt(`eingaenge[${i}].profil`);
    if (typeof e.frei_fuer_cypher !== 'boolean') defekt(`eingaenge[${i}].frei_fuer_cypher`);
    if (e.frei_fuer_cypher && (e.audio === null || e.profil === null)) defekt(`eingaenge[${i}].frei_fuer_cypher: a release needs a device`);
    if (e.audio !== null) {
      const a = objekt(e.audio, `eingaenge[${i}].audio`);
      nurSchluessel(a, ['knoten', 'ports'], `eingaenge[${i}].audio`);
      if (!portName(a.knoten) || !Array.isArray(a.ports) || a.ports.length < 1 || a.ports.length > 2 || !a.ports.every(portName)) defekt(`eingaenge[${i}].audio`);
    }
    if (e.latenz !== null) {
      if (e.audio === null) defekt(`eingaenge[${i}].latenz: a latency profile needs a device`);
      const l = objekt(e.latenz, `eingaenge[${i}].latenz`);
      nurSchluessel(l, ['samples', 'streuung', 'min', 'max', 'laeufe', 'quantum', 'rate', 'art', 'gemessen_am'], `eingaenge[${i}].latenz`);
      for (const f of ['samples', 'streuung', 'min', 'max', 'laeufe', 'quantum', 'rate']) if (typeof l[f] !== 'number' || !Number.isFinite(l[f] as number) || (l[f] as number) < 0) defekt(`eingaenge[${i}].latenz.${f}`);
      if (l.art !== 'software' && l.art !== 'kabel') defekt(`eingaenge[${i}].latenz.art`);
      if (typeof l.gemessen_am !== 'string') defekt(`eingaenge[${i}].latenz.gemessen_am`);
    }
  });
  const m = objekt(o.midi, 'midi');
  nurSchluessel(m, ['profil', 'port', 'frei_fuer_cypher'], 'midi');
  if ((m.profil !== null && (typeof m.profil !== 'string' || !profil(m.profil))) || (m.port !== null && !portName(m.port)) || typeof m.frei_fuer_cypher !== 'boolean') defekt('midi');
  if (m.frei_fuer_cypher && (m.port === null || m.profil === null)) defekt('midi: a release needs a device');
  return o as unknown as Konfig;
}

export class GeraeteSpeicher {
  readonly pfad: string;
  constructor(pfad: string) { this.pfad = pfad; }
  lies(): Konfig {
    let roh: string;
    try { roh = fs.readFileSync(this.pfad, 'utf8'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return standard();
      throw e;
    }
    let j: unknown;
    try { j = JSON.parse(roh); } catch { return defekt('geraete.json is not valid JSON; the file was left untouched'); }
    return pruefeKonfig(j);
  }
  existiert(): boolean { return fs.existsSync(this.pfad); }
  schreibe(k: Konfig): void {
    pruefeKonfig(k);
    fs.mkdirSync(path.dirname(this.pfad), { recursive: true });
    const tmp = `${this.pfad}.${process.pid}.teil`;
    fs.writeFileSync(tmp, JSON.stringify(k, null, 1) + '\n');
    fs.renameSync(tmp, this.pfad);
  }
}
