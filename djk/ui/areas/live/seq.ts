// SEQ deck v2, task 3 (spec 2026-11-14-seq-deck-design, sections 5, 7 and 9): the routes of a SEQ deck. A deck is a top group of the live container, a pattern an
// instrument track that plays into it with one MIDI clip; every write is a list of ordinary project commands.
//   POST /seq/anlegen {platz}                          builds the deck of a place (seq_anlegen)
//   POST /seq/leeren {platz}                           removes the deck and its tracks (seq_leeren)
//   POST /seq/folge {platz, name, geraet, loop_beats?} makes one pattern (seq_folge_neu); `geraet` is `bk:<graph>`, `kit:<kit>`, `rb338` or a device object;
//                                                      from Cypher the pattern is made muted
//   POST /seq/befehle {platz, label?, befehle}         a command list of the page, one gesture = one undo step; only the commands below, each on a track of the
//                                                      deck or a clip of such a track, only the fields below
//   POST /seq/text {platz, text}                       one or several patterns as text (seq_text.ts); one write, one undo step, all or nothing
//   POST /seq/modul {slug, platz}                      a Workbench module (read from disk) becomes patterns of the deck (project/module_after_seq.ts); one undo step,
//                                                      all or nothing; answers {ok, bericht, rev, projekt, gruppe_id}; a new deck follows the rules of seq_anlegen
//   GET  /seq/stand[?zellen=1]                         (`zellen=1` adds `zellen`, one char per cell, to the note rows) {"1": null | {gruppe_id, folgen: [{spur_id, clip_id, name, geraet, stumm, editierbar, laenge_beats, zeilen, text}]}, ...}
//   POST /seq/szene {slot, aktion}                     SEQ scenes: aktion `speichern` stores the picture of the current M buttons in slot 0..7, `loeschen` empties it,
//                                                      `starten` switches the saved picture on at the NEXT BAR (the project model follows when the core has executed the
//                                                      mute rows; transport stopped = at once). Answers like POST /seq/befehle (speichern, loeschen, immediate starten) or
//                                                      {ok, wartet: {slot, ziel_beat}} (starten on the bar). Last press wins; an M click inside the window does not cancel it.
//   GET  /seq/szenen                                   {szenen: ({an, aus} counts | null)[8], aktiv: slot | null, wartet: {slot, ziel_beat} | null}; /seq/stand stays decks only
//   GET  /seq/geraet?spur_id=<id>                      (any open project, not only the live container) the `info` of a track's instrument: {art, regler: [{nr, name, vorgabe}], klaenge: [{ton, name}]}
// Every POST answers what the session answers to POST /proj/aendern, {rev, projekt, kern, hinweise?}, plus `gruppe_id` (and `ohne_aenderung: true` when the list
// came out empty and nothing was written). The page needs `projekt` and `kern` (the message "Saved, but the core did not load"). Each write sends the event
// {a: 'seq', f: {platz, rev}}.
// SeqBereich serialises its writes in one promise chain. The commands are planned INSIDE the chain from the project as it is when the write's turn comes
// (plan is synchronous), so a text and a click never plan against a stale document; rev_veraltet (a module route or a raw /proj/aendern wrote past the chain)
// is retried once. The planning of a text never calls the queue again (the chain would wait for itself).
// Gates: kanal_offen and seq_belegt are the session's (they hold for a raw /proj/aendern too); deck_laeuft is here, because only the server knows deck state.
import type http from 'node:http';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { SEQ_BEATS, seqFolgen, seqGruppe, seqLaengeOk, seqRegion } from '../../project/seq.ts';
import { takteProLive } from '../../project/taktart_live.ts';
import type { Geraet, Gruppe, Projekt, Spur } from '../../project/model.ts';
import { bandVon, folgeBefehle, geraetText, geraetVonText, leseFolgeText, schreibeFolgeText, type Befehl, type FolgeInfo } from '../../project/seq_text.ts';
import { SeqFehler, folgeSicht, musterLaenge, reglerSchluessel } from '../../public/seq_logic.js';
import { parameterTabelle } from '../../devices_parameter.ts';
import { TROMMEL_KARTEN } from '../../project/trommel_map.ts';
import { kitKlaenge } from '../proj/kits.ts';
import { liesSchnitt, type Ordner } from '../../sampler/schnitt.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from '../proj/area.ts';
import { szeneAusMutes } from '../../project/commands_szenen.ts';
import { SZENEN_SLOTS, type Szene } from '../../project/model.ts';
import { szenenZielBeat, type ZielEingang } from '../proj/szenen_bar.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import { aendereStand, StandFehler } from '../../project/state.ts';
import { NachSeqFehler, setzeModulNachSeq, type BefehlsKontext } from '../../project/module_after_seq.ts';
import { findeGraph } from '../../graphs.ts';
import { kitDa } from '../proj/kits.ts';

