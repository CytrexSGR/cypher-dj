// 1.9 U5 (O28 on Surge): the Surge side of the project session. This file holds the parameter ranges (wirte/carla/surge_bereiche.json); the mirror of the
// project's sparse parameter map into the hosts follows below.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_PFADE } from '../../pfade.ts';
import { wirtRuf } from '../../spur.ts';
import type { Projekt } from '../../projekt/modell.ts';

let bereiche: Map<string, [number, number]> | null = null;
function lade(): Map<string, [number, number]> {
  if (bereiche) return bereiche;
  const m = new Map<string, [number, number]>();
  const d = JSON.parse(fs.readFileSync(REPO_PFADE.surgeBereiche, 'utf8')).parameter as Record<string, { punkte: number[] }>;
  for (const [name, e] of Object.entries(d)) m.set(name, [e.punkte[0], e.punkte[e.punkte.length - 1]]);
  bereiche = m;
  return m;
}

// [min, max] of a Surge parameter in display units (first and last point of `punkte`), null for a name the host cannot drive
export const surgeBereich = (name: string): [number, number] | null => lade().get(name) ?? null;

// --- the mirror -------------------------------------------------------------------------------------------------------------------------------
// The project holds a sparse map per Surge track (geraet.parameter, display values); the host of the slot (wirt-arr<slot>.sock, wirt.py) plays what it
// was told. The mirror sends `fahre` with dauer 0 for every entry whose value differs from what it sent last, and takes an entry that left the map
// (undo, delete, project change) back to the value the host had before the mirror first touched it. All work runs one job after the other in a chain;
// a job never throws: a missing host or an error answer is logged and the entry stays pending (it is sent again at the next sync, e.g. before a freeze).
export interface SpiegelOptionen { ordner: (() => string) | undefined; log: (e: Record<string, unknown>) => void; fristMs?: number }
export interface SpiegelErgebnis { gesendet: number; zurueck: number; fehler: string[] }
const SCHLUESSEL = (slot: number, name: string): string => `${slot}:${name}`;

export class SurgeSpiegel {
  private readonly opt: SpiegelOptionen;
  private readonly zuletzt = new Map<string, number>();     // "slot:name" -> the value sent last (acknowledged by the host)
  private readonly original = new Map<string, number>();    // "slot:name" -> the host's value before the mirror first sent this entry
  private kette: Promise<unknown> = Promise.resolve();

  constructor(opt: SpiegelOptionen) { this.opt = opt; }

  // without a folder the mirror is off (a session that was not given the folder of its host sockets never touches one)
  get an(): boolean { return this.opt.ordner !== undefined; }
  private sock(slot: number): string { return path.join(this.opt.ordner!(), `wirt-arr${slot}.sock`); }
  private reihe<T>(f: () => Promise<T>): Promise<T> {
    const n = this.kette.then(f, f);
    this.kette = n.catch(() => undefined);
    return n;
  }
  // resolves when every job queued so far is done
  fertig(): Promise<void> { return this.kette.then(() => undefined); }

  // the current display values of some parameters of a slot's host; null when the host does not answer. The values of entries the mirror has not
  // touched yet are remembered as the originals the mirror returns to.
  ist(slot: number, namen: string[]): Promise<Record<string, number> | null> {
    if (!this.an) return Promise.resolve(null);
    return this.reihe(() => this.istIntern(slot, namen));
  }
  private async istIntern(slot: number, namen: string[]): Promise<Record<string, number> | null> {
    const r = await wirtRuf(this.sock(slot), { befehl: 'ist', namen }, this.opt.fristMs ?? 2000);
    const w = r.werte as Record<string, unknown> | undefined;
    if (!r.ok || w === undefined || w === null || typeof w !== 'object') return null;
    const aus: Record<string, number> = {};
    for (const n of namen) {
      const v = w[n];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      aus[n] = v;
      const k = SCHLUESSEL(slot, n);
      if (!this.zuletzt.has(k) && !this.original.has(k)) this.original.set(k, v);
    }
    return aus;
  }

  // the wanted state of a project: "slot:name" -> value over all Surge tracks
  private soll(p: Projekt | null): Map<string, { slot: number; name: string; wert: number }> {
    const m = new Map<string, { slot: number; name: string; wert: number }>();
    for (const s of p?.spuren ?? []) {
      if (s.geraet?.art !== 'wirt') continue;
      for (const [name, wert] of Object.entries(s.geraet.parameter ?? {})) m.set(SCHLUESSEL(s.geraet.slot, name), { slot: s.geraet.slot, name, wert });
    }
    return m;
  }

  // Brings the hosts to the state of `projekt` (null: the project is closed, every entry goes back). voll: send every entry, not only the changed ones (open).
  gleiche(projekt: Projekt | null, voll = false): Promise<SpiegelErgebnis> {
    if (!this.an) return Promise.resolve({ gesendet: 0, zurueck: 0, fehler: [] });
    const soll = this.soll(projekt);
    return this.reihe(async () => {
      const aus: SpiegelErgebnis = { gesendet: 0, zurueck: 0, fehler: [] };
      const fahre = async (slot: number, name: string, bis: number): Promise<boolean> => {
        const r = await wirtRuf(this.sock(slot), { befehl: 'fahre', name, bis, dauer: 0 }, this.opt.fristMs ?? 2000);
        if (r.ok) return true;
        aus.fehler.push(`${SCHLUESSEL(slot, name)}: ${r.fehler ?? 'refused'}`);
        return false;
      };
      // 1. the entries that left the map go back to the original value
      for (const k of [...this.zuletzt.keys()]) {
        if (soll.has(k)) continue;
        const [slotText, ...rest] = k.split(':');
        const slot = Number(slotText), name = rest.join(':');
        const alt = this.original.get(k);
        if (alt === undefined) { this.zuletzt.delete(k); this.opt.log({ typ: 'surge_spiegel_ohne_original', eintrag: k }); continue; }
        if (await fahre(slot, name, alt)) { this.zuletzt.delete(k); this.original.delete(k); aus.zurueck += 1; }
      }
      // 2. the originals of entries the mirror has not touched yet (one read per slot), then the entries that differ
      const offen = [...soll.entries()].filter(([k, e]) => voll || this.zuletzt.get(k) !== e.wert);
      const ohneOriginal = new Map<number, string[]>();
      for (const [k, e] of offen) if (!this.zuletzt.has(k) && !this.original.has(k)) ohneOriginal.set(e.slot, [...(ohneOriginal.get(e.slot) ?? []), e.name]);
      for (const [slot, namen] of ohneOriginal) {
        if ((await this.istIntern(slot, namen)) === null) aus.fehler.push(`slot ${slot}: the host did not answer (original values unknown)`);
      }
      for (const [k, e] of offen) {
        if (!this.zuletzt.has(k) && !this.original.has(k)) continue;        // host not readable: stay pending, retried at the next sync
        if (await fahre(e.slot, e.name, e.wert)) { this.zuletzt.set(k, e.wert); aus.gesendet += 1; }
      }
      if (aus.fehler.length) this.opt.log({ typ: 'surge_spiegel_fehler', fehler: aus.fehler });
      return aus;
    });
  }
}
