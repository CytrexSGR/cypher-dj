// Tracker task 9: the routes of the tracker view (registered by areas/proj/area.ts).
//   GET  /tracker/song                                      {lpb, ticks, abschnitte: [{id, nr, name, von_beat, laenge_beats, zeilen,
//                                                            muster: [{spur_id, buchstabe, name, clip_id, verbund?}]}]}
//   GET  /tracker/text?abschnitt=<id>&von=&bis=&spuren=A,B  {text}: a section or a range of rows and tracks in the text form (project/tracker_text.ts)
//   POST /tracker/text {text, rev?}                         writes the rows and tracks the text names: ONE history step, answers like
//                                                            POST /proj/aendern (`?antwort=kurz` too), or {rev, projekt, ohne_aenderung: true} when the
//                                                            text changes nothing; a line that does not parse is argument_ungueltig with `zeile`
//   POST /tracker/import_mod {name?, daten | pfad, bestaetigt?}   IMPORT MOD (task 26): daten is the module as base64, pfad is <sample root>/<rel>.
//                                                            Reads the module (project/mod_import.ts), writes the sample files and ONE bank graph, makes a
//                                                            new tracker module and fills it in ONE history step; answers {slug, bank, rev, bericht, text}.
//                                                            At most 4 MiB (mod_zu_gross, checked before decoding), mod_ungueltig {detail, offset} for a file
//                                                            that is no module. All or nothing: a refusal leaves no sample file, no bank and no project behind
// The pure parts (trackerSong, trackerLesen, trackerSchreiben, modBefehle) take the project or the ProjZugang, so tests need no server.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Route } from '../../http/router.ts';
import { findeGraph } from '../../graphs.ts';
import { fuehreListeAus } from '../../project/commands.ts';
import { leseMod, ModFehler } from '../../project/mod_import.ts';
import { neuesProjekt, pruefeFehler, type Projekt } from '../../project/model.ts';
import { legeBank } from '../../sampler/slots.ts';
import { loeseAuf } from '../../sampler/file.ts';
import { SchnittFehler, type Ordner } from '../../sampler/schnitt.ts';
import { liesBereich, schreibeBereich, TrackerTextFehler } from '../../project/tracker_text.ts';
import type { GeraetFxFn } from '../../project/playback.ts';
import { geraetFx } from '../../devices_parameter.ts';
import { ProjFehler, type Antwort, type ProjSitzung } from './session.ts';
// @ts-ignore plain JS module shared with the page
import { abschnitte, projiziere, trackerEinstellung } from '../../public/tracker/grid_model.js';
// @ts-ignore plain JS module shared with the page: the report of an import in words
import { berichtText } from '../../public/tracker/import.js';

