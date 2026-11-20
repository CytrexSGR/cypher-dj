// The cards of the dock: the front knobs of a panel and the builders of the synth card, the effect card, the master card and the "new" cards.
// Every builder takes `werk`, the state of one mounted dock (dock.js): { host, T, quelle, gen, frisch, modell, vorn, strangVon, returnVon, geraetInfo }.
// `werk.modell` is the pure card model of the last refresh (model.js); a refresh function reads its card from it by id, so a change shows without a rebuild. `host` is the host
// object of the view (D2 in dock.js); the project is read only through host.projekt().
import { returnQuelleHall } from '../production/return_face.js';
import { baueInsertAdapter } from '../production/inserts.js';
import { hallText } from '../production/routing.js';
import { posVonDb } from '../production/fader_curve.js';
import { HALL_NORM_VORGABE } from '../face/reverb.js';
import { wertText, vorgabeK } from '../panel.js';
import { geraetText } from '../seq_field.js';
import { kannGeraetFenster, oeffneGeraetFenster, GERAET_FENSTER_TEXT } from '../device_open.js';
import { neuerDrehknopf, sendDb, faderText } from './drehknopf.js';
import { rackTeile, masterTeile, effektKachel } from './stages.js';
import { mk, knopfEl, frontKnoepfe, MAX_FRONT, farbFeld, meterEl, aufKnopf } from './blocks.js';
import { teilChip } from './parts.js';
import { plusKnopf } from './plus.js';
import { sendKnoepfe } from './sends.js';
import { masterLevelSchreiben } from './model.js';
import { mischerKopf, mischerZeile, untertitelEl, levelStand } from './mischer.js';
import { bindeKartenGesten } from './menue.js';
import { anBefehl, insertLabels } from '../production/inserts.js';
import { neueGruppeBefehl } from '../production/routing.js';
import { MAX_GRUPPEN } from '../production/limits.js';

const HALL_FRONT = [['groesse', 'Size'], ['decay', 'Decay'], ['highcut', 'High cut'], ['pre', 'Pre-delay']];
const MASTER_FARBE = '#cfd5e3';
const pegelPos = (db) => posVonDb(db);

