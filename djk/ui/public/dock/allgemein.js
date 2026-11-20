// The generic cards of the dock: a host that has `modell(stand)` (D2 of plan 2026-11-19-one-dock-stage-5a) hands the dock pure card data (D3) and an action
// table, and this module renders them with the building blocks of the project cards (row frame, chip, knob, OPEN, meter), so the cards of DJ and LIVE look
// and behave like the ones of STUDIO and PRODUCTION. It reads nothing of a view: everything goes through `host.modell`, `host.gestalt` and `host.aktionen`.
// Markup (D4): div.w-karte-dock[data-w="karte-live"][data-strang=<id>] with div.w-karte-kopf (colour field, name, subtitle, chips, + INSERT, CHANGE, OPEN) and
// div.w-karte-zeile (front knobs, the meter, the dB text).
import { mk, knopfEl, farbFeld, meterEl, aufKnopf, chipEl, baueReihen, kartenMenueWeicht } from './blocks.js';
import { neuerDrehknopf } from './drehknopf.js';

const FREI = 'button, input, select, .w-dreh';

/** Mount the generic cards of a host (host.modell is a function). Returns nothing; the host drives it through its beimProjekt hook. */
export function montiereKarten(host, T) {
  const dockEl = host.dockEl;
  let rahmen = null;          // { reihen, master } of baueReihen, built from the first model
  let gebaut = null;          // the gestalt key of the cards on screen
  let frisch = [];            // refresh functions of the cards on screen, each called with the current model card
  let karten = new Map();     // id -> card element
  let modell = null;
  const aktionen = host.aktionen;
  const karteVon = (id) => (modell ? [...modell.zeilen.flatMap((z) => z.karten), ...modell.master].find((k) => k.id === id) ?? null : null);
  const menueAn = (punkte, ev) => {
    if (!punkte?.length) return false;
    ev.preventDefault?.();
    host.oeffneMenue(punkte, ev.clientX ?? 0, ev.clientY ?? 0);
    return true;
  };

  function baue(m) {
    if (!rahmen) rahmen = baueReihen(dockEl, m.zeilen.map((z) => ({ key: z.key, titel: z.titel, w: z.w })), !!host.masterSpalte);
    frisch = []; karten = new Map();
    for (const z of m.zeilen) rahmen.reihen[z.key]?.replaceChildren(...z.karten.map((k) => allgemeineKarte({ host, T, aktionen, frisch, karteVon, menueAn }, k, karten)));
    const ziel = rahmen.master ?? rahmen.reihen[m.zeilen[m.zeilen.length - 1]?.key];
    const master = m.master.map((k) => allgemeineKarte({ host, T, aktionen, frisch, karteVon, menueAn }, k, karten));
    if (rahmen.master) rahmen.master.replaceChildren(...master); else ziel?.append(...master);
  }
  function leere() {
    if (rahmen) { for (const r of Object.values(rahmen.reihen)) r.replaceChildren(); rahmen.master?.replaceChildren(); }
    frisch = []; karten = new Map(); gebaut = null; modell = null;
  }

  host.beimProjekt((stand) => {
    if (!stand) { leere(); return; }
    const m = host.modell(stand);
    modell = m;
    const g = host.gestalt ? host.gestalt(m) : JSON.stringify(m);
    if (g !== gebaut) { gebaut = g; baue(m); }
    for (const f of frisch) f();
  });
}

