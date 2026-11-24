// Tag model (B19..B21): item ids and tag grammar. The server never repairs input: a tag typed with capitals, spaces or an
// umlaut is rejected, the client trims and lower-cases first.
import { PRESET_ID } from '../presets/preset_id.ts';
import { KIT_NAME } from '../project/model.ts';
import { SLUG } from '../collection.ts';
import { LOOP_NAME } from '../loops.ts';

export type TagHerkunft = 'gemessen' | 'abgeleitet' | 'nutzer' | 'agent';
export type ItemArt = 'datei' | 'preset' | 'kit' | 'geraet' | 'projekt' | 'take' | 'export' | 'loop';
export const ITEM_ARTEN: readonly ItemArt[] = ['datei', 'preset', 'kit', 'geraet', 'projekt', 'take', 'export', 'loop'];
export const EINWERTIG = ['tempo', 'tonart', 'energie'] as const;
export const TAG_ARTEN = ['typ', 'charakter', 'genre', 'einsatz', 'energie', 'tonart', 'tempo', 'frei'] as const;
export const FREI = /^[a-z0-9][a-z0-9 -]{0,23}$/;   // the preset TAG rule
const TONART = /^(1[0-2]|[1-9])[AB]$/;
const GERAET = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DATEI_TEIL = /^[^/\u0000-\u001f\u007f]{1,200}$/;
const WORT = /^[a-z][a-z0-9_]*$/;

export interface ItemVokabular { typ: ReadonlySet<string>; charakter: ReadonlySet<string>; genre: ReadonlySet<string>; einsatz: ReadonlySet<string> }

export class TagFehler extends Error {
  readonly code: number; readonly grund: string; readonly wer?: string;
  constructor(code: number, grund: string, wer?: string) { super(grund); this.code = code; this.grund = grund; this.wer = wer; }
}

// The id as the route contract names it; null when it is not one
export function pruefeItemId(id: unknown): { art: ItemArt; rest: string } | null {
  if (typeof id !== 'string') return null;
  const i = id.indexOf(':');
  if (i < 1) return null;
  const art = id.slice(0, i) as ItemArt, rest = id.slice(i + 1);
  const ok = (b: boolean) => (b ? { art, rest } : null);
  switch (art) {
    case 'datei': return ok(/^[0-9a-f]{64}$/.test(rest));
    case 'preset': return ok(PRESET_ID.test(rest));
    case 'kit': return ok(KIT_NAME.test(rest));
    case 'geraet': return ok(GERAET.test(rest));
    case 'projekt': return ok(SLUG.test(rest));
    case 'loop': return ok(LOOP_NAME.test(rest));
    case 'take': case 'export': {
      const j = rest.indexOf('/');
      if (j < 1) return null;
      const datei = rest.slice(j + 1);
      return ok(SLUG.test(rest.slice(0, j)) && DATEI_TEIL.test(datei) && !datei.startsWith('.'));
    }
    default: return null;
  }
}

// `<art>:<word>`; the word must exist in the closed lists, `frei` follows the free-tag rule
export function pruefeTag(s: unknown, v: ItemVokabular): { art: string; wort: string } | null {
  if (typeof s !== 'string') return null;
  const i = s.indexOf(':');
  if (i < 1) return null;
  const art = s.slice(0, i), wort = s.slice(i + 1);
  switch (art) {
    case 'typ': return WORT.test(wort) && v.typ.has(wort) ? { art, wort } : null;
    case 'charakter': return WORT.test(wort) && v.charakter.has(wort) ? { art, wort } : null;
    case 'genre': return WORT.test(wort) && v.genre.has(wort) ? { art, wort } : null;
    case 'einsatz': return WORT.test(wort) && v.einsatz.has(wort) ? { art, wort } : null;
    case 'energie': return /^[1-5]$/.test(wort) ? { art, wort } : null;
    case 'tonart': return TONART.test(wort) ? { art, wort } : null;
    case 'tempo': return /^[1-9][0-9]{1,2}$/.test(wort) && Number(wort) >= 40 && Number(wort) <= 220 ? { art, wort } : null;
    case 'frei': return FREI.test(wort) ? { art, wort } : null;
    default: return null;
  }
}
