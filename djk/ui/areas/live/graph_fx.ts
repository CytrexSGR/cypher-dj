// Graphs and beat FX of the page server: load and set graphs, FX units, assignments, latch (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { KernWeg } from '../proj/core_path.ts';
import type { KernLage } from '../proj/state.ts';
import { type Bereich } from '../../http/router.ts';
import { alsAntwort } from '../proj/area.ts';
import { strudelGruppe, stromSpur, platzVonGruppe } from '../../project/model.ts';
import { instanz } from '../../paths.ts';
import { PFAD } from '../../hand_operation.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { istBkStrom, stromVonKanal } from '../../../contract/streams.ts';
import { findeGraph, reglerVonGraph, GRAPH_NAME, GRAPH_KANAELE, INSTRUMENT_KANAELE, EFFEKT_KANAELE } from '../../graphs.ts';
import { GRAPH_ABGELEHNT } from '../../server_kopf.ts';
import { Oberflaeche } from '../../server.ts';

export function fx(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  const anteil = (x: unknown) => typeof x === 'number' && x >= 0 && x <= 1;
  if (d.einheit !== 1 && d.einheit !== 2) return this.json(a, 400, { fehler: 'einheit' });
  if (typeof d.art !== 'number' || !(Number.isInteger(d.art) && d.art >= 1 && d.art <= 12)) return this.json(a, 400, { fehler: 'art' });
  if (typeof d.beats !== 'number' || !Oberflaeche.FX_BEATS.includes(d.beats)) return this.json(a, 400, { fehler: 'beats' });
  if (!anteil(d.wet) || !anteil(d.param1) || !anteil(d.param2) || !anteil(d.param3)) return this.json(a, 400, { fehler: 'wet_param' });
  if (typeof d.an !== 'boolean') return this.json(a, 400, { fehler: 'an' });
  const felder = { id: Number(++this.id), quelle: this.quelle(), einheit: d.einheit, art: d.art, beats: d.beats, wet: d.wet, param1: d.param1, param2: d.param2, param3: d.param3, an: d.an ? 1 : 0 };
  this.kern.sende('/k/fx', felder);
  this.angefasst.add(`fx:${d.einheit}`);
  this.fxVon(d.einheit as 1 | 2, this.quelle() as 'andreas' | 'cypher');
  this.gesendet++;
  this.json(a, 200, { ok: true, felder });
}
// Baukasten S16: the kern reports each graph slot (/e/graph); its word replaces what this server sent
export function merkeGraph(this: Oberflaeche, kanal: string, name: string): void {
  this.graphenVomKernMs = Date.now();
  const vorher = this.stand.graphen_geladen[kanal] ?? '';
  if (vorher === name) return;
  const neu = { ...this.stand.graphen_geladen };
  if (name === '') delete neu[kanal]; else neu[kanal] = name;
  delete this.graphBesitzer[kanal];   // a graph this server did not load: the owner is unknown
  this.opt.log?.({ typ: 'graph_vom_kern', kanal, vorher, name });
  this.setzeGraphenGeladen(neu);
}
export function fragGraphen(this: Oberflaeche, grund: string): void {
  this.kern.sende('/k/graph/frage', { id: Number(++this.id), quelle: 'andreas' });
  this.opt.log?.({ typ: 'graphen_frage', grund });
}
// Baukasten S12: set the loaded-graph map and push it to the pages
export function setzeGraphenGeladen(this: Oberflaeche, neu: Record<string, string>): void {
  this.stand.graphen_geladen = neu;
  this.verteile({ a: 'graphen', f: { geladen: neu } });
}
// POST /graph {kanal, name, vorgaben?}: put a Baukasten graph on a channel or take it off (name ""). Instruments: erz/2, erz/3 through
// /erz/strom (bk:<name>, "bk:" removes: the kern replays the stream's last kit/midi target). Effects: deck/1..4, fx/3, fx/4, master,
// erz/1..3 and pad/1, pad/2 through /k/kanal/graph. A kern refusal answers 200 with the quittung (like /regler); 409 only for the Cypher pre-checks.
export async function graphLaden(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const r = await this.graphSetzen(d, this.quelle());
  this.json(a, r.code, r.j);
}
// S17: the body of POST /graph as a function with an explicit source, shared with the Bereich bridge (bereichKontext().baukasten)
// `wieder` (restore after a kern restart, graphWieder): the graph was sounding before the restart, so Cypher's pre-checks for a NEW load (kit mode, Stop
// Cypher, AUTO off) do not apply here; the caller decides about Stop Cypher. The channel is not marked as set again either.
export async function graphSetzen(this: Oberflaeche, d: Record<string, unknown>, quelle: string, o: { wieder?: boolean } = {}): Promise<{ code: number; j: Record<string, unknown> }> {
  const kanal = d.kanal, name = d.name;
  if (typeof kanal !== 'string' || !GRAPH_KANAELE.includes(kanal)) return { code: 400, j: { fehler: 'ausserhalb_bereich' } };
  if (typeof name !== 'string' || (name !== '' && !GRAPH_NAME.test(name))) return { code: 400, j: { fehler: 'name' } };
  if (d.vorgaben !== undefined && typeof d.vorgaben !== 'boolean') return { code: 400, j: { fehler: 'vorgaben' } };
  // Container core M9 (D2): the stream channels erz/<n> take an instrument graph (the stream of the Erzeuger) or an effect graph (a bk insert on the strom
  // track); pad/1, pad/2 are container strips now and take effects only. The kind decides the way: the graph being loaded, on removal the one loaded now
  // (an instrument graph of the stream, else the bk insert of its strom track).
  const stromKanal = stromVonKanal(kanal);
  const insertGraph = stromKanal !== null ? this.bkInsertVonStrom(stromKanal)?.graph ?? '' : '';
  const jetzt = this.stand.graphen_geladen[kanal] || insertGraph;
  const istInstrument = (n: string): boolean => findeGraph(n)?.art === 'instrument';
  const neuG = name !== '' ? findeGraph(name) : null;
  if (name !== '' && !neuG) return { code: 404, j: { fehler: 'unbekannt' } };
  const instrument = neuG ? neuG.art === 'instrument' : jetzt !== '' ? istInstrument(jetzt)
    : stromKanal !== null ? INSTRUMENT_KANAELE.includes(kanal) : !EFFEKT_KANAELE.includes(kanal);
  const erz = instrument && INSTRUMENT_KANAELE.includes(kanal);
  if (instrument && kanal === 'erz/1') return { code: 400, j: { fehler: 'kein_midi_strom', text: 'stream 1 runs a drum kit: its notes are kit indices, an instrument graph would get them as MIDI notes' } };
  if (instrument && /^pad\//.test(kanal)) return { code: 400, j: { fehler: 'ausserhalb_bereich', text: `${kanal} is a container strip: instrument graphs run on the stream channels erz/<n>` } };
  if (neuG && !(instrument ? INSTRUMENT_KANAELE : EFFEKT_KANAELE).includes(kanal)) return { code: 400, j: { fehler: 'falsche_art', art: neuG.art } };
  // one graph per channel: an effect does not go onto a channel whose stream plays an instrument graph, nor the other way round (on erz/<n> the effect side is the bk insert)
  if (neuG && jetzt !== '' && jetzt !== name && istInstrument(jetzt) !== instrument) {
    return { code: 409, j: { fehler: 'belegt', kanal, graph: jetzt, text: `${kanal} carries the ${instrument ? 'effect' : 'instrument'} graph ${jetzt}: take it off first` } };
  }
  const strom = erz ? (stromKanal as number) : 0;
  // S15 (break 7): a stream whose erzeuger runs in kit mode sends kit indices, a graph would get wrong or no notes. Unknown mode passes.
  // Cypher is refused; Andreas's own page loads and gets a warning (no lock in his tools without his yes).
  let warnung: string | undefined;
  if (erz && name !== '' && leseMusterStand(this.musterOrdner(strom)).status?.noten === 'kit') {
    const text = `stream ${strom} runs in kit mode (notes are kit indices): load the instruments first (tool instrumente, or djk-instrumente --instanz <i>), then load the graph`;
    if (quelle === 'cypher' && !o.wieder) return { code: 400, j: { fehler: 'kein_midi_strom', strom, text } };
    warnung = text;
  }
  if (quelle === 'cypher' && !o.wieder) {
    if (this.kiGestoppt) return { code: 409, j: { fehler: 'ki_gestoppt' } };
    if (erz && !leseMusterStand(this.musterOrdner(strom)).autonom) return { code: 409, j: { fehler: 'auto_aus', strom, text: 'AUTO is off: Andreas holds this stream' } };
  }
  // S18: streams 5..10 are played by the multi-stream erzeuger (djk/start/djk-stroeme). Without a fresh heartbeat nobody would
  // play the graph: say so instead of loading a silent one. Taking a graph off never needs the process (the kern replays the stored target).
  if (erz && name !== '' && istBkStrom(strom) && !this.erzeugerLebt(strom)) {
    return { code: 409, j: { fehler: 'kein_erzeuger', strom, text: `no erzeuger process serves stream ${strom} (${kanal}); start it with djk/start/djk-stroeme${instanz() ? ` --instanz ${instanz()}` : ''}` } };
  }
  // An effect graph on a stream channel is a project edit (bk insert on the strom track), not a message to the core
  if (!instrument && stromKanal !== null) return this.graphAlsInsert(stromKanal, kanal, name, quelle === 'cypher' ? 'cypher' : 'andreas');
  // Graph defaults: the rows of the knobs the graph defines go to the kern, at their `vorgabe`, in ONE batch (KernWeg.setzeRegler, like the project restore) and
  // the load message follows only after the end status of the last row: a part carries a start beat a few ms ahead, the load message none, so without the wait the
  // kern would hand the old rows to the new graph at attach time. Only when the graph name changes (reloading the same graph or unloading leaves every
  // knob alone) and not when the caller sets its own rows (project restore: vorgaben false). `vorher` = the channel's current values, for the rollback below.
  let vorher: { pfad: string; wert: number }[] = [];
  if (name !== '' && d.vorgaben !== false && name !== this.stand.graphen_geladen[kanal] && this.kern.zustand === 'verbunden') vorher = await this.schiebeVorgaben(kanal, name, quelle);
  const id = Number(++this.id);
  if (!o.wieder) this.angefasst.add(`graph:${kanal}`);   // set again since the last restore plan: a pending restore leaves this channel alone
  if (erz) this.kern.sende('/erz/strom', { id, quelle, strom, ziel: `bk:${name}` });
  else this.kern.sende('/k/kanal/graph', { id, quelle, kanal, name });
  this.gesendet++;
  const quittung = await this.warteQuittung(id, undefined, false, 4000);   // a sampler graph loads up to 64 MiB in the net thread before it answers
  if (quittung && [2, 3, 5].includes(quittung.status)) {   // /k/kanal/graph answers 1, 2, 3 at once and the wait can return on the 2 (measured on d)
    const neu = { ...this.stand.graphen_geladen };
    if (name === '') delete neu[kanal]; else neu[kanal] = name;
    this.setzeGraphenGeladen(neu);
    if (name === '') delete this.graphBesitzer[kanal]; else this.graphBesitzer[kanal] = quelle;   // after the push: merkeGraph is not involved here
    this.merkeNeustartStand();
  } else if (quittung && GRAPH_ABGELEHNT.includes(quittung.status) && vorher.length) {
    // an explicit refusal: the running graph keeps its own values, not the defaults of the graph that was refused (no answer at all keeps the pushed rows:
    // the load may still happen, the page's graph list shows the truth)
    await this.kernWeg().setzeRegler(vorher.map((z) => ({ pfad: z.pfad, wert: z.wert })), quelle === 'cypher' ? 'cypher' : 'andreas');   // waits for the end status as well
  }
  // an instrument graph sounds in a container only through a strom track that reads its stream: say so when none does (a hint, not a refusal)
  const ohneSpur = erz && name !== '' && !this.stromSpurDa(strom);
  return { code: 200, j: { ok: true, kanal, name, quittung, ...(warnung ? { warnung } : {}), ...(ohneSpur ? { hinweis: 'kein_strudel_modul' } : {}) } };
}
// The strom track of stream n in a placed strudel module of the open live project (none: no strudel module, or no track for the stream yet)
export function stromSpurDa(this: Oberflaeche, strom: number): boolean {
  const o = this.proj.zugang.offen();
  if (!o?.projekt.live) return false;
  const g = strudelGruppe(o.projekt);
  return !!g && platzVonGruppe(o.projekt, g.id) !== null && stromSpur(o.projekt, strom) !== null;
}
// The bk insert (effect graph) on the strom track of stream n, if any
export function bkInsertVonStrom(this: Oberflaeche, strom: number): { id: string; graph: string; pos: number; spur_id: string } | null {
  const o = this.proj.zugang.offen();
  const s = o ? stromSpur(o.projekt, strom) : undefined;
  const pos = s?.inserts?.findIndex((i) => i.art === 'bk') ?? -1;
  return s && pos >= 0 ? { id: s.inserts![pos].id, graph: s.inserts![pos].graph ?? '', pos, spur_id: s.id } : null;
}
// Effect graph on erz/<n> (D2): a bk insert on the strom track as ONE project step of the caller (undo removes it); name '' removes the insert.
// Needs the strudel module (kein_strudel_modul) and creates the strom track on demand, like POST /strudel. The restore after a core restart does not
// replay it: the project translator carries inserts. graphen_geladen holds no entry for it (the project is the truth).
export async function graphAlsInsert(this: Oberflaeche, strom: number, kanal: string, name: string, quelle: 'andreas' | 'cypher'): Promise<{ code: number; j: Record<string, unknown> }> {
  const o = this.proj.zugang.offen();
  if (!o || o.projekt.live !== true) return { code: 409, j: { fehler: 'kein_liveprojekt', text: 'an effect graph on a stream is an insert of its strom track in the live project' } };
  const modul = strudelGruppe(o.projekt);
  if (!modul || platzVonGruppe(o.projekt, modul.id) === null) return { code: 409, j: { fehler: 'kein_strudel_modul', strom, text: 'no place holds the strudel module; place it with POST /plaetze' } };
  const da = this.bkInsertVonStrom(strom);
  if (name === '') {
    if (!da) return { code: 200, j: { ok: true, kanal, name: '', entfernt: false } };
    const r = await this.proj.sitzung.aendern({ rev: o.projekt.rev, label: `Strom ${strom} graph off`, befehle: [{ befehl: 'insert_entfernen', insert_id: da.id }] }, quelle);
    return r.code === 200 ? { code: 200, j: { ok: true, kanal, name: '', entfernt: true } } : { code: r.code, j: r.j };
  }
  if (da?.graph === name) return { code: 200, j: { ok: true, kanal, name, insert_id: da.id, unveraendert: true } };
  try { await this.sorgeFuerStromSpur(strom, quelle); } catch (e) { const r = alsAntwort(e, this.bereichKontext()); return { code: r.code, j: r.j }; }
  const jetztOffen = this.proj.zugang.offen()!;
  const spur = stromSpur(jetztOffen.projekt, strom)!;
  const bk = this.bkInsertVonStrom(strom);
  const befehl = bk ? { befehl: 'insert_setzen', strang_id: spur.id, pos: bk.pos, art: 'bk', graph: name, ersetzen: true }
    : { befehl: 'insert_setzen', strang_id: spur.id, pos: (spur.inserts ?? []).length, art: 'bk', graph: name };
  const r = await this.proj.sitzung.aendern({ rev: jetztOffen.projekt.rev, label: `Strom ${strom} graph ${name}`, befehle: [befehl] }, quelle);
  if (r.code !== 200) return { code: r.code, j: r.j };
  return { code: 200, j: { ok: true, kanal, name, insert_id: this.bkInsertVonStrom(strom)?.id ?? null } };
}
// The `vorgabe` rows of graph `name` on `kanal` as one batch, waited for until the end status of every row; returns the channel's current values of these rows
// (0.5 = the kern's table default where the page has no report yet), empty when nothing was sent.
export async function schiebeVorgaben(this: Oberflaeche, kanal: string, name: string, quelle: string): Promise<{ pfad: string; wert: number }[]> {
  const b = reglerVonGraph(name);
  if (!b) return [];
  const strom = stromVonKanal(kanal);   // the knobs of a stream's instrument graph are the rows strom/<n>/bk/<k> (container core M9)
  const neu = Object.entries(b).map(([nr, r]) => ({ pfad: `${strom !== null ? `strom/${strom}` : kanal}/bk/${nr}`, wert: r.vorgabe })).filter((z) => PFAD.test(z.pfad));
  if (!neu.length) return [];
  const alt = neu.map((z) => ({ pfad: z.pfad, wert: this.stand.regler[z.pfad] ?? 0.5 }));
  await this.kernWeg().setzeRegler(neu, quelle === 'cypher' ? 'cypher' : 'andreas');
  return alt;
}
export function kernWeg(this: Oberflaeche): KernWeg {
  // KernWeg only reads the clock (beat, bpm) of its lage: this server keeps it in kern.uhr
  const uhr = this;
  this.kernWegInstanz ??= new KernWeg(this.bereichKontext(), { get uhr() { return (uhr.kern.uhr as { beat: number; bpm: number } | null) ?? null; } } as unknown as KernLage);
  return this.kernWegInstanz;
}
// Plan Hand T7 (Review M3): Cyphers FX nur bei AUTO an und ohne Stop Cypher (der Kern nimmt /k/fx auch gestoppt an)
export function fxRiegel(this: Oberflaeche, a: http.ServerResponse): boolean {
  if (this.quelle() !== 'cypher') return false;
  if (this.kiGestoppt) { this.json(a, 409, { fehler: 'ki_gestoppt' }); return true; }
  if (!leseMusterStand(this.musterOrdner()).autonom) { this.json(a, 409, { fehler: 'auto_aus' }); return true; }
  return false;
}
// Ohr T18: /k/fx/routing an den Kern; gibt die Kennung zurück
export function fxRoutingSenden(this: Oberflaeche, routing: 'post_fader' | 'insert', quelle: string): { id: number; quelle: string; routing: number } {
  const felder = { id: Number(++this.id), quelle, routing: routing === 'insert' ? 1 : 0 };
  this.kern.sende('/k/fx/routing', felder);
  this.gesendet++;
  return felder;
}
export function fxZuweisung(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  if (d.einheit !== 1 && d.einheit !== 2 && d.einheit !== 3) return this.json(a, 400, { fehler: 'einheit' });
  const erlaubt = d.einheit === 3 ? Oberflaeche.FX3_ZUWEISUNG_KANAL : Oberflaeche.FX_ZUWEISUNG_KANAL;
  if (typeof d.kanal !== 'string' || !erlaubt.includes(d.kanal)) return this.json(a, 400, { fehler: 'kanal' });
  if (typeof d.an !== 'boolean') return this.json(a, 400, { fehler: 'an' });
  const felder = { id: Number(++this.id), quelle: this.quelle(), einheit: d.einheit, kanal: d.kanal, an: d.an ? 1 : 0 };
  this.kern.sende('/k/fx/zuweisung', felder);
  this.angefasst.add(`fx:${d.einheit}`);
  this.fxVon(d.einheit as 1 | 2 | 3, this.quelle() as 'andreas' | 'cypher');
  this.gesendet++;
  this.json(a, 200, { ok: true, felder });
}
// Wer eine Einheit zuletzt gesetzt hat (fx_von.json im Muster-Ordner, je Einheit ein Schlüssel "1"/"2"): die
// Seite schreibt andreas, djk-fx (Slice 4) cypher.
export function fxVon(this: Oberflaeche, einheit: 1 | 2 | 3, von?: 'andreas' | 'cypher'): string | null {
  const datei = path.join(this.musterOrdner(), 'fx_von.json');
  let stand: Record<string, { von: string; zeit: number }> = {};
  try { stand = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { /* noch keine Datei */ }
  if (von) {
    stand[String(einheit)] = { von, zeit: Date.now() };
    try { fs.mkdirSync(this.musterOrdner(), { recursive: true }); fs.writeFileSync(datei, JSON.stringify(stand)); } catch { /* ohne Datei: AUTO aus lässt sie stehen */ }
    return von;
  }
  return stand[String(einheit)]?.von ?? null;
}
// AUTO aus (Andreas 2026-09-28: „effekte laufen besser immer aus“): je Einheit klingt ein laufender, von Cypher
// gesetzter Effekt aus; einen von Andreas gesetzten fasst das nicht an. Beide Einheiten unabhängig geprüft.
export function fxCypherAuslaufen(this: Oberflaeche): void {
  for (const einheit of [1, 2] as const) {
    const f = this.stand.fx[einheit - 1] as Record<string, unknown> | null;
    if (!f || f.an !== 1 || this.fxVon(einheit) !== 'cypher') continue;
    const felder = { id: Number(++this.id), quelle: this.quelle(), einheit, art: f.art, beats: f.beats, wet: f.wet, param1: f.param1, param2: f.param2, param3: f.param3, an: 0 };
    this.kern.sende('/k/fx', felder);
    this.gesendet++;
    this.opt.log?.({ typ: 'fx_auslaufen', einheit });
  }
}
