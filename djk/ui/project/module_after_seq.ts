// A Workbench module becomes a SEQ deck of the DJ view (landkarte 2026-11-17, slice A): one pattern per instrument track, same instrument,
// same notes, same knob values. A pure function in the pattern of setzeModulEin (module_storage.ts) and baueModul
// (live.ts): it runs ordinary project commands one after the other on
// a copy of the open live container and returns the new project plus a report, or throws NachSeqFehler (all or nothing; the caller stores one undo step).
// Carried: instrument (device with its knob values), notes with chance/wdh/versatz, the `seq` view, the knob lanes, row settings, fader, pan, mute
// (solo never: it would silence the other decks).
// Not carried (counted in the report): sends, inserts, master inserts, returns, groups, chain automation, the key, audio tracks, tracks whose
// instrument is not an internal one (host, plugin, rack). A clip longer than 64 beats comes along up to beat 64.
// TO DJ (task 24, D23): with `o.abschnitt_id` ANY open project is the source and one section of it (the tracker's section list, or the default one) goes:
// per internal instrument track that has something in the section window, one pattern of the section length (at most 64 beats) with the notes
// (platz, spalte, versatz kept), the effect commands `fx` and the envelope points of the window, beats relative to the section start, notes cut at its
// end. Tracks with nothing in the window stay out (reported). Too long a section, too many Baukasten tracks: refused, nothing partial. The source
// project is never changed. Playback frame: a pattern with `fx` or `platz` makes the deck remember lpb and ticks of the source (Gruppe.seq).
import { fuehreListeAus } from './commands.ts';
import { istKettenZiel, MAX_BK_SPUREN, type FxEintrag, type Geraet, type Herkunft, type MidiClip, type Note, type Projekt, type Spur } from './model.ts';
import { SEQ_BEATS, seqGruppe } from './seq.ts';
import { abschnitte, trackerEinstellung } from '../public/tracker/grid_model.js';

export type BefehlsKontext = NonNullable<Parameters<typeof fuehreListeAus>[1]>;
export interface NachSeqBericht {
  platz: number; deck_neu: boolean;
  patterns: { name: string; spur_id: string; quelle_spur: string }[];
  weggelassen: {
    sends: number; inserts: number; master_inserts: number; returns: number; gruppen: number; kettenautomation: number; tonart: boolean;
    spuren_uebersprungen: { name: string; grund: string }[]; gekuerzt: { name: string; noten: number; punkte: number }[];
  };
  abschnitt?: { id: string; nr: number; von_beat: number; laenge_beats: number };   // TO DJ only
}
// A refusal of the function itself (not of a command): the reason name is one of http/reasons.ts
export class NachSeqFehler extends Error {
  readonly code: number; readonly fehler: string; readonly extra: Record<string, unknown>;
  constructor(code: number, fehler: string, extra: Record<string, unknown> = {}) { super(fehler); this.code = code; this.fehler = fehler; this.extra = extra; }
}
const NAME_MAX = 80;

// a track that can come along: an instrument track with an internal device (Baukasten, kit, RB-338)
const grundOhne = (s: Spur): string | null => (s.art !== 'instrument' ? 'audio track' : s.geraet?.art !== 'intern' ? 'host, plugin or rack instrument' : null);
const ersterMidi = (s: Spur): MidiClip | undefined => s.clips.find((c): c is MidiClip => c.art === 'midi');
const kettenLanen = (x: { automation?: { ziel: string }[] }): number => (x.automation ?? []).filter((l) => istKettenZiel(l.ziel)).length;

const EPS = 1e-9;
const rund = (x: number): number => Math.round(x * 1e9) / 1e9;
const zwei = (n: number): string => String(n).padStart(2, '0');
type Kurve = { ziel: string; punkte: { beat: number; wert: number; form?: string }[]; verknuepft?: boolean; loop_beats?: number };
type NotenOhneId = Omit<Note, 'id'>;
// what one source track hands to a pattern
interface Inhalt {
  loop?: number; noten: NotenOhneId[]; kurven: Kurve[]; fx: FxEintrag[]; seq?: unknown; zeilen?: Record<string, unknown>;
  kurz?: { noten: number; punkte: number };
}

