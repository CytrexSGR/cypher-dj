// The extended vocabulary for every item: the preset vocabulary (read, never edited) plus the catalogue instrument classes
// and the measured character words (vokabular_item.json). Answer of GET /tags/vokabular.
import fs from 'node:fs';
import { ladeVokabular, type Vokabular } from '../presets/vocabulary.ts';
import type { ItemVokabular } from './model.ts';
import { EINWERTIG } from './model.ts';

interface Zusatz { version: number; typ_katalog: string[]; charakter_gemessen: string[]; tempo: { min: number; max: number } }
const ZUSATZ_DATEI = new URL('./vokabular_item.json', import.meta.url);
let cache: { zusatz: Zusatz; preset: Vokabular; vok: ItemVokabular } | null = null;

function lade(): NonNullable<typeof cache> {
  if (cache) return cache;
  const zusatz = JSON.parse(fs.readFileSync(ZUSATZ_DATEI, 'utf8')) as Zusatz;
  const preset = ladeVokabular();
  const typ = new Set<string>(zusatz.typ_katalog);
  for (const fam of Object.values(preset.inhalt.familien)) for (const art of Object.keys(fam)) typ.add(art);
  const vok: ItemVokabular = { typ, charakter: new Set(preset.inhalt.charakter), genre: new Set(preset.inhalt.genre), einsatz: new Set(preset.inhalt.einsatz) };
  return (cache = { zusatz, preset, vok });
}

export const itemVokabular = (): ItemVokabular => lade().vok;

export interface VokabularWort { wort: string; bedeutung?: string; gegenpol?: string; gemessen?: true }
export interface VokabularArt { art: string; einwertig: boolean; frei?: true; bedeutung?: string; woerter: VokabularWort[] }

export function vokabularAntwort(): { version: number; preset_version: number; arten: VokabularArt[] } {
  const { zusatz, preset, vok } = lade();
  const gemessen = new Set(zusatz.charakter_gemessen);
  const gegenpol = new Map<string, string>();
  for (const [a, b] of preset.inhalt.gegensaetze) { gegenpol.set(a, b); gegenpol.set(b, a); }
  const einfach = (s: ReadonlySet<string>): VokabularWort[] => [...s].sort().map((wort) => ({ wort }));
  const ein = (art: string): boolean => (EINWERTIG as readonly string[]).includes(art);
  const tonarten: VokabularWort[] = [];
  for (let n = 1; n <= 12; n++) for (const b of ['A', 'B']) tonarten.push({ wort: `${n}${b}` });
  const arten: VokabularArt[] = [
    { art: 'typ', einwertig: false, woerter: einfach(vok.typ) },
    { art: 'charakter', einwertig: false, woerter: preset.inhalt.charakter.map((wort) => ({
      wort, bedeutung: preset.inhalt.bedeutung[wort]?.sinn, ...(gegenpol.has(wort) ? { gegenpol: gegenpol.get(wort) } : {}), ...(gemessen.has(wort) ? { gemessen: true as const } : {}) })) },
    { art: 'genre', einwertig: false, woerter: preset.inhalt.genre.map((wort) => ({ wort })) },
    { art: 'einsatz', einwertig: false, woerter: preset.inhalt.einsatz.map((wort) => ({ wort })) },
    { art: 'energie', einwertig: ein('energie'), woerter: [1, 2, 3, 4, 5].map((n) => ({ wort: String(n) })) },
    { art: 'tonart', einwertig: ein('tonart'), woerter: tonarten },
    { art: 'tempo', einwertig: ein('tempo'), bedeutung: `whole beats per minute, ${zusatz.tempo.min} to ${zusatz.tempo.max}`, woerter: [] },
    { art: 'frei', einwertig: false, frei: true, bedeutung: 'free words: lower case, digits, space and hyphen, 1 to 24 characters', woerter: [] },
  ];
  return { version: zusatz.version, preset_version: preset.version, arten };
}
