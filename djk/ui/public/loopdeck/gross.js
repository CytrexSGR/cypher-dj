// Loop deck pop-up (owner decision 2026-11-22: the SESSION view is replaced by it). An overlay above the DJ view that shows ONE loop deck large:
// the band head, four `voll` columns (session/spalte.js) with the column strip (session/strip.js), the scene column of the deck and the bottom area with the
// tabs CLIP (clip editor of the selected cell) and DEVICES (the shared dock). It reads the same state as the place (GET /session/stand for the columns,
// the place's own stand for the deck grid) and the same SSE events; every write goes through the routes SESSION used. The nodes are built once per
// open and updated in place; closing removes them, the key listener and the frame loop (nothing outlives a close).
import { el, melde as meldeStandard, jsonPost } from '../page_state.js';
import { baueSpalte } from '../session/spalte.js';
import { baueZug } from '../session/strip.js';
import { baueUnten } from '../session/unten.js';
import { montiereSessionDock } from '../session/dock_host.js';
import { fokus } from '../controller_fokus.js';
import { baueMenue } from './menue.js';
import { RASTER, ZELLEN } from './model.js';
import { schreibeZelle } from './drag.js';
import { ladeStand, deckRaster, beiExportAenderung } from './view.js';

const taste = (klasse, text, titel) => { const b = el('button', klasse, text); b.type = 'button'; b.setAttribute('type', 'button'); if (titel) b.title = titel; return b; };
const tippFeld = (t) => { const tag = String(t?.tagName ?? '').toUpperCase(); return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable === true; };

/**
 * opt: { beatVon() -> beat | null, aendere(label, befehle) -> Promise<boolean>, spurAendern(spur_id, feld, wert, label), projekt() -> live project | null,
 *        holeJson(weg, daten), oeffneLive?(), melde?, dokument? (where Esc is caught; tests pass their own), raster?(deck) -> grid of the place,
 *        beiOffen?(open) called when the pop-up opens (true) and closes (false); the main window reports the view `studio` meanwhile }.
 * Returns { oeffne(deck, anker), schliesse(), istOffen(), ereignis(a, f), projekt() }; the page feeds ereignis and projekt with the events it already gets.
 */
