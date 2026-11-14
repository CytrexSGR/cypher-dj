// DJ view places (plan 2026-11-13, task 13): the pure model of the four places of the DJ view. No DOM here, so it runs in node tests.
// A place shows one of four types (REMIX is the fourth: the fx-remix device on the DJ master or a deck, no DJ channel; remix_platz.js): TRACK (deck N for place N, there is no deck choice), STRUDEL (the generator strips erz/1..3) or LOOPS (the two
// loop slots on pad/1 and pad/2). Strudel and Loops may appear once; a place changes type only while it is silent. The layout is kept in the
// browser (localStorage key djk-plaetze); every access is in try/catch.

export const SCHLUESSEL = 'djk-plaetze';
export const PLAETZE = [1, 2, 3, 4];
export const TYPEN = ['track', 'strudel', 'loops', 'remix'];
export const LAYOUT_STANDARD = Object.freeze(['track', 'track', 'strudel', 'loops']);
const EINMALIG = ['strudel', 'loops', 'remix'];
export const KANAL_OFFEN_DB = -26;

// Which types a place may show. Any place may show any type; the "at most once" rule is a property of the layout, not of the place.
export const erlaubt = (platz, typ) => PLAETZE.includes(platz) && TYPEN.includes(typ);

// A layout is valid when it has four known types and Strudel and Loops appear at most once.
export function gueltig(layout) {
  if (!Array.isArray(layout) || layout.length !== PLAETZE.length) return false;
  if (!layout.every((t, i) => erlaubt(i + 1, t))) return false;
  return EINMALIG.every((t) => layout.filter((x) => x === t).length <= 1);
}

export function ladeLayout(storage) {
  try {
    const roh = storage?.getItem(SCHLUESSEL);
    if (roh == null) return [...LAYOUT_STANDARD];
    const l = JSON.parse(roh);
    return gueltig(l) ? [...l] : [...LAYOUT_STANDARD];
  } catch { return [...LAYOUT_STANDARD]; }
}
export function speichereLayout(storage, layout) {
  try { storage?.setItem(SCHLUESSEL, JSON.stringify(layout)); return true; } catch { return false; }
}

// The core channels a place owns: its silence is judged over these.
export function kanaele(layout, platz) {
  const t = layout[platz - 1];
  if (t === 'track') return [`deck/${platz}`];
  if (t === 'strudel') return ['erz/1', 'erz/2', 'erz/3'];
  if (t === 'loops') return ['pad/1', 'pad/2'];
  return [];
}

// Page copy of kanalOffen (hand_operation.ts): open when trim plus fader is above -26 dB; an unknown fader counts -200, an unknown trim 0.
// slots_paritaet.test.mjs runs both over the same table of values.
export function kanalOffen(regler, k) {
  return (regler?.[`${k}/trim`] ?? 0) + (regler?.[`${k}/fader`] ?? -200) > KANAL_OFFEN_DB;
}
export const pflAn = (regler, k) => (regler?.[`${k}/pfl`] ?? 0) >= 0.5;

// The silence rule: a place is silent when every channel it owns is closed and has PFL off. `offen` names what blocks the switch.
export function still(layout, platz, regler) {
  const offen = [];
  for (const k of kanaele(layout, platz)) {
    if (kanalOffen(regler, k)) offen.push({ kanal: k, grund: 'open' });
    else if (pflAn(regler, k)) offen.push({ kanal: k, grund: 'pfl' });
  }
  const text = offen.length === 0 ? '' : `${offen[0].kanal} ${offen[0].grund === 'pfl' ? 'has PFL on' : 'is open'}${offen.length > 1 ? ` (+${offen.length - 1})` : ''}`;
  return { still: offen.length === 0, offen, text };
}

// A switch of place `platz` to `typ`. `stumm` is the verdict of still() (or a plain boolean). Result: { ok: true, layout } or { ok: false, grund }
// with grund 'unbekannt', 'doppelt' (Strudel or Loops already sits in another place) or 'offen' (the place is not silent); the old layout is
// never touched.
export function wechsel(layout, platz, typ, stumm) {
  if (!gueltig(layout) || !erlaubt(platz, typ)) return { ok: false, grund: 'unbekannt' };
  if (layout[platz - 1] === typ) return { ok: true, layout: [...layout] };
  if (EINMALIG.includes(typ) && layout.some((t, i) => t === typ && i !== platz - 1)) return { ok: false, grund: 'doppelt' };
  const leise = stumm === true || stumm?.still === true;
  if (!leise) return { ok: false, grund: 'offen', text: stumm?.text ?? '' };
  const neu = [...layout]; neu[platz - 1] = typ;
  return { ok: true, layout: neu };
}

// Which types the switch of a place offers: `frei` is false for a type that already sits elsewhere (greyed out).
export function wahl(layout, platz) {
  return TYPEN.map((typ) => ({ typ, aktuell: layout[platz - 1] === typ,
    frei: !(EINMALIG.includes(typ) && layout.some((t, i) => t === typ && i !== platz - 1)) }));
}