/** One generic card. `werk` = { host, T, aktionen, frisch, karteVon, menueAn }; `karten` collects the element by id. */
export function allgemeineKarte(werk, karte, karten = new Map()) {
  const { T, aktionen, frisch, karteVon, menueAn } = werk;
  const id = karte.id;
  const jetzt = () => karteVon(id) ?? karte;
  const e = mk('div', `w-karte-dock${karte.art === 'master' ? ' w-karte-master' : ''}`, 'karte-live');
  e.setAttribute('data-strang', id);
  if (karte.farbe) e.style.setProperty('--farbe', karte.farbe);
  karten.set(id, e);

  // ---- head: colour field, name, subtitle, what plays, chips, + INSERT, CHANGE, OPEN ----
  const kopf = mk('div', 'w-karte-kopf');
  if (karte.kurz && karte.farbe) kopf.append(farbFeld(karte.kurz, karte.farbe));
  kopf.append(mk('b', 'w-karte-name', null, karte.name));
  let unter = null;
  if (karte.untertitelArt) {
    const klasse = karte.untertitelArt === 'instrument' ? ' w-karte-instrument' : karte.untertitelArt === 'inhalt' ? ' w-karte-inhalt' : ' w-karte-effekt';
    unter = mk('span', `w-karte-geraet${klasse}`, 'karte-untertitel', karte.untertitel);
    unter.title = karte.untertitelTitel || karte.untertitel;
    kopf.append(unter);
  }
  let was = null;
  if (karte.inhalt) { was = mk('span', 'w-karte-was', 'karte-was', karte.inhalt.text); was.title = karte.inhalt.titel; kopf.append(was); }
  kopf.append(mk('span', 'w-sp'));

  const chips = [];
  let abschnitt = null;
  for (const t of karte.teile) {
    if (t.abschnitt && t.abschnitt !== abschnitt) { abschnitt = t.abschnitt; kopf.append(mk('span', 'w-karte-abschnitt', null, t.abschnitt)); }
    const b = chipEl({ teil: t.teil, text: t.text, an: t.an, titel: t.titel }, {
      klick: (knopf) => aktionen.chip?.(id, t.teil, knopf),
      menue: (ev) => menueAn(aktionen.chipMenue?.(id, t.teil), ev),
    });
    const gr = t.gr ? mk('span', 'w-chip-gr') : null;
    if (gr) b.append(gr);
    chips.push({ teil: t.teil, b, gr, skala: t.grSkala || 24 });
    kopf.append(b);
  }
  let plus = null;
  if (karte.plus) {
    plus = knopfEl('w-chip-teil w-chip-plus', 'karte-plus', T.plus, karte.plus.titel);
    plus.disabled = !!karte.plus.aus;
    plus.addEventListener('click', (ev) => { ev.stopPropagation?.(); aktionen.plus?.(id, plus); });
    kopf.append(plus);
  }
  if (karte.wechsel) {
    const w = knopfEl('w-karte-knopf', 'karte-wechsel', T.wechsel, karte.untertitelArt === 'effekt' ? 'Change the effect of this return' : 'Change the instrument of this channel');
    w.addEventListener('click', (ev) => { ev.stopPropagation?.(); aktionen.wechsel?.(id, w); });
    kopf.append(w);
  }
  let auf = null;
  if (karte.auf !== undefined && (karte.auf || karte.art === 'ret')) {
    auf = aufKnopf(T, (b) => aktionen.auf?.(id, b), !karte.auf);
    kopf.append(auf);
  }
  e.append(kopf);

  // ---- front knobs, meter, dB text ----
  const zeile = mk('div', 'w-karte-zeile');
  const knoepfe = mk('div', 'w-karte-knoepfe', 'karte-knoepfe');
  for (const kn of karte.knoepfe) {
    const d = neuerDrehknopf({
      w: 'karte-knopf', name: kn.name, titel: kn.titel, farbe: karte.farbe || undefined,
      lies: () => aktionen.wert?.(id, kn.param) ?? null,
      setze: (k) => aktionen.setze?.(id, kn.param, k),
      ende: () => aktionen.ende?.(id, kn.param),
      text: (k) => aktionen.text?.(id, kn.param, k) ?? k.toFixed(2),
      vorgabe: kn.vorgabe ?? 0,
    });
    d.setAttribute('data-param', kn.param);
    frisch.push(d.frisch); d.frisch();
    knoepfe.append(d);
  }
  if (karte.knopfGruppe && karte.knoepfe.length) {
    const gruppe = mk('div', 'w-karte-gruppe');
    gruppe.append(mk('span', 'w-karte-gruppe-name', null, karte.knopfGruppe), knoepfe);
    zeile.append(gruppe);
  } else if (karte.knoepfe.length) zeile.append(knoepfe);
  if (karte.meter) zeile.append(meterEl(karte.meter));
  if (karte.pegelText) { const p = mk('span', 'w-karte-pegel'); p.setAttribute('data-fxpegel', id); zeile.append(p); }
  if (zeile.firstChild) e.append(zeile);

  // ---- gestures: a click on a free spot puts the card in front; the card menu stands back for a chip ----
  e.addEventListener('click', (ev) => { if (ev.target?.closest?.(FREI)) return; aktionen.vorn?.(id); });
  e.addEventListener('contextmenu', (ev) => {
    if (kartenMenueWeicht(ev.target)) return;
    if (!jetzt().menue) return;
    menueAn(aktionen.menue?.(id), ev);
  });

  // ---- refresh in place: chip state and GR bars, active, subtitle of an 'inhalt' card, what plays, + INSERT ----
  frisch.push(() => {
    const k = jetzt();
    e.classList.toggle('aktiv', !!k.aktiv);
    for (const c of chips) {
      const t = k.teile.find((x) => x.teil === c.teil);
      if (!t) continue;
      c.b.classList.toggle('aus', !t.an);
      let titel = t.titel;
      if (c.gr) {
        const db = aktionen.gr?.(id, c.teil);
        const da = typeof db === 'number' && Number.isFinite(db);
        c.gr.style.width = `${da ? Math.min(100, Math.max(0, (Math.abs(db) / c.skala) * 100)) : 0}%`;
        if (da && Math.abs(db) >= 0.05) titel = `${titel} · GR ${Math.abs(db).toFixed(1)} dB`;
      }
      if (c.b.title !== titel) c.b.title = titel;
    }
    if (unter && k.untertitelArt === 'inhalt' && unter.textContent !== k.untertitel) { unter.textContent = k.untertitel; unter.title = k.untertitel; }
    if (was && k.inhalt) {
      if (was.textContent !== k.inhalt.text) { was.textContent = k.inhalt.text; was.title = k.inhalt.titel; }
      was.classList.toggle('laeuft', !!k.inhalt.laeuft);
    }
    if (plus && k.plus) { plus.disabled = !!k.plus.aus; plus.title = k.plus.titel; }
  });
  return e;
}
