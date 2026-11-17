// Readable-name rule shared with djk/ablage (vectors: docs/interfaces/lesbare_namen.json).
// lower case, umlauts to ae/oe/ue/ss, everything outside [a-z0-9] becomes '-', runs collapse, trim, cut to max, trim again.
export function lesbarerName(text: string, max = 40): string {
  const s = text.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/g, '');
}