// Header text of a place. zustand: { titel, tonart, bpm } of the deck for a track place; { ziel } (channel id or null) for remix; { slots: [{ nr, titel, tonart, takte }] } for loops (key and bars are left out when unknown).
const TYP_NAME = { track: 'TRACK', strudel: 'STRUDEL', loops: 'LOOPS', remix: 'REMIX' };
// Display name of a remix target channel: 'master' -> MASTER, 'deck/2' -> DECK 2.
const ZIEL_NAMEN = { master: 'MASTER', 'pad/1': 'L1', 'pad/2': 'L2', 'erz/1': 'DRUMS', 'erz/2': 'BASS', 'erz/3': 'MELODY' };
export const zielName = (kanal) => ZIEL_NAMEN[kanal] ?? (/^deck\/[1-4]$/.test(kanal ?? '') ? `DECK ${kanal.slice(5)}` : '');
export function kopf(platz, zustand = {}) {
  const typ = zustand.typ ?? 'track';
  if (typ === 'strudel') return 'STRUDEL';
  if (typ === 'remix') return `REMIX · ${zielName(zustand.ziel) || 'no target'}`;
  if (typ === 'loops') {
    const belegt = (zustand.slots ?? []).filter((s) => s?.titel);
    return belegt.length ? `LOOPS · ${belegt.map((s) => ['LOOP ' + s.nr, s.titel, s.tonart, Number.isFinite(s.takte) && s.takte > 0 ? `${s.takte} bar${s.takte === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')).join(' · ')}` : 'LOOPS · both slots empty';
  }
  if (!zustand.titel) return `${TYP_NAME.track} ${platz} · no track loaded`;
  const teile = [`${TYP_NAME.track} ${platz}`, zustand.titel];
  if (zustand.tonart) teile.push(zustand.tonart);
  if (Number.isFinite(zustand.bpm)) teile.push(String(Math.round(zustand.bpm)));
  return teile.join(' · ');
}

// The strips of one place, in order: a Track place one deck strip, Strudel one strip with the DR/BA/ME tabs, Loops the two slot strips.
export function streifen(layout, platz) {
  const t = layout[platz - 1];
  if (t === 'track') return [{ art: 'deck', platz, nr: platz, kanal: `deck/${platz}` }];
  if (t === 'strudel') return [{ art: 'erz', platz, kanaele: ['erz/1', 'erz/2', 'erz/3'] }];
  if (t === 'loops') return [1, 2].map((nr) => ({ art: 'pad', platz, nr, kanal: `pad/${nr}` }));
  return [];
}

// The mixer: two rows of three columns. Row 1 holds the strips of places 1 and 2, row 2 of places 3 and 4; the left place's strips sit left, the right
// place's strips right, a row with two strips leaves the middle column empty. A place without strips (Remix) leaves its side to the other place: two
// strips then take the outer columns, so they line up with a row of two decks. The master goes into the crossfader row below.
export function mixerPlan(layout) {
  const reihe = (links, rechts) => {
    const l = streifen(layout, links), r = streifen(layout, rechts);
    const zeile = [null, null, null];
    const allein = l.length === 0 ? r : r.length === 0 ? l : null;
    if (allein && allein.length === 2) return [allein[0], null, allein[1]];
    l.forEach((s, i) => { zeile[i] = s; });
    r.forEach((s, i) => { zeile[3 - r.length + i] = s; });
    return zeile;
  };
  return { reihen: [reihe(1, 2), reihe(3, 4)], master: 'xfader-reihe' };
}

// ---------- Applying a layout to the page nodes (task 14: grid cells over the existing nodes, no rebuild) ----------
// The nodes the places can show. A Track place N always shows deck N; Strudel and Loops are single nodes.
export const KNOTEN = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'strudel', 'loops', 'remix'];
export function knotenPlan(layout) {
  const platz = {};   // node key -> the place (1..4) that shows it
  layout.forEach((t, i) => { platz[t === 'track' ? `deck/${i + 1}` : t] = i + 1; });
  return { platz, aus: KNOTEN.filter((k) => platz[k] === undefined) };
}
// finde(key) returns the element of a node (or null). Only attributes change: data-platz (the grid cell), the hidden flag and the class platz-aus,
// so the node objects, their listeners and the Strudel editors stay as they are.
export function wendeAn(layout, finde) {
  const plan = knotenPlan(layout);
  for (const key of KNOTEN) {
    const el = finde(key);
    if (!el) continue;
    const p = plan.platz[key];
    if (p === undefined) { delete el.dataset.platz; el.hidden = true; el.classList.add('platz-aus'); }
    else { el.dataset.platz = String(p); el.hidden = false; el.classList.remove('platz-aus'); }
  }
  return plan;
}

// ---------- The mixer follows the places (task 15) ----------
export const ZUEGE = ['zug/deck/1', 'zug/deck/2', 'zug/deck/3', 'zug/deck/4', 'zug/erz', 'zug/pad/1', 'zug/pad/2'];
export const zugSchluessel = (s) => (s.art === 'erz' ? 'zug/erz' : `zug/${s.art}/${s.nr}`);
// Sets data-mix-zeile (1, 2) and data-mix-spalte (1..3) on every placed strip and marks the others (class platz-aus, which only the DJ view obeys: the
// Studio view keeps its own strips, and the hidden flag of the strips is not touched); only attributes change, the strips keep their listeners and state. finde(key) returns the element of a strip key or null.
export function wendeMixerAn(layout, finde) {
  const plan = mixerPlan(layout);
  const platziert = new Map();
  plan.reihen.forEach((zeile, z) => zeile.forEach((s, c) => { if (s) platziert.set(zugSchluessel(s), [z + 1, c + 1]); }));
  for (const key of ZUEGE) {
    const el = finde(key);
    if (!el) continue;
    const p = platziert.get(key);
    if (!p) { delete el.dataset.mixZeile; delete el.dataset.mixSpalte; el.classList.add('platz-aus'); }
    else { el.dataset.mixZeile = String(p[0]); el.dataset.mixSpalte = String(p[1]); el.classList.remove('platz-aus'); }
  }
  return plan;
}
