// 1.14 Comping, slice 1, task 7: the heads of the take rows (name, speaker, context menu). One head per take, built once and reused; the head column
// (spurkoepfe.js zeige) asks for the heads of a track in take order and places them directly under the track head, above an open automation head.
import { TAKE_TEXT, vorhoerenKoerper } from './takes.js';
import { rasterBeats, rasten, xZuBeat, beatZuX } from './zeitachse.js';
import { zeileBei } from './layout.js';
import { ZUG_SCHWELLE } from './lanen.js';
import { istTextFeld } from './verlauf_anzeige.js';
import { menueOffen } from './kontextmenue.js';
import { bounceHuelle } from './bounce.js';

const KOPF = `<span class="p-takename" role="button" tabindex="0" title="${TAKE_TEXT.name_titel}"></span>
<button class="p-takehoer" aria-pressed="false" title="${TAKE_TEXT.hoeren_titel}">🔊</button>`;

// sende(body): the POST of the audition (one per click). aendere(label, befehle): the write path of the page. menue(punkte, x, y): kontextmenue.js oeffneMenue.
// vorhoeren(): the map {spur_id: take_id} of the last /proj/aktuell.
export function neueTakeKoepfe({ vorhoeren = () => ({}), sende, aendere, menue }) {
  const koepfe = new Map();      // `${spur_id}/${take_id}` -> head
  let benutzt = new Set();
  const baue = (spurId, takeId) => {
    const el = document.createElement('div');
    el.className = 'p-takekopf';
    el.dataset.spur = spurId; el.dataset.take = takeId;
    el.innerHTML = KOPF;
    let spur = null;
    const take = () => spur?.takes?.find((t) => t.id === takeId);
    // the button is locked until the answer is there: a second quick click would send the same body again
    const hoer = el.querySelector('.p-takehoer');
    hoer.addEventListener('click', async () => {
      if (hoer.disabled) return;
      hoer.disabled = true;
      try { await sende(vorhoerenKoerper(vorhoeren(), spurId, takeId)); } finally { hoer.disabled = false; }
    });
    const name = el.querySelector('.p-takename');
    const umbenennen = () => {
      const ein = document.createElement('input');
      ein.className = 'p-takefeld'; ein.value = take()?.name ?? ''; ein.maxLength = 64; ein.setAttribute('aria-label', TAKE_TEXT.name_label);
      name.hidden = true; el.append(ein); ein.focus(); ein.select?.();   // the input sits beside the hidden name (CSS), no node swap
      let fertig = false;
      const ende = (uebernehmen, zurueckAnName) => {
        if (fertig) return; fertig = true;
        ein.remove(); name.hidden = false;
        if (zurueckAnName) name.focus();      // ended by keyboard: the focus returns to the name
        const neu = ein.value.trim();
        if (uebernehmen && neu && neu !== take()?.name) {
          aendere(TAKE_TEXT.umbenennen, [{ befehl: 'take_umbenennen', spur_id: spurId, take_id: takeId, name: neu }]);
        }
      };
      ein.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') ende(true, true);
        if (e.key === 'Escape') ende(false, true);
      });
      ein.addEventListener('blur', () => ende(false, false));
    };
    name.addEventListener('dblclick', umbenennen);
    name.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === 'F2') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); umbenennen();
      }
    });
    // 1.14 slice 4 (spec R12, D2): the whole lane into the main lane, over the hull of its clips (floor/ceil like the bounce range)
    const ganzeLane = () => {
      const h = bounceHuelle(take()?.clips ?? []);
      return { text: TAKE_TEXT.ganz, aus: !h, ...(h ? {} : { titel: TAKE_TEXT.ganz_leer }),
        aktion: () => { if (h) aendere(TAKE_TEXT.ganz, [{ befehl: 'comp_waehlen', spur_id: spurId, take_id: takeId, ...h }]); } };
    };
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menue([
        { text: TAKE_TEXT.umbenennen, aktion: umbenennen },
        {
          text: TAKE_TEXT.loeschen,
          aktion: () => aendere(TAKE_TEXT.loeschen, [{ befehl: 'take_loeschen', spur_id: spurId, take_id: takeId }]),
        },
        ganzeLane(),
      ], e.clientX, e.clientY);
    });
    el.setSpur = (s) => { spur = s; };
    return el;
  };
  return {
    begin() { benutzt = new Set(); },
    // the heads of the takes of this track, in take order, painted from the state
    fuer(spur) {
      const lit = vorhoeren() ?? {};
      return (spur.takes ?? []).map((t) => {
        const k = `${spur.id}/${t.id}`;
        let el = koepfe.get(k);
        if (!el) { el = baue(spur.id, t.id); koepfe.set(k, el); }
        benutzt.add(k);
        el.setSpur(spur);
        const name = el.querySelector('.p-takename');
        if (name.textContent !== t.name) name.textContent = t.name;
        const an = lit[spur.id] === t.id, b = el.querySelector('.p-takehoer');
        el.classList.toggle('an', an); b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an));
        b.setAttribute('aria-label', `${TAKE_TEXT.hoeren_label} ${t.name}`);
        el.style.setProperty('--farbe', spur.farbe);
        return el;
      });
    },
    // drops the heads that were not asked for since begin(): a deleted take, a closed row, a deleted track
    ende() { for (const [k, el] of koepfe) if (!benutzt.has(k)) { el.remove(); koepfe.delete(k); } },
  };
}

