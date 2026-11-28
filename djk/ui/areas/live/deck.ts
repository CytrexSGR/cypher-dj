// Deck state of the page server: grid, seek, scrub, loop, hotcues, start and stop (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { type DeckLoopAusschnitt } from './export.ts';
import { tonartQuelle } from './key.ts';
import type { Felder } from '../../../conductor/src/addresses.ts';
import { schreibeLoopAusFassung } from '../../loops.ts';
import { fassungQuelle } from '../../wave_cache.ts';
import { hotcueOrdnerVorgabe } from '../../paths.ts';
import { RASTER_WAHL, abBeat, sprungDelta, loopStart, rasterRunden, hotcueDatei, schreibeHotcues, type Hotcue, type Fassung, hotcuesErbe } from '../../deck_operation.ts';
import { AB, kanalOffen } from '../../hand_operation.ts';
import { type Zeile } from '../../catalog.ts';
import { pultContainerPfad } from '../../../contract/pult.ts';
import { GRAPH_ABGELEHNT, leseBestand, OFFENE_DECKS, istOffenesDeck } from '../../server_kopf.ts';
import { Oberflaeche } from '../../server.ts';

// ---------- Plan E9: Deck-Bedienung (Sprung, Hotcues SHOT/LOOP, Loop) über /k/deck/* mit Quelle andreas ----------
// Review E9 F3: je Instanz ein eigener Ordner (Prüfinstanz in /dev/shm wie die Loops), sonst teilen Prüfung und Betrieb
export function hotcueOrdner(this: Oberflaeche): string { return this.opt.hotcueOrdner ?? hotcueOrdnerVorgabe(); }
export function zieheGeladenNach(this: Oberflaeche, z: Record<string, unknown>): void {
  const n = String(z.deck), g = this.stand.geladen[n] as Record<string, unknown> | undefined;
  if (!g) return;
  const seit = this.geladenSeit[n] ?? { vorher: null, bestaetigt: true }, kz = Oberflaeche.deckSchluessel(z), leer = !(Number(z.status) >= 1);
  if (kz === Oberflaeche.deckSchluessel(g)) {
    if (leer) { delete this.stand.geladen[n]; delete this.geladenSeit[n]; } else this.geladenSeit[n] = { vorher: null, bestaetigt: true };
    return;
  }
  if (!seit.bestaetigt && kz === seit.vorher) return;                   // noch das vorige Material: das neue Laden gilt
  if (leer) { delete this.stand.geladen[n]; delete this.geladenSeit[n]; return; }
  this.stand.geladen[n] = { deck: z.deck, material_id: z.material_id, basis_bpm: z.basis_bpm, fassung: z.fassung } as Felder;
  this.geladenSeit[n] = { vorher: null, bestaetigt: true };
}
export function rasterFassung(this: Oberflaeche, deck: number): Fassung | null {
  if (!istOffenesDeck(deck)) return null;
  const z = this.stand.decks[String(deck)] as Record<string, unknown> | undefined;
  const g = this.stand.geladen[String(deck)] as Record<string, unknown> | undefined;
  const fassung = (x: Record<string, unknown>): Fassung => ({ material_id: String(x.material_id), basis_bpm: Number(x.basis_bpm), fassung: Number(x.fassung) });
  if (g && (!z || String(z.material_id) !== String(g.material_id))) return fassung(g);
  return z && Number(z.status) >= 1 ? fassung(z) : null;
}
// Kern-Stand eines geladenen Decks (1, 2): /zustand/deck, /uhr, Fassung und ihre Takt-Eins. null: nicht bedienbar.
export function deckStand(this: Oberflaeche, deck: unknown): { deck: number; z: Record<string, unknown>; beat: number; bpm: number; f: Fassung; eins: number; erster: number } | null {
  if (!istOffenesDeck(deck)) return null;
  const z = this.stand.decks[String(deck)] as Record<string, unknown> | undefined;
  const u = this.kern.uhr;
  if (!z || !u || !(Number(z.status) >= 1)) return null;
  const f: Fassung = { material_id: String(z.material_id), basis_bpm: Number(z.basis_bpm), fassung: Number(z.fassung) };
  const schluessel = `${f.material_id}|${f.basis_bpm}|${f.fassung}`;
  let e = this.einsCache.get(schluessel);
  if (e === undefined) {
    try {
      const q = fassungQuelle(this.opt.bestand, f.material_id, f.basis_bpm, f.fassung);
      const j = JSON.parse(fs.readFileSync(path.join(path.dirname(q.datei), 'fassung.json'), 'utf8')) as Record<string, unknown>;
      e = { eins: Number(j.erste_eins_quell_beat) || 0, erster: Number(j.erster_schlag_frame) || 0 };
    } catch { e = { eins: 0, erster: 0 }; }
    this.einsCache.set(schluessel, e);
  }
  return { deck, z, beat: u.beat, bpm: u.bpm, f, eins: e.eins, erster: e.erster };
}
// Ziel-Beat (D3): jetzt + Vorlauf (vorlauf_ms, mindestens 0,1 Beat: /uhr ist bis zu einem Zyklus alt), aufs Raster.
// Review E9 F1: ein stehendes Deck wartet nicht auf die Rasterstelle (dort rastet nur das Ziel ein); sonst drückt
// Andreas in der Wartezeit Play, und das für das stehende Deck gerechnete Delta landet daneben.
export function zeitRaster(this: Oberflaeche, st: { z: Record<string, unknown> }, raster: number): number { return Number(st.z.status) >= 2 ? raster : 0; }
export function deckAb(this: Oberflaeche, st: { z: Record<string, unknown>; beat: number; bpm: number }, raster: number): number {
  const vorlauf = Math.max(Number(st.z.vorlauf_ms ?? 0) / 1000 * st.bpm / 60, 0.1);
  return abBeat(st.beat, vorlauf, this.zeitRaster(st, raster));
}
export function deckTeil(this: Oberflaeche, adresse: string, st: { deck: number; z: Record<string, unknown> }, ab: number, raster: number, extra: Record<string, unknown>): Record<string, unknown> {
  const r = this.zeitRaster(st, raster);
  const felder = { id: Number(++this.id), quelle: this.quelle(), plan: this.planVon(), gruppe: '', hoerschein: '', deck: st.deck, ab_beat: ab,
    ...extra, politik: r > 0 ? 2 : 1, raster_beats: r > 0 ? r : 0 };
  this.kern.sende(adresse, felder);
  this.gesendet++;
  return felder;
}
export function rasterAus(this: Oberflaeche, d: Record<string, unknown>): number | null {
  const r = d.raster ?? 0;
  return typeof r === 'number' && (RASTER_WAHL as readonly number[]).includes(r) ? r : null;
}
// Sprung (D4): {deck, ziel (Quell-Beat) | delta, raster}
export function deckSprung(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  const raster = this.rasterAus(d);
  if (raster === null) return this.json(a, 400, { fehler: 'raster' });
  if (!istOffenesDeck(d.deck)) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
  const st = this.deckStand(d.deck);
  if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
  const ab = this.deckAb(st, raster);
  let delta: number;
  if (typeof d.ziel === 'number' && Number.isFinite(d.ziel)) {
    delta = sprungDelta({ laeuft: Number(st.z.status) >= 2, quell: Number(st.z.quell_beat), beat: st.beat, ab, ziel: d.ziel, raster, eins: st.eins });
  } else if (typeof d.delta === 'number' && Number.isFinite(d.delta)) {
    delta = d.delta;
  } else {
    return this.json(a, 400, { fehler: 'ziel_oder_delta' });
  }
  // Der Kern verschiebt einen scharfen Loop beim Sprung mit (core_deck.cpp art 6: loop_a += llround(delta · fpb), deck.cpp springe);
  // das Loop-Gedächtnis zieht um dasselbe Delta nach (llround(delta · fpb) / fpb, wie der Kern in Frames rechnet). Lehnt der Kern ab
  // (ausserhalb_bereich: der Loop ginge aus dem Material), bleibt sein Loop stehen: dann Rücknahme.
  const l = this.loopVon(st) ? this.aktiverLoop[String(st.deck)] : undefined;
  let schritt = 0;
  if (l) {
    const fpb = 48000 * 60 / st.f.basis_bpm;
    schritt = Math.round(delta * fpb) / fpb;
    this.setzeAktivenLoop(st.deck, { ...l, start: l.start + schritt });
  }
  const felder = this.deckTeil('/k/deck/sprung', st, ab, raster, { delta_beats: delta });
  if (l) {
    void this.warteBisAb(Number(felder.id), ab).then((q) => {
      const jetzt = this.aktiverLoop[String(st.deck)];
      if (q && GRAPH_ABGELEHNT.includes(q.status) && jetzt) this.setzeAktivenLoop(st.deck, { ...jetzt, start: jetzt.start - schritt });
    });
  }
  this.json(a, 200, { ok: true, felder });
}
// Hörbares Ziehen (2026-10-17): {deck, phase 0 los | 1 Griff | 2 Zug, delta (Quell-Beats seit dem Griff)}. Der Kern liest das Material
// an der Handposition; der Strom (~60 Hz) wird nicht quittiert und nicht gezählt, nur gesendet.
export function deckScrub(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  if (!istOffenesDeck(d.deck)) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
  if (d.phase !== 0 && d.phase !== 1 && d.phase !== 2) return this.json(a, 400, { fehler: 'phase' });
  if (typeof d.delta !== 'number' || !Number.isFinite(d.delta) || Math.abs(d.delta) > 100000) return this.json(a, 400, { fehler: 'delta' });
  const felder = { id: Number(++this.id), quelle: this.quelle(), deck: d.deck, phase: d.phase, delta_beats: d.delta };
  this.kern.sende('/k/deck/scrub', felder);
  this.json(a, 200, { ok: true });
}
export function loopVon(this: Oberflaeche, st: { deck: number; z: Record<string, unknown>; f: Fassung }): { start: number; laenge: number } | null {
  const l = this.aktiverLoop[String(st.deck)];
  return l && l.schluessel === Oberflaeche.fassungSchluessel(st.f) && Oberflaeche.loopScharf(st.z) ? { start: l.start, laenge: l.laenge } : null;
}
export function merkeLoop(this: Oberflaeche, st: { deck: number; z: Record<string, unknown>; beat: number; f: Fassung }, ab: number, laenge: number): void {
  if (!(laenge > 0)) { delete this.aktiverLoop[String(st.deck)]; this.sichereAktiveLoops(); return; }
  const q = Number(st.z.quell_beat), start = Number(st.z.status) >= 2 ? q + (ab - st.beat) : q;
  this.setzeAktivenLoop(st.deck, { schluessel: Oberflaeche.fassungSchluessel(st.f), start, laenge });
}
export function setzeAktivenLoop(this: Oberflaeche, deck: number, l: { schluessel: string; start: number; laenge: number }): void {
  this.aktiverLoop[String(deck)] = l;
  this.sichereAktiveLoops();
}
// Der gemerkte Loop liegt auf Platte neben den Hotcues (Andreas 2026-09-28: nach einem Neustart des Seiten-Servers
// kannte das Pad den laufenden Loop nicht mehr). Gültig bleibt er nur, solange der Kern ihn noch hält (loopVon).
export function aktiveLoopsDatei(this: Oberflaeche): string { return path.join(this.hotcueOrdner(), 'aktive_loops.json'); }
export function sichereAktiveLoops(this: Oberflaeche): void {
  try {
    fs.mkdirSync(this.hotcueOrdner(), { recursive: true });
    const tmp = `${this.aktiveLoopsDatei()}.${process.pid}.neu`;
    fs.writeFileSync(tmp, JSON.stringify(this.aktiverLoop));
    fs.renameSync(tmp, this.aktiveLoopsDatei());
  } catch (err) { this.opt.log?.({ typ: 'aktive_loops_nicht_gesichert', text: (err as Error).message }); }
}
export function ladeAktiveLoops(this: Oberflaeche): void {
  try { this.aktiverLoop = JSON.parse(fs.readFileSync(this.aktiveLoopsDatei(), 'utf8')); } catch { this.aktiverLoop = {}; }
}
export function deckLoop(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  const raster = this.rasterAus(d);
  if (raster === null) return this.json(a, 400, { fehler: 'raster' });
  if (!istOffenesDeck(d.deck)) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
  if (typeof d.laenge !== 'number' || !(d.laenge === 0 || Oberflaeche.LOOP_LAENGEN.includes(d.laenge))) return this.json(a, 400, { fehler: 'laenge' });
  const st = this.deckStand(d.deck);
  if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
  const ab = this.deckAb(st, raster);
  // behalte_start (Längenknöpfe, Traktor): bei scharfem Loop nur die Länge ändern, der Start bleibt (/k/deck/loop_laenge, Kern setzt
  // den Loop bei start_beat statt am Kopf). Ohne gemerkten scharfen Loop (oder Länge 0) der gewöhnliche Weg.
  const alt = d.behalte_start === true && d.laenge > 0 && this.loopVon(st) ? this.aktiverLoop[String(st.deck)] : undefined;
  if (alt) {
    // Taps in a row (4 to 8 to 16) each move the memory before the core answers, so the length the memory held at a tap is not what the core plays:
    // the rollback goes to the length the core last CONFIRMED (sicher), and only when no newer tap is waiting (it moved the memory since)
    const taste = String(st.deck), laenge = d.laenge;
    const z = ((this.loopLaengeTasten ??= {})[taste] ??= { sicher: alt.laenge, tippen: 0, offen: 0, kette: Promise.resolve() });
    const nr = ++z.tippen;
    z.offen++;
    this.setzeAktivenLoop(st.deck, { ...alt, laenge });
    const felder = this.deckTeil('/k/deck/loop_laenge', st, ab, raster, { start_beat: alt.start, laenge_beats: laenge });
    // abgelehnt (Loop ginge aus dem Material): der alte Loop läuft weiter. The answers may arrive in any order (a refusal comes at ab_beat,
    // an accepted tap is only known after its wait): each tap decides after the earlier ones did, so `sicher` is up to date when a refusal rolls back
    z.kette = Promise.all([this.warteBisAb(Number(felder.id), ab), z.kette]).then(([q]) => {
      const abgelehnt = !!q && GRAPH_ABGELEHNT.includes(q.status);
      if (!abgelehnt) z.sicher = laenge;
      const jetzt = this.aktiverLoop[taste];   // only the length goes back: a jump on the same grid beat may have moved the start meanwhile
      if (abgelehnt && nr === z.tippen && jetzt) this.setzeAktivenLoop(st.deck, { ...jetzt, laenge: z.sicher });
      if (--z.offen === 0 && this.loopLaengeTasten?.[taste] === z) delete this.loopLaengeTasten[taste];
    });
    return this.json(a, 200, { ok: true, felder });
  }
  // Loop-Raster (Plan 2026-10-21): mit Raster setzt der Server den Start selbst auf das Track-Raster (L1/L2) und schickt ihn als
  // festen Start (/k/deck/loop_laenge, Kern art 5 mit quell_beat); lehnt der Kern ab, gilt wieder der vorige Loop (L4).
  const imLauf = Number(st.z.status) === 3 || Number(st.z.status) === 4;   // im Loop/Roll: den gewickelten Kopf kennt nur der Kern (L2b)
  if (d.laenge > 0 && raster > 0 && !imLauf) {
    // Sofort (nur Vorlauf), nicht auf die Rasterstelle des Masters: der Start liegt schon auf dem Track-Raster, das Warten kostete bei
    // Takt-Raster bis zu 4 Beats (Andreas 21.10.: „der loop knopf reagiert nur verzögert“). Liegt der Start bis zu ½ Beat vor dem Kopf,
    // läuft der Kopf in den Loop hinein.
    const jetzt = this.deckAb(st, 0);
    const start = loopStart({ laeuft: Number(st.z.status) >= 2, quell: Number(st.z.quell_beat), beat: st.beat, ab: jetzt, raster, eins: st.eins });
    const vorher = this.aktiverLoop[String(st.deck)];
    this.setzeAktivenLoop(st.deck, { schluessel: Oberflaeche.fassungSchluessel(st.f), start, laenge: d.laenge });
    const felder = this.deckTeil('/k/deck/loop_laenge', st, jetzt, 0, { start_beat: start, laenge_beats: d.laenge });
    void this.warteQuittung(Number(felder.id), jetzt).then((q) => {
      if (!q || !GRAPH_ABGELEHNT.includes(q.status)) return;
      if (vorher) this.setzeAktivenLoop(st.deck, vorher);
      else { delete this.aktiverLoop[String(st.deck)]; this.sichereAktiveLoops(); }
    });
    return this.json(a, 200, { ok: true, felder });
  }
  this.merkeLoop(st, ab, d.laenge);   // Raster 0 oder aus: der Kern setzt ab dem Kopf (L3)
  this.json(a, 200, { ok: true, felder: this.deckTeil('/k/deck/loop', st, ab, raster, { laenge_beats: d.laenge }) });
}
// First frame of the deck loop in the rendering file (grid offset included); the cut of deck/loop/sichern and of the live module export
export function loopStartFrame(this: Oberflaeche, st: { deck: number; f: Fassung; erster: number }, l: { start: number }): number {
  return Math.round(st.erster + this.rasterWert(st.deck, st.f).versatz_frames + l.start * (48000 * 60 / st.f.basis_bpm));
}
// The deck's active loop as a cut of its rendering, for the live module export (areas/live/export.ts): the same frames deck/loop/sichern writes
export function deckLoopAusschnitt(this: Oberflaeche, deck: unknown): DeckLoopAusschnitt | { code: number; fehler: string } {
  if (!istOffenesDeck(deck)) return { code: 400, fehler: 'unbekanntes_deck' };
  const st = this.deckStand(deck);
  if (!st) return { code: 409, fehler: 'kein_kernstand' };
  const l = this.loopVon(st);
  if (!l) return { code: 409, fehler: 'kein_loop' };
  let basis: string;
  try { basis = fassungQuelle(this.opt.bestand, st.f.material_id, st.f.basis_bpm, st.f.fassung).datei; } catch { return { code: 409, fehler: 'kein_bibliothekstrack' }; }
  return { deck: st.deck, material_id: st.f.material_id, basis_bpm: st.f.basis_bpm, fassung: st.f.fassung, basisDatei: basis,
    eins: st.eins, startFrame: this.loopStartFrame(st, l), frames: Math.round(l.laenge * 48000 * 60 / st.f.basis_bpm), laenge_beats: l.laenge, von_beat: l.start };
}
// Task 11 (decision 19): the key of the deck on the master. Candidates: the playing decks (status 2+) with an open channel. The loudest channel on the
// master wins (peak of the last 3 s in the unthrottled buffer, channel 'deck/<n>'); without a reading the lowest deck number. The key is the catalogue's
// Camelot value for the deck's material, the library's own analysis as a fallback.
export function masterTonart(this: Oberflaeche): { deck: number; tonart: string | null } | { code: number; fehler: string } {
  const pegel = this.pegelPuffer.lies(3);
  let bester: { n: number; db: number } | null = null;
  for (const n of OFFENE_DECKS) {
    const z = this.stand.decks[String(n)] as Record<string, unknown> | undefined;
    if (!z || !(Number(z.status) >= 2) || !kanalOffen(this.stand.regler, pultContainerPfad[n - 1])) continue;
    const db = pegel[`deck/${n}`]?.max_db ?? -200;
    if (!bester || db > bester.db) bester = { n, db };
  }
  if (!bester) return { code: 409, fehler: 'kein_deck' };
  const mid = String((this.stand.decks[String(bester.n)] as Record<string, unknown>).material_id);
  return { deck: bester.n, tonart: this.tonartVon(mid) };
}
// One key source for the live modules (the module origin at export and the deck on the master): the library's own analysis of the track (what /lage
// shows) first, the catalogue's tag only as a fallback
export function tonartVon(this: Oberflaeche, mid: string): string | null {
  return tonartQuelle(leseBestand(this.opt.bestand).find((x) => x.material_id === mid)?.camelot, this.katalogEintrag(mid)?.camelot);
}
export function moduleHerkunft(this: Oberflaeche, mid: string): Zeile | null {
  const z = this.katalogEintrag(mid);
  return z ? { ...z, camelot: this.tonartVon(mid) } : null;
}
// POST /deck/loop/sichern {deck}: aktiver Deck-Loop → Loop der Bibliothek (Ausschnitt der Fassung wie der Kern ihn
// spielt: schlag0 = erster_schlag_frame + Grid-Versatz), Name a|b-HHMMSS-<beats>b; loading it is the loop deck (container core)
export function deckLoopSichern(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  if (!istOffenesDeck(d.deck)) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
  if (d.box !== undefined) return this.json(a, 400, { fehler: 'unbekannte_box' });   // the loop boxes are gone
  const st = this.deckStand(d.deck);
  if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
  const l = this.loopVon(st);
  if (!l) return this.json(a, 409, { fehler: 'kein_loop' });
  const fpb = 48000 * 60 / st.f.basis_bpm;
  const start = this.loopStartFrame(st, l);
  const jetzt = new Date(), z = (n: number) => String(n).padStart(2, '0');
  const name = `${'abcd'[d.deck - 1]}-${z(jetzt.getHours())}${z(jetzt.getMinutes())}${z(jetzt.getSeconds())}-${l.laenge}b`;
  try {
    const q = fassungQuelle(this.opt.bestand, st.f.material_id, st.f.basis_bpm, st.f.fassung);
    schreibeLoopAusFassung({ basis: q.datei, dir: this.loopOrdner(), name, startFrame: start, frames: Math.round(l.laenge * fpb),
      bpm: st.f.basis_bpm, beats: l.laenge, herkunft: { material_id: st.f.material_id, fassung: st.f.fassung, quell_beat: l.start } });
  } catch (err) { return this.json(a, 500, { fehler: 'schreiben', text: (err as Error).message }); }
  this.opt.log?.({ typ: 'deck_loop_gesichert', deck: st.deck, name, start_frame: start });
  this.json(a, 200, { ok: true, name });
}
// Hotcues der Fassung; fehlt ihre Datei, die der nächstälteren, auf dieselbe Audio-Stelle verschoben (hotcuesErbe)
export function hotcuesErbeVon(this: Oberflaeche, f: Fassung): { hotcues: Record<string, Hotcue>; von: number | null } {
  return hotcuesErbe(this.hotcueOrdner(), f, { fpb: 48000 * 60 / f.basis_bpm,
    esf: (r) => this.einsDerFassung(f.material_id, f.basis_bpm, r)?.esf ?? null,
    rasterV: (r) => this.rasterErbeVon({ ...f, fassung: r }).v });
}
// Hotcues (D5, D6): {deck, nr, aktion: setzen|spielen|loeschen, quell_beat?, art?, laenge?, raster}
export function deckHotcue(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  const raster = this.rasterAus(d);
  if (raster === null) return this.json(a, 400, { fehler: 'raster' });
  if (!istOffenesDeck(d.deck)) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
  if (typeof d.nr !== 'number' || !Number.isInteger(d.nr) || d.nr < 1 || d.nr > 8) return this.json(a, 400, { fehler: 'nr' });
  const st = this.deckStand(d.deck);
  if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
  const datei = hotcueDatei(this.hotcueOrdner(), st.f);
  const alle = this.hotcuesErbeVon(st.f).hotcues;   // neue Fassung ohne eigene Datei: der geerbte Satz wird beim Schreiben ihre eigene
  const setze = (q: number) => {
    this.kern.sende('/k/deck/hotcue_setzen', { id: Number(++this.id), quelle: this.quelle(), deck: st.deck, nr: d.nr, quell_beat: q });
    this.gesendet++;
  };
  if (d.aktion === 'setzen' && d.aus_loop === true) {   // leeres Pad bei laufendem Deck-Loop: genau dieser Loop wird der Cue
    if (!Oberflaeche.loopScharf(st.z)) return this.json(a, 409, { fehler: 'kein_loop' });
    const l = this.loopVon(st);
    // Ohne gemerkten Loop (Seiten-Server neu gestartet, der Kern hält ihn noch): Kopf aufs Raster ab der Eins, Länge der Seite
    const lg = typeof d.laenge === 'number' && Oberflaeche.LOOP_LAENGEN.includes(d.laenge) ? d.laenge : 4;
    const r0 = raster > 0 ? raster : 1, q = Number(st.z.quell_beat);
    const h: Hotcue = l ? { quell_beat: Math.round(l.start * 1000) / 1000, art: 'loop', laenge: l.laenge }
      : { quell_beat: st.eins + r0 * Math.floor((q - st.eins) / r0 + 1e-6), art: 'loop', laenge: lg };
    alle[String(d.nr)] = h;
    schreibeHotcues(datei, alle);
    setze(h.quell_beat);
    return this.json(a, 200, { ok: true, hotcue: h });
  }
  if (d.aktion === 'setzen') {
    const q = typeof d.quell_beat === 'number' && Number.isFinite(d.quell_beat) ? d.quell_beat : Number(st.z.quell_beat);
    const art = d.art === 'loop' ? 'loop' : 'shot';
    if (art === 'loop' && !(typeof d.laenge === 'number' && Oberflaeche.LOOP_LAENGEN.includes(d.laenge))) return this.json(a, 400, { fehler: 'laenge' });
    const h: Hotcue = art === 'loop' ? { quell_beat: rasterRunden(q, raster, st.eins), art, laenge: d.laenge as number }
      : { quell_beat: rasterRunden(q, raster, st.eins), art };
    alle[String(d.nr)] = h;
    schreibeHotcues(datei, alle);
    setze(h.quell_beat);
    return this.json(a, 200, { ok: true, hotcue: h });
  }
  if (d.aktion === 'loeschen') {
    delete alle[String(d.nr)];
    schreibeHotcues(datei, alle);
    setze(NaN);
    return this.json(a, 200, { ok: true });
  }
  if (d.aktion !== 'spielen') return this.json(a, 400, { fehler: 'aktion' });
  const h = alle[String(d.nr)];
  if (!h) return this.json(a, 400, { fehler: 'leer' });
  const ab = this.deckAb(st, raster);
  const hot = this.deckTeil('/k/deck/hotcue', st, ab, raster, { nr: d.nr });
  // LOOP: gleicher Ziel-Beat, spätere id → der Kern führt den Loop nach dem Hotcue aus (seq)
  const lp = h.art === 'loop' ? this.deckTeil('/k/deck/loop', st, ab, raster, { laenge_beats: h.laenge ?? 4 }) : null;
  if (lp) this.setzeAktivenLoop(st.deck, { schluessel: Oberflaeche.fassungSchluessel(st.f), start: h.quell_beat, laenge: h.laenge ?? 4 });
  this.json(a, 200, { ok: true, felder: hot, loop: lp });
}
export function hotcuesAus(this: Oberflaeche, deck: number, a: http.ServerResponse): void {
  const st = this.deckStand(deck);
  if (!st) return this.json(a, 200, {});
  this.json(a, 200, this.hotcuesErbeVon(st.f).hotcues);
}
// Nach /e/geladen (und nach einem Kern-Neustart) die gespeicherten Hotcues der Fassung an den Kern (D5).
export function hotcuesWieder(this: Oberflaeche, deck: number, f: Fassung): void {
  if (!f?.material_id) return;
  const { hotcues: alle, von } = this.hotcuesErbeVon(f);
  let n = 0;
  for (const [nr, h] of Object.entries(alle)) {
    if (!Number.isFinite(h?.quell_beat)) continue;
    this.kern.sende('/k/deck/hotcue_setzen', { id: Number(++this.id), quelle: this.quelle(), deck, nr: Number(nr), quell_beat: h.quell_beat });
    this.gesendet++;
    n++;
  }
  if (n > 0) this.opt.log?.({ typ: 'hotcues_wieder', deck, anzahl: n, ...(von !== null ? { geerbt_von: von } : {}) });
}
// POST /deck/start {deck, ab?='takt', quell_beat?} (Plan Hand T5): synchron zum Master auf den Takt, ab der Takt-Eins der
// Fassung (oder quell_beat). Politik 0: zu spät heißt verworfen, nicht verschoben. Für cypher auf offenem Deck gesperrt.
export async function deckStartStopp(this: Oberflaeche, start: boolean, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  if (!istOffenesDeck(d.deck)) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
  const ab = d.ab ?? (start ? 'takt' : 'jetzt');
  if (typeof ab !== 'string' || !(ab in AB)) return this.json(a, 400, { fehler: 'ab' });
  const st = this.deckStand(d.deck);
  if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
  if (start && this.quelle() === 'cypher' && kanalOffen(this.stand.regler, pultContainerPfad[d.deck - 1])) {
    return this.json(a, 409, { fehler: 'ziel_ungehoert', text: 'deck is open; starting it plays unheard material' });
  }
  const q = d.quell_beat === undefined ? st.eins : d.quell_beat;
  if (typeof q !== 'number' || !Number.isFinite(q)) return this.json(a, 400, { fehler: 'quell_beat' });
  const basis = { id: Number(++this.id), quelle: this.quelle(), plan: this.planVon(), gruppe: '', hoerschein: '', deck: d.deck, ab_beat: this.abVon(ab) };
  // ab 'takt' on a 4-beat bar: politik 3 (SYNC), the core aligns the bar phase to the playing deck (it knows the exact positions); else 0
  const takt = start && ab === 'takt' && this.proTakt() === 4;
  const felder = start ? { ...basis, quell_beat: q, politik: takt ? 3 : 0 } : { ...basis, politik: 1 };
  this.kern.sende(start ? '/k/deck/start' : '/k/deck/stopp', felder);
  this.gesendet++;
  // the core may shift a bar start by less than 4 beats; the +1 window of startSteht takes the rest
  if (start) this.startGeplant.set(Number(d.deck), felder.ab_beat + (takt ? 3 : 0)); else this.startGeplant.delete(Number(d.deck));
  this.json(a, 200, { ok: true, felder, quittung: await this.warteQuittung(felder.id, felder.ab_beat) });
}