// The window [von, bis) of a track as pattern content: the loop copies of every MIDI clip are unrolled for notes and effects (an envelope is taken as stored),
// beats are relative to `von`, a note is cut at the window end, at the end of its clip copy.
function fensterInhalt(s: Spur, von: number, bis: number): Inhalt {
  const noten: NotenOhneId[] = [], fx = new Map<string, FxEintrag>(), kurven = new Map<string, Kurve>();
  for (const c of s.clips) {
    if (c.art !== 'midi') continue;
    const ende = c.start_beat + c.laenge_beats;
    if (ende <= von + EPS || c.start_beat >= bis - EPS) continue;
    const loop = c.loop_beats ?? null;
    const kopien = loop === null ? 1 : Math.ceil(c.laenge_beats / loop - EPS);
    for (let k = 0; k < kopien; k++) {
      const basis = loop === null ? c.start_beat : c.start_beat + k * loop;
      const kopieEnde = Math.min(loop === null ? ende : basis + loop, ende);
      const drin = (abs: number): boolean => abs < kopieEnde - EPS && abs >= von - EPS && abs < bis - EPS;
      for (const n of c.noten) {
        const abs = basis + n.beat;
        if ((loop !== null && !(n.beat < loop)) || !drin(abs)) continue;
        const { id: _id, ...rest } = n;
        noten.push({ ...rest, beat: rund(abs - von), laenge: rund(Math.min(n.laenge, kopieEnde - abs, bis - abs)) });
      }
      for (const e of c.fx ?? []) {
        const abs = basis + e.beat;
        if ((loop !== null && !(e.beat < loop)) || !drin(abs)) continue;
        const r = rund(abs - von);
        fx.set(`${r}/${e.spalte}`, { ...e, beat: r });
      }
    }
    for (const h of c.huellkurven ?? []) {
      const pk = h.punkte.filter((q) => c.start_beat + q.beat >= von - EPS && c.start_beat + q.beat < bis - EPS && c.start_beat + q.beat < ende - EPS)
        .map((q) => ({ ...q, beat: rund(c.start_beat + q.beat - von) }));
      if (pk.length === 0) continue;
      const alt = kurven.get(h.ziel);
      if (alt) alt.punkte.push(...pk); else kurven.set(h.ziel, { ziel: h.ziel, punkte: pk, ...(h.verknuepft === false ? { verknuepft: false } : {}) });
    }
  }
  for (const k of kurven.values()) k.punkte.sort((a, b) => a.beat - b.beat);
  return { noten: noten.sort((a, b) => a.beat - b.beat), kurven: [...kurven.values()],
    fx: [...fx.values()].sort((a, b) => a.beat - b.beat || a.spalte - b.spalte) };
}
// a workbench track: the first MIDI clip up to beat 64, as before
function modulInhalt(s: Spur): Inhalt {
  const clip = ersterMidi(s);
  const lang = clip !== undefined && clip.laenge_beats > SEQ_BEATS;
  const vor = (b: number): boolean => !lang || b < SEQ_BEATS;
  const noten = (clip?.noten ?? []).filter((n) => vor(n.beat)).map(({ id: _id, ...rest }) => rest);
  let punkte = 0;
  const kurven = (clip?.huellkurven ?? []).flatMap((h) => {
    const pk = h.punkte.filter((q) => vor(q.beat));
    punkte += h.punkte.length - pk.length;
    if (pk.length === 0) return [];
    return [{ ziel: h.ziel, punkte: pk, ...(h.verknuepft === false ? { verknuepft: false } : {}),
      ...(h.loop_beats !== undefined ? { loop_beats: Math.min(h.loop_beats, SEQ_BEATS) } : {}) }];
  });
  const kurz = lang && (noten.length < (clip?.noten.length ?? 0) || punkte > 0) ? { noten: (clip?.noten.length ?? 0) - noten.length, punkte } : undefined;
  return { ...(clip === undefined ? {} : { loop: Math.min(clip.loop_beats ?? clip.laenge_beats, SEQ_BEATS) }), noten, kurven, fx: [],
    ...(clip?.seq !== undefined ? { seq: clip.seq } : {}), ...(clip?.zeilen !== undefined ? { zeilen: clip.zeilen } : {}), ...(kurz ? { kurz } : {}) };
}
const hatBk = (s: Spur): boolean => s.geraet?.art === 'intern' && s.geraet.name === 'bk';
const braucht = (i: Inhalt): boolean => i.fx.length > 0 || i.noten.some((n) => n.platz !== undefined);

