// SESSION clip editor, S1b lane E: the ENVELOPES tab (spec D15 and §7). Up to four lanes per cell (gain, filter, HALL send, DELAY send; no PITCH), drawn over the
// cell length with the lane gestures of PRODUCTION's envelope editor, which are imported (lanes.js, lanes_operation.js), not copied: PRODUCTION needs no
// change, the lanes here work on a plain 0..1 row and map to the target range themselves (as production/envelopes.js does for clip envelopes).
// A change posts ONE /session/huelle { ziel, punkte } with the whole point list (cell beats, absolute values, at most 64 points); remove posts punkte null.
// Registered by editor.js; does not import it. ctx: { zelle, spalte, sende(weg, daten), melde } of editor.js.
import { lanePfad, punkteNach, trefferPunkt, wertZuY } from '../production/lanes.js';
import { LaneGeste, loeschBefehl } from '../production/lanes_operation.js';

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const taste = (klasse, text, titel) => { const b = el('button', klasse, text); b.type = 'button'; b.setAttribute('type', 'button'); if (titel) b.title = titel; return b; };

export const MAX_HUELLEN = 4, MAX_PUNKTE = 64;
export const VIER_TEXT = 'A cell holds at most four envelopes.';
export const KOPF_TEXT = 'CLIP ENVELOPES · LOOP WITH THE CLIP, START WITH EVERY LAUNCH';
// the targets of index 2.1 in picker order; min/max are the stored range (project/model.ts ZELL_ZIEL_BEREICH), anzeigeMin the bottom of the row (like the gain row of PRODUCTION)
export const ZIELE = [
  { ziel: 'gain', text: 'GAIN', min: -200, max: 0, anzeigeMin: -60, titel: 'Cell gain in dB over the cell length (on top of the cell gain)' },
  { ziel: 'filter', text: 'FILTER', min: -1, max: 1, anzeigeMin: -1, titel: 'Track filter over the cell length: low-pass left, high-pass right' },
  { ziel: 'send.hall', text: 'HALL SEND', min: -200, max: 0, anzeigeMin: -60, art: 'hall', titel: 'HALL send in dB over the cell length' },
  { ziel: 'send.delay', text: 'DELAY SEND', min: -200, max: 0, anzeigeMin: -60, art: 'delay', titel: 'DELAY send in dB over the cell length' },
];
const BEREICH = Object.fromEntries(ZIELE.map((z) => [z.ziel, z]));
const LANE_ZIEL = 'geraet.cutoff';        // the plain 0..1 row of lanes.js
const RASTER = 0.25, ENDE = 1 / 16;        // gesture grid in beats; a point stays this far below the cell length (the loader wants beat < beats)
const runde = (x) => Math.round(x * 1000) / 1000;
const norm = (wert, b) => Math.min(1, Math.max(0, (wert - b.anzeigeMin) / (b.max - b.anzeigeMin)));

// Which targets the track offers: gain and filter always; a send needs its return (the column says `rueckgaenge: { hall, delay }`; absent = offered, the server refuses otherwise)
export const ziele = (spalte) => ZIELE.filter((z) => !z.art || spalte?.rueckgaenge?.[z.art] !== false);
// A new lane (a target without an envelope yet) needs a free one of the four
export const neueLaneErlaubt = (huellen, ziel) => (huellen ?? []).some((h) => h.ziel === ziel) || (huellen ?? []).length < MAX_HUELLEN;
// At most `max` points, the first and the last kept, the others evenly picked
export function duenneAus(punkte, max = MAX_PUNKTE) {
  const n = punkte.length;
  if (n <= max) return punkte;
  return Array.from({ length: max }, (_, k) => punkte[Math.round(k * (n - 1) / (max - 1))]);
}
// The stored points after the lane commands of one gesture (auto_punkte on the normalised row): a set point takes its value back from 0..1 unless it is an
// untouched stored point (normalised value unchanged: exact value kept); beats stay inside [0, beats - 1/16]; the result is thinned to 64 points. [] = no point left.
export function neuePunkte(ziel, alt, befehle, beats) {
  const b = BEREICH[ziel];
  let lauf = alt.map((q) => ({ ...q, wert: norm(q.wert, b) }));
  // clamp the beats first: the replace rule of punkteNach (one point per beat) must see the beats that are stored
  const klemme = (bf) => (bf.setze ? { ...bf, setze: bf.setze.map((q) => ({ ...q, beat: runde(Math.min(q.beat, beats - ENDE)) })) } : bf);
  for (const bf of befehle) lauf = punkteNach(lauf, klemme(bf));
  const zurueck = (q) => {
    const beat = runde(Math.min(Math.max(0, q.beat), beats - ENDE));
    const war = alt.find((x) => x.beat === q.beat && norm(x.wert, b) === q.wert);
    const wert = war ? war.wert : runde(Math.min(b.max, Math.max(b.min, b.anzeigeMin + q.wert * (b.max - b.anzeigeMin))));
    return { beat, wert, ...(q.form ? { form: q.form } : {}) };
  };
  return duenneAus(lauf.map(zurueck));
}

