// Tempo and keylock controls.
import { keylockStand, keylockAnfrage, keylockMeldung } from './messages.js';
import { $, melde, zustand } from './page_state.js';

// Plan Tempo-Folge: Master-Tempo. Enter im Feld oder − / + (Shift: 0,1); der Kern fährt es ab der nächsten Eins
// über einen Takt. Die Ablehnung steht als Meldung da. Laufende Decks folgen im Varispeed (Welle 3, ADR 028).
const TEMPO_GRUND = { bereich: '60 to 200 BPM', ueberlappung: 'a tempo change is already running', karte_voll: 'too many tempo changes queued' };
let tempoZiel = null;   // Code-Review F6: − / + rechnen vom zuletzt bestellten Ziel, nicht vom Momentanwert in der Rampe
async function setzeTempo(bpm) {
  try {
    const r = await fetch('/tempo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bpm }) });
    const j = await r.json();
    window.djkGesendet.push({ tempo: bpm, code: r.status, antwort: j });
    if (!r.ok) melde(`Tempo refused: ${TEMPO_GRUND[j.fehler] ?? j.fehler}`, true);
    else if (j.quittung?.status === 6) melde(`Tempo refused: ${TEMPO_GRUND[j.quittung.grund] ?? j.quittung.grund}`, true);
    else if (!j.quittung) melde('Tempo: no answer from the core', true);   // Code-Review F5
    else tempoZiel = bpm;
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
}
// Keylock 3 (Plan 2026-10-06-keylock-echtzeit.md, Fassung 4): EIN globaler Knopf `keylock` (Vorgabe an) für Decks und
// Loop-Boxen; gesetzt über /regler (sofort, Quelle andreas), angezeigt aus /e/regler. 3b: ohne Meldung unbekannt (KEY ?).
export function zeigeKeylock() {
  const k = $('#keylock');
  if (!k) return;
  const an = keylockStand(zustand.regler);
  k.classList.toggle('an', an === true);
  k.classList.toggle('unbekannt', an === null);
  k.textContent = an === null ? 'KEY ?' : 'KEY';
  k.setAttribute('aria-pressed', an === null ? 'mixed' : String(an));
}
async function schalteKeylock() {
  const body = keylockAnfrage(keylockStand(zustand.regler));
  try {
    const r = await fetch('/regler', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    window.djkGesendet.push({ keylock: body.nach, code: r.status, antwort: j });
    const m = keylockMeldung(r.status, j);
    if (m) melde(m, true);
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
}

export function bindeTempo() {
  $('#keylock')?.addEventListener('click', schalteKeylock);
  zeigeKeylock();
  const f = $('#bpm');
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = Number(f.value.replace(',', '.')); f.blur(); if (Number.isFinite(v)) setzeTempo(v); else melde('Tempo: not a number', true); }
    if (e.key === 'Escape') f.blur();
  });
  f.addEventListener('focus', () => f.select());
  for (const [id, d] of [['#bpm-minus', -1], ['#bpm-plus', 1]]) {
    $(id).addEventListener('click', (e) => setzeTempo(Math.round(((tempoZiel ?? zustand.bpm ?? 128) + d * (e.shiftKey ? 0.1 : 1)) * 100) / 100));
  }
}
