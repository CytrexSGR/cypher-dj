// Shared text helpers of the page: one date format and one plural rule, so no view invents its own.

// "22 Nov 2026, 23:01"; a dash for a missing or invalid value.
export function datumText(wert) {
  if (wert === null || wert === undefined || wert === '') return '–';
  const d = wert instanceof Date ? wert : new Date(wert);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(d).replace(/,?\s+at\s+/, ', ');
}

// "1 slice", "2 slices", "0 slices"; mehrzahl defaults to einzahl + 's'.
export function zaehlText(n, einzahl, mehrzahl = `${einzahl}s`) {
  return `${n} ${n === 1 ? einzahl : mehrzahl}`;
}
