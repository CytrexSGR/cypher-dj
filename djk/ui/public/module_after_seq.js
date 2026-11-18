// Workbench module -> SEQ deck (page side): the readable line of a load, the load itself (POST /seq/modul) and the way from the Workbench (open LIVE, load,
// the DJ view). Pure parts and calls with an injected holeJson, so they run in node tests; the two entries (werkbank/zu_seq.js, seq_view.js) bind them.
import { oeffneLive } from './live_module.js';

export const PLAETZE = [1, 2, 3, 4];
const mehrzahl = (n, wort, viele = `${wort}s`) => `${n} ${n === 1 ? wort : viele}`;
const grundVon = (j) => {
  const t = j?.text ?? j?.fehler ?? 'unknown';
  return j?.detail && !String(t).includes(j.detail) ? `${t} (${j.detail})` : t;
};

// What the load did not carry, as "2 sends, 1 insert"; '' when it carried everything.
export function weggelassenText(w) {
  if (!w) return '';
  const teile = [];
  const zahl = (n, wort, viele) => { if (n > 0) teile.push(mehrzahl(n, wort, viele)); };
  zahl(w.sends, 'send'); zahl(w.inserts, 'insert'); zahl(w.master_inserts, 'master insert'); zahl(w.returns, 'return'); zahl(w.gruppen, 'group');
  zahl(w.kettenautomation, 'chain automation lane');
  if (w.tonart) teile.push('the key');
  const spuren = w.spuren_uebersprungen ?? [];
  if (spuren.length > 0) teile.push(`${mehrzahl(spuren.length, 'track')} (${spuren.map((s) => `${s.name}: ${s.grund}`).join(', ')})`);
  const noten = (w.gekuerzt ?? []).reduce((n, x) => n + x.noten, 0), punkte = (w.gekuerzt ?? []).reduce((n, x) => n + x.punkte, 0);
  if (noten > 0) teile.push(`${mehrzahl(noten, 'note')} after bar 16`);
  if (punkte > 0) teile.push(`${mehrzahl(punkte, 'lane point')} after bar 16`);
  return teile.join(', ');
}
// "loaded 4 patterns into SEQ 2 · left out: 2 sends, 1 insert"
export function berichtText(b) {
  if (!b) return '';
  const aus = weggelassenText(b.weggelassen);
  return `loaded ${mehrzahl(b.patterns?.length ?? 0, 'pattern')} into SEQ ${b.platz}${aus ? ` · left out: ${aus}` : ''}`;
}

// POST /seq/modul {slug, platz}. -> { ok, text, bericht?, projekt? }
export async function ladeModulInSeq(slug, platz, holeJson) {
  const r = await holeJson('/seq/modul', { slug, platz });
  if (r.status !== 200) return { ok: false, text: `Load refused: ${grundVon(r.j)}`, fehler: r.j?.fehler };
  return { ok: true, text: berichtText(r.j?.bericht), bericht: r.j?.bericht, ...(r.j?.projekt ? { projekt: r.j.projekt } : {}) };
}

// The Workbench entry: open the live container (the confirmation of a running one is the usual one), load the open module into the place. The caller
// switches to the DJ view when `ok`. `abgelehnt`: Andreas said no to the confirmation, nothing to report.
export async function modulZuSeq(slug, platz, holeJson, frage) {
  const l = await oeffneLive(holeJson, frage);
  if (l.abgelehnt) return { ok: false, abgelehnt: true, text: '' };
  if (!l.ok) return { ok: false, text: l.text };
  return ladeModulInSeq(slug, platz, holeJson);
}

// The Workbench modules of GET /proj/liste (entries with werkbank: true; an unreadable entry is left out): [{slug, name}]
export const modulListe = (liste) => (Array.isArray(liste) ? liste.filter((e) => e?.werkbank === true && !e.fehler).map((e) => ({ slug: e.slug, name: e.name })) : []);