// front knobs of a panel on a card; `adapter` reads and writes like the full panel
export function panelKnoepfe(werk, ziel, info, adapter, farbe, max, meine) {
  if (meine !== werk.gen) return;
  for (const c of frontKnoepfe(info.panel, max)) {
    const param = c.bind.param;
    const k = neuerDrehknopf({
      w: 'karte-knopf', name: c.label ?? param, titel: c.label ?? param, farbe,
      lies: () => { const v = adapter.get(param); return typeof v === 'number' ? v : vorgabeK(c); },
      setze: (v) => adapter.set(param, v), ende: () => adapter.ende?.(),
      text: (v) => wertText(c, param, v, info.regler, info.parameter), vorgabe: vorgabeK(c),
    });
    k.setAttribute('data-param', param);
    werk.frisch.push(k.frisch); k.frisch(); ziel.append(k);
  }
}
export function hallKnoepfe(werk, ziel, r, farbe) {
  const q = returnQuelleHall(werk.host.adapterCtx, r);
  for (const [feld, name] of HALL_FRONT) {
    const k = neuerDrehknopf({
      w: 'karte-knopf', name, titel: `${name} (Hall of ${r.name})`, farbe,
      lies: () => { const v = q.get(feld); return typeof v === 'number' ? v : HALL_NORM_VORGABE[feld]; },
      setze: (v) => { q.set(feld, v); }, text: (v) => hallText(feld, v), vorgabe: HALL_NORM_VORGABE[feld],
    });
    k.setAttribute('data-param', feld);
    werk.frisch.push(k.frisch); k.frisch(); ziel.append(k);
  }
}
// the knobs of the first Baukasten stage of a strip (an effect card, the master card)
export function stufenKnoepfe(werk, ziel, strangId, insert, farbe, meine) {
  werk.quelle.panelVon(insert.graph).then((info) => {
    const s = werk.strangVon(strangId);
    if (meine !== werk.gen || !s) return;
    panelKnoepfe(werk, ziel, info, baueInsertAdapter(werk.host.adapterCtx, { id: s.id, name: s.name }, insert.id), farbe, 4, meine);
  });
}
// the LEVEL knob: a fader on the taper of the fader, written like the fader of the strip
export function levelKnopf(werk, titel, lies, schreibe, farbe) {
  const k = neuerDrehknopf({
    w: 'karte-level', name: werk.T.level, titel, farbe, lies: () => { const db = lies(); return db === null ? null : pegelPos(db); },
    setze: (pos) => schreibe(sendDb(pos)), text: (pos) => faderText(sendDb(pos)), vorgabe: pegelPos(0),
  });
  werk.frisch.push(k.frisch);
  return k;
}
// the card of the model by row and id (the model is replaced at every refresh)
const karteVon = (werk, reihe, id) => (reihe === 'master' ? werk.modell?.master : (werk.modell?.[reihe] ?? []).find((k) => k.id === id)) ?? null;
// the latency text right of the name (PRODUCTION only: it comes with the mixer switch)
function latenzSpan(werk, holeKarte) {
  if (!werk.host.schalter.mischer) return [];
  const s = mk('span', 'w-karte-latenz', null, '');
  werk.frisch.push(() => { const l = holeKarte()?.latenz; s.textContent = l?.text ?? ''; s.title = l?.titel ?? ''; });
  return [s];
}
// a click on a free spot of a group, return or master card puts it in front (dock state only; PRODUCTION)
function vornKlick(werk, e, id) {
  if (!werk.host.schalter.mischer) return;
  e.addEventListener('click', (ev) => { if (ev.target?.closest?.('button, input, select, .w-dreh')) return; werk.vorn = id; werk.setzeVorn?.(); });
}

export function synthKarte(werk, z, spur, meine) {
  const { host, T } = werk;
  const karte = () => karteVon(werk, 'spuren', z.id);
  const audio = karte()?.audio === true;
  const e = mk('div', 'w-karte-dock', 'karte-spur');
  e.setAttribute('data-spur-id', z.id); e.setAttribute('data-strang', z.id); e.style.setProperty('--farbe', z.farbe);
  const kopf = mk('div', 'w-karte-kopf');
  const b = farbFeld(z.kurz, z.farbe);
  // CHANGE only where the host can change an instrument; an audio track has neither device nor OPEN
  const wechsel = host.instrumentWechsel && !audio ? knopfEl('w-karte-knopf', 'karte-wechsel', T.wechsel, T.wechselTitel) : null;
  wechsel?.addEventListener('click', (ev) => { ev.stopPropagation?.(); host.instrumentWechsel?.(z.id, wechsel); });
  // the other OPEN ↗ opens the big view inside the page; this one the device in its own browser window (device_window.js), so it reads WINDOW ↗ here
  const fenster = !audio && kannGeraetFenster(spur) ? knopfEl('w-karte-auf', 'karte-fenster', T.fenster, GERAET_FENSTER_TEXT.titel) : null;
  fenster?.addEventListener('click', () => oeffneGeraetFenster(z.id, host.melde));
  const untertitel = untertitelEl(host, karte() ?? { art: 'spur', untertitel: geraetText(spur) }) ?? mk('span', 'w-karte-geraet', null, karte()?.untertitel ?? geraetText(spur));
  kopf.append(b, mk('b', 'w-karte-name', null, z.name), ...latenzSpan(werk, karte), untertitel, mk('span', 'w-sp'),
    ...(spur.inserts ?? []).map((i) => teilChip(werk, z.id, { teil: i.id, ...effektKachel(i) })), plusKnopf(werk, z.id), ...(karte() ? mischerKopf(host, karte(), werk.frisch) : []),
    ...(wechsel ? [wechsel] : []), ...(audio ? [] : [aufKnopf(werk.T, () => host.oeffneGeraet?.(z.id))]), ...(fenster ? [fenster] : []));
  const knoepfe = mk('div', 'w-karte-knoepfe', 'karte-knoepfe');
  const sends = karte() ? sendKnoepfe(host, karte(), werk.frisch) : [];
  if (sends.length) {   // the front knobs and, to their right, the send knobs in one row (STUDIO has no sends: its card stays as it was)
    const zeile = mk('div', 'w-karte-zeile');
    zeile.append(knoepfe, ...sends);
    e.append(kopf, zeile);
  } else e.append(kopf, knoepfe);
  e.addEventListener('click', () => host.wahl.setze(z.id));
  if (karte()) bindeKartenGesten(host, karte(), { el: e, nameEl: kopf.querySelector?.('.w-karte-name') ?? null, farbEl: b });
  if (!audio) werk.geraetInfo(spur).then((info) => { if (info) panelKnoepfe(werk, knoepfe, info, info.adapter, z.farbe, MAX_FRONT, meine); });
  return e;
}