type Quelle = 'andreas' | 'cypher';
// SEQ scenes: what the scene launch needs of the core. server.ts passes KernLage.zielLage and KernWeg.szenenTeile / abbruchPlan; tests inject a double.
export interface SzenenWeg {
  zielLage(loop: { von_beat: number; bis_beat: number }): ZielEingang | null;   // null = no same-block pair known yet
  szenenTeile(plan: string, quelle: Quelle, ab: number, zeilen: readonly { pfad: string; wert: number }[]): Promise<{ id: number; status: number }[]>;
  abbruchPlan(plan: string, quelle: Quelle): Promise<unknown>;
}
const SZENEN_PLAN = 'szene';
const AUSGEFUEHRT = new Set([2, 3, 5]);   // receipts of a Setzen part that ran: gestartet, fertig, verspaetet ausgefuehrt
export interface SeqOptionen {
  szenen?: SzenenWeg;                       // SEQ scenes: the core side; absent = a launch applies at once, nothing waits for a bar
  deckLaeuft?(platz: number): boolean;      // does deck N play (server.ts); absent = no deck plays
  // A write CREATED the SEQ deck on `platz` (after it succeeded): eject a stale stopped track of that place (server.ts); absent = nothing; a failure is no error of the write
  deckAufraeumen?(platz: number, quelle: Quelle): void;
  samplerOrdner?(): string | undefined;   // the cut store of this instance (server.ts); absent = the default folder
  geraetInfo?(g: Geraet | undefined): FolgeInfo;   // tests inject the instrument description; absent = the graph folder and the kit folder
  kanalOffen?(kanal: string): boolean;      // is the channel deck/N open as the server sees it (server.ts); absent = closed
  befehlsKontext?(): BefehlsKontext;        // what the commands of POST /seq/modul check against; absent = the graph folder and the kit folder
}
type Folge = { spur_id: string; clip_id: string | null; name: string; geraet: string; stumm: boolean; editierbar: boolean; laenge_beats: number | null;
  zeilen: Record<string, unknown>[]; text: string | null };
type SeqEintrag = { gruppe_id: string; folgen: Folge[] };
export type SeqStand = Record<'1' | '2' | '3' | '4', SeqEintrag | null>;

const PLAETZE = [1, 2, 3, 4] as const;
const BEFEHLE_MAX = 2000;
const NOTEN_BEAT_EPS = 1e-6;

// The fields a command of POST /seq/befehle may carry (plus `befehl`). Anything else is argument_unbekannt.
const FELDER: Record<string, readonly string[]> = {
  spur_aendern: ['spur_id', 'name', 'mute', 'solo', 'fader_db', 'pan', 'geraet'],
  spur_loeschen: ['spur_id'],
  clip_neu: ['spur_id', 'art', 'name', 'start_beat', 'laenge_beats', 'loop_beats', 'noten', 'seq'],
  clip_aendern: ['clip_id', 'loop_beats', 'name', 'seq'],
  noten_neu: ['clip_id', 'noten'],
  noten_aendern: ['clip_id', 'noten'],
  noten_loeschen: ['clip_id', 'ids'],
  huellkurve_setzen: ['clip_id', 'ziel', 'punkte', 'verknuepft', 'loop_beats'],
  huellkurve_loeschen: ['clip_id', 'ziel'],
};
// the command names that carry a track id in `spur_id`, and those that carry a clip id in `clip_id`
const SPUR_BEFEHLE = ['spur_aendern', 'spur_loeschen', 'clip_neu'];
const CLIP_BEFEHLE = ['clip_aendern', 'noten_neu', 'noten_aendern', 'noten_loeschen', 'huellkurve_setzen', 'huellkurve_loeschen'];

function nurFelder(d: Record<string, unknown>, erlaubt: readonly string[]): void {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
}
function platzVon(d: Record<string, unknown>): number {
  const p = d.platz;
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > 4) throw new ProjFehler(400, 'argument_ungueltig', { text: 'platz: integer 1..4 expected' });
  return p;
}
const ungueltig = (text: string): never => { throw new ProjFehler(400, 'argument_ungueltig', { text }); };

