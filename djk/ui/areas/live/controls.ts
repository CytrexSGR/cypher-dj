// POST /regler and the sequencer helpers of the page server: acknowledgements, bar maths, alias inserts (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import http from 'node:http';
import path from 'node:path';
import { type Bereich } from '../../http/router.ts';
import { alsAntwort } from '../proj/area.ts';
import { stromSpur } from '../../project/model.ts';
import { type Takte } from './harmonie.ts';
import type { Felder } from '../../../conductor/src/addresses.ts';
import { GRUND_TEXT } from '../../http/reasons.ts';
import { vorlaufBeats } from '../../tempo_ramp.ts';
import { takteProLive } from '../../project/taktart_live.ts';
import { veroeffentlicheTaktart } from '../proj/taktart_output.ts';
import { abBeat } from '../../deck_operation.ts';
import { AB, abRaster, PFAD, oeffnet, kanalOffen, containerFrei, containerVonPfad, ersterFreierBeat } from '../../hand_operation.ts';
import { loeseAlias, istStromZeile, type AliasErgebnis } from '../../stream_alias.ts';
import { type Fahrt } from '../../track.ts';
import { type Spur } from '../../track.ts';
import { seqGruppe } from '../../project/seq.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { ALLE_STROEME } from '../../../contract/streams.ts';
import { PULT_ALIAS_STROEME, pultContainerPfad } from '../../../contract/pult.ts';
import { findeGraph } from '../../graphs.ts';
import { ueberProjekt, ueberProjektText, OFFENE_DECKS } from '../../server_kopf.ts';
import { Oberflaeche } from '../../server.ts';