export const COMP_TEXT = { label: 'Comp take' };

// POST of an audition (R8): the answer is the reason (never silent), then the state is fetched (`vorhoeren`). nachladen false: the caller reloads once.
export const vorhoerenSenden = (ctx) => async (body, nachladen = true) => {
  const r = await ctx.holeJson('/proj/take_vorhoeren', body);
  if (r.status !== 200) { ctx.melde(ctx.antwortText(r), true); return false; }
  if (nachladen) await ctx.ladeAktuell();
  return true;
};

const rund = (v) => Math.round(v * 1e6) / 1e6;   // pixel / zoom leaves float dust: 4.9 must stay 4.9 on grid OFF

// One comp gesture on a take row (spec R4, 4.3): the range between press and release, both edges snapped to the grid, never before beat 0.
// ctx: { xZuBeat, raster }. down(x) -> true; move(x) -> the draft {von, bis} or null (below the threshold); up(x) -> {von, bis} or null (a click).
export class CompGeste {
  constructor(ctx) { this.c = ctx; this.x0 = 0; this.b0 = 0; this.gezogen = false; }
  // the start is kept as a BEAT (like clip_bedienung.js): FOLLOW or a zoom during the drag moves the view, not the edge that was pressed
  down(x) { this.x0 = x; this.b0 = this.c.xZuBeat(x); this.gezogen = false; return true; }
  bereich(x) {
    const a = this.b0, b = this.c.xZuBeat(x), r = this.c.raster;
    return { von: Math.max(0, rund(rasten(Math.min(a, b), r))), bis: Math.max(0, rund(rasten(Math.max(a, b), r))) };
  }
  move(x) {
    if (!this.gezogen && Math.abs(x - this.x0) < ZUG_SCHWELLE) return null;
    this.gezogen = true;
    return this.bereich(x);
  }
  up(x) { return this.gezogen || Math.abs(x - this.x0) >= ZUG_SCHWELLE ? this.bereich(x) : null; }
}

