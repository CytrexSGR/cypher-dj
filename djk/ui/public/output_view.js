// Frame timing and the output (ausgang) status.
import { DECKS } from './curves.js';
import { ausgangAnzeige, HAND_PRUEFMODUS_TEXT } from './messages.js';
import { uhrKopf } from './loop_rec_view.js';
import { $, deckAnsicht, melde, pruefmodusAus } from './page_state.js';
import { hotcueMarken } from './deck_griffe.js';

// Bildschleife (Plan Oberfläche T4/T5): Wellen und Köpfe je Bild, Kopf zwischen Meldungen hochgerechnet
window.djkBild = [];       // Zeichendauer je Bild in ms, Ring 600 (Plan T8, Prüfung: lesen)
export function bild() {
  const jetzt = performance.now(), beat = uhrKopf.beat(jetzt);
  for (const n of DECKS) {
    const a = deckAnsicht[n];
    if (a.sektion.hidden) continue;   // a hidden place draws nothing
    if (!a.raster) { a.lauf.zeichne(0); a.ueber.zeichne(0, 0); continue; }
    const f = (a.ziehBasis ?? (a.raster.ersterSchlagFrame + a.kopf.beat(jetzt) * a.raster.framesProBeat)) + (a.zieh ?? 0);
    const marken = hotcueMarken(a);
    a.lauf.zeichne(f, null, marken); a.ueber.zeichne(f, a.lauf.takte * 4 * a.raster.framesProBeat, marken);
  }
  window.djkBild.push(performance.now() - jetzt); if (window.djkBild.length > 600) window.djkBild.shift();
  requestAnimationFrame(bild);
}
// Glanz 2.1 (F22): Punkt OUT aus GET /ausgang, jede Sekunde. Es gibt nur ein Meldungsfeld (melde, Zeile 70): ein Alarm
// kommt wieder, sobald das Feld leer ist; die kurze Notiz eines geheilten Falls schreibt nie über die stehende
// Prüfmodus-Meldung (Zeile 84), und nach dem Alarm kommt diese zurück.
let ausgangFaelle = null, ausgangAlarm = false;
export async function ausgang() {
  let a;
  try { a = await (await fetch('/ausgang')).json(); } catch { return; }
  const z = ausgangAnzeige(a, ausgangFaelle);
  const p = $('#v-out');
  p.classList.remove('an', 'alarm', 'leer'); p.classList.add(z.klasse); p.title = z.titel;
  if (z.klasse === 'alarm') {
    if (!ausgangAlarm || $('#meldung').textContent === '') melde(z.meldung.text, true, true);
  } else if (ausgangAlarm) {
    if (pruefmodusAus) melde(HAND_PRUEFMODUS_TEXT, true, true);
    else melde(z.klasse === 'an' ? 'Digital output back on' : '', false);
  } else if (z.meldung && !pruefmodusAus) {
    melde(z.meldung.text, true, false);
  }
  ausgangAlarm = z.klasse === 'alarm'; ausgangFaelle = a.faelle;
}
