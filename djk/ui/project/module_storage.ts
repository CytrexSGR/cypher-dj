// Live module store (plan live-module task 3, minimal; the library of task 10 builds on it): every module is saved as
// <base>/<id>/modul.json (the subtree of the module group, its origin, relative audio paths) plus copies of its audio files in <id>/audio/<sha256>.<ext>.
// The base is $CYPHERDJ_MODULE or ~/.config/cypherdj/module; tests pass their own. The id is given ONCE at export (neueModulId, stored as modul.id) and
// stays with the module: saving it again overwrites its own modul.json and copies only missing audio, while exporting the same loop again (or the same
// loop into A and B) is a new module with its own folder. A group without modul.id (no origin from the export) uses the content hash (modulId).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_BK_SPUREN, MAX_GRUPPEN, MAX_KIT_GERAETE, MAX_SPUREN, istBlendZiel, istKettenZiel, neueId } from './model.ts';
import type { Gruppe, Herkunft, ModulHerkunft, Projekt, Spur } from './model.ts';
import { liveSlots } from './live.ts';

export const MODUL_FORMAT = 1;

export function modulBasis(): string {
  return process.env.CYPHERDJ_MODULE || path.join(os.homedir(), '.config', 'cypherdj', 'module');
}

// One id per export: the content hash mixed with the export time and a counter, so the same loop exported twice never shares a folder
export function neueModulId(m: NonNullable<Gruppe['modul']>, zaehler: number, jetzt: Date = new Date()): string {
  const roh = `${modulId(m)}|${jetzt.toISOString()}|${zaehler}|${crypto.randomBytes(4).toString('hex')}`;
  return crypto.createHash('sha256').update(roh).digest('hex').slice(0, 16);
}

export function modulId(m: NonNullable<Gruppe['modul']>): string {
  const roh = [m.quelle_sha256, m.fassung, m.von_beat, m.laenge_beats].join('|');
  return crypto.createHash('sha256').update(roh).digest('hex').slice(0, 16);
}

// The group tree of a module: the top group and all groups below it (parents before children), the tracks that feed any of them
export function modulBaum(p: Projekt, gruppeId: string): { gruppen: Gruppe[]; spuren: Spur[] } {
  const top = p.gruppen.find((g) => g.id === gruppeId);
  if (!top) throw new Error(`group ${gruppeId} does not exist`);
  const gruppen: Gruppe[] = [top];
  for (let i = 0; i < gruppen.length; i++) for (const g of p.gruppen) if (g.ausgang?.id === gruppen[i].id) gruppen.push(g);
  const ids = new Set(gruppen.map((g) => g.id));
  return { gruppen, spuren: p.spuren.filter((s) => s.ausgang !== undefined && ids.has(s.ausgang.id)) };
}

export interface AblageOptionen { basis?: string; jetzt?: () => Date }

const minimaleHerkunft = (name: string, jetzt?: () => Date): Pick<ModulHerkunft, 'titel' | 'datum'> =>
  ({ titel: name, datum: (jetzt?.() ?? new Date()).toISOString().slice(0, 10) });
const inhaltsId = (b: { gruppen: Gruppe[]; spuren: Spur[] }): string =>
  crypto.createHash('sha256').update(JSON.stringify([b.gruppen, b.spuren])).digest('hex').slice(0, 16);