export function merkeQuittung(this: Oberflaeche, f: Felder): void {
  if (f.quelle === 'cypher') { this.cypherQuittungen.push(f); if (this.cypherQuittungen.length > 20) this.cypherQuittungen.shift(); }
  const id = Number(f.id), l = this.quittungen.get(id) ?? [];
  if ([4, 6, 7, 8].includes(Number(f.status))) {   // abgelehnt, abgebrochen: das Ende dieser Fahrt gibt es nicht
    for (const [pfad, teile] of this.fahrtEnde) {
      const rest = teile.filter((e) => e.id !== id);
      if (rest.length) this.fahrtEnde.set(pfad, rest); else this.fahrtEnde.delete(pfad);
    }
  }
  l.push(f); this.quittungen.set(id, l);
  if (this.quittungen.size > 200) this.quittungen.delete(this.quittungen.keys().next().value as number);
}
// Erste Quittung mit Status ≠ 1 (angenommen). Review Hand M2: Ablehnungen am Start (ki_stopp, regler_beim_menschen …)
// kommen erst zum ab_beat; darum bis ab_beat + ¼ Beat warten (höchstens 4 s), dann die letzte; null, wenn keine kam.
// bisEnde: nur der Endstatus zählt (nicht 1 angenommen, nicht 2 gestartet): ein Teil belegt seinen Stellwerk-Platz bis dahin (1.10 Slice 3, P11)
// maxMs: longer wait without abBeat for slow loads (S12: sampler graphs)
// ersteGenuegt (loop deck, M4 fix): the first receipt of any status ends the wait (status 1, accepted and pending, is an answer); maxMs is then only
// the upper bound for no receipt at all
export async function warteQuittung(this: Oberflaeche, id: number, abBeat?: number, bisEnde = false, maxMs?: number, ersteGenuegt = false): Promise<{ status: number; grund: string } | null> {
  const t0 = Date.now();
  for (;;) {
    const l = this.quittungen.get(id);
    const x = l?.find((q) => (ersteGenuegt ? true : bisEnde ? Number(q.status) > 2 : Number(q.status) !== 1));
    if (x) return { status: Number(x.status), grund: String(x.grund ?? '') };
    const beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat ?? 0;
    const faellig = abBeat === undefined ? Date.now() - t0 >= (maxMs ?? 400) : beat >= abBeat + 0.25;   // S12: maxMs for slow loads (sampler graphs)
    if (faellig || Date.now() - t0 >= Math.max(4000, maxMs ?? 0)) {
      const y = l?.at(-1);
      return y ? { status: Number(y.status), grund: String(y.grund ?? '') } : null;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}
// warteQuittung up to ab_beat and past it: the core checks "loop stays in the material" and the AUTO stop only when it executes at ab_beat,
// which can lie more than 4 s ahead on a coarse grid (16 beats = 7.5 s at 128 BPM); the plain 4 s cap would return the 'accepted' receipt
export function warteBisAb(this: Oberflaeche, id: number, ab: number): Promise<{ status: number; grund: string } | null> {
  const u = this.kern.uhr as unknown as { beat: number; bpm: number } | null;
  // the cap is only the end of the wait for a core that never answers (the wait itself ends at ab_beat + 1/4 beat): computed at the slowest tempo a ramp can
  // reach (60 BPM), so a tempo ramp downwards after the send cannot make the 'accepted' receipt come too early
  const ms = u ? Math.max(0, (ab - u.beat) * 60000 / Math.min(u.bpm > 0 ? u.bpm : 60, 60)) : 0;
  return this.warteQuittung(id, ab, false, ms + 1000);
}
// Beats per bar of the open project (studio-taktart): its meter n/4, 4 with no project open or an invalid meter
export function proTakt(this: Oberflaeche): number { return takteProLive(this.proj.zugang.offen()?.projekt?.taktart); }
// Publishes the meter: file `taktart` in every stream folder for the generator, SSE `taktart` for the page. The first call always runs (it
// removes a stale file of a crash); later calls only when the value changed, so a 4/4 session writes and emits nothing.
export function meldeTaktart(this: Oberflaeche): void {
  const n = this.proTakt();
  if (this.taktartVeroeffentlicht && n === this.letzteTaktart) return;
  this.taktartVeroeffentlicht = true;
  veroeffentlicheTaktart(ALLE_STROEME.map((st) => this.musterOrdner(st)), n, undefined, (ordner, e) => this.opt.log?.({ typ: 'taktart_datei_fehler', ordner, text: e.message }));
  if (n !== this.letzteTaktart) { this.letzteTaktart = n; this.verteile({ a: 'taktart', f: { proTakt: n } }); }
}
export function harmonieTakte(this: Oberflaeche): Takte {
  const pt = this.proTakt(), u = this.kern.uhr as unknown as { beat: number } | null;
  return { takt: Math.floor(this.abVon('takt') / pt) + 1, phrase: Math.floor(this.abVon('phrase') / pt) + 1, jetzt: Math.floor((u?.beat ?? 0) / pt) + 1 };
}
// Ziel-Beat der Master-Uhr zur Zeitangabe ab (D2): jetzt + Vorlauf, dann aufs Raster 1/4/16
export function abVon(this: Oberflaeche, ab: string): number {
  const u = this.kern.uhr as unknown as { beat: number; bpm: number } | null;
  const beat = u?.beat ?? 0, bpm = u?.bpm ?? 128;
  return abBeat(beat, vorlaufBeats(bpm), abRaster(ab, this.proTakt()) as number);                  // ein Vorlauf (tempo_ramp.ts), derselbe wie im Bereich proj
}
// POST /regler {pfad, nach, takte?=0, ab?='takt', form?='s'} → /k/teil (D3); D8 Öffnen-Sperre für cypher
// Container core M8: `erz/<n>/...` is alias vocabulary: stream_alias.ts resolves it onto the strom track rows (the /k/teil carries the resolved row),
// onto a project insert (komp, bk insert: a project edit, no ramp) or refuses it. The hearing guard runs on the four container strips only,
// by the type of the place that feeds them (containerFrei, table D3); strom rows are never gated.
// Strand 11 (4.3) ramp rule for Cypher: a raise of master/pegel, a bus fader or a loops/stems container fader/trim by more than 6 dB must be a ramp of
// at least one bar. `von` = the start of a track move; else the level the page last saw (unknown level: no check, the core's own limits stay).
export function rampePflicht(this: Oberflaeche, pfad: string, nach: number, takte: number, von?: number): boolean {
  if (takte >= 1) return false;
  const bus = /^bus\/\d+\/fader$/.test(pfad);
  let streifen = false;
  if (!bus && pfad !== 'master/pegel') {
    const platz = /\/(fader|trim)$/.test(pfad) ? containerVonPfad(pfad) : null;
    const projekt = this.proj.zugang.offen()?.projekt ?? null;
    const typ = platz !== null && projekt?.live ? projekt.plaetze?.[platz - 1]?.typ : undefined;
    streifen = typ === 'loops' || typ === 'stems';
  }
  if (!bus && !streifen && pfad !== 'master/pegel') return false;
  const jetzt = von ?? this.stand.regler[pfad];
  // unknown level (right after a page restart): treat it as quiet, so a set above -20 dB still needs a ramp
  return typeof jetzt === 'number' ? nach - jetzt > 6 : nach > -20;
}
export async function regler(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const pfad = d.pfad, nach = d.nach, takte = d.takte ?? 0, ab = d.ab ?? 'takt', form = d.form ?? 's';
  if (typeof pfad !== 'string' || !PFAD.test(pfad)) return this.json(a, 400, { fehler: 'pfad' });
  const projekt = this.proj.zugang.offen()?.projekt ?? null;
  // D1 S2-Integration (Spec 6.22): Spur-Regler ändern sich nur über das Projekt (/proj/aendern, spur_aendern) und über den Rückweg /e/regler
  // mit Halter mensch; PFAD bleibt Vokabular (Vertragstest), aber hier kommt nichts durch, sonst fuhre Cypher am Projekt vorbei.
  // The rows of a strom track are the one exception (C1 carve-out): they take direct writes and ramps, the project follows (sitzung.rueckweg).
  if (ueberProjekt(pfad) && !istStromZeile(projekt, pfad)) return this.json(a, 409, { fehler: 'ueber_projekt', text: ueberProjektText(pfad) });
  if (typeof nach !== 'number' || !Number.isFinite(nach)) return this.json(a, 400, { fehler: 'nach' });
  if (typeof takte !== 'number' || !(takte >= 0 && takte <= 64)) return this.json(a, 400, { fehler: 'takte' });
  if (typeof ab !== 'string' || !(ab in AB)) return this.json(a, 400, { fehler: 'ab' });
  if (form !== 's' && form !== 'linear') return this.json(a, 400, { fehler: 'form' });
  if (this.quelle() === 'cypher') {
    const st = this.stromVonZielOffen(pfad);   // the alias form first: erz/<n>/... still means stream n; a row spur/<nr>/... of a strom track too
    if (st !== null && !leseMusterStand(this.musterOrdner(st)).autonom) return this.json(a, 409, { fehler: 'auto_aus', strom: st, text: 'AUTO is off: Andreas holds this stream' });
  }
  if (this.quelle() === 'cypher' && this.rampePflicht(pfad, nach, takte)) return this.json(a, 409, { fehler: 'nur_rampe', pfad, text: GRUND_TEXT.nur_rampe });
  let alias = loeseAlias(projekt, pfad, (k) => this.graphArt(k));
  const aliasStrom = Number(/^erz\/(\d+)\//.exec(pfad)?.[1]);
  if (alias.art === 'fehler' && alias.code === 'keine_strom_spur' && (PULT_ALIAS_STROEME as readonly number[]).includes(aliasStrom)) {
    // R9: the module is placed but stream n has no track yet: the alias creates it (the way POST /strudel does), then writes
    try { await this.sorgeFuerStromSpur(aliasStrom, this.quelle()); } catch (e) { const r = alsAntwort(e, this.bereichKontext()); return this.json(a, r.code, r.j); }
    alias = loeseAlias(this.proj.zugang.offen()?.projekt ?? null, pfad, (k) => this.graphArt(k));
  }
  if (alias.art === 'fehler') {
    const strom = aliasStrom;
    return this.json(a, 409, { fehler: alias.code, text: alias.text, ...(alias.code === 'kein_strudel_modul' ? { strom } : {}) });
  }
  if (alias.art === 'insert') return await this.aliasInsert(alias, pfad, nach, takte, a);
  const kernPfad = alias.art === 'zeile' ? alias.pfad : pfad;
  const kernWert = nach;
  let hoerscheinId = '';
  const platz = this.quelle() === 'cypher' ? containerVonPfad(pfad) : null;
  if (platz !== null && oeffnet(this.stand.regler, pfad, kernWert)) {
    const typ = projekt?.live ? projekt.plaetze?.[platz - 1]?.typ : undefined;
    const riegel = containerFrei(typ, this.deckStand(platz) !== null);
    if (riegel === 'frei' && typ === 'seq') this.opt.log?.({ typ: 'seq_frei', pfad });
    if (riegel !== 'frei') {
      // Ohr T10: a track container needs a valid hearing check of the player with its number (key deck/<N>, §4.5)
      const kanal = `deck/${platz}`;
      const st = this.deckStand(platz);
      const inhalt = st ? `${st.f.material_id}/${Math.round(st.f.basis_bpm * 1000)}_r${st.f.fassung}` : '';
      const beat = this.kern.uhr?.beat ?? 0;
      const schein = this.hoerscheinstelle.gueltig(kanal, inhalt, beat);
      if (!schein) {
        const letzterSchein = this.hoerscheinstelle.letzter(platz);
        // Plan seq-fader-frei D6 (2): a SEQ deck place that still holds a stopped track: eject it, the next call then opens (the first one still fails)
        // seq_geleert only when the core ACCEPTED the unload (receipt 1..3); a refusal (deck_hoerbar, nicht_geladen) or no receipt reports nothing, and the guard is lifted so a retry sends again
        let geleert = typ === 'seq' && /\/(fader|trim)$/.test(pfad) && this.seqDeckAufraeumen(platz, this.quelle(), true);
        if (geleert) {
          const eintrag = this.seqEntladen.get(platz);
          const q = eintrag ? await this.warteQuittung(eintrag.id) : null;
          if (!q || ![1, 2, 3].includes(q.status)) { this.seqEntladen.delete(platz); geleert = false; }
        }
        return this.json(a, 409, { fehler: 'kein_hoerschein', text: 'channel is closed; opening needs a valid hearing check (Ohr)',
          urteil: letzterSchein?.urteil ?? null, gruende: letzterSchein?.gruende ?? [], ...(geleert ? { seq_geleert: true } : {}) });
      }
      hoerscheinId = schein.hs_id;
    }
  }
  const proTakt = this.proTakt();   // read once per request
  let abBeat = this.abVon(ab), verschobenAuf: number | undefined;
  const id = Number(++this.id);
  if (this.quelle() === 'cypher') {
    const beat = this.kern.uhr?.beat ?? 0;
    const offen = (this.fahrtEnde.get(pfad) ?? []).filter((e) => e.ab + e.dauer >= beat);   // Abgelaufenes räumt sich hier ab (keyed by the path as asked: the alias for erz/<n>)
    const frei = ersterFreierBeat(offen, abBeat, takte * proTakt);
    if (frei !== abBeat) { abBeat = frei; verschobenAuf = frei; }
    offen.push({ id, ab: abBeat, dauer: takte * proTakt });
    this.fahrtEnde.set(pfad, offen);
  }
  // Keylock 3b (NITPICK): der Knopf mit Politik 1 (zu spät -> sofort ausgeführt, Quittung 5 statt 4 zu_spaet)
  const felder = { id, quelle: this.quelle(), plan: this.planVon(), teil: 0, pfad: kernPfad, ab_beat: abBeat,
    dauer_beats: takte * proTakt, nach: kernWert, form: form === 's' ? 1 : 0, politik: pfad === 'keylock' || pfad === 'color/art' ? 1 : 0, gruppe: '', hoerschein: hoerscheinId };
  this.kern.sende('/k/teil', felder);
  this.gesendet++;
  this.json(a, 200, { ok: true, felder, ...(verschobenAuf !== undefined ? { verschoben_auf: verschobenAuf } : {}),
    quittung: await this.warteQuittung(felder.id, verschobenAuf !== undefined ? undefined : felder.ab_beat) });   // verschoben: nur das kurze Fenster (Sofort-Ablehnungen des Kerns), nicht bis zum Startbeat
}
// erz/<n>/komp/* and the knobs of a bk effect graph live in a project insert of the strom track: the value goes through the project as the caller's
// source (undo, save); a ramp has no row to ride on, so takte must be 0 (the insert rows were `ueber_projekt` for ramps already).
export async function aliasInsert(this: Oberflaeche, al: Extract<AliasErgebnis, { art: 'insert' }>, pfad: string, nach: number, takte: unknown, a: http.ServerResponse): Promise<void> {
  if (takte !== 0) return this.json(a, 409, { fehler: 'rampe_ueber_projekt', text: `${pfad} is a project insert value: it is set, not ramped (takte 0)` });
  const o = this.proj.zugang.offen();
  const ins = o?.projekt.spuren.find((s) => s.id === al.spur_id)?.inserts?.find((i) => i.art === al.insert);
  if (!o || !ins) return this.json(a, 409, { fehler: al.insert === 'komp' ? 'keine_komp_stufe' : 'kein_graph', text: 'the insert is gone' });
  const befehl = al.param === 'an' ? { befehl: 'insert_an', insert_id: ins.id, an: nach >= 0.5 }
    : { befehl: 'insert_param_setzen', insert_id: ins.id, param: al.param, wert: nach };
  const r = await this.proj.sitzung.aendern({ rev: o.projekt.rev, label: `Strom ${al.strom} ${pfad.split('/').slice(2).join('/')}`, befehle: [befehl] }, this.quelle() as 'andreas' | 'cypher');
  if (r.code !== 200) return this.json(a, r.code, r.j);
  this.json(a, 200, { ok: true, insert_id: ins.id, param: al.param, wert: nach });
}
// The kind of the graph on a channel for the alias resolver: the loaded graph (instrument or effect), or an effect graph that sits as a bk insert on the strom track
export function graphArt(this: Oberflaeche, kanal: string): 'instrument' | 'effekt' | null {
  const name = this.stand.graphen_geladen[kanal] ?? '';
  if (name !== '') return findeGraph(name)?.art === 'instrument' ? 'instrument' : 'effekt';
  const n = /^erz\/(\d+)$/.exec(kanal)?.[1];
  const o = this.proj.zugang.offen();
  const s = n && o ? stromSpur(o.projekt, Number(n)) : undefined;
  return s?.inserts?.some((i) => i.art === 'bk') ? 'effekt' : null;
}
// The row the core knows for an automation target: the path itself, or the strom row of an erz/<n> alias. null: no plain row (no strom track, insert).
export function kernPfadVon(this: Oberflaeche, pfad: string): string | null {
  const al = loeseAlias(this.proj.zugang.offen()?.projekt ?? null, pfad, (k) => this.graphArt(k));
  if (al.art === 'keiner') return pfad;
  return al.art === 'zeile' ? al.pfad : null;
}
// POST /spur targets: an erz/<n> alias must resolve onto a plain strom row now (checked at the start; resolved again where the part is sent)
export function spurAliasFehler(this: Oberflaeche, fahrten: { ziel: string }[]): Record<string, unknown> | null {
  for (const [index, f] of fahrten.entries()) {
    if (!/^erz\//.test(f.ziel)) continue;
    const al = loeseAlias(this.proj.zugang.offen()?.projekt ?? null, f.ziel, (k) => this.graphArt(k));
    if (al.art === 'fehler') return { fehler: al.code, ziel: f.ziel, index, text: al.text };
    if (al.art === 'insert') return { fehler: 'kein_alias_ziel', ziel: f.ziel, index, text: 'an automation track moves plain strom rows only (not an insert value)' };
  }
  return null;
}
// Plan seq-fader-frei: the places of the open LIVE project that carry a SEQ deck, and the places with a track on the deck player
// (same expressions as /hoeren)
export function seqPlaetzeOffen(this: Oberflaeche): { seq: Set<number>; geladen: Set<number> } {
  const op = this.proj.zugang.offen();
  const seq = new Set<number>(op?.projekt.live ? OFFENE_DECKS.filter((n) => seqGruppe(op.projekt, n) !== undefined) : []);
  const geladen = new Set<number>(OFFENE_DECKS.filter((n) => this.deckStand(n) !== null));
  return { seq, geladen };
}
export function merkeNachgeladen(this: Oberflaeche, z: Record<string, unknown>): void {
  const n = Number(z.deck), vor = this.stand.decks[String(n)] as Record<string, unknown> | undefined;
  if (!(Number(z.status) >= 1)) this.seqNachgeladen.delete(n);
  else if (vor !== undefined && (!(Number(vor.status) >= 1) || Oberflaeche.deckSchluessel(vor) !== Oberflaeche.deckSchluessel(z))) this.seqNachgeladen.add(n);
}
export function startSteht(this: Oberflaeche, n: number): boolean {
  const ab = this.startGeplant.get(n);
  if (ab === undefined) return false;
  if ((this.kern.uhr?.beat ?? 0) <= ab + 1) return true;
  this.startGeplant.delete(n);
  return false;
}
export function seqDeckAufraeumen(this: Oberflaeche, n: number, quelle: string, spaet: boolean): boolean {
  if (!this.seqPlaetzeOffen().seq.has(n)) return false;
  if ((spaet && this.seqNachgeladen.has(n)) || this.startSteht(n)) return false;
  const st = this.deckStand(n);
  if (st === null || Number(st.z.status) >= 2 || kanalOffen(this.stand.regler, pultContainerPfad[n - 1])) return false;
  const schluessel = `${Oberflaeche.deckSchluessel(st.z)}|${Number(st.z.status)}`;
  const vorher = this.seqEntladen.get(n);
  if (vorher && vorher.schluessel === schluessel && Date.now() - vorher.t < 5000) return false;
  let id = 0;
  try {
    id = Number(++this.id);
    this.kern.sende('/k/deck/entladen', { id, quelle, deck: n });
  } catch (e) {
    this.opt.log?.({ typ: 'seq_aufraeumen_fehler', deck: n, text: (e as Error).message });
    return false;   // a failed send is no error of the SEQ write or of the fader call
  }
  this.gesendet++;
  this.seqEntladen.set(n, { schluessel, t: Date.now(), id });
  this.opt.log?.({ typ: 'seq_aufgeraeumt', deck: n });
  return true;
}
// Plan seq-fader-frei D4: a SEQ deck sits on place n and a part of Cypher on deck/n/fader or deck/n/trim is planned or running
// (fahrtEnde holds Cypher's parts only)
export function seqRampeLaeuft(this: Oberflaeche, n: number): boolean {
  if (!this.seqPlaetzeOffen().seq.has(n)) return false;
  const beat = this.kern.uhr?.beat ?? 0;
  return [`deck/${n}/fader`, `deck/${n}/trim`].some((pfad) => (this.fahrtEnde.get(pfad) ?? []).some((e) => e.ab + e.dauer >= beat));
}
