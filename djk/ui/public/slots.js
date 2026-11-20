// DJ view places (plan 2026-11-13, task 13): the pure model of the four places of the DJ view. No DOM here, so it runs in node tests.
// A place shows one of four types: TRACK (deck N for place N, there is no deck choice), STRUDEL (the generator strips erz/1..3), LOOPS (the two
// loop slots on pad/1 and pad/2) or SEQ (patterns of notes, values and curves that play into the strip of deck N, seq_field.js; REMIX is an effect with its own window, remix_platz.js).
// Strudel and Loops may appear once, SEQ in every place; a place changes type only while it is silent, and a place leaves SEQ only while it holds no deck. The layout is kept in the
// browser (localStorage key djk-plaetze); every access is in try/catch.

export const SCHLUESSEL = 'djk-plaetze';
export const PLAETZE = [1, 2, 3, 4];
export const TYPEN = ['track', 'strudel', 'loops', 'seq'];   // REMIX was a fourth type until 2026-11-14; it is an effect and has its own window now (#remix)
export const LAYOUT_STANDARD = Object.freeze(['track', 'track', 'strudel', 'loops']);
const EINMALIG = ['strudel', 'loops'];
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
    const roh_l = JSON.parse(roh);
    const l = Array.isArray(roh_l) ? roh_l.map((t) => (t !== 'remix' ? t : roh_l.includes('strudel') ? 'track' : 'strudel')) : roh_l;   // a stored REMIX place becomes Strudel (Track when Strudel is elsewhere)
    return gueltig(l) ? [...l] : [...LAYOUT_STANDARD];
  } catch { return [...LAYOUT_STANDARD]; }
}
export function speichereLayout(storage, layout) {
  try { storage?.setItem(SCHLUESSEL, JSON.stringify(layout)); return true; } catch { return false; }
}

// The core channels a place owns: its silence is judged over these.
export function kanaele(layout, platz) {
  const t = layout[platz - 1];
  if (t === 'track' || t === 'seq') return [`deck/${platz}`];   // a SEQ deck plays into the strip of its place
  if (t === 'strudel') return ['erz/1', 'erz/2', 'erz/3'];
  if (t === 'loops') return ['pad/1', 'pad/2'];
  return [];
}

// LOAD needs a deck on a Track place: place N plays deck N (ADR 038), a SEQ place has no track deck.
export const ladeDeckDa = (layout, deck) => layout[deck - 1] === 'track';

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
// with grund 'unbekannt', 'doppelt' (Strudel or Loops already sits in another place) or 'offen' (the place is not silent); the old layout is never touched.
// `seqDa` says whether the place holds a SEQ deck: a SEQ place with a deck may switch away (Andreas 2026-11-20), the answer then carries `parken: true` and the
// page mutes the deck group first (on the next bar while the transport runs), so the parked deck stays in the live container, silent, and shows again when
// the place turns SEQ. Such a switch needs no silence: the deck is what sounds on the channel, and parking silences it.
export function wechsel(layout, platz, typ, stumm, seqDa = false) {
  if (!gueltig(layout) || !erlaubt(platz, typ)) return { ok: false, grund: 'unbekannt' };
  if (layout[platz - 1] === typ) return { ok: true, layout: [...layout] };
  if (EINMALIG.includes(typ) && layout.some((t, i) => t === typ && i !== platz - 1)) return { ok: false, grund: 'doppelt' };
  const parken = layout[platz - 1] === 'seq' && seqDa;   // the parked deck falls silent, so an open channel does not hold the place
  const leise = stumm === true || stumm?.still === true;
  if (!leise && !parken) return { ok: false, grund: 'offen', text: stumm?.text ?? '' };
  const neu = [...layout]; neu[platz - 1] = typ;
  return parken ? { ok: true, layout: neu, parken: true } : { ok: true, layout: neu };
}