// The generated sampler device `smp-<id>` (D11): slice i is note i and is named i + 1 (people count from 1); `schnitt` carries what the grid needs of the cut.
// Anything that is not a readable cut of that name is an ordinary graph.
function schnittVon(graph: string, o: Ordner = {}): { klaenge: { ton: number; name: string }[]; schnitt: NonNullable<FolgeInfo['schnitt']> } | null {
  if (!graph.startsWith('smp-')) return null;
  const s = liesSchnitt(graph.slice(4), o);
  if (!s || s.grenzen.length < 2) return null;
  const n = s.grenzen.length - 1;
  return {
    klaenge: Array.from({ length: n }, (_, i) => ({ ton: i, name: String(i + 1) })),
    schnitt: { id: s.id, scheiben: n, laengen_beats: Array.from({ length: n }, (_, i) => (s.grenzen[i + 1] - s.grenzen[i]) * s.beats / s.frames) },
  };
}

// What the text and the page need to know about an instrument: the knobs with names and start positions, the sounds of a kit. Sources without HTTP: the
// parameter table of the device (the one GET /graphen/panel and the device panels are built from; names are the `label`s) and the kit file (as GET /proj/kits
// reads it; it lists only the number of sounds, the names come from kit.json). bk knobs carry their number as `nr`, the RB-338 targets their name.
export function geraetInfo(g: Geraet | undefined, o: Ordner = {}): FolgeInfo {
  if (g?.art === 'intern' && g.name === 'bk') {
    const schnitt = schnittVon(g.graph, o);
    return { art: 'bk', klaenge: schnitt ? schnitt.klaenge : [...(TROMMEL_KARTEN[g.graph] ?? [])], ...(schnitt ? { schnitt: schnitt.schnitt } : {}), regler: parameterTabelle({ art: 'bk', graph: g.graph })
      .map((p) => ({ nr: Number(p.name.slice(1)), name: p.label, vorgabe: p.vorgabe })).filter((r) => Number.isInteger(r.nr)) };
  }
  if (g?.art === 'intern' && g.name === 'rb338') {
    return { art: 'rb338', klaenge: [], regler: parameterTabelle({ art: 'rb338' })
      .filter((p) => reglerSchluessel(`geraet.${p.name}`) !== null).map((p) => ({ nr: p.name, name: p.label, vorgabe: p.vorgabe })) };
  }
  if (g?.art === 'intern' && g.name === 'kit') {
    return { art: 'kit', regler: [], klaenge: (kitKlaenge(g.kit) ?? []).map((k) => ({ ton: k.note, name: k.name })) };
  }
  return { art: 'anderes', regler: [], klaenge: [] };
}

// one character per cell of a note lane: '.' empty; trigger lane o/x/X by velocity band (the characters of the text notation); pitched lane x where a note starts
function zellenText(z: Record<string, unknown>): string {
  return (z.zellen as { an: boolean; vel: number }[]).map((c) => (!c.an ? '.' : z.ton !== undefined ? bandVon(c.vel) : 'x')).join('');
}

export class SeqBereich {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly o: SeqOptionen;
  private kette: Promise<unknown> = Promise.resolve();
  private wartet: { slot: number; ziel_beat: number; marke: number; quelle: Quelle } | null = null;   // a scene launched and not yet executed by the core
  private marke = 0;                                                                   // counts launches and clears: an old receipt must not write the model
  private generation: number | null = null;
  constructor(ctx: BereichKontext, zugang: ProjZugang, o: SeqOptionen = {}) { this.ctx = ctx; this.zugang = zugang; this.o = o; }

  private info(g: Geraet | undefined): FolgeInfo { return this.o.geraetInfo ? this.o.geraetInfo(g) : geraetInfo(g, { ordner: this.o.samplerOrdner?.() }); }

  private eintrag(p: Projekt, platz: number, zellen = false): SeqEintrag | null {
    const g = seqGruppe(p, platz);
    if (!g?.seq) return null;
    const folgen = seqFolgen(p, g).map(({ spur, clip, editierbar }): Folge => {
      const info = this.info(spur.geraet);
      const kopf = { spur_id: spur.id, name: spur.name, geraet: geraetText(spur.geraet), stumm: spur.mute, editierbar };
      if (!editierbar) return { ...kopf, clip_id: null, laenge_beats: null, zeilen: [], text: null };
      const zeilen = clip ? folgeSicht(spur, clip, info).zeilen.map((z: Record<string, unknown>) => ({
        id: z.id, art: z.art, name: z.name, teiler: z.teiler, ziel: z.ziel, ton: z.ton, von: z.von, abgeleitet: z.abgeleitet,
        zellen: zellen && z.art === 'noten' ? zellenText(z) : undefined,
      })).map((z: Record<string, unknown>) => Object.fromEntries(Object.entries(z).filter(([, v]) => v !== undefined))) : [];
      return { ...kopf, clip_id: clip?.id ?? null, laenge_beats: musterLaenge(clip), zeilen, text: schreibeFolgeText(spur, clip, info, takteProLive(p.taktart)) };
    });
    return { gruppe_id: g.id, folgen };
  }

