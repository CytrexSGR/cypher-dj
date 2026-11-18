// Controller presets and follow: bereich controller. The page tells the server which synth is in front (POST /controller/fokus: an instrument channel or
// a project track), the server derives graph and base (`erz/5/bk/`, `spur/3/bk/`) and rewrites the learn table of every controller place that follows
// (geraete.json `folgen`): the knob entries that point at a graph knob row are replaced by the instrument preset of (device model, graph) or by the
// default bank. Entries on other targets stay. A place that does not follow is never touched by a focus change. Presets are saved and loaded here too.
//
// What is applied is remembered per place as a signature `<model>|<graph>|<base>`: the same signature is not applied twice, so a repeated focus message
// or a hook that finds nothing new writes nothing. The signature is only set when the kern took the table. The focus lives in memory only: a restart of the
// page server forgets it (the page sends it again); the tables are files and stay.
// Re-resolve hooks (a changed signature is applied): the focus message itself, the kern event /e/graph (another graph on an instrument channel), the
// project's change listener (a track added, removed or given another graph: the slot or graph of the focused track moved) and a change of the devices file
// (a place starts following, another device on a place). Without a hook, a change is only seen at the next focus message.
import type http from 'node:http';
import path from 'node:path';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { grundText } from '../../http/reasons.ts';
import { json } from '../../http/transport.ts';
import { geraeteDatei } from '../../paths.ts';
import { BK_KANAELE } from '../../../conductor/src/controls_info.ts';
import { bkSlot, BK_LIVE_SLOTS } from '../../project/model.ts';
import { leseKoerper } from '../proj/area.ts';
import { ProjFehler } from '../proj/session.ts';
import { GeraeteFehler, GeraeteSpeicher, controllerPlaetze, folgenVon, type Konfig } from '../devices/store.ts';
import type { LernenBereich } from '../learn/area.ts';
import { LernFehler, PLAETZE, type Neu, type Zuordnung } from '../learn/store.ts';
import { KATALOG } from './catalog.ts';
import { bank, loese, type Uebersprungen } from './preset_aufloesen.ts';
import { ControllerPresets, SEITE, slugVon, type InstrumentEintrag, type Preset } from './preset_store.ts';
import { ReglerZurueck, type ZurueckZugang } from './zurueck.ts';
import { tastenSenke, type TastenArm } from './tasten.ts';
import { sendeLiveTasten, stromVonKanal } from './tasten_live.ts';

export interface FolgenOptionen { geraeteKonfig?: string; werk?: string; nutzer?: string; zugang?: ZurueckZugang; ruheMs?: number; tasten?: TastenArm }
export type FokusGrund = 'kein_graph' | 'kein_bk' | 'slot_ohne_zeile';
interface Fokus { kanal?: string; spur_id?: string; graph: string | null; basis: string | null; grund?: FokusGrund }
type Eingabe = { kanal: string } | { spur_id: string } | null;
/** Where the MIDI keys go (N1): a project track (the focus arm), a live channel (N2) or nowhere, with the reason. */
export type TastenGrund = 'kein_fokus' | 'kein_instrument' | 'keine_senke' | 'kein_ziel' | 'kern_alt';
interface TastenZiel { ziel: { spur_id: string } | { kanal: string } | null; grund?: TastenGrund }
export interface ControllerBereich extends Bereich {
  /** Re-resolve the focus and the following places now (the hooks call this); resolves when the pass is done. */
  anstoss(): Promise<void>;
  lage(): Record<string, unknown>;
}

const KANAL = /^[a-z]{1,8}\/[1-9][0-9]{0,2}$/;
const SPUR_ID = /^[A-Za-z0-9_-]{1,32}$/;
const NAME_MAX = 60;

/** The catalogue model of a learnable device on a port (the page's rule: the catalogue's MIDI port name part occurs in the port), or null. */
export const modellVonPort = (port: string): string | null => KATALOG.find((k) => k.weg === 'lernen' && k.midi !== null && port.includes(k.midi))?.id ?? null;