export function speichereModul(projekt: Projekt, gruppeId: string, o: AblageOptionen = {}): { id: string; pfad: string } {
  const baum = modulBaum(projekt, gruppeId);
  const top0 = baum.gruppen[0];
  if (top0.ausgang !== undefined) throw new Error(`group ${gruppeId} is no top group`);
  // task 10: any top group can be saved; without a module origin the origin is minimal (title = group name, date) and the id comes from the content
  const modul = top0.modul ?? minimaleHerkunft(top0.name, o.jetzt);
  const id = top0.modul ? (top0.modul.id ?? modulId(top0.modul)) : inhaltsId(baum);
  const ordner = path.join(o.basis ?? modulBasis(), id);
  const audio = path.join(ordner, 'audio');
  fs.mkdirSync(audio, { recursive: true });
  const kopiert: { sha256: string; datei: string }[] = [], fehlt: string[] = [];
  const spuren = structuredClone(baum.spuren);
  for (const s of spuren) for (const c of s.clips) {
    if (c.art !== 'audio') continue;
    const sha = c.quelle.sha256, quelle = c.quelle.pfad_hinweis;
    const datei = `audio/${sha}${path.extname(quelle) || '.wav'}`;
    const ziel = path.join(ordner, datei);
    if (!fs.existsSync(ziel)) {
      if (!fs.existsSync(quelle)) { if (!fehlt.includes(sha)) fehlt.push(sha); continue; }
      const tmp = `${ziel}.tmp-${process.pid}`;
      fs.copyFileSync(quelle, tmp);
      fs.renameSync(tmp, ziel);
    }
    if (!kopiert.some((k) => k.sha256 === sha)) kopiert.push({ sha256: sha, datei });
    c.quelle.pfad_hinweis = datei;                                              // relative to the module folder
  }
  const inhalt = { format: MODUL_FORMAT, id, gespeichert: new Date().toISOString(), slot: top0.modul?.slot, herkunft: modul,
    gruppen: structuredClone(baum.gruppen), spuren, audio: kopiert, ...(fehlt.length ? { audio_fehlt: fehlt } : {}) };
  const pfad = path.join(ordner, 'modul.json');
  fs.writeFileSync(`${pfad}.tmp-${process.pid}`, JSON.stringify(inhalt, null, 2));
  fs.renameSync(`${pfad}.tmp-${process.pid}`, pfad);
  return { id, pfad };
}

// --- Library (plan live-module task 10): list, search by origin, read, place -------------------------------------------------------------------
export interface ModulEintrag {
  id: string; titel: string; kuenstler: string; tonart: string; datum: string; set: string; bpm: number | null; laenge_beats: number | null;
  quelle_sha256: string | null; slot: 'A' | 'B' | null; gespeichert: string; stems: boolean; audio_fehlt: boolean; spuren: number;
}
export interface ModulDateiInhalt {
  format: number; id: string; gespeichert: string; slot?: 'A' | 'B'; herkunft: Partial<ModulHerkunft>; gruppen: Gruppe[]; spuren: Spur[];
  audio: { sha256: string; datei: string }[]; audio_fehlt?: string[];
}
const ID_FORM = /^[0-9a-f]{16}$/;

