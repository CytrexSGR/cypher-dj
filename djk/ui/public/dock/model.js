// The pure card model of the shared dock: one project and a host's strip list in, the card rows out (no DOM, no I/O, never mutates the project).
import { effektKachel, rackTeile, masterTeile } from './stages.js';
import { pdcRechnen, msText, streifenText, latenzZeile } from '../production/pdc.js';
import { returnListe, sendWert, gruppenStreifenFolge, gruppenKette, gruppenEltern, ausgangWert } from '../production/routing.js';
import { geraetText } from '../seq_field.js';

const SEND_AUS_DB = -60;   // a send at or below this level counts as off

/** The short label of a strip in PRODUCTION: track number, G<nr>, R<nr>, M. */
export function produktionKurz(p, id) {
  if (id === 'master') return 'M';
  const g = (p?.gruppen ?? []).find((x) => x.id === id);
  if (g) return `G${g.nr}`;
  const r = (p?.returns ?? []).find((x) => x.id === id);
  if (r) return `R${r.nr}`;
  const s = (p?.spuren ?? []).find((x) => x.id === id);
  return s ? String(s.nr) : '';
}

/** Every track (instrument and audio) in project order: [{id, kurz, name, farbe}]. */
export const produktionZuege = (p) => (p?.spuren ?? []).map((s) => ({ id: s.id, kurz: String(s.nr), name: s.name, farbe: s.farbe ?? '' }));

/** The send knob label: the return name, 5 characters plus an ellipsis when longer than 6. */
/** Label and coalescing key of the master LEVEL. With the mixer switch (PRODUCTION) they are the label and key the master fader of the PRODUCTION mixer used,
 *  so every drag of the master level folds into one undo line; STUDIO keeps its own. */
export const masterLevelSchreiben = (schalter) => (schalter?.mischer
  ? { label: 'Master volume', schluessel: 'pm:fader' } : { label: 'Volume master', schluessel: 'master:fader' });

export const sendKurz = (name) => { const t = String(name ?? ''); return t.length > 6 ? `${t.slice(0, 5)}…` : t; };

/** The latency text and tooltip of one strip from a pdcRechnen result. */
export function latenzVon(pdc, id) {
  const r = pdc?.streifen?.[id];
  if (!r) return { text: '', titel: '' };
  const text = r.kette > 0 ? msText(r.kette) : r.bk > 0 ? '? ms' : '';
  return { text, titel: streifenText(r) };
}

/** The latency of the master card: the whole path while it is above zero; the tooltip is the project's latency line. */
export function masterLatenz(p, pdc, hostLage = null, graphLatenzen = null) {
  const g = pdc?.gesamt ?? 0;
  return g > 0 ? { text: msText(g), titel: latenzZeile(p, hostLage, graphLatenzen) } : { text: '', titel: '' };
}

const insertTeile = (strang) => (strang?.inserts ?? []).map((i) => { const k = effektKachel(i); return { teil: i.id, text: k.text, an: k.an, art: i.art, slot: i.slot }; });

/** The cards of the dock rows: { spuren, gruppen, effekte, master }. Host input: { zuege(p), kurz(p, id), schalter, hostLage?, graphLatenzen? }. */
export function dockModell(p, { zuege, kurz = produktionKurz, schalter = {}, hostLage = null, graphLatenzen = null } = {}) {
  const pdc = pdcRechnen(p, hostLage, graphLatenzen);
  const returns = returnListe(p);
  const spurVon = new Map((p?.spuren ?? []).map((s) => [s.id, s]));
  const gruppeVon = new Map((p?.gruppen ?? []).map((g) => [g.id, g]));
  const sendsVon = (strang) => (schalter.sends ? returns.map((r) => ({ return_id: r.id, name: r.name, kurz: sendKurz(r.name), db: sendWert(strang, r.id) })) : []);

  const zl = zuege(p);
  const spuren = zl.map((z) => {
    const s = spurVon.get(z.id) ?? {};
    return { art: 'spur', id: z.id, kurz: z.kurz, name: z.name, farbe: z.farbe, audio: s.art === 'audio', untertitel: s.art === 'audio' ? 'Audio' : geraetText(s),
      teile: insertTeile(s), sends: sendsVon(s), latenz: latenzVon(pdc, z.id) };
  });

  const eltern = gruppenEltern(p);
  const gruppen = schalter.gruppen ? gruppenStreifenFolge(p).flatMap(({ id, tiefe }) => {
    const g = gruppeVon.get(id);
    if (!g) return [];
    const ausgang = ausgangWert(g);
    return [{ art: 'grp', id, nr: g.nr, kurz: kurz(p, id), name: g.name, farbe: g.farbe ?? '', tiefe,
      balken: gruppenKette(p, id, eltern).slice(0, -1).map((a) => gruppeVon.get(a)?.farbe ?? ''),
      ausgang, ausgangText: ausgang === 'master' ? '→ Master' : `→ ${gruppeVon.get(ausgang)?.name ?? ausgang}`,
      teile: insertTeile(g), sends: sendsVon(g), fader_db: g.fader_db, pan: g.pan, mute: g.mute, solo: g.solo, latenz: latenzVon(pdc, id) }];
  }) : [];

  // FROM: tracks in order, then (with groups) the groups in tree order
  const sender = [...zl.filter((z) => spurVon.has(z.id)).map((z) => ({ kurz: z.kurz, strang: spurVon.get(z.id) })),
    ...gruppen.map((g) => ({ kurz: g.kurz, strang: gruppeVon.get(g.id) }))];
  const effekte = returns.map((r) => {
    const teile = rackTeile(r), haupt = teile[0] ?? null;
    const hauptText = !haupt ? '' : haupt.teil === 'hall' ? 'Hall' : haupt.art === 'bk' ? String((r.inserts ?? []).find((i) => i.id === haupt.teil)?.graph ?? haupt.text) : haupt.text;
    return { art: 'ret', id: r.id, nr: r.nr, kurz: kurz(p, r.id), name: r.name, farbe: r.farbe ?? '', teile, haupt, hauptText,
      von: sender.filter((x) => sendWert(x.strang, r.id) > SEND_AUS_DB).map((x) => x.kurz),
      fader_db: r.fader_db, pan: r.pan, mute: r.mute, solo: r.solo, pre: r.pre, latenz: latenzVon(pdc, r.id) };
  });

  const master = { art: 'pm', id: 'master', kurz: 'M', teile: masterTeile(p), fader_db: p?.master?.fader_db, latenz: masterLatenz(p, pdc, hostLage, graphLatenzen) };
  return { spuren, gruppen, effekte, master };
}

/** The rebuild key: what forces the rows to be drawn again. Fader, pan, mute, solo, send levels and latency are left out (they refresh in place). */
export function dockGestalt(m) {
  const chips = (t) => t.map((x) => [x.teil, x.text, x.an, x.art]);
  return JSON.stringify([
    m.spuren.map((s) => [s.id, s.kurz, s.name, s.farbe, s.audio, s.untertitel, chips(s.teile), s.sends.map((x) => x.return_id)]),
    m.gruppen.map((g) => [g.id, g.kurz, g.name, g.farbe, g.tiefe, g.balken, g.ausgang, chips(g.teile), g.sends.map((x) => x.return_id)]),
    m.effekte.map((r) => [r.id, r.kurz, r.name, r.farbe, chips(r.teile), r.hauptText]),
    [m.master.id, chips(m.master.teile)],
  ]);
}