type Quelle = 'andreas' | 'cypher';
interface Zugang {
  offen(): { slug?: string; projekt: Projekt } | null;
  aendern(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort>;
}
const EPS = 1e-9;

// the project of a tracker request: open, and neither the live container nor a workbench module (they have no tracker view)
function pruefe(p: Projekt | null | undefined): Projekt {
  if (!p) throw new ProjFehler(409, 'kein_projekt');
  if (p.live) throw new ProjFehler(409, 'tracker_live');
  if (p.werkbank) throw new ProjFehler(409, 'tracker_werkbank');
  return p;
}
// the English text of a refusal here is built from the parts of the text form, so it comes from a variable; the key is computed to say so
const mitZeile = (t: string, zeile: number): Record<string, unknown> => ({ ['text']: t, ...(zeile > 0 ? { zeile } : {}) });
const ungueltig = (t: string, zeile = 0): ProjFehler => new ProjFehler(400, 'argument_ungueltig', mitZeile(t, zeile));
const alsFehler = (e: unknown): never => {
  if (e instanceof TrackerTextFehler) throw ungueltig(e.message, e.zeile);
  throw e;
};

export function trackerSong(projekt: Projekt): Record<string, unknown> {
  const p = pruefe(projekt);
  const liste = abschnitte(p);
  const e = trackerEinstellung(p);
  const erste = projiziere(p, { abschnitt_id: liste[0].id });                       // the letters do not depend on the section
  const buchstabe = new Map<string, string>(erste.spuren.map((s: { spur_id: string; buchstabe: string }) => [s.spur_id, s.buchstabe]));
  return { lpb: e.lpb, ticks: e.ticks, abschnitte: liste.map((a: { id: string; nr: number; name: string; von_beat: number; laenge_beats: number }) => {
    const bis = a.von_beat + a.laenge_beats;
    const muster = [];
    for (const s of p.spuren) {
      for (const c of s.clips) {
        if (c.art !== 'midi' || c.start_beat < a.von_beat - EPS || c.start_beat >= bis - EPS) continue;
        muster.push({ spur_id: s.id, buchstabe: buchstabe.get(s.id), name: c.name, clip_id: c.id, ...(c.verbund !== undefined ? { verbund: c.verbund } : {}) });
      }
    }
    return { id: a.id, nr: a.nr, name: a.name, von_beat: a.von_beat, laenge_beats: a.laenge_beats, zeilen: Math.round(a.laenge_beats * e.lpb), muster };
  }) };
}

const ganz = (q: URLSearchParams, k: string): number | undefined => {
  const t = q.get(k);
  if (t === null || t === '') return undefined;
  if (!/^\d{1,6}$/.test(t)) throw ungueltig(`${k}: a whole row number is required`);
  return Number(t);
};
// `gf`: the roles of the devices (the device register); the text form shows INS on the tracks whose device has a slot role
export function trackerLesen(projekt: Projekt, q: URLSearchParams, gf: GeraetFxFn = geraetFx): { text: string } {
  const p = pruefe(projekt);
  const id = q.get('abschnitt');
  if (!id) throw ungueltig('abschnitt: a section id (as GET /tracker/song lists them) is required');
  const spuren = q.get('spuren');
  try {
    return { text: liesBereich(p, { abschnitt_id: id, von: ganz(q, 'von'), bis: ganz(q, 'bis'),
      ...(spuren ? { spuren: spuren.split(',').map((x) => x.trim().toUpperCase()).filter((x) => x !== '') } : {}) }, gf) };
  } catch (e) { return alsFehler(e); }
}

export async function trackerSchreiben(zugang: Zugang, d: Record<string, unknown>, quelle: Quelle, gf: GeraetFxFn = geraetFx): Promise<Antwort> {
  const o = zugang.offen();
  const p = pruefe(o?.projekt);
  const fremd = Object.keys(d).find((k) => k !== 'text' && k !== 'rev');
  if (fremd !== undefined) throw ungueltig(`unknown field ${fremd} (text, rev)`);
  if (typeof d.text !== 'string' || d.text === '') throw ungueltig('text: the text form of a section is required');
  if (d.rev !== undefined && !Number.isInteger(d.rev)) throw ungueltig('rev: a whole number expected');
  let r;
  try { r = schreibeBereich(p, d.text, gf); } catch (e) { return alsFehler(e); }
  if (r.befehle.length === 0) return { code: 200, j: { rev: p.rev, projekt: p, ohne_aenderung: true } };
  // the commands were planned against this very project: the rev of this read guards the write unless the caller names one
  return zugang.aendern({ rev: d.rev ?? p.rev, label: r.label, befehle: r.befehle }, quelle);
}

// ---- IMPORT MOD (task 26) ----
export const MOD_MAX = 4 * 1024 * 1024;                                    // the module file, in bytes
export const MOD_KOERPER_MAX = Math.ceil(MOD_MAX * 4 / 3) + 64 * 1024;    // the JSON body with the file as base64

/** Pure. The command list that makes the parsed project in a fresh tracker project (marker only): tempo, ticks, the sections, one track per channel on
 *  the bank `bank`, the clips (the first member of a pattern with its notes and effects, later members empty and then linked to it) and the loop range.
 *  The ids the commands hand out (`s1`, `c1`, ...) are the ones the parser numbered, as both count from 1 in the same order. */
export function modBefehle(p: Projekt, bank: string): unknown[] {
  const b: unknown[] = [];
  if (p.tempo_bpm !== 120) b.push({ befehl: 'tempo_setzen', bpm: p.tempo_bpm });
  if (p.tracker?.ticks !== undefined) b.push({ befehl: 'tracker_setzen', ticks: p.tracker.ticks });
  (p.tracker?.abschnitte ?? []).forEach((a, i) => {
    const zeilen = Math.round(a.laenge_beats * 4);                        // the parser works at LPB 4
    if (i === 0) {
      b.push({ befehl: 'abschnitt_laenge', id: 'a1', zeilen });
      if (a.name !== undefined) b.push({ befehl: 'abschnitt_umbenennen', id: 'a1', name: a.name });
    } else b.push({ befehl: 'abschnitt_neu', zeilen, ...(a.name !== undefined ? { name: a.name } : {}) });
  });
  p.spuren.forEach((s, i) => {
    b.push({ befehl: 'spur_neu', art: 'instrument', name: s.name, geraet: { art: 'intern', name: 'bk', graph: bank, parameter: {} } },
      { befehl: 'spur_aendern', spur_id: `s${i + 1}`, fader_db: s.fader_db, pan: s.pan });
  });
  let clipNr = 0;
  p.spuren.forEach((s, i) => {
    const erste = new Map<string, string>();                              // pattern -> id of its first member
    for (const c of s.clips) {
      if (c.art !== 'midi') continue;
      const id = `c${++clipNr}`, mit = c.verbund === undefined ? undefined : erste.get(c.verbund);
      const noten = mit !== undefined ? [] : c.noten.map(({ id: _id, ...n }) => n);
      b.push({ befehl: 'clip_neu', spur_id: `s${i + 1}`, art: 'midi', name: c.name, start_beat: c.start_beat, laenge_beats: c.laenge_beats,
        ...(noten.length > 0 ? { noten } : {}) });
      if (mit !== undefined) { b.push({ befehl: 'clip_verknuepfen', clip_id: id, mit }); continue; }
      if (c.fx !== undefined && c.fx.length > 0) b.push({ befehl: 'fx_setzen', clip_id: id, eintraege: c.fx.map((e) => ({ ...e })) });
      if (c.verbund !== undefined) erste.set(c.verbund, id);
    }
  });
  if (p.loop.bis_beat - p.loop.von_beat >= 1) b.push({ befehl: 'loop_setzen', an: p.loop.an, von_beat: p.loop.von_beat, bis_beat: p.loop.bis_beat });
  return b;
}

const base64Bytes = (t: string): number => Math.floor(t.length * 3 / 4) - (t.endsWith('==') ? 2 : t.endsWith('=') ? 1 : 0);
const zuGross = (): ProjFehler => new ProjFehler(413, 'mod_zu_gross', { text: `the module file is larger than ${MOD_MAX / 1048576} MiB`, grenze: MOD_MAX });
const nameOhneEndung = (n: string): string => n.replace(/\.mod$/i, '').trim().slice(0, 80);

/** The module of the request as bytes and the name it suggests; refuses before anything is decoded or read when it is over the limit. */
function modBytes(d: Record<string, unknown>, ordner: Ordner): { bytes: Uint8Array; name: string } {
  const fremd = Object.keys(d).find((k) => !['name', 'daten', 'pfad', 'bestaetigt'].includes(k));
  if (fremd !== undefined) throw ungueltig(`unknown field ${fremd} (name, daten, pfad)`);
  if ((d.daten === undefined) === (d.pfad === undefined)) {
    throw ungueltig('exactly one of daten (the module as base64) and pfad (<sample root>/<rel>) is required');
  }
  if (d.name !== undefined && typeof d.name !== 'string') throw ungueltig('name: a text expected');
  const gegeben = typeof d.name === 'string' ? nameOhneEndung(d.name) : '';
  if (d.daten !== undefined) {
    if (typeof d.daten !== 'string' || d.daten === '') throw ungueltig('daten: the module as a base64 text is required');
    if (base64Bytes(d.daten) > MOD_MAX) throw zuGross();                  // the size is read from the length: nothing is decoded yet
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(d.daten)) throw ungueltig('daten: not valid base64');
    return { bytes: Buffer.from(d.daten, 'base64'), name: gegeben };
  }
  if (typeof d.pfad !== 'string' || d.pfad === '') throw ungueltig('pfad: <sample root>/<rel> expected');
  const i = d.pfad.indexOf('/');
  let datei: string;
  try { datei = loeseAuf(i < 0 ? d.pfad : d.pfad.slice(0, i), i < 0 ? '' : d.pfad.slice(i + 1), ordner); }   // refuses what lies outside the roots
  catch (e) { if (e instanceof SchnittFehler) throw new ProjFehler(e.code, e.grund, { detail: e.text }); throw e; }
  let st: fs.Stats | null = null;
  try { st = fs.statSync(datei); } catch { /* checked below */ }
  if (st === null || !st.isFile()) throw new ProjFehler(404, 'quelle_unbekannt', { text: `${path.basename(datei)} is not a file` });
  if (st.size > MOD_MAX) throw zuGross();                                 // the size is read from the file system: nothing is read yet
  return { bytes: fs.readFileSync(datei), name: gegeben || nameOhneEndung(path.basename(datei)) };
}

