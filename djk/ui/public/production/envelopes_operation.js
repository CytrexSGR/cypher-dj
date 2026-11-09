// PRODUCTION (1.12 automation slice 5, plan PLAN-1.12-slices4-5-7.md U10): the wiring of the ENVELOPES tab (target menu, LINKED, LOOP, delete,
// the envelope row on a canvas with the clip as the time frame). The pure parts and the commands live in envelopes.js. Every gesture sends ONE
// huellkurve_setzen with the whole point list; envelopes have no lock (the spec has none).
import { HK_ANZEIGE, HK_TEXT, hkZiele, hkGeste, hkBefehl, hkPfad, normiert, verknuepftBefehl, loopBefehl, loopText } from './envelopes.js';
import { trefferPunkt, wertZuY } from './lanes.js';
import { loeschBefehl, punktMenue } from './lanes_operation.js';
import { oeffneMenue } from './context_menu.js';
import { rasterBeats } from './timeline.js';

const GERUEST = `<div class="p-hk-leiste">
  <select data-h="ziel" title="${HK_TEXT.ziel_titel}" aria-label="${HK_TEXT.ziel_titel}"></select>
  <button data-h="verknuepft" aria-pressed="true" title="${HK_TEXT.verknuepft_titel}">${HK_TEXT.verknuepft}</button>
  <label title="${HK_TEXT.loop_titel}">${HK_TEXT.loop} <input data-h="loop" inputmode="decimal" autocomplete="off" size="5"></label>
  <button data-h="weg" title="${HK_TEXT.weg_titel}">${HK_TEXT.weg}</button>
  <span class="p-roll-hilfe">${HK_TEXT.hilfe}</span>
</div>
<canvas class="p-hk-canvas" data-h="canvas" tabindex="0" aria-label="${HK_TEXT.reiter_hk}"></canvas>`;
const LANE_ZIEL = 'geraet.cutoff';               // the plain 0..1 row of envelopes.js