/** Whether a port is the DAW port of its catalogue device (Launch Control 3: "LC3 1: DAW In"): its controls may send on another channel there (`kanal_daw`). */
export const dawPort = (port: string): boolean => { const g = KATALOG.find((k) => k.weg === 'lernen' && k.midi !== null && port.includes(k.midi)); return !!g && typeof g.rueckweg_port === 'string' && port.includes(g.rueckweg_port); };

export function controllerBereich(ctx: BereichKontext, lern: LernenBereich, opt: FolgenOptionen = {}): ControllerBereich {
  const geraete = new GeraeteSpeicher(opt.geraeteKonfig ?? geraeteDatei());
  const konfig = (): Konfig | null => { try { return geraete.lies(); } catch { return null; } };   // a damaged devices file: no places known, nothing is touched
  const presets = new ControllerPresets({ werk: opt.werk, nutzer: opt.nutzer ?? path.join(lern.speicher.ordner, 'presets') });
  const zurueck = opt.zugang ? new ReglerZurueck(ctx, opt.zugang, opt.ruheMs) : null;   // write-back of controller values on project tracks (zurueck.ts)
  let eingabe: Eingabe = null;
  let fokus: Fokus | null = null;
  // The page of the synth's panel that is in front (MAIN, MOD, FX ...), told with the focus by a page that shows the panel. It belongs to the synth it came
  // with: a focus on the same synth without a page keeps it, another synth starts without one.
  let seite: string | null = null;
  // The program of a place: which of the preset's programs its controls drive now (0-based). Page up/down on the device steps it (POST
  // /controller/programm). It belongs to the synth in front like the page: another synth starts at program 1 (or at the first program of its page).
  const programm = new Map<number, number>();
  // Keys follow the focus (N1). The switch is session state: on after every start of the page server, the focus unknown until the page sends it.
  // Nothing of this is project data; the arm itself lives in opt.tasten and is sent to the core by the reconciler of proj/aufnahme.ts.
  let tastenAn = true;
  let tastenStand: TastenZiel = { ziel: null, grund: 'kein_fokus' };
  let liveKanal: string | null = null;   // the channel the live-key target was last set to (N2); null: not set
  let liveFehl: { kanal: string; grund: 'kern_alt' } | null = null;   // the core refused that channel: not tried again until the focus or the core changes
  const angewandt = new Map<number, { sig: string; preset: string | null; programm?: { nr: number; von: number; name: string } }>();
  let kette: Promise<unknown> = Promise.resolve();

  // ---- focus ----
  function leite(e: Eingabe): Fokus | null {
    if (e === null) return null;
    if ('kanal' in e) {
      let graph: string | null = null;
      try { graph = ctx.baukasten?.geladen()[e.kanal] || null; } catch { /* no graph known */ }
      if (!BK_KANAELE.includes(e.kanal)) return { kanal: e.kanal, graph, basis: null, grund: 'kein_bk' };
      return graph === null ? { kanal: e.kanal, graph, basis: null, grund: 'kein_graph' } : { kanal: e.kanal, graph, basis: `${e.kanal}/bk/` };
    }
    let projekt = null;
    try { projekt = ctx.projekt?.() ?? null; } catch { /* no project known */ }
    const spur = projekt?.spuren.find((s) => s.id === e.spur_id);
    const g = spur?.geraet;
    if (!projekt || !spur || g?.art !== 'intern' || g.name !== 'bk') return { spur_id: e.spur_id, graph: null, basis: null, grund: 'kein_bk' };
    if (!g.graph) return { spur_id: e.spur_id, graph: null, basis: null, grund: 'kein_graph' };
    const slot = bkSlot(projekt, spur.id);
    if (slot === null || slot > BK_LIVE_SLOTS) return { spur_id: e.spur_id, graph: g.graph, basis: null, grund: 'slot_ohne_zeile' };
    return { spur_id: e.spur_id, graph: g.graph, basis: `spur/${slot}/bk/` };
  }

  const plaetzeLage = (): { platz: number; modell: string | null; folgen: boolean; preset: string | null; programm?: { nr: number; von: number; name: string } }[] => {
    const k = konfig();
    if (!k) return [];
    return controllerPlaetze(k).map((c) => { const a = angewandt.get(c.platz); return { platz: c.platz, modell: modellVonPort(c.port), folgen: folgenVon(k, c.platz), preset: a?.preset ?? null, ...(a?.programm ? { programm: a.programm } : {}) }; });
  };
  // The program index of a place for a preset, or null when the preset has no programs. A place without one yet, or one whose program is on another
  // page than the one in front, takes the first program of the page in front (else program 1).
  const programmVon = (platz: number, preset: Preset): number | null => {
    const liste = preset.art === 'instrument' ? preset.programme ?? [] : [];
    if (liste.length === 0) return null;
    let i = programm.get(platz);
    if (i === undefined || i < 0 || i >= liste.length || (seite !== null && liste[i].seite !== undefined && liste[i].seite !== seite && liste.some((x) => x.seite === seite))) {
      i = seite !== null ? Math.max(0, liste.findIndex((x) => x.seite === seite)) : 0;
      programm.set(platz, i);
    }
    return i;
  };
  const lage = (): Record<string, unknown> => ({ fokus: fokus && seite !== null ? { ...fokus, seite } : fokus, plaetze: plaetzeLage(), tasten: { an: tastenAn, ...tastenStand } });

  // ---- keys (N1) ----
  // Where the keys should go for the current focus, before anything is sent: a project track with a note sink, a live channel that has a stream, or nothing.
  function tastenWunsch(): TastenZiel {
    if (!tastenAn) return { ziel: null };
    if (eingabe === null) return { ziel: null, grund: 'kein_fokus' };
    if ('kanal' in eingabe) return stromVonKanal(eingabe.kanal) === null ? { ziel: null, grund: 'kein_ziel' } : { ziel: { kanal: eingabe.kanal } };
    let projekt = null;
    try { projekt = ctx.projekt?.() ?? null; } catch { /* no project known */ }
    const spur = projekt?.spuren.find((s) => s.id === eingabe.spur_id);
    if (!spur || spur.art !== 'instrument') return { ziel: null, grund: 'kein_instrument' };
    return tastenSenke(spur) ? { ziel: { spur_id: spur.id } } : { ziel: null, grund: 'keine_senke' };
  }
  // Puts the wish into effect: the focus arm for a project track, the live-key target for a channel (kern_alt when the core refuses it,
  // tasten_live.ts). A focus on a channel takes the focus arm back; a focus on a track clears the live target when one was set.
  async function tasten(): Promise<void> {
    const w = tastenWunsch();
    const spurId = w.ziel && 'spur_id' in w.ziel ? w.ziel.spur_id : null;
    opt.tasten?.setze(spurId);
    const kanal = w.ziel && 'kanal' in w.ziel ? w.ziel.kanal : null;
    let stand = w;
    if (kanal === null || kanal !== liveFehl?.kanal) liveFehl = null;
    if (kanal !== liveKanal && (kanal !== null || liveKanal !== null) && liveFehl === null) {
      const r = await sendeLiveTasten(ctx, kanal);
      if (r.ok) liveKanal = kanal;
      else if (kanal !== null) liveFehl = { kanal, grund: r.grund };
    }
    if (liveFehl !== null && kanal === liveFehl.kanal) stand = { ziel: null, grund: liveFehl.grund };   // the core cannot take it: say so, nothing breaks
    tastenStand = stand;
  }

  // ---- follow ----
  // Every following place with a known model gets the knob entries of the preset (or bank) resolved onto the base. Lower places keep their targets
  // when two places follow the same synth: a place never takes a target from a lower following place.
  async function wende(): Promise<void> {
    const k = konfig();
    if (!k) return;
    for (const c of controllerPlaetze(k)) if (!folgenVon(k, c.platz) || modellVonPort(c.port) === null) angewandt.delete(c.platz);
    if (!fokus || fokus.basis === null || fokus.graph === null) return;   // a focus without a base removes nothing
    const { basis, graph } = fokus;
    for (const c of controllerPlaetze(k)) {
      const modell = modellVonPort(c.port);
      if (!folgenVon(k, c.platz) || modell === null) continue;
      const treffer = presets.findeInstrument(modell, graph);
      // the preset's own content is part of the signature: a preset that changed on disk (saved again, a new factory file) is applied at the next pass
      const pi = treffer ? programmVon(c.platz, treffer.preset) : null;
      const sig = `${modell}|${graph}|${basis}|${seite ?? ''}|${pi ?? ''}|${treffer ? JSON.stringify([treffer.id, treffer.preset.eintraege, treffer.preset.seiten ?? null, treffer.preset.programme ?? null]) : ''}`;
      if (angewandt.get(c.platz)?.sig === sig) continue;
      const vergeben = new Set<string>();
      for (const z of lern.speicher.lies().zuordnungen) if (z.platz < c.platz && folgenVon(k, z.platz) && z.pfad.startsWith(basis)) vergeben.add(z.pfad);
      const aufg = treffer ? loese(treffer.preset, basis, vergeben, dawPort(c.port), seite, pi) : bank(modell, basis, vergeben, dawPort(c.port));
      try {
        const r = await lern.ersetze(c.platz, aufg.eintraege, 'bk');
        if (r.stand === 'abgelehnt') { angewandt.delete(c.platz); continue; }
        const pl = treffer && pi !== null ? treffer.preset.programme! : null;
        angewandt.set(c.platz, { sig, preset: treffer ? treffer.id : 'bank', ...(pl ? { programm: { nr: pi! + 1, von: pl.length, name: pl[pi!].name } } : {}) });
        for (const p of r.plaetze) if (p > c.platz) angewandt.delete(p);   // a higher place lost a target to this one: it resolves again, below
      } catch (e) {
        angewandt.delete(c.platz);
        ctx.log({ typ: 'controller_folgen_fehler', platz: c.platz, fehler: (e as Error)?.message ?? String(e) });
      }
    }
  }

  // One pass: derive the focus again, apply, and tell the pages when the state changed. Passes run one after the other.
  function durchlauf(neu?: Eingabe | undefined, immer = false): Promise<void> {
    if (neu === undefined && eingabe === null && !immer) return kette.then(() => undefined);   // a hook without a focus has nothing to do
    const lauf = kette.then(async () => {
      const vorher = JSON.stringify(lage());
      if (neu !== undefined) eingabe = neu;
      fokus = leite(eingabe);
      await wende();
      await tasten();
      if (JSON.stringify(lage()) !== vorher) ctx.verteile({ a: 'controller_fokus', f: lage() });
    }).catch((e) => ctx.log({ typ: 'controller_folgen_fehler', fehler: (e as Error)?.message ?? String(e) }));
    kette = lauf;
    return lauf;
  }

  // ---- presets ----
  const antwort = (e: unknown): { code: number; j: Record<string, unknown> } => {
    if (e instanceof LernFehler || e instanceof GeraeteFehler) return { code: e.code, j: { fehler: e.grund, text: e.text || grundText(e.grund) } };
    if (e instanceof ProjFehler) return { code: e.code, j: { fehler: e.fehler, text: grundText(e.fehler), ...e.extra } };
    ctx.log({ typ: 'controller_fehler', fehler: (e as Error)?.message ?? String(e) });
    return { code: 500, j: { fehler: 'intern', text: grundText('intern') } };
  };
  const nurAndreas = (): void => { if (ctx.quelle() !== 'andreas') throw new LernFehler('nur_andreas', 403); };
  const ungueltig = (t: string): LernFehler => new LernFehler('argument_ungueltig', 400, t);
  const schreib = (pfad: string, f: (d: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>): Route => ({
    methode: 'POST', pfad, schutz: 'fremdePost',
    handler: async (q: http.IncomingMessage, a: http.ServerResponse) => {
      try {
        const d = await leseKoerper(q);
        nurAndreas();
        json(a, 200, { ok: true, ...(await f(d)) });
      } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
    },
  });

  /** The controller place `platz` with its model; refuses a place without a device or without a known model. */
  function platzMitModell(x: unknown): { platz: number; modell: string; k: Konfig; daw: boolean } {
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 1 || x > PLAETZE) throw ungueltig(`platz: a controller place 1..${PLAETZE}`);
    const k = konfig();
    const c = k ? controllerPlaetze(k).find((p) => p.platz === x) : undefined;
    if (!k || !c) throw ungueltig(`platz: no controller on place ${x}`);
    const modell = modellVonPort(c.port);
    if (modell === null) throw ungueltig(`platz: the device on place ${x} is not a learnable controller of the catalogue`);
    return { platz: x, modell, k, daw: dawPort(c.port) };
  }
  const steuerung = (modell: string, z: Zuordnung): string | null => {
    const r = KATALOG.find((m) => m.id === modell)?.regler?.find((x) => x.typ === (z.typ ?? 'cc') && x.nr === z.nr && (x.kanal === z.kanal || x.kanal_daw === z.kanal || z.kanal === 0));
    return r?.name ?? null;
  };

  // Save the place as a preset. 'instrument': the entries of the place that point into the focus base, by control name and knob number. 'fest': the whole table.
  function speichere(d: Record<string, unknown>): Record<string, unknown> {
    const { platz, modell } = platzMitModell(d.platz);
    const eigene = lern.speicher.lies().zuordnungen.filter((z) => z.platz === platz);
    let preset: Preset;
    if (d.art === 'instrument') {
      if (!fokus || fokus.basis === null || fokus.graph === null) throw new LernFehler('kein_fokus', 409);
      const basis = fokus.basis;
      const eintraege = eigene.filter((z) => z.pfad.startsWith(basis) && /^[1-9][0-9]?$/.test(z.pfad.slice(basis.length)))
        .map((z) => ({ regler: steuerung(modell, z), knopf: Number(z.pfad.slice(basis.length)), ...(z.stufen ? { stufen: z.stufen } : {}) })).filter((e): e is { regler: string; knopf: number; stufen?: number } => e.regler !== null);
      if (eintraege.length === 0) throw ungueltig('platz: the place has no knob of this device assigned on the synth in front; nothing to save');
      // With a page in front only that page is saved: the other pages and the entries without a page stay as the preset in use has them (the user's file,
      // else the factory one), so saving MOD does not lose MAIN.
      const alt = presets.findeInstrument(modell, fokus.graph)?.preset ?? null;
      const seiten: Record<string, InstrumentEintrag[]> = { ...(alt?.seiten ?? {}) };
      const pi = alt ? programmVon(platz, alt) : null;   // with programs only the program in front is replaced
      const programme = alt?.programme ? alt.programme.map((x, i) => (i === pi ? { ...x, eintraege } : x)) : undefined;
      if (seite !== null && (pi === null || alt?.programme?.findIndex((x) => x.seite === seite) === pi)) seiten[seite] = eintraege;
      preset = { schema: 1, name: fokus.graph, modell, art: 'instrument', graph: fokus.graph, eintraege: alt && (pi !== null ? pi !== 0 : seite !== null) ? alt.eintraege : eintraege, ...(Object.keys(seiten).length ? { seiten } : {}) , ...(programme ? { programme } : {}) };
    } else if (d.art === 'fest') {
      if (typeof d.name !== 'string' || d.name.trim().length < 1 || d.name.trim().length > NAME_MAX) throw ungueltig(`name: 1 to ${NAME_MAX} characters`);
      if (slugVon(d.name) === '') throw ungueltig('name: needs at least one letter or digit');
      const eintraege = eigene.map((z) => ({ regler: steuerung(modell, z), pfad: z.pfad })).filter((e): e is { regler: string; pfad: string } => e.regler !== null);
      preset = { schema: 1, name: d.name.trim(), modell, art: 'fest', eintraege };
    } else throw ungueltig("art: 'instrument' or 'fest'");
    const id = presets.speichere(preset);
    return { preset: presets.liste(modell).find((p) => p.id === id) };
  }

  // Load a preset onto a place. An instrument preset replaces the knob entries on the focus base (as the follow does); a fest preset replaces every learned entry.
  async function lade(d: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { platz, modell, daw } = platzMitModell(d.platz);
    if (typeof d.id !== 'string') throw ungueltig('id: a preset id such as nutzer:lc3/synth-poly');
    const { preset } = presets.lies(d.id);
    if (preset.modell !== modell) throw ungueltig(`id: the preset is for the model ${preset.modell}, the device on place ${platz} is ${modell}`);
    let neu: Neu[], uebersprungen: Uebersprungen[], modus: 'bk' | 'alle';
    if (preset.art === 'instrument') {
      if (!fokus || fokus.basis === null || fokus.graph === null) throw new LernFehler('kein_fokus', 409);
      if (fokus.graph !== preset.graph) throw new LernFehler('graph_anders', 409, `the preset is for the graph ${preset.graph}, the synth in front has ${fokus.graph}`);
      ({ eintraege: neu, uebersprungen } = loese(preset, fokus.basis, undefined, daw, seite, programmVon(platz, preset)));
      modus = 'bk';
    } else {
      ({ eintraege: neu, uebersprungen } = loese(preset, null, undefined, daw));
      modus = 'alle';
    }
    const r = await lern.ersetze(platz, neu, modus);
    if (r.stand === 'abgelehnt') throw new LernFehler('lernen_abgelehnt', 409, `the assignment was refused (${r.grund ?? 'abgelehnt'}); nothing was changed`);
    const vorher = JSON.stringify(plaetzeLage());
    angewandt.set(platz, { sig: angewandt.get(platz)?.sig ?? '', preset: d.id });
    if (JSON.stringify(plaetzeLage()) !== vorher) ctx.verteile({ a: 'controller_fokus', f: lage() });
    return { gesetzt: r.gesetzt.length, uebersprungen: [...uebersprungen, ...r.kollidiert.map((z) => ({ regler: steuerung(modell, { ...z, platz }) ?? z.pfad, grund: 'quelle_belegt' }))], ...lern.lage() };
  }

  return {
    name: 'controller',
    anstoss: () => durchlauf(),
    lage,
    routen: () => [
      { methode: 'GET', pfad: '/controller/presets', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse, url: URL) => {
        try {
          const m = url.searchParams.get('modell');
          json(a, 200, { presets: presets.liste(m === null || m === '' ? undefined : m) });
        } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
      } },
      schreib('/controller/presets/speichern', (d) => speichere(d)),
      schreib('/controller/presets/laden', (d) => {
        const lauf = kette.then(() => lade(d));   // after a running follow pass
        kette = lauf.catch(() => undefined);
        return lauf;
      }),
      schreib('/controller/presets/loeschen', (d) => {
        if (typeof d.id !== 'string') throw ungueltig('id: a preset id such as nutzer:lc3/synth-poly');
        presets.loesche(d.id);
        return {};
      }),
      { methode: 'GET', pfad: '/controller/fokus', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse) => json(a, 200, lage()) },
      // Step the program of a following place: {platz, schritt: 1 | -1} (Page down / up on the device, sent by its bridge) or {platz, nr} (1-based, a click
      // on the page). The ends hold (no wrap). The page in front becomes the page of the new program, so the device window shows it.
      { methode: 'POST', pfad: '/controller/programm', schutz: 'fremdePost', handler: async (q: http.IncomingMessage, a: http.ServerResponse) => {
        try {
          const d = await leseKoerper(q);
          const { platz, modell } = platzMitModell(d.platz);
          if (!fokus || fokus.graph === null) throw new LernFehler('kein_fokus', 409);
          const liste = presets.findeInstrument(modell, fokus.graph)?.preset.programme ?? [];
          if (liste.length === 0) throw new LernFehler('keine_programme', 409, 'the mapping of this synth has no programs');
          const jetzt = programm.get(platz) ?? 0;
          let ziel: number;
          if (d.nr !== undefined) { if (!Number.isInteger(d.nr) || (d.nr as number) < 1 || (d.nr as number) > liste.length) throw ungueltig(`nr: a program 1..${liste.length}`); ziel = (d.nr as number) - 1; }
          else if (d.schritt === 1 || d.schritt === -1) ziel = Math.min(liste.length - 1, Math.max(0, jetzt + d.schritt));
          else throw ungueltig('schritt: 1 or -1, or nr: the program number');
          programm.set(platz, ziel);
          if (liste[ziel].seite !== undefined) seite = liste[ziel].seite!;
          await durchlauf(undefined, true);
          json(a, 200, { ok: true, ...lage() });
        } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
      } },
      { methode: 'POST', pfad: '/controller/fokus/tasten', schutz: 'fremdePost', handler: async (q: http.IncomingMessage, a: http.ServerResponse) => {
        try {
          const d = await leseKoerper(q);
          nurAndreas();
          if (typeof d.an !== 'boolean') throw ungueltig('an: true or false');
          tastenAn = d.an;
          await durchlauf(undefined, true);
          json(a, 200, { ok: true, ...lage() });
        } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
      } },
      { methode: 'POST', pfad: '/controller/fokus', schutz: 'fremdePost', handler: async (q: http.IncomingMessage, a: http.ServerResponse) => {
        try {
          const d = await leseKoerper(q);
          nurAndreas();
          const gegeben = ['kanal', 'spur_id'].filter((s) => d[s] !== undefined);
          if (gegeben.length > 1) throw ungueltig('give either kanal or spur_id, or nothing for no synth in front');
          let neu: Eingabe = null;
          if (d.kanal !== undefined) {
            if (typeof d.kanal !== 'string' || !KANAL.test(d.kanal)) throw ungueltig('kanal: an instrument channel such as erz/5');
            neu = { kanal: d.kanal };
          } else if (d.spur_id !== undefined) {
            if (typeof d.spur_id !== 'string' || !SPUR_ID.test(d.spur_id)) throw ungueltig('spur_id: a track id such as s3');
            neu = { spur_id: d.spur_id };
          }
          if (d.seite !== undefined && d.seite !== null && (typeof d.seite !== 'string' || !SEITE.test(d.seite))) throw ungueltig('seite: a page id of the panel such as main, mod, fx');
          const gleich = JSON.stringify(neu) === JSON.stringify(eingabe);
          if (typeof d.seite === 'string') seite = d.seite;
          else if (!gleich || d.seite === null) seite = null;
          if (!gleich) programm.clear();   // another synth: its programs start anew
          await durchlauf(neu);
          json(a, 200, lage());
        } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
      } },
    ],
    ereignis(adresse: string, felder: Record<string, unknown>): void {
      if (adresse === '/e/graph') void durchlauf();   // another graph on a channel: the focused one may be it
      if (adresse === '/e/regler') zurueck?.ereignis(felder);
      if (adresse === '/k/willkommen' || adresse === '/e/neustart') { liveKanal = null; liveFehl = null; void durchlauf(); }   // a new core generation starts with no live-key target (N2)
    },
  };
}