// The page follows the server (2026-11-14): a SEQ deck sits on every place it was created for, whatever the browser's layout says (Cypher's hand tool picks the
// place, another browser has another layout, the live project may have arrived after the layout). `belegt` lists the places that hold a deck (null or absent: the
// project is unknown, nothing changes). A place that is not typed seq turns seq when stillVon(platz, layout) says it is silent (a verdict like the `stumm` of
// wechsel(): true, false or { still }); null or undefined means the verdict is not known yet, the place is left alone and not reported. A place that is not
// silent stays as it is and is listed in `offen`. Result: { layout, gewechselt, offen }; the layout is a copy, equal to the old one when nothing switched.
export function folgeServer(layout, belegt, stillVon) {
  const neu = Array.isArray(layout) ? [...layout] : [];
  const gewechselt = [], offen = [];
  if (!gueltig(layout) || !Array.isArray(belegt)) return { layout: neu, gewechselt, offen };
  for (const platz of [...new Set(belegt)].filter((n) => PLAETZE.includes(n)).sort((a, b) => a - b)) {
    if (neu[platz - 1] === 'seq') continue;
    const v = stillVon(platz, neu);
    if (v === null || v === undefined) continue;
    if (v === true || v?.still === true) { neu[platz - 1] = 'seq'; gewechselt.push(platz); } else offen.push(platz);
  }
  return { layout: neu, gewechselt, offen };
}

// Which types the switch of a place offers: `frei` is false for a type that already sits elsewhere (greyed out).
export function wahl(layout, platz) {
  return TYPEN.map((typ) => ({ typ, aktuell: layout[platz - 1] === typ,
    frei: !(EINMALIG.includes(typ) && layout.some((t, i) => t === typ && i !== platz - 1)) }));
}