// the group card (PRODUCTION): colour field with G<nr>, name, the output, latency, stage chips, + INSERT, OPEN, LEVEL and the meter
export function gruppenKarte(werk, g, meine) {
  const { host, T } = werk;
  const karte = () => karteVon(werk, 'gruppen', g.id);
  const gruppe = () => (host.projekt()?.gruppen ?? []).find((x) => x.id === g.id) ?? null;
  const e = mk('div', 'w-karte-dock', 'karte-grp');
  e.setAttribute('data-gruppe-id', g.id); e.setAttribute('data-strang', g.id); e.style.setProperty('--farbe', g.farbe);
  const kopf = mk('div', 'w-karte-kopf');
  const b = farbFeld(g.kurz, g.farbe);
  const balken = (g.balken ?? []).map((f) => { const x = mk('span', 'w-karte-balken'); x.style.background = f; return x; });
  const teile = g.teile;
  const untertitel = untertitelEl(host, g) ?? mk('span', 'w-karte-geraet', null, g.ausgangText);
  kopf.append(...balken, b, mk('b', 'w-karte-name', null, g.name), ...latenzSpan(werk, karte), untertitel, mk('span', 'w-sp'),
    ...teile.map((t) => teilChip(werk, g.id, t)), plusKnopf(werk, g.id), ...mischerKopf(host, g, werk.frisch),
    aufKnopf(werk.T, (a) => { if (teile[0]) host.oeffneStufe?.(g.id, teile[0].teil, a); }, !teile.length));
  const zeile = mk('div', 'w-karte-zeile');
  const knoepfe = mk('div', 'w-karte-knoepfe', 'karte-knoepfe');
  zeile.append(knoepfe, ...sendKnoepfe(host, g, werk.frisch), ...mischerZeile(host, g, werk.frisch), levelKnopf(werk, `Level of ${g.name}`, () => (gruppe() ? levelStand(host, karte() ?? g).db ?? 0 : null),
    (db) => { const x = gruppe(); if (x) host.aendere(`Volume group ${x.name}`, [{ befehl: 'gruppenspur_aendern', gruppe_id: g.id, fader_db: db }], `${g.id}:fader_db`, { wiederhole: true }); }, g.farbe), meterEl(`grp/${g.nr}`));
  e.append(kopf, zeile);
  vornKlick(werk, e, g.id);
  bindeKartenGesten(host, g, { el: e, nameEl: kopf.querySelector?.('.w-karte-name') ?? null, farbEl: b });
  return e;
}

