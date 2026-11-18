// One grouping module for every instrument picker (INSTRUMENTS area, strip pickers, SEQ and workbench menus, PRODUCTION device browser).
// The axis is one page-wide choice: the instruments are grouped by synthesis type (`prinzip`) or by role (`kategorie`, called `rolle` here).
// Everything is pure except the axis storage (leseAchse, merkeAchse); tests/instrument_gruppen.test.mjs.

export const ACHSEN = ['prinzip', 'rolle'];
/** Synthesis types (ids as in kategorien.json `prinzip`). `host` is the Surge/plugin entry of erz/2 and erz/3, `sonst` collects graphs without the field. */
export const PRINZIPIEN = [
  { id: 'analog', name: 'Analog' }, { id: 'wavetable', name: 'Wavetable' }, { id: 'fm', name: 'FM' }, { id: 'physik', name: 'Strings & Bodies' },
  { id: 'granular', name: 'Granular' }, { id: 'sampler', name: 'Sampler' }, { id: 'drums', name: 'Drum Synthesis' }, { id: 'feedback', name: 'Feedback' },
  { id: 'host', name: 'Host (Surge/plugins)' }, { id: 'sonst', name: 'Other' },
];
/** Instrument roles (ids as in kategorien.json `kategorie`); the same `host` and `sonst` at the end. */
export const GRAPH_KATEGORIEN = [
  { id: 'drums', name: 'Drums' }, { id: 'bass', name: 'Bass' }, { id: 'lead', name: 'Lead' }, { id: 'pad', name: 'Pad & Poly' },
  { id: 'keys', name: 'Keys & Plucks' }, { id: 'textur', name: 'Texture & FX' }, { id: 'sampler', name: 'Sampler' }, { id: 'host', name: 'Host (Surge/plugins)' }, { id: 'sonst', name: 'Other' },
];

const FELD = { prinzip: 'prinzip', rolle: 'kategorie' };
const achseVon = (a) => (a === 'rolle' ? 'rolle' : 'prinzip');
export const andereAchse = (a) => (achseVon(a) === 'prinzip' ? 'rolle' : 'prinzip');
const nameVon = (e) => String(e?.name ?? e?.titel ?? e?.text ?? e?.wert ?? '');

/** The ordered groups `[{id, name}]` of an axis. */
export const gruppenVon = (achse) => (achseVon(achse) === 'rolle' ? GRAPH_KATEGORIEN : PRINZIPIEN);

/** The group id of an entry on an axis: `host` for the host entry (`host: true`), `sonst` for an entry without the field or with an id the axis does not know,
 *  so that no instrument ever drops out of a picker. */
export function gruppeVon(eintrag, achse) {
  if (eintrag?.host === true) return 'host';
  const a = achseVon(achse), id = eintrag?.[FELD[a]];
  return typeof id === 'string' && id !== 'host' && gruppenVon(a).some((g) => g.id === id) ? id : 'sonst';
}

/** The short name of the OTHER axis (`Bass` behind an instrument grouped by type, `Analog` behind one grouped by role); '' when unknown. */
export function nebenText(eintrag, achse) {
  const id = gruppeVon(eintrag, andereAchse(achse));
  if (id === gruppeVon(eintrag, achse)) return '';   // sampler and drums exist on both axes: no "· Sampler" behind an instrument in the group Sampler
  return id === 'sonst' || id === 'host' ? '' : gruppenVon(andereAchse(achse)).find((g) => g.id === id)?.name ?? '';
}

/** The label of an entry in an option or a menu: its name plus ` · <nebenText>` when the other axis is known. */
export function mitNeben(name, eintrag, achse) {
  const n = nebenText(eintrag, achse);
  return n ? `${name} · ${n}` : name;
}

/** The entries ordered by group of the axis, inside a group by the order of the other axis, then by name. Does not change its argument. */
export function sortiere(eintraege, achse) {
  const a = achseVon(achse), b = andereAchse(a);
  const rang = (e, ax) => { const i = gruppenVon(ax).findIndex((g) => g.id === gruppeVon(e, ax)); return i < 0 ? gruppenVon(ax).length : i; };
  return (eintraege ?? []).map((e, i) => ({ e, i }))
    .sort((x, y) => rang(x.e, a) - rang(y.e, a) || rang(x.e, b) - rang(y.e, b) || nameVon(x.e).localeCompare(nameVon(y.e)) || x.i - y.i)
    .map((x) => x.e);
}