// Wiring to the page: the comp drag on a take row, the keys T (audition the row under the pointer, toggles) and Esc (ends the drag, else every audition).
// Registered before bindeClips: a pointerdown in a take row is ours (the clip handling below must not clear the selection or start a clip drag).
export function bindeComp(ctx) {
  const { st, $ } = ctx;
  const flaeche = $('flaeche'), ueber = $('ueber');
  const sende = vorhoerenSenden(ctx);
  let zeiger = null;                          // {x, y} of the last pointer position over the canvas, for the key T
  let zug = null;                             // the running drag: {g, z, spur, take, entwurf}
  const takeAn = (y) => {
    if (!st.projekt || y === undefined || y === null) return null;
    const z = zeileBei(ctx.zeilen(), y);
    if (!z || z.art !== 'take') return null;
    const spur = (st.projektEntwurf ?? st.projekt).spuren[z.spur], take = spur?.takes?.[z.take];
    return take ? { z, spur, take } : null;
  };
  flaeche.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== ueber || !st.projekt) return;
    const t = takeAn(e.offsetY);
    if (!t) return;
    e.stopImmediatePropagation();
    ueber.focus?.({ preventScroll: true });
    const g = new CompGeste({ xZuBeat: (x) => xZuBeat(st.ansicht, x), raster: rasterBeats(st.raster) });
    g.down(e.offsetX);
    const mein = { g, z: t.z, spur: t.spur.id, take: t.take.id, entwurf: null };
    zug = mein;
    ueber.setPointerCapture?.(e.pointerId);
    const bewege = (m) => { if (zug === mein) mein.entwurf = g.move(m.offsetX) ?? mein.entwurf; };
    const los = () => {
      ueber.removeEventListener('pointermove', bewege); ueber.removeEventListener('pointerup', ende); ueber.removeEventListener('pointercancel', abbruch);
      ueber.removeEventListener('lostpointercapture', abbruch);
    };
    const abbruch = () => { los(); if (zug === mein) zug = null; };
    const ende = (m) => {
      los();
      if (zug !== mein) return;               // cancelled (Esc, pointercancel) or the listener of an earlier drag
      zug = null;
      const r = g.up(m.offsetX);
      if (!r) return;                         // a click: nothing
      // snapped to nothing: the text of the server's comp_leer, no request
      if (!(r.bis > r.von)) { ctx.melde(ctx.fehlerText({ j: { fehler: 'comp_leer' } }), true); return; }
      ctx.aendere(COMP_TEXT.label, [{ befehl: 'comp_waehlen', spur_id: mein.spur, take_id: mein.take, von_beat: r.von, bis_beat: r.bis }]);
    };
    ueber.addEventListener('pointermove', bewege);
    ueber.addEventListener('pointerup', ende);
    ueber.addEventListener('pointercancel', abbruch);
    ueber.addEventListener('lostpointercapture', abbruch);
  }, true);
  ueber.addEventListener('pointermove', (e) => { zeiger = { x: e.offsetX, y: e.offsetY }; });
  ueber.addEventListener('pointerleave', () => { zeiger = null; });

  // The context menu closes itself on Esc in the capture phase of the window, before our document handler runs: ask first, then the Esc belongs to the menu
  let menueBeiTaste = false;
  window.addEventListener('keydown', () => { menueBeiTaste = menueOffen(); }, true);
  let sperre = false;                         // one key action at a time: the next one reads the map after the reload
  async function taste(e) {
    if (!st.sichtbar || !st.projekt || e.ctrlKey || e.metaKey || e.altKey || e.repeat || istTextFeld(e.target)) return;
    if (e.key === 'Escape') {
      if (menueBeiTaste) return;              // the Esc closed the context menu: nothing else
      if (zug) { zug = null; e.preventDefault?.(); return; }
      const lit = Object.keys(st.vorhoeren ?? {});
      if (!lit.length || sperre) return;
      sperre = true;
      try {
        for (const id of lit) await sende({ spur_id: id, take_id: null }, false);
        await ctx.ladeAktuell();
      } finally { sperre = false; }
      return;
    }
    if (e.key.toLowerCase() !== 't' || e.shiftKey || !zeiger || sperre) return;
    const t = takeAn(zeiger.y);
    if (!t) return;
    sperre = true;
    try { await sende(vorhoerenKoerper(st.vorhoeren, t.spur.id, t.take.id)); } finally { sperre = false; }
  }
  document.addEventListener('keydown', taste);

  // Overlay: the range while dragging (below the threshold nothing is drawn)
  const g2 = ueber.getContext('2d');
  ctx.beimBild.push(() => {
    if (!zug?.entwurf) return;
    const { von, bis } = zug.entwurf, x0 = beatZuX(st.ansicht, von), x1 = beatZuX(st.ansicht, bis);
    g2.fillStyle = 'rgba(255,255,255,0.18)'; g2.fillRect(x0, zug.z.y, Math.max(1, x1 - x0), zug.z.h);
    g2.strokeStyle = '#ffffff'; g2.strokeRect(x0, zug.z.y + 0.5, Math.max(1, x1 - x0), zug.z.h - 1);
  });
}
