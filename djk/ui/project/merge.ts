// Paket 1.13 Slice 7 (G08, AK27): reine Merge-Rechnung. Plan und Ablehnungen (D6, D7, D9, D10), Regler-Datei des Renders (D3, D6), Wiedergabe-Ausschnitt (P5),
// der neue Stand (D5) und die Veraltet-Prüfung (D12). Kein fs, kein Prozess.
import { fuehreListeAus } from './commands.ts';
import { routingRegler } from './render.ts';
import { brauchtFreeze, istWirt } from './freeze.ts';
import { MAX_SPUREN, SAMPLERATE, herkunft, kanonisch, spurSicht, sucheSpur, type Herkunft, type Projekt, type Spur } from './model.ts';

// Das Pan-Gesetz der Spur (cos/sin über (pan+1)·π/4, arr_output.cpp:2, :26-33) senkt jeden Kanal bei Pan 0 um 20·log10(√2).
// Der Render enthält das Gesetz der Quellen schon; die neue Spur wendet es mit Pan 0 ein zweites Mal an.
// Dieser Gain am Clip hebt das auf (P2).
export const PAN_MITTE_DB = 20 * Math.log10(Math.SQRT2);
export const EPS = 1e-9;

export class MergeFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text: string) { super(text); this.grund = grund; }
}
const ab = (grund: string, text: string): never => { throw new MergeFehler(grund, text); };

export interface MergePlan {
  spurIds: string[]; von: number; bis: number; ausgang: string | null; index: number; name: string; solo: boolean; ausserhalb: boolean;
  tempo: number; sicht: string;
  sends: { id: string; db: number }[];   // slice 3: the sends all sources share (the new track takes them over)
}

// Alles, was den Klang der Quellen und ihren Platz bestimmt, ohne `dekodiert` (ein Dekodierzustand ändert den Klang nicht,
// sonst wäre jeder Merge "veraltet"), dazu Fader, Pan, Mute, Solo, Ziel und das Tempo (die WAV ist in Sekunden fest).
export function mergeSicht(p: Projekt, ids: string[]): string {
  return kanonisch({
    tempo: p.tempo_bpm,
    spuren: ids.map((id) => {
      const s = sucheSpur(p, id);
      if (!s) return null;
      const sicht = JSON.parse(JSON.stringify(spurSicht(s))) as { clips: Record<string, unknown>[] };
      for (const c of sicht.clips) delete c.dekodiert;
      return { sicht, fader_db: s.fader_db, pan: s.pan, mute: s.mute, solo: s.solo, ausgang: s.ausgang?.id ?? null, sends: sendsSortiert(s) };
    }),
  });
}

