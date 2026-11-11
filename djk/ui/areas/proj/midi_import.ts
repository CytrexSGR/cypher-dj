// MIDI import over HTTP (POST /proj/midi_import, hand tool proj_midi_import, the page's import dialog): one entry, three jobs.
//   vorschau: true  reads the file and answers the report (tracks, notes, tempo, hints, the proposed instruments) and writes nothing;
//   otherwise       plans the same way and runs the resulting command list through ProjSitzung.aendern: ONE history step (one undo takes it all
//                   back), the same checks, limits and playback swap as every other project change, a refusal changes nothing.
// The file arrives as `daten_b64` (the page) or `pfad` (a local path the server reads, for the hand). Spec: docs/superpowers/specs/2026-11-10-midi-import.md
import fs from 'node:fs';
import path from 'node:path';
import { findeGraph } from '../../graphs.ts';
import { MidiImportFehler, planeImport, type ImportEingabe, type ImportKontext } from '../../project/midi_import.ts';
import { SmfFehler, leseSmf } from '../../project/smf.ts';
import { gmKitVorschau, nimmGmKitZurueck, sorgeFuerGmKit } from './gm_kit.ts';
import { kitDa } from './kits.ts';
import { ProjFehler, type Antwort, type ProjSitzung } from './session.ts';

export const MIDI_DATEI_MAX = 8 * 1024 * 1024;                     // raw bytes of the .mid file
export const MIDI_KOERPER_MAX = Math.ceil(MIDI_DATEI_MAX * 4 / 3) + 64 * 1024;   // the JSON body with the file as base64
type Koerper = Record<string, unknown>;

const graphArt = (name: string): 'instrument' | 'effekt' | null => findeGraph(name)?.art ?? null;

function leseBytes(d: Koerper): { bytes: Uint8Array; name: string } {
  const b64 = d.daten_b64, pfad = d.pfad;
  if ((b64 === undefined) === (pfad === undefined)) throw new ProjFehler(400, 'argument_ungueltig',
    { text: 'exactly one of daten_b64 (the file as base64) and pfad (a local path) is required' });
  if (typeof b64 === 'string') {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new ProjFehler(400, 'argument_ungueltig', { text: 'daten_b64: not valid base64' });
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MIDI_DATEI_MAX) throw new ProjFehler(413, 'midi_datei_zu_gross',
      { text: `the MIDI file is larger than ${MIDI_DATEI_MAX / 1024 / 1024} MiB` });
    const name = typeof d.name === 'string' ? d.name : 'MIDI';
    return { bytes, name: name.replace(/\.(mid|midi|rmi)$/i, '').slice(0, 60) || 'MIDI' };
  }
  if (typeof pfad !== 'string' || !path.isAbsolute(pfad) || !/\.(mid|midi|rmi)$/i.test(pfad)) {
    throw new ProjFehler(400, 'argument_ungueltig', { text: 'pfad: an absolute path ending in .mid, .midi or .rmi is required' });
  }
  let st: fs.Stats;
  try { st = fs.statSync(pfad); } catch { throw new ProjFehler(404, 'midi_datei_fehlt', { text: `no file at ${pfad}` }); }
  if (!st.isFile()) throw new ProjFehler(404, 'midi_datei_fehlt', { text: `${pfad} is not a file` });
  if (st.size > MIDI_DATEI_MAX) throw new ProjFehler(413, 'midi_datei_zu_gross', { text: `the MIDI file is larger than ${MIDI_DATEI_MAX / 1024 / 1024} MiB` });
  let bytes: Buffer;
  try { bytes = fs.readFileSync(pfad); } catch (e) {
    throw new ProjFehler(404, 'midi_datei_fehlt', { text: `cannot read ${pfad} (${(e as NodeJS.ErrnoException).code ?? 'error'})` });
  }
  return { bytes, name: path.basename(pfad).replace(/\.(mid|midi|rmi)$/i, '').slice(0, 60) || 'MIDI' };
}