// Header text of a place. zustand: { titel, tonart, bpm } of the deck for a track place; { folgen } (pattern count, absent without a deck) for SEQ; { ziel } (channel id or null) for remix; { slots: [{ nr, titel, tonart, takte }] } for loops (key and bars are left out when unknown).
const TYP_NAME = { track: 'TRACK', strudel: 'STRUDEL', loops: 'LOOPS', remix: 'REMIX', seq: 'SEQ' };
// Display name of a remix target channel: 'master' -> MASTER, 'deck/2' -> DECK 2.
const ZIEL_NAMEN = { master: 'MASTER', 'pad/1': 'L1', 'pad/2': 'L2', 'erz/1': 'DRUMS', 'erz/2': 'BASS', 'erz/3': 'MELODY' };
export const zielName = (kanal) => ZIEL_NAMEN[kanal] ?? (/^deck\/[1-4]$/.test(kanal ?? '') ? `DECK ${kanal.slice(5)}` : '');
export function kopf(platz, zustand = {}) {
  const typ = zustand.typ ?? 'track';
  if (typ === 'strudel') return 'STRUDEL';
  if (typ === 'seq') return `SEQ ${platz} · ${Number.isFinite(zustand.folgen) ? `${zustand.folgen} pattern${zustand.folgen === 1 ? '' : 's'}` : 'empty'}`;
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

// The mixer strips of one place, in order: a Track or SEQ place in the top row (places 1 and 2) one deck strip, Loops the two slot strips. Strudel has
// none in the mixer: its three channel strips (DRUMS, BASS, MELODY) sit inside the Strudel place (Andreas 2026-11-14: "wenn wir strudel kanalfader haben
// wollen gehören die ins strudel deck"). The main mixer has four channels, A, B, L1 and L2: a deck in place 3 or 4 has no strip on the page
// (Andreas 2026-11-14 on the "3" fader: "mach den auch im code weg, wird nicht gebraucht"; 2026-11-15: "nicht nur rausnehmen. löschen.").
export const ZUG_PLAETZE = [1, 2];
export function streifen(layout, platz) {
  const t = layout[platz - 1];
  if (t === 'track' || t === 'seq') return ZUG_PLAETZE.includes(platz) ? [{ art: 'deck', platz, nr: platz, kanal: `deck/${platz}` }] : [];   // a SEQ place owns the strip of deck N too
  if (t === 'loops') return [1, 2].map((nr) => ({ art: 'pad', platz, nr, kanal: `pad/${nr}` }));
  return [];
}

// The mixer (2026-11-14): a fixed middle column (master on top, beat FX and COLOR below) with the strips of the left place to its left and the
// strips of the right place to its right. A row is four slots [L2, L1, R1, R2]: L1 and R1 sit next to the middle, L2 and R2 only hold the second
// strip of a Loops place. A place without strips (Remix) leaves its side to the other place: two strips then sit around the middle (L1, R1), in line
// with a row of two decks. spalten gives the page grid column of each slot and of the middle; a column no row uses is left out of the grid.
export function mixerPlan(layout) {
  const reihe = (links, rechts) => {
    const l = streifen(layout, links), r = streifen(layout, rechts);
    const allein = l.length === 0 ? r : r.length === 0 ? l : null;
    if (allein && allein.length === 2) return [null, allein[0], allein[1], null];
    return [l.length === 2 ? l[0] : null, l.length === 2 ? l[1] : l[0] ?? null, r[0] ?? null, r[1] ?? null];
  };
  const reihen = [reihe(1, 2), reihe(3, 4)];
  const l2 = reihen.some((z) => z[0]), r2 = reihen.some((z) => z[3]);
  const L1 = l2 ? 3 : 2, mitte = L1 + 1;
  const spalten = { slots: [l2 ? 2 : null, L1, mitte + 1, r2 ? mitte + 2 : null], mitte, aussen: `${l2 ? 'l' : ''}${r2 ? 'r' : ''}` };
  return { reihen, spalten, master: 'mitte' };
}

// ---------- Applying a layout to the page nodes (task 14: grid cells over the existing nodes, no rebuild) ----------
// The nodes the places can show. A Track place N always shows deck N, a SEQ place N the node seq/N; Strudel and Loops are single nodes.
export const KNOTEN = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'strudel', 'loops', 'remix', 'seq/1', 'seq/2', 'seq/3', 'seq/4'];
export function knotenPlan(layout) {
  const platz = {};   // node key -> the place (1..4) that shows it
  layout.forEach((t, i) => { platz[t === 'track' ? `deck/${i + 1}` : t === 'seq' ? `seq/${i + 1}` : t] = i + 1; });
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
export const ZUEGE = ['zug/deck/1', 'zug/deck/2', 'zug/pad/1', 'zug/pad/2'];   // the Strudel strips live in the Strudel place
export const zugSchluessel = (s) => (s.art === 'erz' ? 'zug/erz' : `zug/${s.art}/${s.nr}`);
// Sets data-mix-zeile (1, 2) and data-mix-spalte (the page grid column, plan.spalten) on every placed strip and marks the others (class platz-aus, which only the DJ view obeys: the
// Studio view keeps its own strips, and the hidden flag of the strips is not touched); only attributes change, the strips keep their listeners and state. finde(key) returns the element of a strip key or null.
export function wendeMixerAn(layout, finde) {
  const plan = mixerPlan(layout);
  const platziert = new Map();
  plan.reihen.forEach((zeile, z) => zeile.forEach((s, c) => { if (s) platziert.set(zugSchluessel(s), [z + 1, plan.spalten.slots[c]]); }));
  for (const key of ZUEGE) {
    const el = finde(key);
    if (!el) continue;
    const p = platziert.get(key);
    if (!p) { delete el.dataset.mixZeile; delete el.dataset.mixSpalte; el.classList.add('platz-aus'); }
    else { el.dataset.mixZeile = String(p[0]); el.dataset.mixSpalte = String(p[1]); el.classList.remove('platz-aus'); }
  }
  return plan;
}

// ---------- The Studio view shows the deck strip of a SEQ place that has one (places 1 and 2; follow-up of task 7) ----------
// The Studio view has no deck strips (its strip row is DRUMS, BASS, MELODY, L1, L2), but a SEQ deck plays into the strip of deck/N: the fader, EQ, filter and PFL
// must be reachable there too. studioZuege lists the strips of the row for a layout; wendeStudioZuegeAn marks the deck strips of the SEQ places
// (data-studio-zug) and shows them, and returns their keys in the order of the places so that the page can put the nodes after L2. Only attributes
// change; the strip nodes are the ones the DJ view uses (listeners and state stay).
export const STUDIO_ZUEGE = ['zug/erz/1', 'zug/erz/2', 'zug/erz/3', 'zug/pad/1', 'zug/pad/2'];
const seqZuege = (layout) => ZUG_PLAETZE.filter((n) => layout[n - 1] === 'seq').map((n) => `zug/deck/${n}`);
export const studioZuege = (layout) => [...STUDIO_ZUEGE, ...seqZuege(layout)];
export function wendeStudioZuegeAn(layout, finde) {
  const seq = seqZuege(layout);
  for (const n of ZUG_PLAETZE) {
    const key = `zug/deck/${n}`, el = finde(key);
    if (!el) continue;
    if (seq.includes(key)) el.dataset.studioZug = '1'; else delete el.dataset.studioZug;
  }
  return seq;
}
