// SEQ deck v2, task 3 (spec 2026-11-14-seq-deck-design, sections 5, 7 and 9): the routes of a SEQ deck. A deck is a top group of the live container, a pattern an
// instrument track that plays into it with one MIDI clip; every write is a list of ordinary project commands.
//   POST /seq/anlegen {platz}                          builds the deck of a place (seq_anlegen)
//   POST /seq/leeren {platz}                           removes the deck and its tracks (seq_leeren)
//   POST /seq/folge {platz, name, geraet, loop_beats?} makes one pattern (seq_folge_neu); `geraet` is `bk:<graph>`, `kit:<kit>`, `rb338` or a device object;
//                                                      from Cypher the pattern is made muted
//   POST /seq/befehle {platz, label?, befehle}         a command list of the page, one gesture = one undo step; only the commands below, each on a track of the
//                                                      deck or a clip of such a track, only the fields below
//   POST /seq/text {platz, text}                       one or several patterns as text (seq_text.ts); one write, one undo step, all or nothing
//   GET  /seq/stand[?zellen=1]                         (`zellen=1` adds `zellen`, one char per cell, to the note rows) {"1": null | {gruppe_id, folgen: [{spur_id, clip_id, name, geraet, stumm, editierbar, laenge_beats, zeilen, text}]}, ...}
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
import { seqFolgen, seqGruppe } from '../../project/seq.ts';
import type { Geraet, Gruppe, Projekt, Spur } from '../../project/model.ts';
import { bandVon, folgeBefehle, geraetText, geraetVonText, leseFolgeText, schreibeFolgeText, type Befehl, type FolgeInfo } from '../../project/seq_text.ts';
import { SeqFehler, folgeSicht, musterLaenge, reglerSchluessel } from '../../public/seq_logic.js';
import { parameterTabelle } from '../../devices_parameter.ts';
import { TROMMEL_KARTEN } from '../../project/trommel_map.ts';
import { kitKlaenge } from '../proj/kits.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';

type Quelle = 'andreas' | 'cypher';
export interface SeqOptionen {
  deckLaeuft?(platz: number): boolean;      // does deck N play (server.ts); absent = no deck plays
  geraetInfo?(g: Geraet | undefined): FolgeInfo;   // tests inject the instrument description; absent = the graph folder and the kit folder
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

// What the text and the page need to know about an instrument: the knobs with names and start positions, the sounds of a kit. Sources without HTTP: the
// parameter table of the device (the one GET /graphen/panel and the device panels are built from; names are the `label`s) and the kit file (as GET /proj/kits
// reads it; it lists only the number of sounds, the names come from kit.json). bk knobs carry their number as `nr`, the RB-338 targets their name.
export function geraetInfo(g: Geraet | undefined): FolgeInfo {
  if (g?.art === 'intern' && g.name === 'bk') {
    return { art: 'bk', klaenge: [...(TROMMEL_KARTEN[g.graph] ?? [])], regler: parameterTabelle({ art: 'bk', graph: g.graph })
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
  constructor(ctx: BereichKontext, zugang: ProjZugang, o: SeqOptionen = {}) { this.ctx = ctx; this.zugang = zugang; this.o = o; }

  private info(g: Geraet | undefined): FolgeInfo { return (this.o.geraetInfo ?? geraetInfo)(g); }

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
      return { ...kopf, clip_id: clip?.id ?? null, laenge_beats: musterLaenge(clip), zeilen, text: schreibeFolgeText(spur, clip, info) };
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
    return this.schreibe(platz, quelle, `SEQ ${platz}: create`, () => [{ befehl: 'seq_anlegen', platz }]);
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
    const folgen = leseFolgeText(d.text as string);
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
  // a track of the deck group, a clip id a clip of such a track; clip_neu only at beat 0 over 64 beats; a track keeps a pattern name that is unique in the deck.
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
    const aus: Befehl[] = [];
    liste.forEach((b, i) => {
      if (b === null || typeof b !== 'object' || Array.isArray(b)) ungueltig(`befehle[${i}]: a command object expected`);
      const c = b as Befehl;
      const name = c.befehl;
      if (typeof name !== 'string' || !(name in FELDER)) ungueltig(`befehle[${i}]: the command ${String(name)} is not allowed here (${Object.keys(FELDER).join(', ')})`);
      for (const k of Object.keys(c)) if (k !== 'befehl' && !FELDER[name as string].includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { detail: `befehle[${i}].${k}` });
      if (SPUR_BEFEHLE.includes(name as string)) spurVon(c.spur_id);
      let clipDa: { spur: Spur; clip: Spur['clips'][number] } | null = null;
      if (CLIP_BEFEHLE.includes(name as string)) clipDa = clipVon(c.clip_id);
      if (name === 'clip_neu' && (c.art !== 'midi' || c.start_beat !== 0 || c.laenge_beats !== 64)) {
        ungueltig(`befehle[${i}]: a pattern clip is a MIDI clip from beat 0 over 64 beats`);
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
    post('/seq/folge', (d, q) => s.folge(d, q)),
    post('/seq/befehle', (d, q) => s.befehle(d, q)),
    post('/seq/text', (d, q) => s.text(d, q)),
    { methode: 'GET', pfad: '/seq/stand', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => s.stand({ zellen: url.searchParams.get('zellen') === '1' })) },
    { methode: 'GET', pfad: '/seq/geraet', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => s.geraet(url.searchParams.get('spur_id'))) },
  ];
}