function eingabeVon(d: Koerper): ImportEingabe {
  const e: ImportEingabe = {};
  if (d.auswahl !== undefined) e.auswahl = d.auswahl as string[];
  if (d.zuordnung !== undefined) {
    if (d.zuordnung === null || typeof d.zuordnung !== 'object' || Array.isArray(d.zuordnung)) throw new ProjFehler(400, 'argument_ungueltig',
      { text: 'zuordnung: an object {part key: device} is required' });
    e.zuordnung = d.zuordnung as ImportEingabe['zuordnung'];
  }
  if (d.tempo !== undefined) e.tempo = d.tempo as ImportEingabe['tempo'];
  if (d.profil !== undefined) e.profil = d.profil as ImportEingabe['profil'];
  return e;
}

export async function midiImport(s: ProjSitzung, d: Koerper, quelle: 'andreas' | 'cypher'): Promise<Antwort> {
  const { bytes, name } = leseBytes(d);
  const vorschau = d.vorschau === true;
  if (d.vorschau !== undefined && typeof d.vorschau !== 'boolean') throw new ProjFehler(400, 'argument_ungueltig',
    { text: 'vorschau: true or false expected' });
  let datei;
  try { datei = leseSmf(bytes); } catch (e) {
    if (e instanceof SmfFehler) throw new ProjFehler(400, e.grund, { detail: e.message });
    throw e;
  }
  const eingabe = eingabeVon(d);
  const offen = s.zugangOffen();
  // the drum kit: planning only LOOKS (the preview model of the kit); the folder `gm` is built once the import is sure to be tried (below)
  const braucht = datei.teile.some((t) => t.kanal === 9 && eingabe.zuordnung?.[`${t.spur}.${t.kanal + 1}`] === undefined);
  const kit = gmKitVorschau();
  const ctx: ImportKontext = { gmKit: kit ? { name: kit.name, noten: kit.noten } : null, graphArt, kitDa };
  let plan;
  try { plan = planeImport(datei, offen?.projekt ?? null, eingabe, ctx); } catch (e) {
    if (e instanceof MidiImportFehler) throw new ProjFehler(e.code, e.grund, { detail: e.message, ...e.extra });
    throw e;
  }
  const bericht: typeof plan.bericht & { datei_name: string; gm_kit_gebaut?: string } = { ...plan.bericht, datei_name: name };
  if (vorschau) return { code: 200, j: { vorschau: true, offen: offen !== null, bericht } };
  if (!plan.bericht.anlegbar) throw new ProjFehler(409, plan.bericht.grund ?? 'midi_zu_viele_spuren', { detail: plan.bericht.grund_text, bericht });
  if (offen === null) throw new ProjFehler(409, 'kein_projekt');
  const rev = d.rev === undefined ? offen.projekt.rev : d.rev;
  // a stale revision is refused before anything is built (the session would say the same)
  if (typeof rev === 'number' && rev !== offen.projekt.rev) throw new ProjFehler(409, 'rev_veraltet', { rev: offen.projekt.rev });
  const vorher = offen.projekt.spuren.length;
  // the kit folder must exist when the commands run (the kit check of spur_neu), so it is built now and taken back if the change is refused
  const gebaut = braucht && kit !== null ? sorgeFuerGmKit() : null;
  const baute = gebaut?.neu === true;
  if (baute) bericht.gm_kit_gebaut = gebaut!.name;
  let r;
  try {
    r = await s.aendern({ rev, label: typeof d.label === 'string' && d.label.trim() ? d.label.slice(0, 200) : `MIDI import: ${name}`,
      befehle: plan.befehle }, quelle);
  } catch (e) {
    if (baute) nimmGmKitZurueck();
    throw e;
  }
  if (r.code !== 200) { if (baute) nimmGmKitZurueck(); return r; }
  const j = r.j as { rev: number; projekt: { spuren: { id: string; clips: { id: string }[] }[] }; kern?: Record<string, unknown>; hinweise?: unknown[] };
  const neu = j.projekt.spuren.slice(vorher);
  const angelegt = bericht.spuren.map((x, i) => ({ schluessel: x.schluessel, name: x.name, spur_id: neu[i]?.id ?? null,
    clip_id: neu[i]?.clips[0]?.id ?? null }));
  return { code: 200, j: { rev: j.rev, kern: j.kern ?? {}, angelegt, bericht, ...(j.hinweise ? { hinweise: j.hinweise } : {}) } };
}
