// Checks of the release metadata of a project (`abgabe_meta`): the field list and the value rules. Free of imports on purpose (no file, no process),
// so the model (model.ts) and the commands (commands_transport.ts) can use it; the tags of a delivery file are built in abgabe.ts.

export const META_FELDER = ['titel', 'kuenstler', 'album', 'jahr', 'genre', 'isrc'] as const;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;
const STEUER = /[\u0000-\u001f\u007f]/;

/** Error text for one value of abgabe_meta (field name `f`), or null when it is valid. */
export function metaWertFehler(f: string, v: unknown): string | null {
  if (f === 'jahr') return typeof v === 'number' && Number.isInteger(v) && v >= 1900 && v <= 2100 ? null : 'jahr: an integer from 1900 to 2100 expected';
  if (f === 'isrc') return typeof v === 'string' && ISRC.test(v) ? null : 'isrc: 12 characters like DEXXX2600001 expected (capitals and digits, no hyphens)';
  if (typeof v !== 'string' || v.length < 1 || v.length > 200) return `${f}: text of 1 to 200 characters expected`;
  return STEUER.test(v) ? `${f}: no control characters (line breaks included) allowed` : null;
}

/** Error text for a whole abgabe_meta object (model check), or null. */
export function metaFehler(m: unknown): string | null {
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return 'abgabe_meta: object expected';
  const e = Object.entries(m);
  if (e.length === 0) return 'abgabe_meta: not empty expected (absent when no field is set)';
  for (const [k, v] of e) {
    if (!(META_FELDER as readonly string[]).includes(k)) return `abgabe_meta.${k}: unknown field`;
    const f = metaWertFehler(k, v);
    if (f) return `abgabe_meta.${f}`;
  }
  return null;
}
