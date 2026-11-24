// The error body of the browser routes of plans 1 to 7: { ok: false, grund, text, fehler } (browser routes contract).
// `fehler` repeats `grund` because existing routes answer it; the page reads `grund ?? fehler`.
export function fehlerKoerper(grund: string, text: string): { ok: false; grund: string; text: string; fehler: string } {
  return { ok: false, grund, text, fehler: grund };
}
