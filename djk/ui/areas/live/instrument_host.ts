// Host sockets, studio state and hand brake of the page server (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { alsAntwort } from '../proj/area.ts';
import { PLATZ_TYPEN, type PlatzTyp } from '../../project/model.ts';
import { HAND_PRUEFMODUS_TEXT } from '../../public/messages.js';
import { wirtOrdnerVorgabe } from '../../paths.ts';
import { platzStill } from '../../hand_operation.ts';
import { wirtRuf } from '../../track.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { ALLE_STROEME, istBkStrom } from '../../../contract/streams.ts';
import { SPEKTRUM_QUELLEN, KLANG_GRUPPEN, OFFENE_DECKS } from '../../server_kopf.ts';
import type { Pruefmodus } from '../../server_kopf.ts';
import type { Oberflaeche } from '../../server.ts';

// A new run of a name waits until the previous run's in-flight wirt call (fahre answer and halte) has settled; bounded by the wirtRuf timeout
export async function wirtFlugAbwarten(this: Oberflaeche, name: string): Promise<void> {
  const f = this.wirtImFlug.get(name);
  if (!f) return;
  await Promise.race([f, new Promise((r) => setTimeout(r, 3000))]);
}
export function wirtBasis(this: Oberflaeche): string { return this.opt.wirtOrdner ?? wirtOrdnerVorgabe(); }
export function wirtSock(this: Oberflaeche, gruppe: string): string { return path.join(this.wirtBasis(), `wirt-${gruppe}.sock`); }
// wirt-<gruppe>.json je Klang-Gruppe, null ohne (lesbare) Datei; geteilt von GET /klang und /lage.studio.klang
export function leseWirtMeldungen(this: Oberflaeche): Record<string, unknown> {
  const aus: Record<string, unknown> = {};
  for (const g of KLANG_GRUPPEN) {
    try { aus[g] = JSON.parse(fs.readFileSync(path.join(this.wirtBasis(), `wirt-${g}.json`), 'utf8')); } catch { aus[g] = null; }
  }
  return aus;
}
// Task 4: Studio-Zustand für /lage: AUTO und Muster je Strom (Kurzform), geladener Surge-Klang je Gruppe (Name aus wirt-<g>.json)
export function studioLage(this: Oberflaeche): { stroeme: unknown[]; klang: Record<string, string | null> } {
  // S18: streams 1..3 always; a Baukasten stream (5, 6, 7, 9, 10) only while its erzeuger heartbeat is fresh
  const stroeme = ALLE_STROEME.filter((s) => !istBkStrom(s) || this.erzeugerLebt(s)).map((strom) => {
    const m = leseMusterStand(this.musterOrdner(strom));
    return { strom, autonom: m.autonom, von: m.von, bezeichnung: m.bezeichnung, text_kurz: m.text.slice(0, 200) };
  });
  const w = this.leseWirtMeldungen(), klang: Record<string, string | null> = {};
  for (const g of KLANG_GRUPPEN) klang[g] = (w[g] as { klang?: unknown } | null)?.klang as string | null ?? null;
  return { stroeme, klang };
}
// GET /lage (Plan Hand D5): verdichteter Stand für einen Zug
// 1.15 A7b (D11): the last spectrum frame, or {leer:true} while the selector is 0 (known from the /e/regler echo: no source has the name '') or no frame came yet.
export function spektrum(this: Oberflaeche): Record<string, unknown> {
  const l = this.spektrumLetzt;
  const sel = this.stand.regler['spektrum/kanal'];
  if (!l) return { leer: true };
  if (sel !== undefined && l.kanal !== SPEKTRUM_QUELLEN[sel]) return { leer: true };   // a late frame of the previous source
  return { leer: false, kanal: l.kanal, rahmen: l.rahmen, pegel: l.pegel, alter_ms: Date.now() - l.zeit };
}
// The four places of the open live project (the only truth for what sits in each container); null without one (no project, or a production project)
export function plaetzeLage(this: Oberflaeche): readonly unknown[] | null {
  const p = this.proj.zugang.offen()?.projekt;
  return p?.live === true && p.plaetze ? structuredClone(p.plaetze) : null;
}
// POST /plaetze {platz, typ, gruppe_id?} (container core M6): one platz_setzen command through the project machinery (rev, undo, kanal_offen, playback swap)
export async function plaetzeSetzen(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const platz = d.platz, typ = d.typ;
  if (platz !== 1 && platz !== 2 && platz !== 3 && platz !== 4) return this.json(a, 400, { fehler: 'platz_ungueltig', text: 'platz: integer 1..4 expected' });
  if (typeof typ !== 'string' || !PLATZ_TYPEN.includes(typ as PlatzTyp)) return this.json(a, 400, { fehler: 'platz_ungueltig', text: `typ: one of ${PLATZ_TYPEN.join(' ')} expected` });
  if (d.gruppe_id !== undefined && typeof d.gruppe_id !== 'string') return this.json(a, 400, { fehler: 'platz_ungueltig', text: 'gruppe_id: text expected' });
  const o = this.proj.zugang.offen();
  if (!o || o.projekt.live !== true || !o.projekt.plaetze) return this.json(a, 409, { fehler: 'kein_liveprojekt', text: 'places belong to the live container' });
  const aktuell = o.projekt.plaetze[platz - 1];
  if (aktuell.typ === typ && d.gruppe_id === undefined) return this.json(a, 200, { ok: true, plaetze: this.plaetzeLage(), rev: o.projekt.rev });
  // a place that holds a SEQ deck or a loop deck is parked, not emptied: no still rule (the page mutes the group first)
  const parken = aktuell.typ === 'seq' || aktuell.typ === 'loops';
  if (!parken) {
    const s = platzStill(platz, this.stand.regler);
    if (!s.still) return this.json(a, 409, { fehler: 'platz_offen', grund: s.offen[0].grund, kanal: s.offen[0].kanal, platz, text: s.text });
  }
  const befehl = { befehl: 'platz_setzen', platz, typ, ...(d.gruppe_id !== undefined ? { gruppe_id: d.gruppe_id } : {}) };
  let r: { code: number; j: Record<string, unknown> };
  try { r = await this.proj.sitzung.aendern({ rev: o.projekt.rev, label: `Place ${platz}: ${typ}`, befehle: [befehl] }, this.quelle()) as typeof r; }
  catch (e) { r = alsAntwort(e, this.bereichKontext()) as typeof r; }
  if (r.code !== 200) {
    const fehler = r.j.fehler === 'typ_doppelt' ? 'typ_einmalig' : r.j.fehler === 'platz_belegt' ? 'loopdeck_voll' : r.j.fehler;
    return this.json(a, r.code, { ...r.j, fehler });
  }
  this.json(a, 200, { ok: true, plaetze: this.plaetzeLage(), rev: r.j.rev, ...(parken ? { parken: true } : {}) });
}
// Review Hand M7: Cyphers Befehle tragen plan 'cypher', damit /k/abbruch sie (auch wartende Deck-Teile) trifft
export function planVon(this: Oberflaeche): string { return this.quelle() === 'cypher' ? 'cypher' : ''; }
export function setzeKiGestoppt(this: Oberflaeche, an: boolean): void {
  const war = this.kiGestoppt;
  this.kernKiGestoppt = an;
  this.nachKiWechsel(war);
}
export function setzeHandBremse(this: Oberflaeche, an: boolean): void {
  const war = this.kiGestoppt;
  this.handBremse = an;
  this.nachKiWechsel(war);
}
export function handStand(this: Oberflaeche): { gestoppt: boolean; bremse: boolean; kern_ki: boolean } {
  return { gestoppt: this.kiGestoppt, bremse: this.handBremse, kern_ki: this.kernKiGestoppt };
}
export function nachKiWechsel(this: Oberflaeche, war: boolean): void {
  if (this.kiGestoppt && !war) this.fahrtEnde.clear();
  if (this.kiGestoppt && !war) void this.cypherSpurenAbbrechen();   // Studio S6 F1: Stop Cypher hält auch Wirt und Muster
  this.verteile({ a: 'hand', f: this.handStand() });
}
/** Music plays: an open deck runs (same test as the ear) or the arrangement plays or counts in. */
export function musikLaeuft(this: Oberflaeche): boolean {
  const st = this.proj.sitzung.lage.arr?.status;
  return OFFENE_DECKS.some((n) => Number(this.deckStand(n)?.z.status) >= 2) || st === 1 || st === 2;
}
export function pruefmodusAusKonfig(this: Oberflaeche): Pruefmodus {
  const k = this.opt.kernPruefmodus;
  return k === true ? 'an' : k === false ? 'aus' : 'unbekannt';
}
export function setzePruefmodus(this: Oberflaeche, neu: Pruefmodus, quelle: string): void {
  if (neu === this.pruefmodus) return;
  this.pruefmodus = neu;
  this.opt.log?.({ typ: 'pruefmodus', stand: neu, quelle });
  this.verteile({ a: 'pruefmodus', f: { stand: neu, text: neu === 'aus' ? HAND_PRUEFMODUS_TEXT : '' } });
}