export function fxKarte(werk, r, meine) {
  const { host, T } = werk;
  const mischer = host.schalter.mischer;
  const ret = () => werk.returnVon(r.id);
  const karte = () => karteVon(werk, 'effekte', r.id);
  const e = mk('div', 'w-karte-dock', 'karte-fx');
  e.setAttribute('data-return-id', r.id); e.setAttribute('data-strang', r.id); e.style.setProperty('--farbe', r.farbe);
  const teile = rackTeile(r), haupt = teile[0], hauptInsert = haupt && haupt.teil !== 'hall' ? (r.inserts ?? []).find((i) => i.id === haupt.teil) : null;
  const von = mk('span', 'w-chip-teil', 'karte-von'); von.title = T.vonTitel;
  const an = knopfEl('w-karte-knopf', 'karte-an', T.an, mischer ? T.anTitelMischer : T.anTitel);
  // STUDIO: ON mutes the return. PRODUCTION (mixer on): ON switches the main effect, the Hall, or the first stage when the Hall is off.
  an.addEventListener('click', (ev) => {
    ev.stopPropagation?.();
    const x = ret(); if (!x) return;
    if (!mischer) { host.aendere(`${x.mute ? 'Unmute' : 'Mute'} return ${x.name}`, [{ befehl: 'return_aendern', return_id: r.id, mute: !x.mute }]); return; }
    const h = rackTeile(x)[0];
    if (!h) return;
    if (h.teil === 'hall') { host.aendere(`Hall ${h.an ? 'off' : 'on'} return ${x.name}`, [{ befehl: 'return_aendern', return_id: r.id, hall: { an: !h.an } }]); return; }
    const pos = x.inserts.findIndex((i) => i.id === h.teil);
    if (pos >= 0) host.aendere(insertLabels(x.name, pos + 1, x.inserts[pos].art).an, [anBefehl(h.teil, !h.an)]);
  });
  const weg = mischer ? null : knopfEl('w-karte-knopf', 'karte-weg', T.weg, T.wegTitel);
  weg?.addEventListener('click', async (ev) => {
    ev.stopPropagation?.();
    const x = ret(); if (!x) return;
    if (!(await host.frage(T.wegFrage(x.name)))) return;
    host.aendere(`Delete return ${x.name}`, [{ befehl: 'return_loeschen', return_id: r.id }]);
  });
  const kopf = mk('div', 'w-karte-kopf');
  const kurz = host.kurz(host.projekt(), r.id);
  const nameEl = mischer ? mk('b', 'w-karte-name', null, r.name) : mk('b', 'w-karte-name', null, `${kurz} · ${r.name}`);
  const farbEl = mischer ? farbFeld(kurz, r.farbe) : null;
  kopf.append(...(farbEl ? [farbEl] : []), nameEl, ...latenzSpan(werk, karte), mk('span', 'w-karte-geraet', null, hauptInsert ? String(hauptInsert.graph ?? hauptInsert.art) : 'hall'), mk('span', 'w-sp'),
    von, ...teile.slice(1).map((t) => teilChip(werk, r.id, t)), plusKnopf(werk, r.id), ...(karte() ? mischerKopf(host, karte(), werk.frisch) : []), an,
    aufKnopf(werk.T, (a) => { if (haupt) host.oeffneStufe?.(r.id, haupt.teil, a); }, !haupt), ...(weg ? [weg] : []));
  const zeile = mk('div', 'w-karte-zeile');
  const knoepfe = mk('div', 'w-karte-knoepfe', 'karte-knoepfe');
  zeile.append(knoepfe, ...(karte() ? sendKnoepfe(host, karte(), werk.frisch) : []), ...(karte() ? mischerZeile(host, karte(), werk.frisch) : []), levelKnopf(werk, `Level of ${r.name}`, () => (ret() ? levelStand(host, karte() ?? r).db ?? null : null),
    (db) => { const x = ret(); if (x) host.aendere(`Volume return ${x.name}`, [{ befehl: 'return_aendern', return_id: r.id, fader_db: db }], `${r.id}:fader_db`, { wiederhole: true }); }, r.farbe), meterEl(`ret/${r.nr}`));
  e.append(kopf, zeile);
  if (haupt?.teil === 'hall') hallKnoepfe(werk, knoepfe, r, r.farbe);
  else if (hauptInsert?.art === 'bk') stufenKnoepfe(werk, knoepfe, r.id, hauptInsert, r.farbe, meine);
  vornKlick(werk, e, r.id);
  if (karte()) bindeKartenGesten(host, karte(), { el: e, nameEl, farbEl });
  werk.frisch.push(() => {
    const x = ret(); if (!x) return;
    const l = karte()?.von ?? werk.sendeVon(host.projekt(), r.id);
    von.textContent = l.length ? T.von(l) : T.keineSends;   // FROM follows a send change in place (the rebuild key leaves it out)
    const an_ = mischer ? rackTeile(x)[0]?.an === true : x.mute !== true;
    an.setAttribute('aria-pressed', String(an_)); an.classList.toggle('an', an_);
  });
  return e;
}
export function masterKarte(werk, meine) {
  const { host, T } = werk;
  const p = host.projekt();
  const karte = () => karteVon(werk, 'master', 'master');
  const e = mk('div', 'w-karte-dock w-karte-master', 'karte-master');
  e.setAttribute('data-strang', 'master'); e.style.setProperty('--farbe', MASTER_FARBE);
  const teile = masterTeile(p), erstes = (p?.master?.inserts ?? []).find((i) => i.art === 'bk');
  const kopf = mk('div', 'w-karte-kopf');
  kopf.append(mk('b', 'w-karte-name', null, T.master), ...latenzSpan(werk, karte), mk('span', 'w-sp'), ...teile.map((t) => teilChip(werk, 'master', t)), plusKnopf(werk, 'master'),
    ...(karte() ? mischerKopf(host, karte(), werk.frisch) : []), aufKnopf(werk.T, (a) => { if (teile[0]) host.oeffneStufe?.('master', teile[0].teil, a); }, !teile.length));
  const zeile = mk('div', 'w-karte-zeile');
  const knoepfe = mk('div', 'w-karte-knoepfe', 'karte-knoepfe');
  zeile.append(knoepfe, ...(karte() ? mischerZeile(host, karte(), werk.frisch) : []), levelKnopf(werk, 'Master volume', () => (host.projekt() ? levelStand(host, karte() ?? { fader_db: 0 }).db ?? 0 : null),
    (db) => { const m = masterLevelSchreiben(host.schalter); host.aendere(m.label, [{ befehl: 'master_aendern', fader_db: db }], m.schluessel, { wiederhole: true }); }, MASTER_FARBE), meterEl('pm'));
  e.append(kopf, zeile);
  if (erstes) stufenKnoepfe(werk, knoepfe, 'master', erstes, MASTER_FARBE, meine);
  vornKlick(werk, e, 'master');
  if (karte()) bindeKartenGesten(host, karte(), { el: e, nameEl: null, farbEl: null });
  return e;
}
export const neuKarte = (w, text, titel, klick) => { const b = knopfEl('w-karte-dock w-karte-neu', w, text, titel); b.addEventListener('click', klick); return b; };
/** The card + GROUP of the GROUPS row: disabled with the reason when every group is used. */
export function neueGruppeKarte(werk) {
  const { host, T } = werk;
  const b = neuKarte('gruppe-neu', T.neueGruppe, T.neueGruppeTitel, (ev) => { ev.stopPropagation?.(); const befehl = neueGruppeBefehl(host.projekt()); if (befehl) host.aendere('Add group', [befehl]); });
  const voll = neueGruppeBefehl(host.projekt()) === null;
  b.disabled = voll;
  if (voll) b.title = T.gruppenVoll(MAX_GRUPPEN);
  return b;
}
