// Track runs of the page server: save and load of the runs, start, stop, change, pattern timers, arcs (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { kopfWert } from '../../http/hand_stufe.ts';
import type { Felder } from '../../../conductor/src/addresses.ts';
import { GRUND_TEXT } from '../../http/reasons.ts';
import { kompiliereBogen } from '../../bogen.ts';
import { abBeat } from '../../deck_operation.ts';
import { FEHL_STATUS } from '../../hand_operation.ts';
import { istStromZeile } from '../../stream_alias.ts';
import { pruefeSpur, plane, oeffnetKanal, beatZuMono, wirtRuf, faelligeMuster, SPUR_NAME, STROM_ZIEL, MAX_TAKT, type MusterPlan, type Fahrt } from '../../track.ts';
import { planeDurchlauf, type Spur } from '../../track.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { ALLE_STROEME, istBkStrom } from '../../../contract/streams.ts';
import { ueberProjekt, ueberProjektText, KLANG_GRUPPEN, schleifeAusDatei } from '../../server_kopf.ts';
import type { SpurLauf } from '../../server_kopf.ts';
import type { Oberflaeche } from '../../server.ts';

// F2: laufende Spuren überstehen den Neustart des Seiten-Servers. Nach jeder Änderung atomar nach <wirtBasis>/spuren.json
// (tmpfs wie die Wirt-Sockets); beim Start geladen. Abgelaufene Spuren räumt spurenAufraeumen ab, sobald die Uhr da ist.
export function spurenSichern(this: Oberflaeche): void {
  const datei = path.join(this.wirtBasis(), 'spuren.json');
  const daten = [...this.spuren].map(([name, l]) => ({ name, quelle: l.quelle, anker: l.anker, ende: l.ende, fahrten: l.fahrten, gruppen: [...l.gruppen],
    ids: l.ids, teile: l.teile, muster: l.offen, ...(l.schleife ? { schleife: l.schleife } : {}), ...(l.bogen ? { bogen: l.bogen } : {}) }));
  try {
    fs.mkdirSync(this.wirtBasis(), { recursive: true });
    const tmp = `${datei}.${process.pid}.neu`;
    fs.writeFileSync(tmp, JSON.stringify(daten));
    fs.renameSync(tmp, datei);
  } catch (e) { this.opt.log?.({ typ: 'spuren_sichern_fehler', fehler: (e as Error).message }); }
}
export function spurenLaden(this: Oberflaeche): void {
  let daten: unknown;
  try { daten = JSON.parse(fs.readFileSync(path.join(this.wirtBasis(), 'spuren.json'), 'utf8')); } catch { return; }
  if (!Array.isArray(daten)) return;
  for (const x of daten as Record<string, unknown>[]) {
    if (typeof x?.name !== 'string' || !SPUR_NAME.test(x.name) || this.spuren.has(x.name) || !Number.isFinite(x.anker) || !Number.isFinite(x.ende)) continue;
    const muster = (Array.isArray(x.muster) ? x.muster : []).filter((m: MusterPlan) => Number.isFinite(m?.ab_beat) && typeof m?.text === 'string' && (ALLE_STROEME as readonly number[]).includes(m?.strom));
    const lauf: SpurLauf = { quelle: x.quelle === 'cypher' ? 'cypher' : 'andreas', anker: Number(x.anker), ende: Number(x.ende), fahrten: Array.isArray(x.fahrten) ? x.fahrten as Fahrt[] : [], timer: [], offen: muster,
      gruppen: new Set((Array.isArray(x.gruppen) ? x.gruppen : []).filter((g: unknown) => g === 'bass' || g === 'melodie') as string[]),
      ids: Array.isArray(x.ids) ? x.ids.filter(Number.isFinite) : [], teile: Array.isArray(x.teile) ? x.teile : [] };
    const schleife = schleifeAusDatei(x.schleife);   // 1.12 S7: a loop resumes its watcher from the next unsent pass
    if (schleife) lauf.schleife = schleife;
    const bg = x.bogen as SpurLauf['bogen'] | undefined;
    if (bg && typeof bg.name === 'string' && Number.isFinite(bg.takte) && Array.isArray(bg.plan)) lauf.bogen = bg;
    this.spuren.set(x.name, lauf);
    if (lauf.offen.length) this.musterTimer(x.name, lauf);
    if (lauf.schleife) this.schleifenWaechter(x.name, lauf);
  }
  if (this.spuren.size) this.opt.log?.({ typ: 'spuren_geladen', anzahl: this.spuren.size });
}
// POST /spur {spur, ab?='takt'} (Studio S6): Anker = nächste Takt- bzw. Phrasen-Eins; Kanalzug-Fahrten als /k/teil mit
// Plan spur:<name> (ein Handgriff bricht sie im Kern ab, /spur/stopp über /k/abbruch). D8 gilt für Cyphers Spur ganz.
// intern.versatz (live scene restore only): phase offset per stream for the strom: moves of this track
export async function spurStart(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse, intern: { versatz?: Record<number, number>; bogen?: SpurLauf['bogen'] } = {}): Promise<void> {
  const ab = d.ab ?? 'takt';
  if (ab !== 'takt' && ab !== 'phrase') return this.json(a, 400, { fehler: 'ab', text: 'ab: takt or phrase' });
  // 1.1 anchor: anker_takt = an absolute bar instead of ab; probe = every check, nothing sent, nothing entered
  const ankerTakt = d.anker_takt, probe = d.probe === true;
  if (d.probe !== undefined && typeof d.probe !== 'boolean') return this.json(a, 400, { fehler: 'probe', text: 'probe: boolean' });
  if (ankerTakt !== undefined) {
    if (d.ab !== undefined) return this.json(a, 400, { fehler: 'ab_und_anker', text: 'ab and anker_takt exclude each other' });
    if (typeof ankerTakt !== 'number' || !Number.isInteger(ankerTakt) || ankerTakt < 1) return this.json(a, 400, { fehler: 'anker_takt', text: 'anker_takt: integer >= 1 (an absolute bar)' });
  }
  const r = pruefeSpur(d.spur, this.fahrbar);
  if ('fehler' in r) return this.json(a, 400, { fehler: 'spur', text: r.fehler });
  // D1 S2-Integration (Spec 6.22, 6.30): Spur-Regler ändern sich nur über das Projekt, auch eine Automationsspur fährt sie nicht
  const ueber = r.spur.fahrten.findIndex((f) => ueberProjekt(f.ziel) && !istStromZeile(this.proj.zugang.offen()?.projekt ?? null, f.ziel));
  if (ueber >= 0) {
    return this.json(a, 409, { fehler: 'ueber_projekt', ziel: r.spur.fahrten[ueber].ziel, index: ueber,
      text: `${ueberProjektText(r.spur.fahrten[ueber].ziel)}, not by an automation track` });
  }
  const aliasFehler = this.spurAliasFehler(r.spur.fahrten);
  if (aliasFehler) return this.json(a, 409, aliasFehler);
  this.spurenAufraeumen();
  const quelle = this.quelle(), name = r.spur.name;
  if (quelle === 'cypher' && this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
  if (this.spuren.has(name)) return this.json(a, 409, { fehler: 'laeuft', text: `track ${name} is running; stop it first` });
  await this.wirtFlugAbwarten(name);   // the previous run's late fahre/halte first, then this run's fahre
  if (this.spuren.has(name)) return this.json(a, 409, { fehler: 'laeuft', text: `track ${name} is running; stop it first` });
  const u = this.kern.uhr as unknown as { beat: number; bpm: number; mono_ns: number } | null;
  if (!u) return this.json(a, 409, { fehler: 'keine_uhr' });
  const fruehest = this.abVon('takt'), proTaktA = this.proTakt();
  let anker = this.abVon(ab);
  if (typeof ankerTakt === 'number') {
    anker = proTaktA * (ankerTakt - 1);
    if (anker < fruehest) return this.json(a, 409, { fehler: 'anker_vorbei', fruehester_takt: Math.floor(fruehest / proTaktA) + 1, text: 'the requested anchor bar is no longer ahead; use fruehester_takt or later' });
    if (anker - fruehest > proTaktA * MAX_TAKT) return this.json(a, 400, { fehler: 'anker_takt', text: `anker_takt: at most ${MAX_TAKT} bars ahead` });
  }
  // 1.1: a stream played by the multi-stream erzeuger needs its process, else the pattern would never sound
  for (const f of r.spur.fahrten) {
    const st = STROM_ZIEL.exec(f.ziel);
    if (st && istBkStrom(Number(st[1])) && !this.erzeugerLebt(Number(st[1]))) {
      return this.json(a, 409, { fehler: 'strom_ohne_erzeuger', strom: Number(st[1]), ziel: f.ziel, text: `no erzeuger process serves stream ${st[1]}; start djk-stroeme first` });
    }
  }
  const schleife = r.spur.schleife_takte !== undefined;   // 1.12 S7: pass 0 of a loop; its end is the start of pass 1
  const g = schleife ? planeDurchlauf(r.spur, anker, 0, 0, this.proTakt()) : plane(r.spur, anker, this.proTakt(), this.fahrbar);
  // task 7.5: the spur of an arc ends with the arc, also when the last layer has no bis_takt (warte bis: spur_ende)
  if (intern.bogen) g.ende_beat = Math.max(g.ende_beat, anker + proTaktA * intern.bogen.takte);
  if (quelle === 'cypher') {
    const rampe = r.spur.fahrten.findIndex((f) => typeof f.nach === 'number' && this.rampePflicht(f.ziel, f.nach, f.takte ?? 0, f.von));
    if (rampe >= 0) return this.json(a, 409, { fehler: 'nur_rampe', ziel: r.spur.fahrten[rampe].ziel, index: rampe, text: GRUND_TEXT.nur_rampe });
    // F4: AUTO aus auf einem Strom heißt, Andreas hält ihn; Cyphers Spur darf ihn nicht berühren (Kern, Wirt, Muster)
    for (const f of r.spur.fahrten) {
      const st = this.stromVonZielOffen(f.ziel);
      if (st !== null && !leseMusterStand(this.musterOrdner(st)).autonom) return this.json(a, 409, { fehler: 'auto_aus', strom: st, ziel: f.ziel, text: 'AUTO is off: Andreas holds this stream' });
    }
    // 1.12 S7: for a loop over two passes, so that the seam (end of pass k → start of pass k+1) is checked from the start
    const p = oeffnetKanal(this.stand.regler, schleife ? [...g.teile, ...planeDurchlauf(r.spur, g.ende_beat, 0, 0, this.proTakt()).teile] : g.teile);
    if (p) return this.json(a, 409, { fehler: 'kein_hoerschein', pfad: p, text: 'this track opens a closed channel; Cypher may not (Plan Hand D8)' });
  }
  if (probe) {
    return this.json(a, 200, { ok: true, probe: true, anker_beat: anker, anker_takt: Math.floor(anker / proTaktA) + 1, ende_beat: g.ende_beat,
      muster: g.muster.map((m) => ({ strom: m.strom, ab_takt_absolut: Math.floor(m.ab_beat / proTaktA) + 1 })) });
  }
  const offen = g.muster.map((m) => (intern.versatz?.[m.strom] ? { ...m, versatz: intern.versatz[m.strom] } : m));
  const lauf: SpurLauf = { quelle, anker, ende: g.ende_beat, fahrten: r.spur.fahrten, timer: [], offen, gruppen: new Set(), ids: [], teile: [] };
  if (intern.bogen) lauf.bogen = intern.bogen;
  if (schleife) {   // 1.12 S7: set before the track enters the table, so it never looks like a one-shot track (cleanup, GET /spur)
    lauf.schleife = { n: r.spur.schleife_takte as number, anker_naechster: g.ende_beat, durchlauf: 1, teilNr: g.teile.length, naechste: null,
      durchlaeufe: [{ k: 0, anfang: anker, ende: g.ende_beat, teile: g.teile.length, ...(this.proTakt() !== 4 ? { proTakt: this.proTakt() } : {}) }] };
  }
  this.spuren.set(name, lauf);
  this.spurenSichern();
  // Surge-Fahrten zuerst: scheitert ein Wirt, ist noch nichts beim Kern und die schon belegten Wirte halten an
  for (const w of g.wirt) {
    const befehl: Record<string, unknown> = { befehl: 'fahre', name: w.name, bis: w.bis, dauer: w.dauer_beats * 60 / u.bpm,
      ab: beatZuMono(u, w.ab_beat), spur: name, form: w.form, ...(w.von !== undefined ? { von: w.von } : {}) };
    // In-flight unit like sendeDurchlauf: a STOP during this await deleted the run before the group was recorded, so its halte missed
    // this wirt; the late fahre is held here, and a new run of the name waits for it (wirtFlugAbwarten)
    const antwort = await this.wirtFlug(name, async () => {
      const r = await wirtRuf(this.wirtSock(w.gruppe), befehl);
      if (this.spuren.get(name) !== lauf && r.ok) await wirtRuf(this.wirtSock(w.gruppe), { befehl: 'halte', spur: name });
      return r;
    });
    if (this.spuren.get(name) !== lauf) {   // stopped while waiting: no core part may follow the STOP's /k/abbruch
      for (const gr of lauf.gruppen) await wirtRuf(this.wirtSock(gr), { befehl: 'halte', spur: name });
      return this.json(a, 409, { fehler: 'gestoppt', name, text: `track ${name} was stopped while it started` });
    }
    if (!antwort.ok) {
      for (const gr of lauf.gruppen) await wirtRuf(this.wirtSock(gr), { befehl: 'halte', spur: name });
      this.spuren.delete(name);
      this.spurenSichern();
      return this.json(a, 409, { fehler: 'wirt', gruppe: w.gruppe, text: String(antwort.fehler ?? '') });
    }
    lauf.gruppen.add(w.gruppe);
    this.opt.log?.({ typ: 'spur_wirt', name, gruppe: w.gruppe, parameter: w.name, ab_beat: w.ab_beat, ab: befehl.ab });
    if (Number(antwort.ersetzt) > 0) this.opt.log?.({ typ: 'spur_wirt_ersetzt', name, gruppe: w.gruppe, parameter: w.name, ersetzt: Number(antwort.ersetzt) });   // F8: eine andere wartende Fahrt ging verloren
  }
  // Discrete Surge sets: one host `setze` per host and beat, same in-flight unit as fahre; the group is recorded, so spur_stopp and Stop Cypher halte it
  for (const z of g.setzen ?? []) {
    const befehl = { befehl: 'setze', werte: z.werte, ab: beatZuMono(u, z.ab_beat), spur: name };
    const antwort = await this.wirtFlug(name, async () => {
      const r = await wirtRuf(this.wirtSock(z.gruppe), befehl);
      if (this.spuren.get(name) !== lauf && r.ok) await wirtRuf(this.wirtSock(z.gruppe), { befehl: 'halte', spur: name });
      return r;
    });
    if (this.spuren.get(name) !== lauf) {
      for (const gr of lauf.gruppen) await wirtRuf(this.wirtSock(gr), { befehl: 'halte', spur: name });
      return this.json(a, 409, { fehler: 'gestoppt', name, text: `track ${name} was stopped while it started` });
    }
    if (!antwort.ok) {
      for (const gr of lauf.gruppen) await wirtRuf(this.wirtSock(gr), { befehl: 'halte', spur: name });
      this.spuren.delete(name);
      this.spurenSichern();
      return this.json(a, 409, { fehler: 'wirt', gruppe: z.gruppe, text: String(antwort.fehler ?? '') });
    }
    lauf.gruppen.add(z.gruppe);
    this.opt.log?.({ typ: 'spur_wirt_setze', name, gruppe: z.gruppe, parameter: Object.keys(z.werte), ab_beat: z.ab_beat, ab: befehl.ab });
  }
  for (const [i, t] of g.teile.entries()) {
    const kernPfad = this.kernPfadVon(t.pfad);
    if (kernPfad === null) { this.opt.log?.({ typ: 'spur_ziel_aufgeloest_nicht', name, pfad: t.pfad }); continue; }   // the strom track is gone since the start
    const felder = { id: Number(++this.id), quelle, plan: `spur:${name}`, teil: i, pfad: kernPfad, ab_beat: t.ab_beat,
      dauer_beats: t.dauer_beats, nach: t.nach, form: t.form, politik: t.politik, gruppe: '', hoerschein: '' };
    this.kern.sende('/k/teil', felder);
    this.gesendet++;
    lauf.ids.push(felder.id);
    lauf.teile.push({ id: felder.id, teil: i, pfad: t.pfad });
  }
  if (lauf.offen.length) this.musterTimer(name, lauf);
  if (lauf.schleife) this.schleifenWaechter(name, lauf);
  this.spurenSichern();
  this.opt.log?.({ typ: 'spur', name, quelle, anker, teile: g.teile.length, wirt: g.wirt.length, muster: g.muster.length });
  const quittung = lauf.ids.length ? await this.warteQuittung(lauf.ids[0], g.teile[0].ab_beat) : null;
  this.json(a, 200, { ok: true, name, anker_beat: anker, anker_takt: Math.floor(anker / this.proTakt()) + 1, ende_beat: g.ende_beat,
    teile: g.teile.length, wirt: g.wirt.length, muster: g.muster.length, quittung, abgelehnt: this.spurAbgelehnt(lauf) });
}
// Strand 11 slice 5 (5.2): POST /szene, live scenes (files in <project folder>/szenen/, not the launcher scenes of project.json `szenen`).
// aktion sichern | ersetzen | laden | liste | zeige | loeschen. laden saves _vor_laden first, loads differing graphs at once, then runs ONE
// internal track szene-<name> as Cypher from the next bar: strom:<n> moves (with versatz), control sets or ramps, the Surge patch as host setze.
// A part a Cypher rule refuses goes into ausgelassen [{ziel, grund}]; nothing else stops.
export function innenAntwort(this: Oberflaeche): { code: number; text: string; writeHead(c: number): unknown; end(t: string): void; j(): Record<string, unknown> } {
  return { code: 0, text: '', writeHead(c: number) { this.code = c; return this; }, end(t: string) { this.text = t; },
    j() { try { return JSON.parse(this.text) as Record<string, unknown>; } catch { return {}; } } };
}
// B1: a POST route with reading aktionen (/szene, /klang) is classed by the x-djk-aktion header; a body aktion that differs from it is refused,
// so a call classed as reading (liste, zeige) cannot carry a writing aktion in its body.
export function aktionPasst(this: Oberflaeche, q: http.IncomingMessage, d: Record<string, unknown>, a: http.ServerResponse): boolean {
  const kopf = kopfWert(q.headers['x-djk-aktion']);
  if (kopf === null || d.aktion === kopf) return true;
  this.json(a, 403, { fehler: 'aktion_passt_nicht', kopf, aktion: typeof d.aktion === 'string' ? d.aktion : null, text: GRUND_TEXT.aktion_passt_nicht });
  return false;
}
// POST /spur/stopp {name} (Studio S6): wartende und laufende Fahrten der Spur enden am Ist-Wert (/k/abbruch, Wirt halte)
export async function spurStopp(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const name = d.name;
  if (typeof name !== 'string' || !SPUR_NAME.test(name)) return this.json(a, 400, { fehler: 'name' });
  this.spurenAufraeumen();
  const lauf = this.spuren.get(name);
  if (!lauf) return this.json(a, 404, { fehler: 'keine_spur', name });
  if (this.quelle() === 'cypher' && lauf.quelle !== 'cypher') return this.json(a, 403, { fehler: 'nur_andreas', text: 'this track is Andreas\'s' });
  const { felder, wirt } = await this.spurAbbrechen(name, lauf, this.quelle());
  this.json(a, 200, { ok: true, name, felder, wirt });
}
// POST /spur/aendern {name, spur} (1.12 S7, S8 plan "Festlegungen"): the new line of a running loop, checked like POST /spur (schleife_takte
// required, it may change), waits as naechste and applies from the next pass not yet sent; a later change replaces a waiting one. Only the
// owner changes a loop (MAJOR 3: nur_andreas / nur_cypher); for Cypher Stop Cypher, AUTO and D8 hold as at the start. Answer
// {ok, name, ab_beat, ab_takt, uebernaechster}: the start of the pass it applies from; uebernaechster = the next pass was already being
// sent, so it applies from the one after.
export async function spurAendern(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const name = d.name, quelle = this.quelle();
  if (typeof name !== 'string' || !SPUR_NAME.test(name)) return this.json(a, 400, { fehler: 'name' });
  if (quelle === 'cypher' && this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
  this.spurenAufraeumen();
  const lauf = this.spuren.get(name);
  if (!lauf) return this.json(a, 404, { fehler: 'keine_spur', name });
  if (!lauf.schleife) return this.json(a, 409, { fehler: 'keine_schleife', name, text: 'only a running loop can be changed; stop and start it' });
  if (lauf.quelle !== quelle) {
    return lauf.quelle === 'cypher' ? this.json(a, 403, { fehler: 'nur_cypher', text: 'this loop is Cypher\'s' })
      : this.json(a, 403, { fehler: 'nur_andreas', text: 'this loop is Andreas\'s' });
  }
  const r = pruefeSpur(d.spur, this.fahrbar);
  if ('fehler' in r) return this.json(a, 400, { fehler: 'spur', text: r.fehler });
  if (r.spur.name !== name) return this.json(a, 400, { fehler: 'spur', text: `spur.name must be ${name}` });
  if (r.spur.schleife_takte === undefined) return this.json(a, 400, { fehler: 'spur', text: 'schleife_takte: a loop stays a loop (1..64)' });
  const ueber = r.spur.fahrten.findIndex((f) => ueberProjekt(f.ziel) && !istStromZeile(this.proj.zugang.offen()?.projekt ?? null, f.ziel));
  if (ueber >= 0) {
    return this.json(a, 409, { fehler: 'ueber_projekt', ziel: r.spur.fahrten[ueber].ziel, index: ueber,
      text: `${ueberProjektText(r.spur.fahrten[ueber].ziel)}, not by an automation track` });
  }
  const aliasFehler = this.spurAliasFehler(r.spur.fahrten);
  if (aliasFehler) return this.json(a, 409, aliasFehler);
  const s = lauf.schleife, uebernaechster = lauf.planend !== undefined;
  const ab = uebernaechster ? lauf.planend as number : s.anker_naechster;
  if (quelle === 'cypher') {
    for (const f of r.spur.fahrten) {
      const st = this.stromVonZielOffen(f.ziel);
      if (st !== null && !leseMusterStand(this.musterOrdner(st)).autonom) return this.json(a, 409, { fehler: 'auto_aus', strom: st, ziel: f.ziel, text: 'AUTO is off: Andreas holds this stream' });
    }
    const g = planeDurchlauf(r.spur, ab, 0, 0, this.proTakt());
    const p = oeffnetKanal(this.stand.regler, [...g.teile, ...planeDurchlauf(r.spur, g.ende_beat, 0, 0, this.proTakt()).teile]);
    if (p) return this.json(a, 409, { fehler: 'kein_hoerschein', pfad: p, text: 'this change opens a closed channel; Cypher may not (Plan Hand D8)' });
  }
  s.naechste = r.spur;
  this.spurenSichern();
  this.opt.log?.({ typ: 'spur_aendern', name, quelle, ab_beat: ab, uebernaechster });
  this.json(a, 200, { ok: true, name, ab_beat: ab, ab_takt: Math.floor(ab / this.proTakt()) + 1, uebernaechster });
}
// F5: ein Timer je Spur mit Muster-Fahrten; er schreibt, sobald der Kern-Beat ab_beat − Vorlauf erreicht hat
export function musterTimer(this: Oberflaeche, name: string, lauf: SpurLauf): void {
  const zeit = setInterval(() => {
    this.spurenAufraeumen();
    if (this.spuren.get(name) !== lauf) { clearInterval(zeit); return; }
    const beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat;
    if (beat === undefined) return;
    const faellig = faelligeMuster(lauf.offen, beat);
    if (!faellig.length) return;
    lauf.offen = lauf.offen.filter((m) => !faellig.includes(m));
    this.spurenSichern();
    if (!lauf.offen.length) clearInterval(zeit);
    for (const m of faellig) this.spurMuster(name, lauf, m).catch((e) => this.opt.log?.({ typ: 'spur_muster_fehler', name, text: e instanceof Error ? e.message : String(e) }));
  }, 50);
  zeit.unref();
  lauf.timer.push(zeit);
}
// Studio S6: ein Muster der Spur über denselben Weg wie das Strudel-Feld (djk-muster, Musterkette, AUTO-Riegel für cypher)
export async function spurMuster(this: Oberflaeche, name: string, lauf: SpurLauf, m: MusterPlan): Promise<void> {
  if (this.spuren.get(name) !== lauf) return;
  const beatVorher = this.kern.uhr?.beat ?? 0;
  const fang = { code: 0, text: '', writeHead(c: number) { this.code = c; return this; }, end(t: string) { this.text = t; } };
  await this.qs.run(lauf.quelle, () => this.strudel({ text: m.text, strom: m.strom, ...(m.bezeichnung !== undefined ? { bezeichnung: m.bezeichnung } : {}) }, fang as unknown as http.ServerResponse,
    { abBeat: m.ab_beat, ...(Number.isInteger(m.versatz) ? { versatz: m.versatz } : {}) }));
  this.opt.log?.({ typ: 'spur_muster', name, strom: m.strom, ziel_beat: m.ab_beat, beat_vorher: beatVorher,
    beat_nachher: this.kern.uhr?.beat ?? 0, code: fang.code, antwort: fang.text });
}
// Eine Spur beenden: aus der Tabelle, Timer weg, /k/abbruch mit ihrem Plan, Wirt halte für ihre Gruppen
export async function spurAbbrechen(this: Oberflaeche, name: string, lauf: SpurLauf, quelle: string): Promise<{ felder: Felder; wirt: Record<string, unknown> }> {
  this.spuren.delete(name);
  this.spurenSichern();
  for (const t of lauf.timer) clearTimeout(t);
  const felder = { id: Number(++this.id), quelle, plan: `spur:${name}`, teile: '*' };
  this.kern.sende('/k/abbruch', felder);
  this.gesendet++;
  const wirt: Record<string, unknown> = {};
  for (const gr of lauf.gruppen) wirt[gr] = await wirtRuf(this.wirtSock(gr), { befehl: 'halte', spur: name });
  this.opt.log?.({ typ: 'spur_stopp', name });
  return { felder, wirt };
}
// Alle Spuren mit Quelle cypher beenden (Cyphers /abbruch und Stop Cypher); Andreas' Spuren bleiben
export async function cypherSpurenAbbrechen(this: Oberflaeche): Promise<void> {
  this.spurenAufraeumen();
  await Promise.all([...this.spuren].filter(([, l]) => l.quelle === 'cypher').map(([name, l]) => this.spurAbbrechen(name, l, 'cypher')));
  // Task 3: Cyphers Klang-Fahrten (POST /klang fahre) tragen die Spur klang-<gruppe> und stehen in keiner Tabelle; ein fehlender Wirt ist kein Fehler
  await Promise.all(KLANG_GRUPPEN.map((g) => wirtRuf(this.wirtSock(g), { befehl: 'halte', spur: `klang-${g}` }, 1000)));
}
// Spuren, deren Ende + 1 Beat im Kern-Beat vorbei ist, fallen aus der Tabelle (Kern-Beat statt Wanduhr: ein
// Tempowechsel darf eine noch laufende Spur nicht verwaisen lassen)
export function spurenAufraeumen(this: Oberflaeche): void {
  const beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat;
  if (beat === undefined) return;
  let weg = false;
  for (const [name, l] of this.spuren) if (!l.schleife && l.ende + 1 < beat) { for (const t of l.timer) clearTimeout(t); this.spuren.delete(name); weg = true; }
  if (weg) this.spurenSichern();
}
export function spurListe(this: Oberflaeche): Record<string, unknown>[] {
  this.spurenAufraeumen();
  return [...this.spuren].map(([name, l]) => ({ name, quelle: l.quelle, anker_beat: l.anker, ende_beat: l.ende, fahrten: l.fahrten,
    abgelehnt: this.spurAbgelehnt(l), ...(l.schleife ? this.schleifenInfo(l.schleife) : {}), ...(l.bogen ? { bogen: this.bogenInfo(l) } : {}) }));
}
// Teile der Spur, deren letzte Kern-Quittung ein Fehlstatus ist (GET /spur und Antwort von POST /spur)
export function spurAbgelehnt(this: Oberflaeche, l: SpurLauf): { teil: number; pfad: string; status: number; grund: string }[] {
  return l.teile.flatMap((t) => {
    const y = this.quittungen.get(t.id)?.at(-1);
    return y && FEHL_STATUS.has(Number(y.status)) ? [{ teil: t.teil, pfad: t.pfad, status: Number(y.status), grund: String(y.grund ?? '') }] : [];
  });
}
// Task 7.5: where the arc stands and what changes next, from the core beat (the page has no arc logic). takt_im_bogen 0 = not started yet.
export function bogenInfo(this: Oberflaeche, l: SpurLauf): Record<string, unknown> {
  const b = l.bogen as NonNullable<SpurLauf['bogen']>;
  const beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat ?? null;
  const im = beat === null ? 0 : Math.max(0, Math.min(b.takte, Math.floor((beat - l.anker) / this.proTakt()) + 1));
  const naechst = b.plan.filter((z) => z.takt > im).reduce<number | null>((m, z) => (m === null || z.takt < m ? z.takt : m), null);
  const naechste = naechst === null ? null : { in_takten: naechst - im, text: b.plan.filter((z) => z.takt === naechst).map((z) => z.text).join('; ') };
  return { name: b.name, takte: b.takte, takt_im_bogen: im, naechste };
}
// Task 7.5: POST /bogen. The flat body is the arc (name, takte, schichten, bruch?, fahrten?) plus ab, anker_takt, probe. It compiles to one spur body and
// goes through spurStart, so every spur rule holds. Answer: the spur answer plus kompiliert (the spur body) and plan.
export async function bogenStart(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  if (d.schleife !== undefined || d.schleife_takte !== undefined) return this.json(a, 400, { fehler: 'bogen_schleife', text: GRUND_TEXT.bogen_schleife });
  const { ab, anker_takt, probe, ...bogen } = d;
  const k = kompiliereBogen(bogen, this.fahrbar);
  if ('fehler' in k) return this.json(a, 400, { fehler: 'bogen', text: k.text });
  const fang = this.innenAntwort();
  const rein: Record<string, unknown> = { spur: k.spur };
  if (ab !== undefined) rein.ab = ab;
  if (anker_takt !== undefined) rein.anker_takt = anker_takt;
  if (probe !== undefined) rein.probe = probe;
  await this.spurStart(rein, fang as unknown as http.ServerResponse, { bogen: { name: k.spur.name, takte: (bogen as { takte: number }).takte, plan: k.plan } });
  const j = fang.j();
  this.json(a, fang.code, fang.code === 200 ? { ...j, kompiliert: k.spur, plan: k.plan } : j);
}