function baueLane(wurzel, c, h, beats) {
  const b = BEREICH[h.ziel];
  const lane = el('div', 'hl-lane'); lane.dataset.ziel = h.ziel;
  const etikett = el('span', 'hl-etikett', b.text);
  const weg = taste('hl-weg', '×', 'Remove this envelope');
  weg.addEventListener('click', () => c.sende('/session/huelle', { ziel: h.ziel, punkte: null }));
  const canvas = el('canvas', 'hl-canvas'); canvas.tabIndex = 0; canvas.title = 'Click: add a point · drag: move · double click: delete a point';
  lane.append(etikett, canvas, weg);
  wurzel.append(lane);
  const g2 = canvas.getContext('2d');
  let entwurf = null;
  const rahmen = () => {
    const breite = canvas.clientWidth || 480, hoehe = canvas.clientHeight || 28;
    return { breite, hoehe, zeile: { y: 0, h: hoehe }, beatZuX: (x) => x / beats * breite, xZuBeat: (x) => x / breite * beats };
  };
  const normiert = (punkte) => punkte.map((q) => ({ ...q, wert: norm(q.wert, b) }));
  function zeichne() {
    const r = rahmen();
    if (canvas.width !== r.breite) { canvas.width = r.breite; canvas.height = r.hoehe; }
    g2.clearRect(0, 0, r.breite, r.hoehe);
    g2.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let t = 1; t < beats; t++) { const x = Math.round(r.beatZuX(t)) + 0.5; g2.beginPath(); g2.moveTo(x, 0); g2.lineTo(x, r.hoehe); g2.stroke(); }
    const pk = normiert(entwurf ?? h.punkte);
    if (!pk.length) return;
    const pfad = lanePfad(pk, r.zeile, r.beatZuX, r.xZuBeat, r.breite, LANE_ZIEL);
    g2.strokeStyle = '#e0a83b'; g2.lineWidth = 2; g2.beginPath();
    pfad.forEach(([x, y], i) => (i ? g2.lineTo(x, y) : g2.moveTo(x, y)));
    g2.stroke(); g2.lineWidth = 1; g2.fillStyle = '#ffffff';
    for (const q of pk) { g2.beginPath(); g2.arc(r.beatZuX(q.beat), wertZuY(r.zeile, q.wert, LANE_ZIEL), 3, 0, Math.PI * 2); g2.fill(); }
  }
  const schreibe = async (befehle) => {
    entwurf = null;
    if (befehle.length) {
      const neu = neuePunkte(h.ziel, h.punkte, befehle, beats);
      await c.sende('/session/huelle', { ziel: h.ziel, punkte: neu.length ? neu : null });
    }
    zeichne();
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = rahmen();
    const g = new LaneGeste({ lane: { id: 'hl', ziel: LANE_ZIEL, punkte: normiert(h.punkte) }, zeile: r.zeile, beatZuX: r.beatZuX, xZuBeat: r.xZuBeat, raster: RASTER });
    g.down(e.offsetX, e.offsetY);
    canvas.setPointerCapture?.(e.pointerId);
    const bewege = (m) => { const bf = g.move(m.offsetX, m.offsetY); entwurf = bf ? neuePunkte(h.ziel, h.punkte, [bf], beats) : null; zeichne(); };
    const ende = (m) => {
      canvas.removeEventListener('pointermove', bewege); canvas.removeEventListener('pointerup', ende);
      const r2 = g.up(m.offsetX, m.offsetY);
      if (r2.hinweis) c.melde?.(r2.hinweis, true);
      schreibe(r2.befehle);
    };
    canvas.addEventListener('pointermove', bewege);
    canvas.addEventListener('pointerup', ende);
  });
  canvas.addEventListener('dblclick', (e) => {
    const r = rahmen(), pk = normiert(h.punkte), i = trefferPunkt(pk, r.zeile, r.beatZuX, e.offsetX, e.offsetY, LANE_ZIEL);
    const bf = i >= 0 ? loeschBefehl({ id: 'hl', ziel: LANE_ZIEL, punkte: pk }, i) : null;
    if (bf) schreibe([bf]);
  });
  zeichne();
}

export const huellenTab = {
  passt: (z) => !!z && !z.halten && (z.art === 'loop' || z.art === 'einmal'),
  baue(wurzel, c) {
    const z = c.zelle, huellen = Array.isArray(z.huellen) ? z.huellen : [], beats = z.beats > 0 ? z.beats : 8;
    wurzel.append(el('div', 'hl-kopf', KOPF_TEXT));
    const wahl = el('div', 'seg hl-ziel');
    for (const t of ziele(c.spalte)) {
      const da = huellen.some((h) => h.ziel === t.ziel);
      const bt = taste('seg-b', t.text, t.titel); bt.dataset.wert = t.ziel;
      bt.classList.toggle('an', da); bt.setAttribute('aria-pressed', String(da));
      bt.addEventListener('click', () => {
        if (da) return;
        if (!neueLaneErlaubt(huellen, t.ziel)) { c.melde?.(VIER_TEXT, true); return; }
        const start = t.ziel === 'gain' ? 0 : t.ziel === 'filter' ? (Number.isFinite(c.spalte?.filter) ? c.spalte.filter : 0)
          : (Number.isFinite(c.spalte?.send?.[t.art]) ? c.spalte.send[t.art] : -200);
        c.sende('/session/huelle', { ziel: t.ziel, punkte: [{ beat: 0, wert: start }] });
      });
      wahl.append(bt);
    }
    wurzel.append(wahl);
    for (const h of huellen) if (BEREICH[h.ziel] && Array.isArray(h.punkte)) baueLane(wurzel, c, h, beats);
  },
};