// `platz`: 1..4; `quelle`: who gives the commands; `abschnitt_id`: TO DJ, see the head of the file. The deck of the place is created when there is none;
// otherwise the patterns are added muted.
export function setzeModulNachSeq(p0: Projekt, modul: Projekt, platz: number, o: { kontext?: BefehlsKontext; quelle?: Herkunft; abschnitt_id?: string } = {}):
  { projekt: Projekt; bericht: NachSeqBericht } {
  if (!p0.live) throw new NachSeqFehler(409, 'kein_liveprojekt');
  const ab = o.abschnitt_id;
  if (ab === undefined && modul.werkbank?.schema !== 1) throw new NachSeqFehler(409, 'kein_werkbank');
  if (!Number.isInteger(platz) || platz < 1 || platz > 4) throw new NachSeqFehler(400, 'argument_ungueltig', { text: 'platz: integer 1..4 expected' });
  const uebersprungen: { name: string; grund: string }[] = [];
  const spuren: Spur[] = [];
  for (const s of modul.spuren) {
    const g = grundOhne(s);
    if (g === null) spuren.push(s); else uebersprungen.push({ name: s.name, grund: g });
  }
  let abschnitt: NachSeqBericht['abschnitt'];
  const inhalt = new Map<Spur, Inhalt>();
  if (ab === undefined) {
    for (const s of spuren) inhalt.set(s, modulInhalt(s));
  } else {
    const a = abschnitte(modul).find((x: { id: string }) => x.id === ab);
    if (!a) throw new NachSeqFehler(404, 'abschnitt_unbekannt', { text: `no section ${ab} in this project` });
    const rahmen0 = trackerEinstellung(modul) as { lpb: number };
    abschnitt = { id: a.id, nr: a.nr, von_beat: a.von_beat, laenge_beats: a.laenge_beats };
    if (a.laenge_beats > SEQ_BEATS + EPS) {
      throw new NachSeqFehler(409, 'abschnitt_zu_lang', {
        text: `section ${zwei(a.nr)} is ${rund(a.laenge_beats)} beats long, a SEQ deck takes at most ${SEQ_BEATS}` });
    }
    if (Math.abs(a.laenge_beats * 8 - Math.round(a.laenge_beats * 8)) > EPS) {
      throw new NachSeqFehler(409, 'abschnitt_zu_lang', {
        text: `section ${zwei(a.nr)} is ${rund(a.laenge_beats)} beats long, a SEQ pattern takes a multiple of 0.125 beat` });
    }
    for (const s of spuren) {
      const i = fensterInhalt(s, a.von_beat, a.von_beat + a.laenge_beats);
      // the SEQ grid is 1/8 beat: rows at 3, 6 or 12 per beat do not sit on it, and a quantised copy would play another rhythm
      const schief = i.noten.find((n) => Math.abs(n.beat * 8 - Math.round(n.beat * 8)) > EPS);
      if (schief) {
        throw new NachSeqFehler(409, 'seq_raster_ungleich', { text: `section ${zwei(a.nr)} runs at ${rahmen0.lpb} rows per beat, track ${s.name} has a note at `
          + `beat ${rund(schief.beat)} that is not on the 1/8-beat grid of a SEQ deck: set the section to 2, 4, 8 or 16 rows per beat first` });
      }
      if (i.noten.length + i.kurven.length + i.fx.length > 0) inhalt.set(s, { ...i, loop: a.laenge_beats });
      else uebersprungen.push({ name: s.name, grund: `nothing in section ${zwei(a.nr)}` });
    }
  }
  const dabei = ab === undefined ? spuren : spuren.filter((s) => inhalt.has(s));
  if (spuren.length === 0) {
    throw new NachSeqFehler(409, 'modul_ohne_instrument', {
      text: 'the module has no instrument track that a SEQ deck can play', spuren_uebersprungen: uebersprungen });
  }
  if (dabei.length === 0) {
    throw new NachSeqFehler(409, 'abschnitt_leer', { spuren_uebersprungen: uebersprungen,
      text: `section ${zwei(abschnitt!.nr)} holds no notes, envelope points or effects on an instrument track a SEQ deck can play` });
  }
  if (ab !== undefined) {
    const vorhanden = p0.spuren.filter(hatBk).length, neu = dabei.filter(hatBk).length;
    if (vorhanden + neu > MAX_BK_SPUREN) {
      throw new NachSeqFehler(409, 'zu_viele_bk', { vorhanden, neu, text:
        `the live project holds ${vorhanden} Cypher Modular tracks and the section brings ${neu}, at most ${MAX_BK_SPUREN} are possible` });
    }
  }
  const kontext: BefehlsKontext = { ...(o.kontext ?? {}), quelle: o.quelle ?? 'andreas' };
  const lauf = (p: Projekt, b: Record<string, unknown>): Projekt => fuehreListeAus(p, [b], kontext).projekt;
  let p = p0;
  const deckNeu = seqGruppe(p, platz) === undefined;
  if (deckNeu) p = lauf(p, { befehl: 'seq_anlegen', platz });
  const gruppeId = seqGruppe(p, platz)!.id;
  const belegt = new Set(p.spuren.filter((s) => s.ausgang?.id === gruppeId).map((s) => s.name.toLowerCase()));
  const kette0 = kettenLanen(modul.master) + modul.gruppen.reduce((n, g) => n + kettenLanen(g), 0);
  const bericht: NachSeqBericht = { platz, deck_neu: deckNeu, patterns: [], weggelassen: {
    sends: 0, inserts: 0, master_inserts: modul.master.inserts?.length ?? 0, returns: modul.returns?.length ?? 0,
    gruppen: modul.gruppen.length, kettenautomation: kette0,
    tonart: modul.tonart !== undefined, spuren_uebersprungen: uebersprungen, gekuerzt: [] }, ...(abschnitt ? { abschnitt } : {}) };
  const w = bericht.weggelassen;
  const rahmen = trackerEinstellung(modul) as { lpb: number; ticks: number };
  for (const s of dabei) {
    w.sends += s.sends?.length ?? 0; w.inserts += s.inserts?.length ?? 0; w.kettenautomation += kettenLanen(s);
    const i = inhalt.get(s)!;
    let name = s.name.slice(0, NAME_MAX);
    for (let n = 2; belegt.has(name.toLowerCase()); n++) name = `${s.name.slice(0, NAME_MAX - ` ${n}`.length)} ${n}`;
    belegt.add(name.toLowerCase());
    if (i.kurz) w.gekuerzt.push({ name, ...i.kurz });
    p = lauf(p, { befehl: 'seq_folge_neu', gruppe_id: gruppeId, name, geraet: structuredClone(s.geraet as Geraet),
      ...(i.loop !== undefined ? { loop_beats: i.loop } : {}),
      ...(i.noten.length > 0 ? { noten: i.noten } : {}), ...(i.seq !== undefined ? { seq: structuredClone(i.seq) } : {}),
      ...(i.kurven.length > 0 ? { huellkurven: i.kurven } : {}),
      ...(i.fx.length > 0 ? { fx: i.fx } : {}), ...(ab !== undefined && braucht(i) ? { raster: { lpb: rahmen.lpb, ticks: rahmen.ticks } } : {}) });
    const neu = p.spuren[p.spuren.length - 1];
    for (const [ton, z] of Object.entries(i.zeilen ?? {})) {
      p = lauf(p, { befehl: 'zeile_setzen', clip_id: neu.clips[0].id, ton: Number(ton), ...(z as object) });
    }
    // a deck that already is there keeps what it sounds like: the added patterns arrive muted. Solo never comes along: in the live container
    // it would silence the other decks and the loop modules.
    p = lauf(p, { befehl: 'spur_aendern', spur_id: neu.id, fader_db: s.fader_db, pan: s.pan, mute: deckNeu ? s.mute : true, solo: false });
    bericht.patterns.push({ name, spur_id: neu.id, quelle_spur: s.id });
  }
  return { projekt: p, bericht };
}