type Sitzung = Pick<ProjSitzung, 'neu' | 'aendern' | 'oeffnen' | 'schliessen' | 'loeschen'>;
export interface ImportOpt {
  sitzung: Sitzung;
  zugang: { offen(): { slug?: string; projekt: Projekt } | null };
  ordner: () => Ordner;
  kiGestoppt: () => boolean;
}

/** Takes the new module back after a refusal: the previous project is opened again (nothing open before: the new one is closed), then the new module is
 *  moved to the bin of the project folder and the bin entry is removed (it was made a moment ago by this very import). Never throws. */
async function verwirf(s: Sitzung, slug: string, vorher: string | null, quelle: Quelle): Promise<void> {
  try {
    if (vorher !== null) await s.oeffnen(vorher, quelle, true); else await s.schliessen(quelle, true);
    const r = await s.loeschen(slug, quelle);
    const korb = (r.j as { papierkorb?: string } | null)?.papierkorb;
    if (r.code === 200 && typeof korb === 'string' && path.basename(path.dirname(korb)) === '.papierkorb') fs.rmSync(korb, { recursive: true, force: true });
  } catch { /* the refusal that started this is the one to report */ }
}

/** IMPORT MOD. Steps: read the request and the module (nothing written yet), write the sample files and the bank graph, check the command list on a
 *  scratch project (a refusal removes the bank again), make the tracker module (`/proj/neu` semantics), fill it with ONE `aendern`. A refusal after the new
 *  module was made takes the previous project back and removes the new module with its folder, then the bank. */
