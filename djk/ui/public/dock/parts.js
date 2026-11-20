// The stage chips of a card and the menu of a chip (right click). `werk` is the state of one mounted dock (see dock.js): { host, T, quelle, strangVon, ... }.
import { anBefehl, entfernenBefehl, ordnungBefehl, verschoben, insertLabels, hostDotTitel } from '../production/inserts.js';
import { schluesselGruppen, schluesselWert, schluesselBefehl } from '../production/key_choice.js';
import { msText } from '../production/pdc.js';
import { mk, chipEl } from './blocks.js';



// ---- pure parts -------------------------------------------------------------------------------------------------------------------------------------
/** The entries of a chip menu: [{text, aus?, titel?, aktion: name}]. The `aktion` is a name the DOM part maps to a function: an, links, rechts, schluessel,
 *  fenster, weg, hall. `lage` is the HostLage of a plugin stage (or null); `schluessel` says whether the view offers the key source menu (default true; STUDIO
 *  has none, its chip menu stays as it was). The Hall chip (insert `{art: 'hall', an}`) keeps only Bypass / Enable. */
export function chipMenuePunkte(strang, insert, { lage = null, schluessel = true } = {}) {
  if (insert?.art === 'hall') return [{ text: insert.an === false ? 'Enable' : 'Bypass', aktion: 'hall' }];
  const ids = (strang?.inserts ?? []).map((x) => x.id), pos = ids.indexOf(insert.id);
  const punkte = [
    { text: insert.an !== false ? 'Bypass' : 'Enable', aktion: 'an' },
    { text: 'Move earlier', aus: !verschoben(ids, pos, -1), aktion: 'links' },
    { text: 'Move later', aus: !verschoben(ids, pos, 1), aktion: 'rechts' },
  ];
  if (insert.art === 'komp' && schluessel) punkte.push({ text: 'Key source…', aktion: 'schluessel' });
  if (insert.art === 'host') punkte.push({ text: lage?.fenster ? 'Close native window' : 'NATIVE WINDOW', aktion: 'fenster' });
  punkte.push({ text: 'Remove', aktion: 'weg' });
  return punkte;
}

/** The entries of the key source menu from schluesselGruppen(): a heading per group and one entry per option (`aus` when locked, with the server's reason as
 *  `titel`, `✓ ` before the current value `jetzt`); `wert` is the choice string schluesselBefehl takes. */
export function schluesselPunkte(gruppen, jetzt) {
  const punkte = [];
  for (const g of gruppen) {
    if (!g.eintraege.length) continue;
    punkte.push({ gruppe: true, text: g.titel });
    for (const e of g.eintraege) punkte.push({ text: `${e.wert === jetzt ? '✓ ' : ''}${e.label}`, wert: e.wert, ...(e.gesperrt ? { aus: true, titel: e.text } : {}) });
  }
  return punkte;
}

/** What a chip shows: { status, titel, marke }. A plugin stage: the status word (startet, bereit, fehlt, ausfall; unbekannt before the host answered) and the title
 *  (the status text plus the latency). marke: the preset mark `{text, titel, geaendert}` of a stage set by a preset, else null. */
export function chipZustand(insert, lage, marke) {
  let status = null, titel = '';
  if (insert?.art === 'host') {
    status = lage?.status ?? 'unbekannt';
    titel = hostDotTitel(lage);
    if (lage && Number.isFinite(lage.latenz)) titel += ` · ${lage.gemessen ? msText(lage.latenz) : `Estimated latency ${msText(lage.latenz)}`}`;
  }
  return { status, titel, marke: insert?.preset && marke ? marke : null };
}

/** The commands and undo labels of the stage functions of a strip (the chip menu and the face title bar share them). */
export function stufenBefehle(strang, insert) {
  const ids = strang.inserts.map((x) => x.id), pos = ids.indexOf(insert.id), L = insertLabels(strang.name, pos + 1, insert.art);
  const links = verschoben(ids, pos, -1), rechts = verschoben(ids, pos, 1);
  return {
    an: (an) => ({ label: L.an, befehle: [anBefehl(insert.id, an)] }),
    links: links ? { label: L.links, befehle: [ordnungBefehl(strang.id, links)] } : null,
    rechts: rechts ? { label: L.rechts, befehle: [ordnungBefehl(strang.id, rechts)] } : null,
    weg: { label: L.weg, befehle: [entfernenBefehl(insert.id)] },
  };
}

const fehlerVon = (r) => r?.j?.text ?? r?.j?.fehler ?? `HTTP ${r?.status ?? 'none'}`;
/** The key source menu of a compressor stage at (x, y): the options come from the server (GET /proj/routing?optionen=<id>); a failed fetch is reported through
 *  melde. `zu`: { holeGet, aendere, melde, oeffneMenue, projekt() }. */
export async function schluesselMenue(zu, strang, insert, x, y) {
  const r = await zu.holeGet(`/proj/routing?optionen=${encodeURIComponent(insert.id)}`);
  const o = r?.status === 200 ? r.j?.straenge?.flatMap((s) => s.stufen).find((s) => s.insert_id === insert.id)?.optionen : null;
  if (!o) { zu.melde(`Key options not available: ${(zu.fehlerText ?? fehlerVon)(r)}`, true); return; }
  const jetzt = schluesselWert(insert);
  zu.oeffneMenue(schluesselPunkte(schluesselGruppen(o, zu.projekt()), jetzt).map((p) => (p.gruppe ? p
    : { text: p.text, aus: p.aus, titel: p.titel, aktion: () => zu.aendere(`Key compressor on ${strang.name}`, [schluesselBefehl(insert.id, p.wert)]) })), x, y);
}