// behaelter: the tab panel; wahl: the HkWahl of the detail area (page state)
export function bindeHuellkurven(ctx, behaelter, wahl) {
  const { st } = ctx;
  behaelter.innerHTML = GERUEST;
  const h = (n) => behaelter.querySelector(`[data-h="${n}"]`);
  const canvas = h('canvas'), g2 = canvas.getContext('2d');
  let gezeigt = null, entwurf = null;          // gezeigt: {spur, clip}; entwurf: the point list while dragging
  const ziel = () => (gezeigt ? wahl.ziel(gezeigt.clip, gezeigt.spur) : null);
  const hk = () => (gezeigt?.clip.huellkurven ?? []).find((x) => x.ziel === ziel()) ?? null;
  const rahmen = () => {
    const breite = canvas.clientWidth || 600, hoehe = canvas.clientHeight || 120, laenge = gezeigt.clip.laenge_beats;
    return { breite, hoehe, zeile: { y: 0, h: hoehe }, beatZuX: (b) => b / laenge * breite, xZuBeat: (x) => x / breite * laenge };
  };
  const sende = (label, befehle) => { entwurf = null; if (befehle.length) ctx.aendere(label, befehle); zeichne(); };

  function zeichne() {
    if (!gezeigt) return;
    const r = rahmen(), dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.breite * dpr)) { canvas.width = Math.round(r.breite * dpr); canvas.height = Math.round(r.hoehe * dpr); }
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, r.breite, r.hoehe);
    const c = gezeigt.clip, k = hk(), periode = k?.verknuepft === false ? k.loop_beats : c.loop_beats;
    const linie = (b) => { const x = Math.round(r.beatZuX(b)) + 0.5; g2.beginPath(); g2.moveTo(x, 0); g2.lineTo(x, r.hoehe); g2.stroke(); };
    g2.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let b = 1; b < c.laenge_beats; b++) linie(b);
    if (periode) {                               // where the envelope repeats (clip loop for linked, its own loop for unlinked)
      g2.strokeStyle = 'rgba(224,168,59,0.6)';
      for (let b = periode; b < c.laenge_beats - 1e-9; b += periode) linie(b);
    }
    const punkte = entwurf ?? k?.punkte;
    if (!punkte?.length) return;
    const pfad = hkPfad({ ziel: ziel(), punkte }, r.zeile, r.beatZuX, r.xZuBeat, r.breite);
    g2.strokeStyle = '#e0a83b'; g2.lineWidth = 2; g2.beginPath();
    pfad.forEach(([x, y], i) => (i ? g2.lineTo(x, y) : g2.moveTo(x, y)));
    g2.stroke(); g2.lineWidth = 1; g2.fillStyle = '#ffffff';
    for (const q of normiert(punkte, ziel())) {
      g2.beginPath(); g2.arc(r.beatZuX(q.beat), wertZuY(r.zeile, q.wert, LANE_ZIEL), 3.5, 0, Math.PI * 2); g2.fill();
    }
  }

  h('ziel').addEventListener('change', (e) => { if (gezeigt) { wahl.waehle(gezeigt.clip.id, e.target.value); zeige(gezeigt); } });
  h('verknuepft').addEventListener('click', () => {
    const k = hk();
    if (!gezeigt || !k) return;
    const an = k.verknuepft === false;
    sende(an ? HK_TEXT.verknuepft_label : HK_TEXT.frei_label, [verknuepftBefehl(gezeigt.clip, k, an)]);
  });
  const loop = h('loop');
  loop.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') loop.blur();
    if (e.key === 'Escape') { zeige(gezeigt); loop.blur(); }
  });
  loop.addEventListener('change', () => {
    const k = hk();
    if (!gezeigt || !k) return;
    const r = loopBefehl(gezeigt.clip, k, loop.value);
    if (r.fehler) { ctx.melde(r.fehler, true); zeige(gezeigt); return; }
    if (r.befehl) sende(HK_TEXT.loop_label, [r.befehl]);
  });
  h('weg').addEventListener('click', () => {
    if (gezeigt && hk()) sende(HK_TEXT.weg_label, [{ befehl: 'huellkurve_loeschen', clip_id: gezeigt.clip.id, ziel: ziel() }]);
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (!gezeigt || e.button !== 0) return;
    const r = rahmen(), t = gezeigt;
    const g = hkGeste({ clip: t.clip, hk: hk(), ziel: ziel(), zeile: r.zeile, beatZuX: r.beatZuX, xZuBeat: r.xZuBeat, raster: rasterBeats(st.raster) });
    g.down(e.offsetX, e.offsetY);
    canvas.setPointerCapture(e.pointerId);
    const bewege = (m) => { const b = g.move(m.offsetX, m.offsetY); entwurf = b ? b.punkte : null; zeichne(); };
    const ende = (m) => {
      canvas.removeEventListener('pointermove', bewege); canvas.removeEventListener('pointerup', ende);
      const r2 = g.up(m.offsetX, m.offsetY);
      if (r2.hinweis) ctx.melde(r2.hinweis, true);
      sende(HK_TEXT.label, r2.befehle);
    };
    canvas.addEventListener('pointermove', bewege);
    canvas.addEventListener('pointerup', ende);
  });
  const punktBei = (e) => {
    const k = hk();
    if (!gezeigt || !k) return null;
    const r = rahmen(), lane = { id: 'hk', ziel: LANE_ZIEL, punkte: normiert(k.punkte, k.ziel) };
    const i = trefferPunkt(lane.punkte, r.zeile, r.beatZuX, e.offsetX, e.offsetY, LANE_ZIEL);
    return i >= 0 ? { k, lane, i } : null;
  };
  canvas.addEventListener('dblclick', (e) => {
    const p = punktBei(e);
    const b = p ? hkBefehl(gezeigt.clip, p.k, loeschBefehl(p.lane, p.i)) : null;
    if (b) sende(HK_TEXT.label, [b]);
  });
  canvas.addEventListener('contextmenu', (e) => {
    const p = punktBei(e);
    if (!p) return;
    e.preventDefault();
    oeffneMenue(punktMenue(p.lane, p.i).map((x) => ({ text: x.text, aus: x.aus || !x.befehl,
      aktion: () => { const b = hkBefehl(gezeigt.clip, p.k, x.befehl); if (b) sende(HK_TEXT.label, [b]); } })), e.clientX, e.clientY);
  });

  // t: {spur, clip} of the detail area, or null
  function zeige(t) {
    gezeigt = t; entwurf = null;
    if (!t) return;
    const ziele = hkZiele(t.clip, t.spur), z = ziel(), vorhanden = new Set((t.clip.huellkurven ?? []).map((x) => x.ziel));
    const sel = h('ziel');
    const schluessel = JSON.stringify([ziele, [...vorhanden]]);
    if (sel.dataset.optionen !== schluessel) {
      sel.dataset.optionen = schluessel;
      sel.replaceChildren(...ziele.map((x) => {
        const o = document.createElement('option');
        o.value = x; o.textContent = `${HK_ANZEIGE[x].label}${vorhanden.has(x) ? ' ●' : ''}`;
        return o;
      }));
    }
    sel.value = z;
    const k = hk(), frei = k?.verknuepft === false;
    const vb = h('verknuepft');
    vb.disabled = !k; vb.classList.toggle('an', !frei); vb.setAttribute('aria-pressed', String(!frei));
    loop.disabled = !frei;
    if (document.activeElement !== loop) loop.value = frei ? loopText(k.loop_beats) : '';
    h('weg').disabled = !k;
    zeichne();
  }
  return { zeige };
}
