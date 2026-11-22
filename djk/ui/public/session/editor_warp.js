// SESSION clip editor, S1b lane E: the WARP tab (plan index 10.1: only what the launcher already does for cells). KEYLOCK on or off (off = the loop
// follows the tempo as re-pitch), the SOURCE tempo of the cell (its `bpm`), the waveform with the beat grid (read only). No MODE, no markers, no TEXTURE.
// Registered by editor.js; does not import it. ctx: { zelle, sendeZelle(felder), melde } of editor.js.
import { daumen } from './waves.js';

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const taste = (klasse, text, titel) => { const b = el('button', klasse, text); b.type = 'button'; b.setAttribute('type', 'button'); if (titel) b.title = titel; return b; };

// copies of TEMPO_MIN and TEMPO_MAX of project/model.ts (the page does not import server code; a test compares both)
export const TEMPO_MIN = 60, TEMPO_MAX = 200;
export const EINMAL_TITEL = 'a one-shot plays unstretched';
const MAX_LINIEN = 64;

export const warpTab = {
  passt: (z) => !!z && !z.halten && (z.art === 'loop' || z.art === 'einmal'),
  baue(wurzel, c) {
    const z = c.zelle, einmal = z.art === 'einmal', an = z.keylock === false ? false : null;   // null: keylock on (the field is absent)
    const kopf = el('div', 'ed-zeile wp-kopf');
    const lock = el('div', 'seg wp-keylock');
    for (const [wert, text, titel] of [[null, 'ON', 'Keylock on: the loop is stretched to the tempo, the pitch stays'], [false, 'OFF', 'Keylock off: the loop follows the tempo as re-pitch']]) {
      const b = taste('seg-b', text, einmal ? EINMAL_TITEL : titel); b.dataset.wert = String(wert);
      b.classList.toggle('an', wert === an); b.setAttribute('aria-pressed', String(wert === an));
      if (einmal) b.disabled = true; else b.addEventListener('click', () => c.sendeZelle({ keylock: wert }));
      lock.append(b);
    }
    const quelle = el('input', 'wp-quelle'); quelle.type = 'number'; quelle.setAttribute('type', 'number');
    quelle.min = String(TEMPO_MIN); quelle.max = String(TEMPO_MAX); quelle.step = '0.1'; quelle.title = 'Source tempo of the audio in BPM';
    quelle.value = Number.isFinite(z.bpm) ? String(z.bpm) : '';
    let alt = quelle.value;
    const commit = async () => {   // a refusal (in the page or by the server) puts the old text back
      if (quelle.value === alt) return;
      const n = Number(quelle.value.trim().replace(',', '.'));
      if (quelle.value.trim() === '' || !Number.isFinite(n) || n < TEMPO_MIN || n > TEMPO_MAX) {
        c.melde?.(`The source tempo must be between ${TEMPO_MIN} and ${TEMPO_MAX} BPM`, true); quelle.value = alt; return;
      }
      const vorher = alt; alt = quelle.value;
      const r = await c.sendeZelle({ bpm: n });
      if (r === null || r === false) { alt = vorher; quelle.value = vorher; }
    };
    quelle.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(); else if (ev.key === 'Escape') quelle.value = alt; });
    quelle.addEventListener('blur', commit);
    const mk = (label, ...inhalt) => { const r = el('div', 'pr'); r.append(el('label', '', label), ...inhalt); return r; };
    kopf.append(mk('KEYLOCK', lock), mk('SOURCE', quelle, el('span', 'ed-einheit', 'BPM')));

    const wv = el('div', 'ed-welle wp-welle'); wv.dataset.sha = z.sha256 ?? '';
    const beats = z.beats > 0 ? z.beats : 0;
    const schritt = Math.max(1, Math.ceil(beats / MAX_LINIEN));
    for (let b = 0; b < beats; b += schritt) { const l = el('i', 'wp-takt'); l.style.left = `${b / beats * 100}%`; l.dataset.beat = String(b + 1); wv.append(l); }
    if (z.sha256) daumen(z.sha256, 480, 40).then((k) => { if (k && wv.isConnected !== false) wv.prepend(k); }, () => {});
    wurzel.append(kopf, wv, el('div', 'wp-spaeter', 'Warp markers and more modes come in a later slice.'));
  },
};
