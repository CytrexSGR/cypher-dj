// Source file for "prepare a deck track" (POST /mediathek/vorbereiten and the set queue).
// With the media library database present the media library answers, unchanged. Without it (a stranger's machine) the
// catalog djk-bibliothek built answers: the file must lie inside a folder that catalog scanned.
import fs from 'node:fs';
import path from 'node:path';
import { KatalogFehler, type Katalog } from './catalog.ts';
import { MediathekFehler, type Mediathek } from './media_library.ts';

const MID = /^[0-9a-f]{16}$/;
const ERBAUER = 'djk-bibliothek';   // djk/bibliothek/catalog_build.py ERBAUER; a catalog of any other builder has its own prepare path

const echt = (p: string): string | null => { try { return fs.realpathSync(p); } catch { return null; } };
const innen = (datei: string, wurzel: string): boolean => { const r = path.relative(wurzel, datei); return r !== '' && r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };

export function vorbereitQuelle(m: Mediathek, k: Katalog, mid: string, bestand: Set<string>): { pfad: string; titel: string; vorhanden?: string } {
  if (m.vorhanden()) return m.quelle(mid, bestand);
  if (!MID.test(mid)) throw new MediathekFehler(400, 'material_id_ungueltig');
  let zeilen; let herkunft;
  try { herkunft = k.herkunft(); zeilen = k.eintraegeMid(mid); }
  catch (e) { if (e instanceof KatalogFehler) throw new MediathekFehler(e.code, e.fehler); throw e; }
  // A catalog of foreign origin has its own prepare path (the media library); without it nothing is prepared from here.
  if (herkunft.erbauer !== ERBAUER) throw new MediathekFehler(503, 'mediathek_fehlt');
  if (zeilen.length !== 1) throw new MediathekFehler(404, zeilen.length === 0 ? 'unbekannt' : 'material_id_mehrdeutig');
  const z = zeilen[0];
  if (z.typ !== 'track') throw new MediathekFehler(409, 'kein_track');
  // Another object of the same work already in the stock: no second render
  const da = z.shas.split(' ').map((s) => s.slice(0, 16)).find((s) => s !== mid && MID.test(s) && bestand.has(s));
  if (da !== undefined) return { pfad: '', titel: '', vorhanden: da };
  const pfad = z.pfad;
  if (!pfad || !path.isAbsolute(pfad)) throw new MediathekFehler(409, 'datei_fehlt');
  const ist = echt(pfad);
  if (ist === null) throw new MediathekFehler(409, 'datei_fehlt');
  // Only files below a scanned folder, after resolving links: the catalog is data, not a licence to read any file of the machine
  if (!herkunft.wurzeln.some((w) => { const r = echt(w); return r !== null && innen(ist, r); })) throw new MediathekFehler(409, 'datei_ausserhalb');
  try { if (!fs.statSync(ist).isFile()) throw new Error('no file'); } catch { throw new MediathekFehler(409, 'datei_fehlt'); }
  try { fs.accessSync(ist, fs.constants.R_OK); } catch { throw new MediathekFehler(409, 'datei_nicht_lesbar'); }
  const kopf = [z.kuenstler, z.titel].filter((s) => s).join(' – ');
  return { pfad, titel: kopf ? kopf + (z.mix ? ` - ${z.mix}` : '') : path.basename(pfad, path.extname(pfad)) };
}
