// Write path of the SESSION view to the project (POST /proj/aendern): one request at a time, in order. The revision is taken when a write's
// turn comes (the highest of the page's own and the one the last answer made), so Solo then Arm never send a stale rev. A 409 rev_veraltet
// asks the server for the current revision (aktuelleRev, a direct read: the page's own reload may only be scheduled while writes run), starts the
// reload, pauses a moment like production/writer.js and writes the same absolute value again (1 + 3 attempts). aendere() -> Promise<boolean>.
export const WIEDERHOLUNGEN = 3, WIEDERHOLE_PAUSE_MS = 80;
export function neuerSessionSchreiber({ holeJson, rev, laden = async () => {}, aktuelleRev = async () => null, melde = () => {}, pause = (ms) => new Promise((ok) => setTimeout(ok, ms)) }) {
  let bekannt = null, kette = Promise.resolve();
  const eine = async (label, befehle) => {
    for (let versuch = 0; ; versuch++) {
      const eigene = rev();
      if (!Number.isFinite(eigene) && !Number.isFinite(bekannt)) return false;
      const nimm = Math.max(Number.isFinite(eigene) ? eigene : -Infinity, Number.isFinite(bekannt) ? bekannt : -Infinity);
      let r;
      try { r = await holeJson('/proj/aendern', { rev: nimm, label, befehle }); } catch (e) { r = { status: 0, j: { text: e.message } }; }
      if (r.status === 200) { if (Number.isFinite(r.j?.rev)) bekannt = Math.max(bekannt ?? -Infinity, r.j.rev); return true; }
      if (r.status === 409 && r.j?.fehler === 'rev_veraltet' && versuch < WIEDERHOLUNGEN) {
        bekannt = null;   // the read below decides again
        await pause(WIEDERHOLE_PAUSE_MS);   // the take that made the revision stale may still be being written
        try { await laden(); } catch { /* the owner of the reload shows it */ }
        try { const k = await aktuelleRev(); if (Number.isFinite(k)) bekannt = k; } catch { /* the retry goes with what the page has */ }
        continue;
      }
      melde(`${label} refused: ${r.j?.text ?? r.j?.fehler ?? r.status}`, true);
      return false;
    }
  };
  return { aendere(label, befehle) { const p = kette.then(() => eine(label, befehle)); kette = p.catch(() => false); return p; } };
}
