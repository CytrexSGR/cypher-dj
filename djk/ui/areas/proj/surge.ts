// 1.9 U5 (O28 on Surge): the Surge side of the project session. This file holds the parameter ranges (hosts/carla/surge_bereiche.json); the mirror of the
// project's sparse parameter map into the hosts follows below.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_PFADE } from '../../paths.ts';
import { wirtRuf } from '../../track.ts';
import type { Projekt } from '../../project/model.ts';
import { surgePatchDatei } from './surge_patches.ts';

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
// The project holds a sparse map per Surge track (geraet.parameter, display values); the host of the slot (wirt-arr<slot>.sock, instrument_host.py) plays what
// it was told. The mirror sends `fahre` with dauer 0 for every entry whose value differs from what it sent last, and takes an entry that left the
// map (undo, delete, project change) back to the value the host had before the mirror first touched it. All work runs one job after the other in a
// chain; a job never throws: a missing host or an error answer is logged and the entry stays pending (it is sent again at the next sync, e.g.
// before a freeze). slotBereit (plan 1.11 task 17): resolves when the host of a slot is not being swapped (a plugin instrument host going back to
// Surge); a job waits for it in the background chain, so a patch or parameter never hits the plugin host or a vanishing socket
export interface SpiegelOptionen {
  ordner: (() => string) | undefined; log: (e: Record<string, unknown>) => void; fristMs?: number; slotBereit?: (slot: number) => Promise<void>;
}
export interface SpiegelErgebnis { gesendet: number; zurueck: number; fehler: string[] }
const SCHLUESSEL = (slot: number, name: string): string => `${slot}:${name}`;

export class SurgeSpiegel {
  private readonly opt: SpiegelOptionen;
  private readonly zuletzt = new Map<string, number>();     // "slot:name" -> the value sent last (acknowledged by the host)
  private readonly original = new Map<string, number>();    // "slot:name" -> the host's value before the mirror first sent this entry
  private readonly geladen = new Map<number, string>();   // slot -> the library name of the patch the mirror loaded into the host last (acknowledged)
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

  // Is filter 1 on in the patch the host of the slot plays now (a_filter1_type of the state XML other than 0 = Off); null when the host does not answer
  // or the XML has no such entry. a_filter1_type is not a steplessly drivable parameter, so `ist` cannot read it: the state (`zustand`) is read.
  filter1An(slot: number): Promise<boolean | null> {
    if (!this.an) return Promise.resolve(null);
    return this.reihe(async () => {
      const r = await wirtRuf(this.sock(slot), { befehl: 'zustand' }, this.opt.fristMs ?? 2000);
      if (!r.ok || typeof r.xml !== 'string') return null;
      const m = /<a_filter1_type\b[^>]*?\bvalue="(-?\d+(?:\.\d+)?)"/.exec(r.xml);
      return m === null ? null : Number(m[1]) !== 0;
    });
  }

  // the wanted state of a project: "slot:name" -> value over all Surge tracks
  private soll(p: Projekt | null): Map<string, { slot: number; name: string; wert: number }> {
    const m = new Map<string, { slot: number; name: string; wert: number }>();
    for (const s of p?.spuren ?? []) {
      if (s.geraet?.art !== 'wirt' || s.geraet.name !== 'surge') continue;   // a plugin instrument has no Surge map
      for (const [name, wert] of Object.entries(s.geraet.parameter ?? {})) m.set(SCHLUESSEL(s.geraet.slot, name), { slot: s.geraet.slot, name, wert });
    }
    return m;
  }

  // the wanted patch per slot: geraet.patch of the Surge tracks (a track without patch wants none: the host stays as it is)
  private sollPatch(p: Projekt | null): Map<number, string> {
    const m = new Map<number, string>();
    for (const s of p?.spuren ?? []) {
      if (s.geraet?.art === 'wirt' && s.geraet.name === 'surge' && s.geraet.patch !== undefined) m.set(s.geraet.slot, s.geraet.patch);
    }
    return m;
  }

  // Brings the hosts to the state of `projekt` (null: the project is closed, every entry goes back). voll: send every entry, not only the changed ones (open).
  // First the patches: a slot whose wanted patch differs from the one loaded last (or every wanted patch with patchNeu, default = voll: open and the freeze
  // path, where the host may have been changed by hand) gets `lade` with the file of the library; a load overwrites the host's values, so everything the
  // mirror knew about that slot is forgotten and the whole map is sent again on top, and the originals are read from the freshly loaded patch.
  // A patch that does not load (not in the library, host error) is an error and its slot's map entries stay pending.
  gleiche(projekt: Projekt | null, voll = false, patchNeu: boolean = voll): Promise<SpiegelErgebnis> {
    if (!this.an) return Promise.resolve({ gesendet: 0, zurueck: 0, fehler: [] });
    const soll = this.soll(projekt);
    const patches = this.sollPatch(projekt);
    return this.reihe(async () => {
      if (this.opt.slotBereit) {
        const slots = new Set<number>([...patches.keys(), ...[...soll.values()].map((e) => e.slot)]);
        for (const k of this.zuletzt.keys()) slots.add(Number(k.split(':')[0]));
        await Promise.all([...slots].map((s) => this.opt.slotBereit!(s)));
      }
      const aus: SpiegelErgebnis = { gesendet: 0, zurueck: 0, fehler: [] };
      const ohnePatch = new Set<number>();                                  // slots whose wanted patch did not load: their entries wait
      if (projekt === null) this.geladen.clear();
      // no patch wanted any more: the host plays on, nothing is known about it
      for (const slot of [...this.geladen.keys()]) if (!patches.has(slot)) this.geladen.delete(slot);
      for (const [slot, name] of patches) {
        if (!patchNeu && this.geladen.get(slot) === name) continue;
        const datei = surgePatchDatei(name);
        if (datei === null) {
          aus.fehler.push(`slot ${slot}: patch ${JSON.stringify(name)} is not in the library`);
          ohnePatch.add(slot); this.geladen.delete(slot);
          continue;
        }
        const r = await wirtRuf(this.sock(slot), { befehl: 'lade', pfad: datei }, this.opt.fristMs ?? 10000);
        if (!r.ok) { aus.fehler.push(`slot ${slot}: lade ${name}: ${r.fehler ?? 'refused'}`); ohnePatch.add(slot); this.geladen.delete(slot); continue; }
        this.geladen.set(slot, name);
        for (const k of [...this.zuletzt.keys(), ...this.original.keys()]) if (k.startsWith(`${slot}:`)) { this.zuletzt.delete(k); this.original.delete(k); }
      }
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
      const offen = [...soll.entries()].filter(([k, e]) => !ohnePatch.has(e.slot) && (voll || this.zuletzt.get(k) !== e.wert));
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