  stand(opt?: { zellen?: boolean }): Antwort {
    const o = this.zugang.offen();
    const j = {} as SeqStand;
    for (const n of PLAETZE) j[String(n) as keyof SeqStand] = o?.projekt.live ? this.eintrag(o.projekt, n, opt?.zellen === true) : null;
    return { code: 200, j };
  }

  geraet(spurId: string | null): Antwort {
    const o = this.zugang.offen();   // any open project: the workbench asks for the info outside the live container
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    const s = o.projekt.spuren.find((x) => x.id === spurId);
    if (!s) throw new ProjFehler(404, 'spur_unbekannt', { text: `no track ${String(spurId)}` });
    return { code: 200, j: this.info(s.geraet) };
  }

  async anlege(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['platz']);
    const platz = platzVon(d);
    this.ki(quelle);
    this.brauchLive();
    if (this.o.deckLaeuft?.(platz)) {
      throw new ProjFehler(409, 'deck_laeuft', { platz, text: `deck ${platz} is playing; stop it before a SEQ deck is created on its channel` });
    }
    const r = await this.schreibe(platz, quelle, `SEQ ${platz}: create`, () => [{ befehl: 'seq_anlegen', platz }]);
    if (r.code === 200) this.aufraeumen(platz, quelle);
    return r;
  }

  // A Workbench module becomes patterns of the deck of `platz`. The module is read from disk; the open project must be the live container. Everything is
  // computed first (setzeModulNachSeq), then stored as ONE undo step, so a refusal writes nothing. A new deck follows the rules of seq_anlegen (deck_laeuft,
  // kanal_offen); patterns added to an existing deck are not gated (they arrive muted).
  async modul(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['slug', 'platz']);
    const platz = platzVon(d);
    if (typeof d.slug !== 'string' || d.slug === '') ungueltig('slug: the slug of a Workbench module expected');
    const slug = d.slug as string;
    this.ki(quelle);
    this.brauchLive();
    const lauf = this.kette.then(async (): Promise<Antwort> => {
      const o = this.brauchLive();
      const modul = this.zugang.liesProjekt(slug);
      if (seqGruppe(o.projekt, platz) === undefined) {
        const kanal = `deck/${platz}`;
        if (this.o.deckLaeuft?.(platz)) throw new ProjFehler(409, 'deck_laeuft', { platz, text: `deck ${platz} is playing; stop it before a SEQ deck is created on its channel` });
        if (this.o.kanalOffen?.(kanal)) {
          throw new ProjFehler(409, 'kanal_offen', { platz, kanal, text: `the channel ${kanal} of place ${platz} is open; close it before a SEQ deck is created there` });
        }
      }
      try {
        const kontext = this.o.befehlsKontext?.() ?? { graphArt: (n: string) => findeGraph(n)?.art ?? null, kitDa, kitKlaenge };
        const r = setzeModulNachSeq(o.projekt, modul, platz, { kontext, quelle });
        const meta = { quelle, label: `load module ${modul.name} into SEQ ${platz}`.slice(0, 80) };
        const w = aendereStand(o.verlauf, o.projekt, r.projekt, meta, this.zugang.haken());
        await this.zugang.uebernimm(w, meta);
        const jetzt = this.brauchLive().projekt;
        this.ctx.verteile({ a: 'seq', f: { platz, rev: jetzt.rev } });
        if (r.bericht.deck_neu) this.aufraeumen(platz, quelle);
        return { code: 200, j: { ok: true, bericht: r.bericht, rev: jetzt.rev, projekt: jetzt, gruppe_id: seqGruppe(jetzt, platz)?.id ?? '' } };
      } catch (e) {
        if (e instanceof NachSeqFehler) throw new ProjFehler(e.code, e.fehler, e.extra);
        if (e instanceof StandFehler) throw new ProjFehler(409, e.grund, { text: e.text, detail: e.detail });
        throw e;
      }
    });
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }

  async leere(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['platz']);
    const platz = platzVon(d);
    this.ki(quelle);
    this.brauchLive();
    return this.schreibe(platz, quelle, `SEQ ${platz}: clear`, (p) => [{ befehl: 'seq_leeren', gruppe_id: this.brauchDeck(p, platz).id }]);
  }

  async folge(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['platz', 'name', 'geraet', 'loop_beats']);
    const platz = platzVon(d);
    if (typeof d.name !== 'string' || d.name.trim() === '') ungueltig('name: the pattern name expected');
    if (d.geraet === undefined) ungueltig('geraet: bk:<graph>, kit:<kit>, rb338 or a device object expected');
    this.ki(quelle);
    this.brauchLive();
    let geraet: unknown = d.geraet;
    if (typeof geraet === 'string') {
      try { geraet = geraetVonText(geraet); } catch (e) { if (e instanceof SeqFehler) throw new ProjFehler(400, e.grund, { text: e.message }); throw e; }
    }
    const name = d.name as string;
    return this.schreibe(platz, quelle, `SEQ ${platz}: pattern ${name}`, (p) => [{
      befehl: 'seq_folge_neu', gruppe_id: this.brauchDeck(p, platz).id, name, geraet, ...(d.loop_beats !== undefined ? { loop_beats: d.loop_beats } : {}),
      ...(quelle === 'cypher' ? { stumm: true } : {}),
    }]);
  }

  async text(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['platz', 'text']);
    const platz = platzVon(d);
    if (typeof d.text !== 'string') ungueltig('text: the pattern text expected');
    this.ki(quelle);
    this.brauchLive();
    const folgen = leseFolgeText(d.text as string, takteProLive(this.zugang.offen()?.projekt.taktart));
    if (!Array.isArray(folgen)) throw new ProjFehler(400, folgen.grund, { text: folgen.text });
    return this.schreibe(platz, quelle, `SEQ ${platz}: text`, (p) => folgeBefehle(p, this.brauchDeck(p, platz).id, folgen,
      { stumm: quelle === 'cypher', geraetInfo: (g) => this.info(g) }));
  }

  async befehle(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['platz', 'label', 'befehle']);
    const platz = platzVon(d);
    if (!Array.isArray(d.befehle) || d.befehle.length === 0 || d.befehle.length > BEFEHLE_MAX) ungueltig(`befehle: a list of 1..${BEFEHLE_MAX} commands expected`);
    if (d.label !== undefined && typeof d.label !== 'string') ungueltig('label: text expected');
    this.ki(quelle);
    this.brauchLive();
    const label = (d.label as string | undefined) ?? `SEQ ${platz}: edit`;
    return this.schreibe(platz, quelle, label, (p) => this.pruefeBefehle(p, this.brauchDeck(p, platz), d.befehle as unknown[]));
  }

  // The rule of POST /seq/befehle, checked against the project as it is when the write runs: only the commands of FELDER with their fields; a track id must be
  // a track of the deck group, a clip id a clip of such a track; clip_neu only at beat 0 over the region (64 beats, or 16 bars of the project meter, or the stored 64); a track keeps a pattern name that is unique in the deck.
  // A noten_neu whose note equals one that is already there (clip, beat to 1e-6, pitch) is dropped: a click on a cell the other writer just filled would double it.
  private pruefeBefehle(p: Projekt, g: Gruppe, liste: unknown[]): Befehl[] {
    const spuren = p.spuren.filter((s) => s.ausgang?.id === g.id);
    const spurVon = (id: unknown): Spur => {
      const s = spuren.find((x) => x.id === id);
      if (!s) return ungueltig(`spur_id ${String(id)} is no pattern of this SEQ deck`);
      return s;
    };
    const clipVon = (id: unknown): { spur: Spur; clip: Spur['clips'][number] } => {
      for (const spur of spuren) { const clip = spur.clips.find((c) => c.id === id); if (clip) return { spur, clip }; }
      return ungueltig(`clip_id ${String(id)} is no clip of a pattern of this SEQ deck`);
    };
    const beatsText = seqRegion(p) === SEQ_BEATS ? `${SEQ_BEATS} beats` : `${seqRegion(p)} beats (or ${SEQ_BEATS})`;
    const aus: Befehl[] = [];
    liste.forEach((b, i) => {
      if (b === null || typeof b !== 'object' || Array.isArray(b)) ungueltig(`befehle[${i}]: a command object expected`);
      const c = b as Befehl;
      const name = c.befehl;
      if (typeof name !== 'string' || !Object.hasOwn(FELDER, name)) ungueltig(`befehle[${i}]: the command ${String(name)} is not allowed here (${Object.keys(FELDER).join(', ')})`);
      for (const k of Object.keys(c)) if (k !== 'befehl' && !FELDER[name as string].includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { detail: `befehle[${i}].${k}` });
      if (SPUR_BEFEHLE.includes(name as string)) spurVon(c.spur_id);
      let clipDa: { spur: Spur; clip: Spur['clips'][number] } | null = null;
      if (CLIP_BEFEHLE.includes(name as string)) clipDa = clipVon(c.clip_id);
      if (name === 'clip_neu' && (c.art !== 'midi' || c.start_beat !== 0 || !seqLaengeOk(p, c.laenge_beats as number))) {
        ungueltig(`befehle[${i}]: a pattern clip is a MIDI clip from beat 0 over ${beatsText}`);
      }
      if (name === 'spur_aendern' && typeof c.name === 'string' && spuren.some((s) => s.id !== c.spur_id && s.name.toLowerCase() === (c.name as string).trim().toLowerCase())) {
        ungueltig(`befehle[${i}]: the deck already has a pattern called ${c.name} (names are unique, ignoring case)`);
      }
      if (name === 'noten_neu' && Array.isArray(c.noten) && clipDa && clipDa.clip.art === 'midi') {
        const da = clipDa.clip.noten;
        const neu = c.noten.filter((n) => !(n !== null && typeof n === 'object' && typeof (n as { beat?: unknown }).beat === 'number'
          && da.some((x) => x.ton === (n as { ton?: unknown }).ton && Math.abs(x.beat - (n as { beat: number }).beat) <= NOTEN_BEAT_EPS)));
        if (neu.length === 0) return;
        aus.push(neu.length === c.noten.length ? c : { ...c, noten: neu });
        return;
      }
      aus.push(c);
    });
    return aus;
  }

  // --- SEQ scenes -----------------------------------------------------------------------------------------------------------------------------

  private muster(p: Projekt): Spur[] { return (p.gruppen ?? []).filter((g) => g.seq).flatMap((g) => seqFolgen(p, g).map((f) => f.spur)); }

  // The slots as counts, the slot whose picture equals the current M buttons (first one; patterns that are not in the scene do not count; a scene without a
  // living pattern is never lit), and the launch that waits for its bar.
  szenenStand(): Antwort {
    const o = this.zugang.offen();
    const leer = Array.from({ length: SZENEN_SLOTS }, () => null as { an: number; aus: number } | null);
    const wartet = this.wartet ? { slot: this.wartet.slot, ziel_beat: this.wartet.ziel_beat } : null;
    if (!o?.projekt.live) return { code: 200, j: { szenen: leer, aktiv: null, wartet } };
    const p = o.projekt;
    const jetzt = szeneAusMutes(p);
    const an = new Set(jetzt.an), aus = new Set(jetzt.aus);
    let aktiv: number | null = null;
    const szenen = leer.map((_, i) => {
      const s = p.szenen?.[i];
      if (!s) return null;
      const lebend = [...s.an, ...s.aus].filter((id) => an.has(id) || aus.has(id));
      if (aktiv === null && lebend.length > 0 && s.an.every((id) => !aus.has(id)) && s.aus.every((id) => !an.has(id))) aktiv = i;
      return { an: s.an.length, aus: s.aus.length };
    });
    return { code: 200, j: { szenen, aktiv, wartet } };
  }

  async szene(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['slot', 'aktion']);
    const slot = d.slot;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= SZENEN_SLOTS) ungueltig(`slot: integer 0..${SZENEN_SLOTS - 1} expected`);
    if (d.aktion !== 'speichern' && d.aktion !== 'loeschen' && d.aktion !== 'starten') ungueltig('aktion: speichern, loeschen or starten expected');
    this.ki(quelle);
    this.brauchLive();
    const n = slot as number;
    if (d.aktion === 'speichern') {
      return this.schreibeSzene(quelle, `SEQ scene ${n + 1}: save`, (p) => {
        if (!(p.gruppen ?? []).some((g) => g.seq)) throw new ProjFehler(409, 'szene_leer', { text: 'no SEQ deck: there is nothing to save' });
        const s = szeneAusMutes(p);
        return [{ befehl: 'szene_speichern', slot: n, an: s.an, aus: s.aus }];
      });
    }
    if (d.aktion === 'loeschen') return this.schreibeSzene(quelle, `SEQ scene ${n + 1}: clear`, () => [{ befehl: 'szene_loeschen', slot: n }]);
    return this.starte(n, quelle);
  }

  // Launch: the mute rows of the saved picture go to the core as parts with ONE shared ab_beat (the next bar), plan `szene`. The project model changes when the
  // core has executed them (nachQuittung), not now: an M click or an undo in the window does not cancel the scene, it executes and overwrites.
  private starte(slot: number, quelle: Quelle): Promise<Antwort> {
    const lauf = this.kette.then(async (): Promise<Antwort> => {
      const o = this.brauchLive();
      const s = o.projekt.szenen?.[slot];
      if (!s) throw new ProjFehler(409, 'szene_leer_slot', { slot, text: `slot ${slot + 1} holds no scene` });
      const zeilen = this.muster(o.projekt).flatMap((sp) => (s.an.includes(sp.id) ? [{ pfad: `spur/${sp.nr}/mute`, wert: 0 }]
        : s.aus.includes(sp.id) ? [{ pfad: `spur/${sp.nr}/mute`, wert: 1 }] : []));
      const weg = this.o.szenen;
      const lage = weg ? weg.zielLage(o.projekt.loop) : null;
      const ziel = lage ? szenenZielBeat({ ...lage, taktart: o.projekt.taktart }) : null;
      const label = `SEQ scene ${slot + 1}: launch`;
      const marke = ++this.marke;                                      // a launch replaces a waiting one: its receipts no longer count
      if (!weg || ziel === null || zeilen.length === 0) {              // transport stopped (or nothing to wait for): apply at once
        const war = this.wartet !== null;
        if (weg && war) await this.bricheTeileAb(weg, quelle);         // last press wins: the earlier scene's open parts must not fire after this one
        this.wartet = null;
        if (war) this.ctx.verteile({ a: 'seq', f: { szene: true } });
        return this.schreibeKern(quelle, label, () => [{ befehl: 'szene_anwenden', slot, an: s.an, aus: s.aus }]);
      }
      if (this.wartet) await weg.abbruchPlan(SZENEN_PLAN, quelle);     // last press wins: the first scene must not fire after the second
      this.wartet = { slot, ziel_beat: ziel, marke, quelle };
      this.ctx.verteile({ a: 'seq', f: { szene: true } });
      weg.szenenTeile(SZENEN_PLAN, quelle, ziel, zeilen).then((r) => this.nachQuittung(marke, slot, s, quelle, label, r), (e: Error) => {
        this.ctx.log({ typ: 'seq_szene_fehler', fehler: e.message });
        this.beendeWartet(marke);
      });
      return { code: 200, j: { ok: true, wartet: { slot, ziel_beat: ziel } } };
    });
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }

  // The final receipts of one launch (matched by message id by the core side). Executed at least once (the rest may be refused: the model is the picture of the
  // scene and the next regler write re-syncs the rows): ONE szene_anwenden with the picture captured at the press, on the project as it is now. Nothing executed: only the waiting state ends.
  private nachQuittung(marke: number, slot: number, bild: Szene, quelle: Quelle, label: string, r: { id: number; status: number }[]): void {
    if (marke !== this.marke) return;                                  // replaced, cleared (stop, new core) or answered already
    const lauf = this.kette.then(async () => {
      if (marke !== this.marke) return;
      if (r.some((x) => AUSGEFUEHRT.has(x.status))) {
        try { await this.schreibeKern(quelle, label, () => [{ befehl: 'szene_anwenden', slot, an: bild.an, aus: bild.aus }]); } catch (e) {
          this.ctx.log({ typ: 'seq_szene_fehler', fehler: e instanceof Error ? e.message : String(e) });
        }
      }
      this.beendeWartet(marke);
    });
    this.kette = lauf.catch(() => undefined);
  }

  private async bricheTeileAb(weg: SzenenWeg, quelle: Quelle): Promise<void> {
    try { await weg.abbruchPlan(SZENEN_PLAN, quelle); } catch (e) { this.ctx.log({ typ: 'seq_szene_fehler', fehler: e instanceof Error ? e.message : String(e) }); }
  }

  private beendeWartet(marke?: number): void {
    if (!this.wartet || (marke !== undefined && marke !== this.marke)) return;
    this.wartet = null;
    this.marke++;
    this.ctx.verteile({ a: 'seq', f: { szene: true } });
  }

  // Kern events (server.ts calls this through the router hook): a stopped transport or a new core generation ends the waiting launch without a model write.
  ereignis(adresse: string, f: Record<string, unknown>): void {
    if (adresse === '/zustand/arr' && Number(f.status) !== 2) {          // stopped transport: the core still holds the parts, abort them too
      const w = this.wartet, weg = this.o.szenen;
      this.beendeWartet();
      if (w && weg) void this.bricheTeileAb(weg, w.quelle);
    }
    if (adresse === '/zustand/kern' || adresse === '/e/neustart' || adresse === '/k/willkommen') {
      const g = Number(f.generation);
      if (Number.isFinite(g)) {
        if (this.generation !== null && g !== this.generation) this.beendeWartet();
        this.generation = g;
      }
    }
  }

  private ki(quelle: Quelle): void { if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt'); }
  private brauchLive(): NonNullable<ReturnType<ProjZugang['offen']>> {
    const o = this.zugang.offen();
    if (!o || !o.projekt.live) throw new ProjFehler(409, 'kein_liveprojekt');
    return o;
  }
  private brauchDeck(p: Projekt, platz: number): Gruppe {
    const g = seqGruppe(p, platz);
    if (!g?.seq) throw new ProjFehler(409, 'seq_fehlt', { platz, text: `place ${platz} holds no SEQ deck` });
    return g;
  }

  // The stale-track eject of a deck a write just created; whatever it does, the write has succeeded
  private aufraeumen(platz: number, quelle: Quelle): void {
    try { this.o.deckAufraeumen?.(platz, quelle); } catch { /* the page server logs a failed unload; it is no error of the write */ }
  }

  // One write in the queue: the commands are planned from the project as it is when the write's turn comes (plan is synchronous); rev_veraltet is retried once.
  // A list that comes out empty writes nothing and answers the current state.
  private schreibe(platz: number, quelle: Quelle, label: string, plane: (p: Projekt) => Befehl[]): Promise<Antwort> {
    const lauf = this.kette.then(async (): Promise<Antwort> => {
      for (let versuch = 0; ; versuch++) {
        const o = this.brauchLive();
        let befehle: Befehl[];
        try { befehle = plane(o.projekt); } catch (e) {
          if (e instanceof SeqFehler) throw new ProjFehler(400, e.grund, { text: e.message });
          throw e;
        }
        const vorher = seqGruppe(o.projekt, platz)?.id ?? '';
        if (befehle.length === 0) return { code: 200, j: { rev: o.projekt.rev, projekt: o.projekt, gruppe_id: vorher, ohne_aenderung: true } };
        let a: Antwort;
        try { a = await this.zugang.aendern({ rev: o.projekt.rev, label, befehle }, quelle); } catch (e) {
          if (versuch === 0 && e instanceof ProjFehler && e.fehler === 'rev_veraltet') continue;
          throw e;
        }
        if (a.code !== 200) return a;
        const j = a.j as { rev: number; projekt: Projekt };
        this.ctx.verteile({ a: 'seq', f: { platz, rev: j.rev } });
        return { code: 200, j: { ...j, gruppe_id: seqGruppe(j.projekt, platz)?.id ?? vorher } };
      }
    });
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }

  // The write of a scene command (no deck place): the body of one turn in the queue; rev_veraltet is retried once. Answers like schreibe, event {szene, rev}.
  private async schreibeKern(quelle: Quelle, label: string, plane: (p: Projekt) => Befehl[]): Promise<Antwort> {
    for (let versuch = 0; ; versuch++) {
      const o = this.brauchLive();
      const befehle = plane(o.projekt);
      let a: Antwort;
      try { a = await this.zugang.aendern({ rev: o.projekt.rev, label, befehle }, quelle); } catch (e) {
        if (versuch === 0 && e instanceof ProjFehler && e.fehler === 'rev_veraltet') continue;
        throw e;
      }
      if (a.code !== 200) return a;
      const j = a.j as { rev: number };
      this.ctx.verteile({ a: 'seq', f: { szene: true, rev: j.rev } });
      return a;
    }
  }
  private schreibeSzene(quelle: Quelle, label: string, plane: (p: Projekt) => Befehl[]): Promise<Antwort> {
    const lauf = this.kette.then(() => this.schreibeKern(quelle, label, plane));
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }
}