export function liesModul(id: string, basis = modulBasis()): ModulDateiInhalt | null {
  if (!ID_FORM.test(id)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(basis, id, 'modul.json'), 'utf8')) as ModulDateiInhalt;
    return j.format === MODUL_FORMAT && Array.isArray(j.gruppen) && Array.isArray(j.spuren) && j.gruppen.length > 0 ? j : null;
  } catch { return null; }
}
const eintragVon = (j: ModulDateiInhalt): ModulEintrag => {
  const h = j.herkunft ?? {};
  return { id: j.id, titel: h.titel ?? j.gruppen[0].name, kuenstler: h.kuenstler ?? '', tonart: h.tonart ?? '', datum: h.datum ?? '', set: h.set ?? '',
    bpm: h.bpm ?? null, laenge_beats: h.laenge_beats ?? null, quelle_sha256: h.quelle_sha256 ?? null, slot: j.slot ?? null, gespeichert: j.gespeichert,
    stems: j.gruppen.length > 1, audio_fehlt: (j.audio_fehlt?.length ?? 0) > 0, spuren: j.spuren.length };
};
// Newest first. `q`: every word must occur (case-insensitive) in the source title (a group saved without origin: its name), artist, set, date
// or key; `sha`: the source track.
export function listeModule(o: { basis?: string; q?: string; sha?: string } = {}): ModulEintrag[] {
  const basis = o.basis ?? modulBasis();
  let namen: string[] = [];
  try { namen = fs.readdirSync(basis); } catch { return []; }
  const woerter = (o.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const aus: ModulEintrag[] = [];
  for (const n of namen) {
    const j = liesModul(n, basis);
    if (!j) continue;
    const e = eintragVon(j);
    if (o.sha && e.quelle_sha256 !== o.sha) continue;
    const heu = [e.titel, e.kuenstler, e.set, e.datum, e.tonart].join('\n').toLowerCase();
    if (woerter.every((w) => heu.includes(w))) aus.push(e);
  }
  return aus.sort((a, b) => (a.gespeichert < b.gespeichert ? 1 : a.gespeichert > b.gespeichert ? -1 : a.id < b.id ? -1 : 1));
}

export class EinsetzFehler extends Error {
  readonly code: number; readonly fehler: string; readonly extra: Record<string, unknown>;
  constructor(code: number, fehler: string, extra: Record<string, unknown> = {}) { super(fehler); this.code = code; this.fehler = fehler; this.extra = extra; }
}
export interface EinsetzOptionen {
  modulOrdner: string;          // <base>/<id>
  audioZiel: string;            // folder in the target project the audio copies go to
  quelle: Herkunft;
  slot?: 'A' | 'B';             // live project only: wanted slot, else the first free one
  jetzt?: () => Date;
}
// Places the module tree as a top group into a copy of `p0`: new ids and numbers for every group, track and clip, the audio copied into the project
// (a project backup then holds everything; the hint is an absolute path like the one of every other clip), `modul.slot` dropped in a production project
// and set to a free slot in the live container (whose module fader is closed, as after an export). One project value = one undo step for the caller.
export function setzeModulEin(p0: Projekt, j: ModulDateiInhalt, o: EinsetzOptionen): { projekt: Projekt; gruppeId: string; audio_fehlt: string[] } {
  const nicht = (text: string): EinsetzFehler => new EinsetzFehler(409, 'modul_nicht_einsetzbar', { text });
  // sends, inserts and racks hang on pools of the project (returns, stage slots) and are not carried; lanes only without chain targets (blend and plain)
  const traegt = (x: Gruppe | Spur): boolean => !!(x.sends?.length || x.inserts?.length || x.rack);
  const kette = (x: Gruppe | Spur): boolean => !!x.automation?.some((l) => istKettenZiel(l.ziel));
  for (const g of j.gruppen) if (traegt(g) || kette(g)) throw nicht(`group ${g.name} carries sends, inserts or chain automation`);
  for (const s of j.spuren) {
    if (s.art === 'instrument' && (s.geraet?.art !== 'intern')) throw nicht(`track ${s.name} plays a host or rack instrument`);
    if (traegt(s) || kette(s) || s.takes?.length || s.freeze) throw nicht(`track ${s.name} carries sends, inserts, chain automation, takes or a freeze`);
  }
  const p = structuredClone(p0);
  const bk = (x: Spur): boolean => x.geraet?.art === 'intern' && x.geraet.name === 'bk';
  const kit = (x: Spur): boolean => x.geraet?.art === 'intern' && x.geraet.name === 'kit';
  const zuViele = (zaehle: (x: Spur) => boolean, max: number): boolean => p.spuren.filter(zaehle).length + j.spuren.filter(zaehle).length > max;
  if (p.spuren.length + j.spuren.length > MAX_SPUREN || p.gruppen.length + j.gruppen.length > MAX_GRUPPEN
    || zuViele(bk, MAX_BK_SPUREN) || zuViele(kit, MAX_KIT_GERAETE)) {
    throw new EinsetzFehler(409, 'routing_grenze', { text: `the module needs ${j.spuren.length} free tracks (${j.spuren.filter(bk).length} Baukasten) and `
      + `${j.gruppen.length} free groups` });
  }
  const top = j.gruppen[0];
  let slot: 'A' | 'B' | undefined;
  if (p.live) {
    const belegt = liveSlots(p);
    slot = o.slot ?? (['A', 'B'] as const).find((s) => belegt[s] === undefined);
    if (slot === undefined || belegt[slot] !== undefined) throw new EinsetzFehler(409, 'slot_belegt', { text: 'no free live slot for the module' });
  }
  const frei = (liste: { nr: number }[], max: number): number => Array.from({ length: max }, (_, i) => i + 1).find((n) => !liste.some((x) => x.nr === n))!;
  const gruppenId = new Map<string, string>();
  // lane ids are project wide; the blend target names the group's own id, so it moves with it
  const neueLanen = (x: Gruppe | Spur, eigeneId: string | null): void => {
    for (const l of x.automation ?? []) {
      l.id = neueId(p, 'lane');
      if (eigeneId !== null && istBlendZiel(l.ziel)) l.ziel = `blend:${eigeneId}`;
    }
  };
  for (const g0 of j.gruppen) {
    const g = structuredClone(g0);
    g.id = neueId(p, 'gruppe'); g.nr = frei(p.gruppen, MAX_GRUPPEN);
    gruppenId.set(g0.id, g.id);
    neueLanen(g, g.id);
    if (g0 === top) delete g.ausgang;
    else {
      const ziel = g0.ausgang && gruppenId.get(g0.ausgang.id);
      if (!ziel) throw new EinsetzFehler(409, 'modul_nicht_einsetzbar', { text: `group ${g0.name} has no parent inside the module` });
      g.ausgang = { art: 'gruppe', id: ziel };
    }
    p.gruppen.push(g);
  }
  const neuTop = p.gruppen.find((g) => g.id === gruppenId.get(top.id))!;
  const fehlt: string[] = [];
  const kopiert = new Map<string, string>();
  for (const s0 of j.spuren) {
    const s = structuredClone(s0);
    s.id = neueId(p, 'spur'); s.nr = frei(p.spuren, MAX_SPUREN); s.von = o.quelle;
    delete s.aufnahme; delete s.gruppe;
    neueLanen(s, null);
    const ziel = s0.ausgang && gruppenId.get(s0.ausgang.id);
    if (!ziel) throw new EinsetzFehler(409, 'modul_nicht_einsetzbar', { text: `track ${s0.name} feeds no group of the module` });
    s.ausgang = { art: 'gruppe', id: ziel };
    for (const c of s.clips) {
      c.id = neueId(p, 'clip');
      if (c.art !== 'audio') continue;
      c.dekodiert = 'nein';
      const sha = c.quelle.sha256;
      if (!kopiert.has(sha)) {
        const rel = c.quelle.pfad_hinweis, aus = path.join(o.modulOrdner, rel), nach = path.join(o.audioZiel, `modul-${sha}${path.extname(rel) || '.wav'}`);
        if (!fs.existsSync(nach)) {
          if (fs.existsSync(aus)) {
            fs.mkdirSync(o.audioZiel, { recursive: true });
            fs.copyFileSync(aus, `${nach}.tmp-${process.pid}`); fs.renameSync(`${nach}.tmp-${process.pid}`, nach);
          } else if (!fehlt.includes(sha)) fehlt.push(sha);
        }
        kopiert.set(sha, nach);
      }
      c.quelle.pfad_hinweis = kopiert.get(sha)!;
    }
    p.spuren.push(s);
  }
  const jetzt = o.jetzt?.() ?? new Date();
  if (p.live) {
    const alt = top.modul ?? { quelle_sha256: '0'.repeat(64), titel: top.name, fassung: '0', basis_bpm: p0.tempo_bpm, von_beat: 0,
      laenge_beats: 64, bpm: p0.tempo_bpm, datum: jetzt.toISOString().slice(0, 10) };
    neuTop.modul = { ...structuredClone(alt), slot };
    neuTop.fader_db = 0;                                                     // the channel pad/N is the only gain (DJ view places, decision 9)
  } else if (neuTop.modul) delete neuTop.modul.slot;
  // an inserted module is a new module: its own store id (the one of the file stays with the file)
  if (neuTop.modul) neuTop.modul.id = neueModulId(neuTop.modul, p.gruppen.length, jetzt);
  return { projekt: p, gruppeId: neuTop.id, audio_fehlt: fehlt };
}
