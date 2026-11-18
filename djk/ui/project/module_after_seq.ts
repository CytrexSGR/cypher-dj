// A Workbench module becomes a SEQ deck of the DJ view (landkarte 2026-11-17, slice A): one pattern per instrument track, same instrument,
// same notes, same knob values. A pure function in the pattern of setzeModulEin (module_storage.ts) and baueModul
// (live.ts): it runs ordinary project commands one after the other on
// a copy of the open live container and returns the new project plus a report, or throws NachSeqFehler (all or nothing; the caller stores one undo step).
// Carried: instrument (device with its knob values), notes with chance/wdh/versatz, the `seq` view, the knob lanes, row settings, fader, pan, mute
// (solo never: it would silence the other decks).
// Not carried (counted in the report): sends, inserts, master inserts, returns, groups, chain automation, the key, audio tracks, tracks whose
// instrument is not an internal one (host, plugin, rack). A clip longer than 64 beats comes along up to beat 64.
import { fuehreListeAus } from './commands.ts';
import { istKettenZiel, type Geraet, type Herkunft, type MidiClip, type Projekt, type Spur } from './model.ts';
import { SEQ_BEATS, seqGruppe } from './seq.ts';

export type BefehlsKontext = NonNullable<Parameters<typeof fuehreListeAus>[1]>;
export interface NachSeqBericht {
  platz: number; deck_neu: boolean;
  patterns: { name: string; spur_id: string; quelle_spur: string }[];
  weggelassen: {
    sends: number; inserts: number; master_inserts: number; returns: number; gruppen: number; kettenautomation: number; tonart: boolean;
    spuren_uebersprungen: { name: string; grund: string }[]; gekuerzt: { name: string; noten: number; punkte: number }[];
  };
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

// `platz`: 1..4; `quelle`: who gives the commands. The deck of the place is created when there is none; otherwise the patterns are added muted.
export function setzeModulNachSeq(p0: Projekt, modul: Projekt, platz: number, o: { kontext?: BefehlsKontext; quelle?: Herkunft } = {}):
  { projekt: Projekt; bericht: NachSeqBericht } {
  if (!p0.live) throw new NachSeqFehler(409, 'kein_liveprojekt');
  if (modul.werkbank?.schema !== 1) throw new NachSeqFehler(409, 'kein_werkbank');
  if (!Number.isInteger(platz) || platz < 1 || platz > 4) throw new NachSeqFehler(400, 'argument_ungueltig', { text: 'platz: integer 1..4 expected' });
  const uebersprungen: { name: string; grund: string }[] = [];
  const spuren: Spur[] = [];
  for (const s of modul.spuren) {
    const g = grundOhne(s);
    if (g === null) spuren.push(s); else uebersprungen.push({ name: s.name, grund: g });
  }
  if (spuren.length === 0) {
    throw new NachSeqFehler(409, 'modul_ohne_instrument', {
      text: 'the module has no instrument track that a SEQ deck can play', spuren_uebersprungen: uebersprungen });
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
    tonart: modul.tonart !== undefined, spuren_uebersprungen: uebersprungen, gekuerzt: [] } };
  const w = bericht.weggelassen;
  for (const s of spuren) {
    w.sends += s.sends?.length ?? 0; w.inserts += s.inserts?.length ?? 0; w.kettenautomation += kettenLanen(s);
    const clip = ersterMidi(s);
    let name = s.name.slice(0, NAME_MAX);
    for (let n = 2; belegt.has(name.toLowerCase()); n++) name = `${s.name.slice(0, NAME_MAX - ` ${n}`.length)} ${n}`;
    belegt.add(name.toLowerCase());
    const lang = clip !== undefined && clip.laenge_beats > SEQ_BEATS;
    const vor = (b: number): boolean => !lang || b < SEQ_BEATS;
    const noten = (clip?.noten ?? []).filter((n) => vor(n.beat));
    let punkte = 0;
    const kurven = (clip?.huellkurven ?? []).flatMap((h) => {
      const pk = h.punkte.filter((q) => vor(q.beat));
      punkte += h.punkte.length - pk.length;
      if (pk.length === 0) return [];
      return [{ ziel: h.ziel, punkte: pk, ...(h.verknuepft === false ? { verknuepft: false } : {}),
        ...(h.loop_beats !== undefined ? { loop_beats: Math.min(h.loop_beats, SEQ_BEATS) } : {}) }];
    });
    if (lang && (noten.length < (clip?.noten.length ?? 0) || punkte > 0)) w.gekuerzt.push({ name, noten: (clip?.noten.length ?? 0) - noten.length, punkte });
    const loop = clip === undefined ? undefined : Math.min(clip.loop_beats ?? clip.laenge_beats, SEQ_BEATS);
    p = lauf(p, { befehl: 'seq_folge_neu', gruppe_id: gruppeId, name, geraet: structuredClone(s.geraet as Geraet),
      ...(loop !== undefined ? { loop_beats: loop } : {}),
      ...(noten.length > 0 ? { noten: noten.map(({ id: _id, ...rest }) => rest) } : {}), ...(clip?.seq !== undefined ? { seq: structuredClone(clip.seq) } : {}),
      ...(kurven.length > 0 ? { huellkurven: kurven } : {}) });
    const neu = p.spuren[p.spuren.length - 1];
    for (const [ton, z] of Object.entries(clip?.zeilen ?? {})) p = lauf(p, { befehl: 'zeile_setzen', clip_id: neu.clips[0].id, ton: Number(ton), ...z });
    // a deck that already is there keeps what it sounds like: the added patterns arrive muted. Solo never comes along: in the live container
    // it would silence the other decks and the loop modules.
    p = lauf(p, { befehl: 'spur_aendern', spur_id: neu.id, fader_db: s.fader_db, pan: s.pan, mute: deckNeu ? s.mute : true, solo: false });
    bericht.patterns.push({ name, spur_id: neu.id, quelle_spur: s.id });
  }
  return { projekt: p, bericht };
}