// ---- DOM --------------------------------------------------------------------------------------------------------------------------------------------
const MENUE_AKTION = (werk, strangId, insert, s) => {
  const { host } = werk, b = stufenBefehle(s, insert);
  const tu = (x) => x && host.aendere(x.label, x.befehle);
  return {
    an: (_ev) => tu(b.an(insert.an === false)), links: () => tu(b.links), rechts: () => tu(b.rechts), weg: () => tu(b.weg),
    fenster: () => host.pluginFenster?.(insert.id),
    schluessel: (ev) => schluesselMenue(host, s, insert, ev.clientX ?? 0, ev.clientY ?? 0),
  };
};

export function teilMenue(werk, strangId, insertId, ev) {
  const { host } = werk;
  if (insertId === 'hall') {
    const r = werk.returnVon?.(strangId), h = r?.hall;
    if (!r) return;
    ev.preventDefault?.();
    host.oeffneMenue(chipMenuePunkte(null, { art: 'hall', an: h?.an !== false }).map((p) => ({ text: p.text,
      aktion: () => host.aendere(`Hall ${h?.an !== false ? 'off' : 'on'} return ${r.name}`, [{ befehl: 'return_aendern', return_id: r.id, hall: { an: h?.an === false } }]) })), ev.clientX ?? 0, ev.clientY ?? 0);
    return;
  }
  const s = werk.strangVon(strangId), i = s?.inserts.find((x) => x.id === insertId);
  if (!s || !i) return;
  ev.preventDefault?.();
  const tabelle = MENUE_AKTION(werk, strangId, i, s);
  host.oeffneMenue(chipMenuePunkte(s, i, { lage: host.hostLage?.(i.id) ?? null, schluessel: host.ansicht === 'production' }).map((p) => ({ text: p.text, aus: p.aus, titel: p.titel, aktion: () => tabelle[p.aktion](ev) })),
    ev.clientX ?? 0, ev.clientY ?? 0);
}

const GR_BEREICH_DB = 20;
// one hook for the gain reduction bars per mounted dock (the host has no way to unregister): it refreshes the bars that are in the DOM now
const ereignisHaken = new WeakSet();
function grHaken(werk) {
  if (ereignisHaken.has(werk)) return;
  ereignisHaken.add(werk);
  let timer = null;
  const alle = () => { for (const bar of werk.host.dockEl?.querySelectorAll?.('.w-chip-gr') ?? []) bar._frisch?.(); };
  werk.host.beimEreignis?.((a) => {
    if (a !== '/e/ins_gr') return;
    alle();
    clearTimeout(timer); timer = setTimeout(alle, 520);   // a stage that went quiet falls back to empty after the 500 ms rule (the INSERTS list does the same with insGrAblaufIn)
  });
}

export function teilChip(werk, strangId, t) {
  const { host } = werk;
  const b = chipEl({ teil: t.teil, text: t.text, an: t.an, titel: werk.T.chipTitel }, {
    klick: (el) => host.oeffneStufe?.(strangId, t.teil, el),
    menue: (e) => teilMenue(werk, strangId, t.teil, e),
  });
  if (t.teil === 'hall') return b;
  const insert = () => werk.strangVon(strangId)?.inserts.find((x) => x.id === t.teil) ?? null;
  const i0 = insert();
  if (!i0) return b;
  const hostStufe = i0.art === 'host', hatGr = i0.art === 'komp' || i0.art === 'lim';
  const punkt = hostStufe ? mk('span', 'w-chip-punkt') : null;
  const marke = mk('span', 'w-chip-marke'); marke.hidden = true;
  const gr = hatGr ? mk('span', 'w-chip-gr') : null;
  if (punkt) b.prepend(punkt);
  b.append(marke);
  if (gr) {
    b.append(gr);
    grHaken(werk);
  }
  const frischGr = () => {
    const i = insert(); if (!i || !gr) return;
    const db = host.grLesung?.(i, globalThis.performance?.now?.() ?? Date.now()) ?? null;
    gr.style.width = db === null ? '0' : `${Math.min(100, Math.max(0, (db / GR_BEREICH_DB) * 100))}%`;
  };
  const frisch = () => {
    const i = insert(); if (!i) return;
    const z = chipZustand(i, host.hostLage?.(i.id) ?? null, i.preset ? host.presetMarke?.(i.id) ?? null : null);
    if (punkt) { punkt.className = `w-chip-punkt ${z.status}`; punkt.dataset.status = z.status; punkt.title = z.titel; }
    marke.hidden = !z.marke;
    if (z.marke) { marke.textContent = z.marke.text; marke.title = z.marke.titel ?? ''; marke.classList.toggle('geaendert', !!z.marke.geaendert); }
    frischGr();
  };
  if (gr) gr._frisch = frischGr;
  werk.frisch?.push(frisch);
  frisch();
  return b;
}