export function bindeLoopdeckGross(opt = {}) {
  const melde = opt.melde ?? meldeStandard;
  const dok = opt.dokument ?? globalThis.document;
  let halbGebaut = null;   // the teardown of a pop-up whose build is running: a build that throws is cleaned up from here
  let offen = null;   // the open pop-up: { nr, schliesse, ereignis, projekt, zeichneKopf, wurzel }
  // one registration per page (the lists below have no way to unregister): the focus source and the redraw of the head when the place's stand changes
  fokus.registriere('session', () => (offen?.spaltenId() ? { spur_id: offen.spaltenId() } : null));
  beiExportAenderung(() => offen?.zeichneKopf());

  function baue(nr, anker) {
    let stand = null, nummer = 0, lauf = 0, geplant = false, zu = false;
    let wahl = null;           // { spur_id, zelle } the selected cell
    let spaltenId = null;      // the selected column (the columns and the TRACKS card of the dock follow each other)
    let spalten = new Map();   // spur_id -> { h, zug, spalte (the model), host }
    let unterschrift = '';
    let schreibKette = Promise.resolve(), ablageLaeuft = false;
    let popoverBeiTaste = false;   // a dock popover was open when this Esc started: it closes first, the pop-up stays
    const win = globalThis.window;
    const merkePopover = (e) => { if (e.key === 'Escape') popoverBeiTaste = !!(globalThis.document?.body ?? dok?.body)?.querySelector?.('.p-ins-schwebend'); };

    const wurzel = el('div', 'ldg-overlay');
    const panel = el('div', 'ldg-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', `Loop deck ${nr}`); panel.dataset.deck = String(nr); panel.tabIndex = -1; panel.setAttribute('tabindex', '-1');
    wurzel.append(panel);
    halbGebaut = abbauen;

    // ---- head: the band head, the grid select and STOP ALL of this deck, the close key
    const kopf = el('div', 'ldg-kopf'), band = el('div', 'band');
    const bu = el('span', 'bu', ''), art = el('span', 'art', 'LOOPS'), gn = el('span', 'gn', `LOOP ${nr}`);
    band.append(bu, art, gn);
    const raster = el('span', 'ld-raster'); raster.setAttribute('role', 'group'); raster.setAttribute('aria-label', 'Launch grid');
    const rasterKnoepfe = RASTER.map(([wert, text]) => {
      const b = taste('ld-r', text, `Launch on the next grid point: ${text}`); b.dataset.raster = wert;
      b.addEventListener('click', async () => { if (await sende('/loopdeck/raster', { deck: nr, raster: wert })) ladeStand(); });
      raster.append(b); return b;
    });
    const stoppAlle = taste('ld-stopall', 'STOP ALL', 'Stop every track of this deck on the next grid point'); stoppAlle.dataset.stoppAlle = '1';
    stoppAlle.addEventListener('click', () => sende('/loopdeck/stopp', { deck: nr }));
    const zuTaste = taste('ldg-zu', '×', 'Close (Esc)'); zuTaste.setAttribute('aria-label', 'Close');
    zuTaste.addEventListener('click', () => schliesse());
    kopf.append(band, raster, stoppAlle, zuTaste);

    // ---- middle: the four columns and the scene column of the deck
    const mitte = el('div', 'ldg-mitte'), rasterEl = el('div', 'ldg-spalten'), szenenEl = el('aside', 'ldg-szenen');
    szenenEl.setAttribute('id', 'ldg-szenen');
    for (let z = 1; z <= ZELLEN; z++) {
      const b = taste('ld-szene', String(z), `Launch row ${z} of all tracks`); b.dataset.zeile = String(z);
      b.addEventListener('click', () => sende('/loopdeck/szene', { deck: nr, zeile: z }));
      szenenEl.append(b);
    }
    mitte.append(rasterEl, szenenEl);
    const untenEl = el('div', 'ldg-unten'); untenEl.setAttribute('id', 'session-unten');   // the dock and editor CSS key on this id: one pop-up at a time
    panel.append(kopf, mitte, untenEl);

    // ---- writes
    async function sende(pfad, daten) {
      try {
        const r = await jsonPost(pfad, daten);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.ok === false) { melde(j?.text ?? j?.fehler ?? `${pfad} refused`, true); return null; }
        return j;
      } catch (e) { melde(`page server unreachable: ${e.message}`, true); return null; }
    }
    // a model write succeeded: this view and the place read again
    const nachSchreiben = () => { holeStand(); ladeStand(); };
    const nach = (p) => p.then((ok) => { if (ok) nachSchreiben(); return ok; });

    // ---- the cell menu (the one of the place, built once per open)
    const zellmenue = baueMenue((koerper) => { const m = zellmenue.ctx; if (m) nach(sende('/loopdeck/zelle', { deck: nr, spur: m.spur, zelle: m.zelle, ...koerper }).then((j) => !!j)); });
    zellmenue.ctx = null;
    panel.append(zellmenue.knoten);
    panel.addEventListener('pointerdown', (e) => { if (zellmenue.istOffen() && !zellmenue.knoten.contains(e.target)) zellmenue.schliesse(); });
    function oeffneZellmenue(sp, zelle, anker2) {
      const z = sp.zellen?.[zelle - 1];
      if (!z || z.halten) return;
      zellmenue.ctx = { spur: sp.spur, zelle };
      zellmenue.oeffne(z, anker2);
    }

    // ---- the bottom area: CLIP editor of the selected cell, DEVICES dock
    const unten = baueUnten(untenEl, { editor: {
      schreibeZelle: (sp, index, felder) => nach(sende('/loopdeck/zelle', { deck: sp.deck, spur: sp.spur, zelle: index, ...felder }).then((j) => !!j)),
      aendere: (label, befehle) => nach(opt.aendere ? opt.aendere(label, befehle) : Promise.resolve(false)),
      // the generic write of the editor tabs: the answer is { ok, ... } or { ok: false, text }; the stand is read again before it answers.
      // One request in flight at a time, in the order of the gestures: the project rev moves with every write.
      sende: (pfad, daten) => {
        const l = schreibKette.then(async () => {
          try {
            const r = await jsonPost(pfad, daten), j = await r.json().catch(() => ({}));
            if (!r.ok || j?.ok === false) return { ok: false, text: j?.text ?? j?.fehler ?? `${pfad} refused` };
            await holeStand(); ladeStand();
            return { ...j, ok: true };
          } catch (e) { return { ok: false, text: `page server unreachable: ${e.message}` }; }
        });
        schreibKette = l;   // never rejects: the body catches
        return l;
      },
      waehle: (spur_id, zelle) => waehleZelle(spur_id, zelle),
      melde,
    } });
    let dock = null;
    const dockEl = el('div', 'w-pan w-dock session-dock'); dockEl.setAttribute('data-w', 'dock-wurzel');
    unten.koerper('DEVICES').append(dockEl);
    dock = montiereSessionDock({
      dockEl, projekt: () => opt.projekt?.() ?? null,
      spalten: () => deckSpalten()?.spalten ?? [],
      aendere: (label, befehle) => (opt.aendere ? opt.aendere(label, befehle) : Promise.resolve(false)),
      melde, holeJson: (w, k) => (opt.holeJson ? opt.holeJson(w, k) : Promise.resolve({ status: 0, j: null })),
      spaltenWahl: { lies: () => spaltenId, setze: (id) => waehleSpalte(id, true) },
    });

    // ---- selection
    function waehleSpalte(id, ausKarte = false) {
      if (!id) return;
      const neu = id !== spaltenId;
      spaltenId = id;
      for (const [sid, s] of spalten) s.host.classList.toggle('spalte-gewaehlt', sid === id);
      if (ausKarte) spalten.get(id)?.host.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      if (neu || ausKarte) fokus.melde({ spur_id: id }, 'session');
      dock.wahl();
    }
    function waehleZelle(spur_id, zelle) { wahl = { spur_id, zelle }; zeichneSpalten(); zeigeAuswahl(true); waehleSpalte(spur_id); }
    function zeigeAuswahl(erzwingen = false) {
      const sp = wahl ? spalten.get(wahl.spur_id)?.spalte : null;
      unten.editor.zeige(sp ? { spalte: sp, index: wahl.zelle } : null, erzwingen);
    }

    // a library loop or another cell dropped on a cell: load or move through the routes of the loop deck, then read the stand again
    async function ablegen(sp, zelle, inhalt) {
      if (ablageLaeuft || sp.deck == null || sp.spur == null) return;
      const ziel = { deck: sp.deck, spur: sp.spur, zelle };
      if (inhalt.art === 'zelle') { const v = inhalt.von; if (v.deck === ziel.deck && v.spur === ziel.spur && v.zelle === ziel.zelle) return; }
      ablageLaeuft = true;
      try {
        const j = inhalt.art === 'zelle' ? await sende('/loopdeck/bewegen', { von: inhalt.von, nach: ziel }) : await sende('/loopdeck/laden', { ...ziel, quelle: inhalt.quelle });
        if (!j) return;
        melde(inhalt.art === 'zelle' ? `Moved to LOOP ${ziel.deck}, track ${ziel.spur}, cell ${ziel.zelle}` : `Loaded into LOOP ${ziel.deck}, track ${j.spur ?? ziel.spur}, cell ${j.zelle ?? ziel.zelle}`);
        await holeStand(); ladeStand();
      } finally { ablageLaeuft = false; }
    }

    // ---- the columns of this deck from the stand
    function deckSpalten() {
      if (!stand) return null;
      for (const c of stand.container ?? []) if (c.typ === 'loops' && c.spalten?.[0]?.deck === nr) return { bu: c.buchstabe, name: c.name || `LOOP ${nr}`, spalten: c.spalten };
      for (const d of stand.geparkt ?? []) if (d[0]?.deck === nr) return { bu: '·', name: `LOOP ${nr}`, spalten: d };
      return null;
    }
    function raeume() {
      for (const s of spalten.values()) { s.zug?.entferne(); s.h.entferne(); s.host.remove(); }
      spalten = new Map(); unterschrift = ''; rasterEl.replaceChildren();
    }
    function baueSpalten(liste) {
      raeume();
      for (const sp of liste) {
        const host = el('div', 'spalte-host'); host.dataset.spur = sp.spur_id;
        const eintrag = { h: null, zug: null, spalte: sp, host };
        eintrag.h = baueSpalte(host, {
          variante: 'voll',
          beiStart: (zelle) => sende('/session/start', { spur_id: sp.spur_id, zelle }),
          beiStopp: () => sende('/session/stopp', { spur_id: sp.spur_id }),
          beiWahl: (zelle) => waehleZelle(sp.spur_id, zelle),
          beiAblegen: (zelle, inhalt) => ablegen(sp, zelle, inhalt),
          beiZiehen: (zelle, e) => schreibeZelle(e, { deck: sp.deck, spur: sp.spur, zelle }),
          beiMenue: (zelle, anker2) => oeffneZellmenue(eintrag.spalte, zelle, anker2),
        });
        eintrag.zug = baueZug(host.querySelector('.zug-slot'), { sende: (d) => sende('/loopdeck/spur', d), spurAendern: opt.spurAendern });
        rasterEl.append(host);
        spalten.set(sp.spur_id, eintrag);
      }
    }
    function zeichneSpalten() {
      for (const [id, s] of spalten) { s.h.zeichne(s.spalte, wahl?.spur_id === id ? wahl.zelle : null, stand?.bpm); s.zug?.zeichne(s.spalte); }
    }
    function zeichneKopf() {
      const g = deckSpalten(), r = (opt.raster ?? deckRaster)(nr);
      if (g) { if (bu.textContent !== g.bu) bu.textContent = g.bu; if (gn.textContent !== g.name) gn.textContent = g.name; }
      for (const b of rasterKnoepfe) { const an = b.dataset.raster === r; b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an)); }
    }
    function leer(text) {
      raeume(); wahl = null; spaltenId = null; unten.editor.zeige(null, true); szenenEl.hidden = true;
      const z = el('div', 'session-leer'); z.append(el('span', 'sl-text', text));
      if (opt.oeffneLive) { const b = taste('sl-knopf', 'OPEN LIVE'); b.addEventListener('click', async () => { await opt.oeffneLive(); holeStand(); }); z.append(b); }
      rasterEl.append(z);
    }
    function zeichneAlles() {
      const g = deckSpalten();
      if (!g) { leer(stand?.container ? `LOOP ${nr} does not exist yet: create it in its place` : 'No live project open'); zeichneKopf(); return; }
      szenenEl.hidden = false;
      const u = JSON.stringify(g.spalten.map((s) => s.spur_id));
      if (u !== unterschrift) { baueSpalten(g.spalten); unterschrift = u; }
      const neu = new Map(g.spalten.map((sp) => [sp.spur_id, sp]));
      for (const [id, s] of spalten) s.spalte = neu.get(id) ?? s.spalte;
      zeichneKopf(); zeichneSpalten(); zeigeAuswahl();
      if (spaltenId && !spalten.has(spaltenId)) spaltenId = null;
      for (const [sid, s] of spalten) s.host.classList.toggle('spalte-gewaehlt', sid === spaltenId);
      dock.projekt(opt.projekt?.() ?? null);
    }
    async function holeStand() {
      const mein = ++nummer;
      let r, j;
      try { r = await fetch('/session/stand'); j = await r.json().catch(() => ({})); } catch (e) { if (!zu) melde(`page server unreachable: ${e.message}`, true); return; }
      if (mein !== nummer || zu) return;   // a newer request is on its way, or the pop-up closed meanwhile
      if (!r.ok || j?.ok === false || !Array.isArray(j?.container)) {
        if (j?.grund === 'kein_projekt') { stand = null; leer('No live project open'); } else melde(j?.text ?? 'Loop deck: the stand could not be read', true);
        return;
      }
      stand = j; zeichneAlles();
    }
    const holeSpaeter = () => {   // one request per animation frame, however many events came
      if (geplant) return;
      geplant = true;
      requestAnimationFrame(() => { geplant = false; if (!zu) holeStand(); });
    };
    function bild(g) {
      if (zu || g !== lauf) return;
      if (stand) {
        const b = opt.beatVon?.();
        const beat = Number.isFinite(b) && b > 0 ? b : stand.beat;
        for (const s of spalten.values()) s.h.position(beat, stand.bpm);
        dock.bild(performance.now());
      }
      requestAnimationFrame(() => bild(g));
    }

    function abbauen() {
      if (zu) return;
      zu = true; lauf++; nummer++;
      for (const s of spalten.values()) { s.zug?.entferne(); s.h.entferne(); }
      spalten = new Map();
      dok?.removeEventListener?.('keydown', beiTaste);
      win?.removeEventListener?.('keydown', merkePopover, true);
      wurzel.remove();
    }
    // Esc closes (an open cell menu first); inside a text field it keeps its meaning of putting the old text back
    function beiTaste(e) {
      if (e.key !== 'Escape') return;
      if (popoverBeiTaste) { popoverBeiTaste = false; return; }   // the first Esc closes only the dock popover (it closed itself on window capture)
      if (zellmenue.istOffen()) { e.preventDefault?.(); e.stopPropagation?.(); zellmenue.schliesse(); return; }
      if (tippFeld(e.target)) return;
      e.preventDefault?.(); e.stopPropagation?.();
      schliesse();
    }
    dok?.addEventListener?.('keydown', beiTaste);
    win?.addEventListener?.('keydown', merkePopover, true);   // window capture runs before the popover's own capture listener (registered later) removes it

    zeichneKopf();
    (globalThis.document?.body ?? dok?.body)?.append(wurzel);
    zuTaste.focus?.();
    holeStand();
    const g = ++lauf; requestAnimationFrame(() => bild(g));
    halbGebaut = null;

    return {
      nr, anker, wurzel, schliesse: abbauen, zeichneKopf, spaltenId: () => spaltenId,
      projekt: () => dock.projekt(opt.projekt?.() ?? null),
      ereignis(a, f) {
        dock.ereignis(a, f);
        if (a === 'proj' || a === 'stand') { holeSpaeter(); return; }   // 'stand': the stream (re)connected, run states may have changed unseen
        if (a !== 'session' || !stand) return;
        const s = f && typeof f.spur_id === 'string' ? spalten.get(f.spur_id) : null;
        if (!s || !f.lauf || typeof f.lauf !== 'object') return;
        s.spalte.lauf = f.lauf;
        s.h.zeichne(s.spalte, wahl?.spur_id === f.spur_id ? wahl.zelle : null, stand.bpm);
      },
    };
  }

  function schliesse() {
    if (!offen) return;
    const a = offen.anker;
    offen.schliesse(); offen = null;
    opt.beiOffen?.(false);
    a?.focus?.({ preventScroll: true });
  }
  return {
    oeffne(nr, anker) {
      if (offen?.nr === nr) return;
      if (offen) { offen.schliesse(); offen = null; }
      try { offen = baue(nr, anker); } catch (e) {   // a failed build leaves nothing behind and the page reports closed
        halbGebaut?.(); halbGebaut = null; offen = null; opt.beiOffen?.(false); throw e;
      }
      opt.beiOffen?.(true);
    },
    schliesse,
    istOffen: () => offen !== null,
    ereignis: (a, f) => offen?.ereignis(a, f),
    projekt: () => offen?.projekt(),
  };
}