// slice 3: the sends of a track sorted by return id, so that two lists compare by content
export const sendsSortiert = (s: Spur): { id: string; db: number }[] => [...(s.sends ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function liegtAusserhalb(s: Spur, von: number, bis: number, tempo: number): boolean {
  if (s.clips.some((c) => c.start_beat < von - EPS || c.start_beat + c.laenge_beats > bis + EPS)) return true;
  if (!s.freeze) return false;
  const f0 = s.freeze.von_beat ?? 0, f1 = f0 + (s.freeze.frames / SAMPLERATE) * (tempo / 60);
  return f0 < von - EPS || f1 > bis + EPS;
}

// 1.14 slice 4 (bounce, spec D5): `opt.min` 1 lets one source through (bounce to new track), `opt.praefix` names the new track (default 'Merge: ')
export function mergePlan(p: Projekt, a: { spur_ids?: unknown; von_beat?: unknown; bis_beat?: unknown }, quelle: Herkunft,
  opt: { min?: number; praefix?: string } = {}): MergePlan {
  const roh = a.spur_ids, min = opt.min ?? 2;
  if (!Array.isArray(roh) || roh.length < min || roh.length > MAX_SPUREN || roh.some((x) => typeof x !== 'string') || new Set(roh).size !== roh.length) {
    ab('argument_ungueltig', `spur_ids: ${min} or more distinct track ids expected`);
  }
  const ids = roh as string[];
  for (const k of ['von_beat', 'bis_beat'] as const) {
    if (typeof a[k] !== 'number' || !Number.isFinite(a[k] as number)) ab('argument_ungueltig', `${k}: a number is required`);
  }
  const von = a.von_beat as number, bis = a.bis_beat as number;
  const spuren = ids.map((id) => sucheSpur(p, id) ?? ab('spur_unbekannt', id));
  if (quelle === 'cypher' && spuren.some((s) => herkunft(s) === 'andreas')) {
    ab('merge_andreas_spur', 'Cypher may not merge a track of Andreas: it would be muted');
  }
  for (const s of spuren) {
    if (brauchtFreeze(s)) ab('merge_freeze_noetig', `${s.name} has notes that are not frozen; freeze it first (proj_freeze)`);
  }
  const ziele = new Set(spuren.map((s) => s.ausgang?.id ?? null));
  if (ziele.size !== 1) {
    ab('merge_gruppen', 'the tracks feed different groups or the master; merge tracks of one group, or of the master');
  }
  if (spuren.some((s) => s.solo) && !spuren.every((s) => s.solo)) ab('merge_teil_solo', 'some of the tracks are solo; solo all of the tracks or none');
  if (p.spuren.length >= MAX_SPUREN) ab('merge_keine_spur_frei', `all ${MAX_SPUREN} tracks are used`);
  // slice 4: a merge would silently drop the chain of a source (the new track carries none), so any chain on a source is refused
  if (spuren.some((s) => (s.inserts ?? []).length > 0)) {
    ab('merge_inserts', 'a track has an insert chain; remove the inserts of the tracks (or freeze the sound some other way) and merge again');
  }
  // slice 3: the merge renders dry, the new track takes over the sends of the sources, but only if all sources have identical sends
  // (the send is post fader and linear, so (sum of source * fader) * send equals the sum of the single sends only for the same send)
  const erste = JSON.stringify(sendsSortiert(spuren[0]));
  if (spuren.some((s) => JSON.stringify(sendsSortiert(s)) !== erste)) {
    ab('merge_sends', 'the tracks have different sends; give the tracks identical sends (same returns, same levels), or none, and merge again');
  }
  return {
    spurIds: ids, von, bis, ausgang: [...ziele][0], index: Math.max(...spuren.map((s) => p.spuren.indexOf(s))) + 1,
    name: ((opt.praefix ?? 'Merge: ') + spuren.map((s) => s.name).join(' + ')).slice(0, 80), solo: spuren.every((s) => s.solo),
    ausserhalb: spuren.some((s) => liegtAusserhalb(s, von, bis, p.tempo_bpm)), tempo: p.tempo_bpm, sicht: mergeSicht(p, ids),
    sends: sendsSortiert(spuren[0]).map((x) => ({ ...x })),
  };
}

// Regler-Datei des Renders (--spur-regler): Quellen mit ihrem Fader, Pan und Mute, alle anderen Spuren stumm, Solo überall aus,
// Gruppen neutral (sie wirken später einmal auf der neuen Spur), kein pm/fader (D3, D6).
export function mergeRegler(p: Projekt, ids: string[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (let n = 1; n <= MAX_SPUREN; n++) { r[`spur/${n}/mute`] = 1; r[`spur/${n}/solo`] = 0; }
  for (const id of ids) {
    const s = sucheSpur(p, id);
    if (!s) continue;
    r[`spur/${s.nr}/fader`] = s.fader_db; r[`spur/${s.nr}/pan`] = s.pan; r[`spur/${s.nr}/mute`] = s.mute ? 1 : 0;
  }
  for (const g of p.gruppen ?? []) {
    r[`grp/${g.nr}/fader`] = 0; r[`grp/${g.nr}/pan`] = 0; r[`grp/${g.nr}/mute`] = 0; r[`grp/${g.nr}/solo`] = 0;
  }
  Object.assign(r, routingRegler(p, { trocken: true }));   // slice 3: dry, the Sends are not part of the render tap
  return r;
}

// Der Snapshot für den Render (P5): nur die gewählten Spuren, Gruppen bleiben; eine Wirt-Spur ohne Freeze rendert nicht.
export function mergeWiedergabe(p: Projekt, ids: string[]): Projekt {
  const q = structuredClone(p);
  q.spuren = q.spuren.filter((s) => ids.includes(s.id) && !(istWirt(s) && !s.freeze));
  return q;
}

// D5: eine Kopie, jeder Befehl einzeln über fuehreListeAus (Muster project/stems.ts); die Quell-Spuren werden stumm.
export function baueMergeProjekt(p0: Projekt, z: MergePlan, datei: { sha256: string; pfad: string }, quelle: Herkunft):
  { projekt: Projekt; spurId: string; lanesVerworfen: number } {
  const lauf = (p: Projekt, b: unknown): Projekt => fuehreListeAus(p, [b], { quelle }).projekt;
  let p = lauf(p0, { befehl: 'spur_neu', art: 'audio', name: z.name });
  const id = p.spuren[p.spuren.length - 1].id;                                   // spur_neu hängt hinten an
  p = lauf(p, { befehl: 'spur_verschieben', spur_id: id, index: z.index });
  if (z.ausgang !== null) p = lauf(p, { befehl: 'ziel_setzen', strang_id: id, ausgang: { art: 'gruppe', id: z.ausgang } });
  if (z.solo) p = lauf(p, { befehl: 'spur_aendern', spur_id: id, solo: true });
  p = lauf(p, { befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: z.von, laenge_beats: z.bis - z.von,
    sha256: datei.sha256, pfad_hinweis: datei.pfad, name: z.name });
  const c = sucheSpur(p, id)!.clips[0];
  p = lauf(p, { befehl: 'clip_aendern', clip_id: c.id, gain_db: PAN_MITTE_DB });
  for (const x of z.sends) p = lauf(p, { befehl: 'send_setzen', strang_id: id, return_id: x.id, db: x.db });   // same undo step
  for (const q of z.spurIds) p = lauf(p, { befehl: 'spur_aendern', spur_id: q, mute: true });
  // slice 2 (E10): a muted source drops its mute and solo lanes (mute wins over solo in the kern: a mute lane would make the muted source audible next
  // to the merged audio, a solo lane would silence the other tracks); fader, pan and geraet.* stay. Locked lanes go too (merge is a deliberate command,
  // Undo restores them). Directly on the fresh copy, not via auto_loeschen, which refuses locked lanes. An emptied list loses its key.
  let lanesVerworfen = 0;
  for (const q of z.spurIds) {
    const s = sucheSpur(p, q);
    if (!s?.automation) continue;
    const rest = s.automation.filter((l) => l.ziel !== 'mute' && l.ziel !== 'solo');
    lanesVerworfen += s.automation.length - rest.length;
    if (rest.length > 0) s.automation = rest; else delete s.automation;
  }
  return { projekt: p, spurId: id, lanesVerworfen };
}

// D12: null = die Quellen sind noch die vom Start; sonst der Grund
export function pruefeMergeNochGleich(p: Projekt, z: MergePlan): 'veraltet' | 'merge_keine_spur_frei' | null {
  if (mergeSicht(p, z.spurIds) !== z.sicht) return 'veraltet';
  if (p.spuren.length >= MAX_SPUREN) return 'merge_keine_spur_frei';
  return null;
}
