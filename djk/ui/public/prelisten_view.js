// Library preview listening (vorhoeren): headphone cue state and buttons.
import { vorhoerCursor } from './browse.js';
import { laengeFrames, SR } from './wave.js';
import { stz } from './browse_table.js';
import { $$, el, melde, postJson } from './page_state.js';
// ---------- Vorhören (S7): Leertaste spielt/stoppt das gewählte Element über den Cue des Kerns (Kopfhörer), nie auf dem Master ----------
let vorhoerUhr = null;
const VORHOER_TEXT = { kein_kopfhoerer: 'Headphones not connected — plug in the FiiO (cue output has no link). Nothing plays on the speakers.',
  nur_live: 'Ableton Live only (encrypted) — cannot be previewed here', datei_fehlt: 'File not found (drive unplugged?)',
  kern_ohne_vorhoerkanal: 'Preview needs the updated audio engine (restart pending) — nothing was played' };
export const hoerId = (t) => t.sha ?? t.material_id;                  // Listen-Zeilen tragen bei Tracks nur material_id (Review S7 m3)
export function zeigeHoert() {
  const t = stz.treffer[stz.wahl];
  for (const b of $$('.st-vorhoeren')) { const an = !!t && stz.hoert === hoerId(t); b.textContent = an ? '■' : '▶'; b.classList.toggle('an', an); }
}
let vorhoerNr = 0;                                             // Laufnummer je Anfrage (Review S7 B1): eine überholte Antwort fasst weder Poll noch Zustand der neuesten an
export async function vorhoeren(t) {
  if (!t || t.typ === 'strudel') return;
  const nr = ++vorhoerNr;
  stz.wartet = hoerId(t);                                      // F1: bis zur Antwort gilt die Anfrage in der Luft als „aktiv“, ↓ lenkt sie um
  let r;
  try { r = await postJson('/vorhoeren', t.sha ? { sha: t.sha } : { mid: t.material_id }); }
  catch (e) { if (nr === vorhoerNr) { stz.wartet = null; melde(`Preview: ${e.message}`, true); } return; }
  if (nr !== vorhoerNr) return;
  stz.wartet = null;
  if (!r.ok) {
    clearInterval(vorhoerUhr); stz.hoert = null; zeigeHoert();
    return melde(VORHOER_TEXT[r.j.fehler] ?? (r.j.fehler?.startsWith('format:') ? `Cannot play this file (${r.j.fehler.slice(8)})` : `Preview: ${r.j.fehler}`), true);
  }
  stz.hoert = hoerId(t); zeigeHoert();
  if (r.j.gekuerzt) melde('Long file: the preview covers the first 30 minutes only', false);
  clearInterval(vorhoerUhr);
  vorhoerUhr = setInterval(async () => {
    let s;
    try { s = await (await fetch('/vorhoeren')).json(); } catch { return; }
    if (!s.kopfhoerer) { clearInterval(vorhoerUhr); stz.hoert = null; zeigeHoert(); return melde(VORHOER_TEXT.kein_kopfhoerer, true); }
    if (!s.spielt) { clearInterval(vorhoerUhr); stz.hoert = null; zeigeHoert(); return; }
    const w = stz.detailWelle;                                 // von ladeDetailWelle gesetzt, beim Wechsel der Wahl null (Review S7 m2)
    const wahl = stz.treffer[stz.wahl];
    if (wahl && stz.hoert === hoerId(wahl) && w?.w && s.dauer_s && s.s !== null) w.zeichne(vorhoerCursor(s, laengeFrames(w.w), SR), 0);
  }, 200);
}
export async function vorhoerenStopp() { vorhoerNr++; stz.wartet = null; clearInterval(vorhoerUhr); stz.hoert = null; zeigeHoert(); await postJson('/vorhoeren', { aktion: 'stopp' }); }
export function vorhoerenSpringe(richtung) { return postJson('/vorhoeren', { aktion: 'springe', richtung }); }
export function vorhoerKnoepfe(t) {
  const sp = el('span', 'st-vorhoer-knoepfe');
  const mk = (text, titel, f, klasse = '') => { const b = el('button', `laden ${klasse}`.trim(), text); b.title = titel; b.addEventListener('click', (e) => { e.stopPropagation(); f(); }); sp.append(b); return b; };
  mk('◀◀', 'Jump back (←)', () => { if (stz.hoert) vorhoerenSpringe(-1); });
  mk('▶', 'Preview on headphones (Space)', () => (stz.hoert === hoerId(t) ? vorhoerenStopp() : vorhoeren(t)), 'st-vorhoeren');
  mk('▶▶', 'Jump forward (→)', () => { if (stz.hoert) vorhoerenSpringe(1); });
  return sp;
}