export async function trackerImportMod(o: ImportOpt, d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
  const roh = modBytes(d, o.ordner());
  if (quelle === 'cypher' && o.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
  let erg;
  try { erg = leseMod(roh.bytes); } catch (e) {
    if (e instanceof ModFehler) throw new ProjFehler(400, 'mod_ungueltig', { detail: e.message, offset: e.offset });
    throw e;
  }
  const bank = legeBank(erg.samples);
  const name = roh.name || erg.projekt.name;
  const vorher = o.zugang.offen()?.slug ?? null;
  let neuSlug: string | null = null;
  try {
    const befehle = modBefehle(erg.projekt, bank.name);
    const leer = neuesProjekt(name);                                      // the scratch project: what `/proj/neu` with tracker makes
    leer.tracker = { schema: 1 };
    const probe = fuehreListeAus(leer, befehle, { quelle, graphArt: (n) => findeGraph(n)?.art ?? null }).projekt;
    const f = pruefeFehler(probe);
    if (f !== null) throw new ProjFehler(409, 'projekt_ungueltig', { detail: f });
    const a = await o.sitzung.neu(name, quelle, d.bestaetigt === true, { tracker: true });
    if (a.code !== 200) { bank.zurueck(); return a; }
    const j = a.j as { slug: string; projekt: Projekt };
    neuSlug = j.slug;
    const r = await o.sitzung.aendern({ rev: j.projekt.rev, label: `Import MOD: ${name}`, befehle }, quelle);
    if (r.code !== 200) { await verwirf(o.sitzung, neuSlug, vorher, quelle); bank.zurueck(); return r; }
    return { code: 200, j: { slug: neuSlug, bank: bank.name, rev: (r.j as { rev: number }).rev, bericht: erg.bericht, text: berichtText(erg.bericht) } };
  } catch (e) {
    if (neuSlug !== null) await verwirf(o.sitzung, neuSlug, vorher, quelle);
    bank.zurueck();
    throw e;
  }
}

export interface TrackerRoutenOpt {
  zugang: Zugang;
  antworte: (a: http.ServerResponse, f: () => Antwort | Promise<Antwort>) => Promise<void>;
  leseKoerper: (q: http.IncomingMessage, grenze?: number) => Promise<Record<string, unknown>>;
  quelle: () => Quelle;
  kurz: (r: Antwort) => Antwort;       // the short answer of the tools (?antwort=kurz)
  importMod?: Omit<ImportOpt, 'zugang'>;   // IMPORT MOD: the session and the sample roots; absent = the route is not registered
}
export function trackerRouten(o: TrackerRoutenOpt): Route[] {
  return [
    { methode: 'GET', pfad: '/tracker/song', schutz: 'offen',
      handler: (_q, a) => o.antworte(a, () => ({ code: 200, j: trackerSong(o.zugang.offen()?.projekt as Projekt) })) },
    { methode: 'GET', pfad: '/tracker/text', schutz: 'offen',
      handler: (_q, a, url) => o.antworte(a, () => ({ code: 200, j: trackerLesen(o.zugang.offen()?.projekt as Projekt, url.searchParams) })) },
    { methode: 'POST', pfad: '/tracker/text', schutz: 'fremdePost',
      handler: async (q, a, url) => {
        const quelle = o.quelle();
        await o.antworte(a, async () => {
          const r = await trackerSchreiben(o.zugang, await o.leseKoerper(q), quelle);
          if (r.code !== 200 || url.searchParams.get('antwort') !== 'kurz') return r;
          const k = o.kurz(r);
          return (r.j as { ohne_aenderung?: boolean }).ohne_aenderung ? { code: k.code, j: { ...(k.j as object), ohne_aenderung: true } } : k;
        });
      } },
    ...(o.importMod === undefined ? [] : [importRoute(o, o.importMod)]),
  ];
}

// POST /tracker/import_mod: its own body limit for the file as base64; a body over it is answered as mod_zu_gross
function importRoute(o: TrackerRoutenOpt, opt: Omit<ImportOpt, 'zugang'>): Route {
  return { methode: 'POST', pfad: '/tracker/import_mod', schutz: 'fremdePost',
    handler: async (q, a) => {
      const quelle = o.quelle();
      await o.antworte(a, async () => {
        let d: Record<string, unknown>;
        try { d = await o.leseKoerper(q, MOD_KOERPER_MAX); } catch (e) {
          if (e instanceof ProjFehler && e.fehler === 'koerper_zu_gross') throw zuGross();
          throw e;
        }
        return trackerImportMod({ ...opt, zugang: o.zugang }, d, quelle);
      });
    } };
}
