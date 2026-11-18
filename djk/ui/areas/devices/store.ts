// I08: Konfiguration ~/.config/cypherdj[-<i>]/geraete.json. Gerätekonfiguration, kein Projektinhalt. Strikt geprüft; eine defekte Datei wird gemeldet,
// nie überschrieben. Schreiben: Temp-Datei + rename.
import fs from 'node:fs';
import path from 'node:path';
import { profil } from './profile.ts';

export const FORMAT = 'cypherdj-geraete/1';
export interface Latenz { samples: number; streuung: number; min: number; max: number; laeufe: number; quantum: number; rate: number; art: 'software' | 'kabel'; gemessen_am: string }
export interface AudioZuordnung { knoten: string; ports: string[] }
export interface Eingang { k: number; name: string; profil: string | null; audio: AudioZuordnung | null; frei_fuer_cypher: boolean; latenz: Latenz | null }
// versatz_samples (1.8 T8): how late the player's notes arrive against the music he heard, 0..48000; absent means 0. Only Andreas sets it (the measurement is his).
// folgen (controller follow): place 1 follows the focused synth (see ControllerPlatz.folgen); absent means false.
export interface MidiZuordnung { profil: string | null; port: string | null; frei_fuer_cypher: boolean; versatz_samples?: number; folgen?: boolean }
export const MIDI_VERSATZ_MAX = 48000;
// Controller places: the kern has eight raw MIDI inputs midi_ein_1..8, each with its own learn table, so the same CC of two devices never collides.
// Place 1 is `midi.port` (the playing input with its offset and release); `controller` holds the places 2..8. The key is optional: a file without
// it is a file with one place.
export const CONTROLLER_PLAETZE = 8;
// folgen: the place takes the learn entries of the synth in front (areas/controller/sequences.ts); absent means false. Place 1 keeps the same flag as midi.folgen.
export interface ControllerPlatz { platz: number; port: string; name?: string; folgen?: boolean }
export interface Konfig { format: typeof FORMAT; eingaenge: Eingang[]; midi: MidiZuordnung; controller?: ControllerPlatz[] }
/** The device part of a JACK port name as the kern sees it: "Midi-Bridge:LPD8: MIDI 1 (capture)" -> "LPD8". */
export const portGeraeteName = (port: string): string => { const t = port.split(':'); return (t.length >= 3 ? t[1] : t[0]).trim() || port; };
/** Every assigned place in order: place 1 from `midi.port`, the others from `controller`. */
/** A controller place as the lists show it: the follow flag is read with folgenVon, not carried here. */
export type ControllerZeile = Required<Omit<ControllerPlatz, 'folgen'>>;
export function controllerPlaetze(k: Konfig): ControllerZeile[] {
  const aus: ControllerZeile[] = [];
  if (k.midi.port) aus.push({ platz: 1, port: k.midi.port, name: portGeraeteName(k.midi.port) });
  for (const c of k.controller ?? []) aus.push({ platz: c.platz, port: c.port, name: c.name ?? portGeraeteName(c.port) });
  return aus.sort((a, b) => a.platz - b.platz);
}

/** Does the controller place follow the focused synth? Place 1 by `midi.folgen`, the places 2..8 by their `controller` entry. */
export const folgenVon = (k: Konfig, platz: number): boolean => (platz === 1 ? k.midi.folgen === true : (k.controller ?? []).find((c) => c.platz === platz)?.folgen === true);

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
  nurSchluessel(o, ['format', 'eingaenge', 'midi', 'controller'], 'file');
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
  nurSchluessel(m, ['profil', 'port', 'frei_fuer_cypher', 'versatz_samples', 'folgen'], 'midi');
  if ('folgen' in m && typeof m.folgen !== 'boolean') defekt('midi.folgen: true or false expected');
  if ((m.profil !== null && (typeof m.profil !== 'string' || !profil(m.profil))) || (m.port !== null && !portName(m.port)) || typeof m.frei_fuer_cypher !== 'boolean') defekt('midi');
  if (m.frei_fuer_cypher && (m.port === null || m.profil === null)) defekt('midi: a release needs a device');
  if ('versatz_samples' in m && (!Number.isInteger(m.versatz_samples) || (m.versatz_samples as number) < 0 || (m.versatz_samples as number) > MIDI_VERSATZ_MAX)) {
    defekt(`midi.versatz_samples: an integer from 0 to ${MIDI_VERSATZ_MAX} expected`);
  }
  if ('controller' in o) {
    if (!Array.isArray(o.controller) || o.controller.length > CONTROLLER_PLAETZE - 1) defekt(`controller: a list of at most ${CONTROLLER_PLAETZE - 1} places expected`);
    const plaetze = new Set<number>(), ports = new Set<string>(m.port === null ? [] : [m.port as string]);
    (o.controller as unknown[]).forEach((x, i) => {
      const c = objekt(x, `controller[${i}]`);
      nurSchluessel(c, ['platz', 'port', 'name', 'folgen'], `controller[${i}]`);
      if ('folgen' in c && typeof c.folgen !== 'boolean') defekt(`controller[${i}].folgen: true or false expected`);
      if (!Number.isInteger(c.platz) || (c.platz as number) < 2 || (c.platz as number) > CONTROLLER_PLAETZE || plaetze.has(c.platz as number)) defekt(`controller[${i}].platz: a free place from 2 to ${CONTROLLER_PLAETZE} expected`);
      if (!portName(c.port) || ports.has(c.port)) defekt(`controller[${i}].port: a port name that no other place holds expected`);
      if ('name' in c && (typeof c.name !== 'string' || c.name.length < 1 || c.name.length > 40)) defekt(`controller[${i}].name`);
      plaetze.add(c.platz as number); ports.add(c.port as string);
    });
  }
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