export function seqRouten(ctx: BereichKontext, s: SeqBereich): Route[] {
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  const post = (pfad: string, f: (d: Record<string, unknown>, q: Quelle) => Promise<Antwort>): Route => ({
    methode: 'POST', pfad, schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                             // before the await (pattern of the module routes)
      await antworte(r, async () => f(await leseKoerper(q), quelle));
    } });
  return [
    post('/seq/anlegen', (d, q) => s.anlege(d, q)),
    post('/seq/leeren', (d, q) => s.leere(d, q)),
    post('/seq/modul', (d, q) => s.modul(d, q)),
    post('/seq/folge', (d, q) => s.folge(d, q)),
    post('/seq/befehle', (d, q) => s.befehle(d, q)),
    post('/seq/text', (d, q) => s.text(d, q)),
    post('/seq/szene', (d, q) => s.szene(d, q)),
    { methode: 'GET', pfad: '/seq/szenen', schutz: 'offen', handler: async (_q, r) => antworte(r, () => s.szenenStand()) },
    { methode: 'GET', pfad: '/seq/stand', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => s.stand({ zellen: url.searchParams.get('zellen') === '1' })) },
    { methode: 'GET', pfad: '/seq/geraet', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => s.geraet(url.searchParams.get('spur_id'))) },
  ];
}