// ---------- the axis: page-wide, kept in localStorage (key djk-instrument-achse), default 'prinzip' ----------
const ACHSE_SCHLUESSEL = 'djk-instrument-achse';
let gemerkt = null;   // without a usable storage the choice still holds until the page is reloaded
const hoerer = [];
export function leseAchse() {
  try { const v = globalThis.localStorage?.getItem(ACHSE_SCHLUESSEL); if (ACHSEN.includes(v)) return v; } catch { /* without storage: the choice of this page load */ }
  return gemerkt ?? ACHSEN[0];
}
export function merkeAchse(a) {
  if (!ACHSEN.includes(a)) return;
  const alt = leseAchse();
  gemerkt = a;
  try { globalThis.localStorage?.setItem(ACHSE_SCHLUESSEL, a); } catch { /* without storage: only now */ }
  if (a !== alt) for (const f of hoerer) f(a);
}
/** `f(achse)` runs after the axis changed: the pickers that are not focused redraw. Nothing is sent to the server. */
export function beiAchse(f) { hoerer.push(f); }

// ---------- the group remembered per channel and axis: { <kanal>: { prinzip?: id, rolle?: id } } (an old string value is the role) ----------
/** Reads the stored text of `djk-instrument-kat` into `{kanal: {prinzip?, rolle?}}`; anything that does not fit is dropped. */
export function katSpeicherLesen(roh) {
  let r = null;
  try { r = JSON.parse(roh ?? '{}'); } catch { return {}; }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  const aus = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'string') aus[k] = { rolle: v };
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = {};
      for (const a of ACHSEN) if (typeof v[a] === 'string') o[a] = v[a];
      aus[k] = o;
    }
  }
  return aus;
}
/** A copy of the memory with `id` set for the channel on the axis. */
export const katMerken = (speicher, kanal, achse, id) => ({ ...speicher, [kanal]: { ...(speicher?.[kanal] ?? {}), [achseVon(achse)]: id } });

// ---------- menus (SEQ instrument menu, workbench instrument menu) ----------
/** The entries of an instrument menu `wahl` (geraetWahl of seq_field.js: Baukasten, Kit, RB-338) as menu items: the Baukasten instruments under the group headers of the axis, then the kits and the RB-338 each in their own group, and as the last item the axis switch (`umschalten`).
 *  `graphen` = GET /graphen, for the group of each instrument. A click runs `aktion(entry)` with the entry of `wahl`. */
export function menuePunkte(wahl, graphen, achse, aktion, umschalten) {
  const a = achseVon(achse);
  const info = new Map((graphen ?? []).filter((g) => g && typeof g.name === 'string').map((g) => [g.name, g]));
  const baukasten = sortiere((wahl ?? []).filter((e) => e.gruppe === 'Baukasten').map((e) => ({ e, name: e.name, kategorie: info.get(e.name)?.kategorie, prinzip: info.get(e.name)?.prinzip })), a);
  const punkte = [];
  const eintrag = (x) => ({ text: mitNeben(x.e.text, x, a), aktion: () => aktion(x.e) });
  for (const g of gruppenVon(a)) {
    const in_ = baukasten.filter((x) => gruppeVon(x, a) === g.id);
    if (in_.length) punkte.push({ gruppe: true, text: g.name }, ...in_.map(eintrag));
  }
  let gruppe = null;
  for (const e of (wahl ?? []).filter((x) => x.gruppe !== 'Baukasten')) {
    if (e.gruppe !== gruppe) { gruppe = e.gruppe; punkte.push({ gruppe: true, text: gruppe }); }
    punkte.push({ text: e.text, aktion: () => aktion(e) });
  }
  // the switch is the LAST item: a menu focuses its first item when it opens, and Enter there must keep picking an instrument
  punkte.push({ gruppe: true, text: 'View' }, { text: a === 'prinzip' ? 'Group by role' : 'Group by type', aktion: umschalten });
  return punkte;
}

/** Opens a menu that carries the axis switch: `baue(achse, umschalten)` gives the items, `oeffne(punkte)` shows them. The switch stores the other axis and
 *  reopens the same menu (same place: `oeffne` closes the old one). */
export function oeffneAchsenMenue(baue, oeffne) {
  const zeige = () => { const a = leseAchse(); oeffne(baue(a, () => { merkeAchse(andereAchse(a)); zeige(); })); };
  zeige();
}
