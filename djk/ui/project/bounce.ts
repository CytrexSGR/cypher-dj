// Package 1.14 slice 4 (bounce, N08): pure bounce calculation next to the merge (project/merge.ts). Plan and refusals (spec R2, R3, D4 to
// D8, D11, D12). No fs, no process (same rule as merge.ts).
// Three arts: an_ort (bounce track in place: pre-mixer render, the main clips move into a take lane "Before bounce"), neue_spur (bounce to new
// track: the 1.13 merge with one source allowed, or all members of a group), einfuegen (paste bounced audio: post-fader render onto an audio track
// at a beat, overwriting its main lane there).
import { fuehreListeAus, teileClipsAn } from './commands.ts';
import { nachkommen } from './routing_rules.ts';
import { brauchtFreeze } from './freeze.ts';
import {
  MAX_BEAT, MAX_SPUREN, MAX_TAKES_PRO_SPUR, herkunft, kanonisch, neueId, spurSicht, sucheSpur, type AudioClip, type Clip, type Herkunft, type Projekt,
  type Spur,
} from './model.ts';
import {
  EPS, MergeFehler, PAN_MITTE_DB, baueMergeProjekt, mergePlan, mergeRegler, mergeSicht, mergeWiedergabe, pruefeMergeNochGleich, type MergePlan,
} from './merge.ts';

export type BounceArt = 'an_ort' | 'neue_spur' | 'einfuegen';
export interface BouncePlan {
  art: BounceArt; spurIds: string[]; von: number; bis: number; quelle: Herkunft; name: string;
  ziel?: { spurId: string; beat: number };   // einfuegen
  merge?: MergePlan;                         // neue_spur: the merge plan with 1+ sources
  sicht: string;                             // freshness key (R6)
}

export const BOUNCE_LANE_NAME = 'Before bounce';
export const BOUNCE_PRAEFIX = 'Bounce: ';
// the export range rule (R3): equal to EXPORT_MAX_BEATS of areas/proj/output.ts (pinned by tests/project_bounce_plan.test.mjs)
export const BOUNCE_MAX_BEATS = 1024;

const ab = (grund: string, text: string): never => { throw new MergeFehler(grund, text); };
const FELDER: Record<BounceArt, readonly string[]> = {
  an_ort: ['art', 'spur_id'],
  neue_spur: ['art', 'spur_ids', 'gruppe_id', 'von_beat', 'bis_beat'],
  einfuegen: ['art', 'spur_ids', 'von_beat', 'bis_beat', 'ziel_spur_id', 'ziel_beat'],
};
const zahlOk = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const ende = (c: { start_beat: number; laenge_beats: number }): number => c.start_beat + c.laenge_beats;

// D4: floor(first start + EPS) to ceil(last end - EPS), so a float end like 8.000000000000002 gives 8, not 9; null without clips
export function huelle(clips: readonly Pick<Clip, 'start_beat' | 'laenge_beats'>[]): { von: number; bis: number } | null {
  if (!clips.length) return null;
  return { von: Math.floor(Math.min(...clips.map((c) => c.start_beat)) + EPS), bis: Math.ceil(Math.max(...clips.map(ende)) - EPS) };
}

// R3: the export range rule (start at 0 or later, 1 to BOUNCE_MAX_BEATS beats)
function pruefeBereich(von: number, bis: number, was = ''): void {
  if (!(von >= 0) || !(bis - von >= 1) || bis - von > BOUNCE_MAX_BEATS) {
    ab('export_bereich', `${was}beat ${von} to ${bis}: a bounce starts at beat 0 or later and is 1 to ${BOUNCE_MAX_BEATS} beats long`);
  }
}

function quellIds(roh: unknown): string[] {
  if (!Array.isArray(roh) || roh.length < 1 || roh.length > MAX_SPUREN || roh.some((x) => typeof x !== 'string') || new Set(roh).size !== roh.length) {
    return ab('argument_ungueltig', `spur_ids: 1 to ${MAX_SPUREN} distinct track ids expected`);
  }
  return roh as string[];
}

const spurVon = (p: Projekt, id: unknown, feld: string): Spur => {
  if (typeof id !== 'string' || id === '') return ab('argument_ungueltig', `${feld}: a track id is required`);
  return sucheSpur(p, id) ?? ab('spur_unbekannt', id);
};
// D10 (1.10 slice 4): the bounce is dry and bakes no insert chain, so a strip whose sound is part of the bounce may not carry one
// plan 1.11 task 13: the offline render refuses an active host stage (it is captured in real time), so the bounce says so up front
const ohneHostEchtzeit = (s: Spur): void => {
  if ((s.inserts ?? []).some((i) => i.art === 'host' && i.an)) {
    ab('host_insert_echtzeit', `${s.name} has an active plugin stage that is captured in real time; bounce cannot render it offline, use resample`);
  }
};
const ohneInserts = (s: Spur, rolle: string): void => {
  ohneHostEchtzeit(s);
  if ((s.inserts ?? []).length > 0) {
    ab('merge_inserts', `${s.name} has an insert chain; the bounce is dry and does not bake it. Remove the inserts of the ${rolle} and bounce again`);
  }
};
const nichtAndreas = (s: Spur, quelle: Herkunft, was: string): void => {
  if (quelle === 'cypher' && herkunft(s) === 'andreas') ab('merge_andreas_spur', `${s.name} belongs to Andreas; Cypher may not ${was} it`);
};

// Spec R2, R3, D4, D5, D8, D11, D12. Throws MergeFehler. `sicht` is the freshness key of the state the plan was built on (R6).
export function bouncePlan(p: Projekt, d: Record<string, unknown>, quelle: Herkunft): BouncePlan {
  const z = planOhneSicht(p, d, quelle);
  return { ...z, sicht: bounceSicht(p, z) };
}

function planOhneSicht(p: Projekt, d: Record<string, unknown>, quelle: Herkunft): BouncePlan {
  const art = d.art;
  if (art !== 'an_ort' && art !== 'neue_spur' && art !== 'einfuegen') return ab('argument_ungueltig', 'art: an_ort, neue_spur or einfuegen expected');
  for (const k of Object.keys(d)) if (!FELDER[art].includes(k)) ab('argument_ungueltig', `unknown field ${k} for art ${art}`);
  if (art === 'an_ort') {
    const s = spurVon(p, d.spur_id, 'spur_id');
    if (s.art !== 'audio') ab('bounce_nur_audio', `${s.name} is an instrument track; use Bounce to New Track, or Freeze for a Surge track`);
    nichtAndreas(s, quelle, 'bounce');
    ohneInserts(s, 'track');
    if ((s.takes ?? []).length >= MAX_TAKES_PRO_SPUR) ab('takes_voll', `${s.name} already has ${MAX_TAKES_PRO_SPUR} take lanes; delete one first`);
    const h = huelle(s.clips) ?? ab('merge_leer', `${s.name} has no clips to bounce`);
    pruefeBereich(h.von, h.bis, `${s.name} spans `);
    return { art, spurIds: [s.id], von: h.von, bis: h.bis, quelle, name: (BOUNCE_PRAEFIX + s.name).slice(0, 80), sicht: '' };
  }
  for (const k of ['von_beat', 'bis_beat']) if (d[k] !== undefined && !zahlOk(d[k])) ab('argument_ungueltig', `${k}: a number is required`);
  if (art === 'neue_spur') {
    if ((d.spur_ids === undefined) === (d.gruppe_id === undefined)) ab('argument_ungueltig', 'give exactly one of spur_ids and gruppe_id');
    let ids: string[], unter: string | undefined;
    if (d.gruppe_id !== undefined) {
      const g = typeof d.gruppe_id === 'string' ? d.gruppe_id : ab('argument_ungueltig', 'gruppe_id: a group id is required');
      if (!(p.gruppen ?? []).some((x) => x.id === g)) ab('gruppe_unbekannt', `there is no group ${g}`);
      unter = g;
      const unten = nachkommen(p, g).spuren;                                          // nested groups: the tracks of the group and of every group below it
      ids = p.spuren.filter((s) => unten.includes(s.id)).map((s) => s.id);
      if (!ids.length) ab('merge_leer', `group ${g} has no member tracks`);
    } else ids = quellIds(d.spur_ids);
    const h = huelle(ids.flatMap((id) => sucheSpur(p, id)?.clips ?? []));
    const von = (d.von_beat as number | undefined) ?? h?.von, bis = (d.bis_beat as number | undefined) ?? h?.bis;
    for (const id of ids) ohneHostEchtzeit(sucheSpur(p, id) ?? ab('spur_unbekannt', id));
    if (von === undefined || bis === undefined) return ab('merge_leer', 'the tracks have no clips; give von_beat and bis_beat');
    pruefeBereich(von, bis);
    const merge = mergePlan(p, { spur_ids: ids, von_beat: von, bis_beat: bis }, quelle,
      { min: 1, praefix: BOUNCE_PRAEFIX, ...(unter !== undefined ? { unter } : {}) });
    return { art, spurIds: merge.spurIds, von, bis, quelle, name: merge.name, merge, sicht: '' };
  }
  // einfuegen (D6): no group, solo or sends rule; the sources stay unchanged, so a track of Andreas may be read
  const ids = quellIds(d.spur_ids);
  for (const k of ['von_beat', 'bis_beat', 'ziel_beat']) if (!zahlOk(d[k])) ab('argument_ungueltig', `${k}: a number is required`);
  const von = d.von_beat as number, bis = d.bis_beat as number, beat = d.ziel_beat as number;
  const quellen = ids.map((id) => sucheSpur(p, id) ?? ab('spur_unbekannt', id));
  for (const s of quellen) if (brauchtFreeze(s)) ab('merge_freeze_noetig', `${s.name} has notes that are not frozen; freeze it first (proj_freeze)`);
  for (const s of quellen) ohneInserts(s, 'source');
  pruefeBereich(von, bis);
  const z = spurVon(p, d.ziel_spur_id, 'ziel_spur_id');
  if (z.art !== 'audio') ab('bounce_ziel_art', `${z.name} is not an audio track; paste bounced audio onto an audio track`);
  nichtAndreas(z, quelle, 'paste onto');
  ohneInserts(z, 'target');
  const bisZiel = beat + (bis - von);
  if (!(beat >= 0) || bisZiel > MAX_BEAT) ab('argument_ungueltig', `ziel_beat: ${beat} to ${bisZiel} must lie inside 0..${MAX_BEAT}`);
  const loop = schneidetLoop(z, beat, bisZiel);
  if (loop) ab('ersetzen_loop', loop);
  return { art, spurIds: ids, von, bis, quelle, name: (BOUNCE_PRAEFIX + quellen.map((s) => s.name).join(' + ')).slice(0, 80),
    ziel: { spurId: z.id, beat }, sicht: '' };
}

// the comp rule (commands.ts comp_waehlen): a loop clip of the main lane that has an edge strictly inside gives its id, else null
export function schneidetLoop(s: Spur, von: number, bis: number): string | null {
  const schneidet = (c: Clip, t: number): boolean => c.start_beat < t - EPS && ende(c) > t + EPS;
  return s.clips.find((c) => c.loop_beats != null && (schneidet(c, von) || schneidet(c, bis)))?.id ?? null;
}

// R6: the sources as the merge sees them (clips without dekodiert, fader, pan, mute, solo, target, sends, tempo); for an_ort also the ids of the
// track's take lanes (a lane added or removed meanwhile); for einfuegen also the target's main lane view without dekodiert.
export function bounceSicht(p: Projekt, z: Pick<BouncePlan, 'art' | 'spurIds' | 'ziel' | 'merge'>): string {
  const quellen = mergeSicht(p, z.spurIds, z.merge?.unter);
  if (z.art === 'an_ort') return kanonisch({ quellen, takes: (sucheSpur(p, z.spurIds[0])?.takes ?? []).map((t) => t.id) });
  if (z.art === 'neue_spur' || !z.ziel) return quellen;
  const ziel = sucheSpur(p, z.ziel.spurId);
  if (!ziel) return kanonisch({ quellen, ziel: null });
  const sicht = JSON.parse(JSON.stringify(spurSicht(ziel))) as { clips: Record<string, unknown>[] };
  for (const c of sicht.clips) delete c.dekodiert;
  return kanonisch({ quellen, ziel: sicht });
}

// R5, D3: neue_spur and einfuegen render post-fader like the merge; an_ort renders the track before its mixer (fader 0, pan 0, mute off; sends are
// dry and groups neutral in mergeRegler already)
export function bounceRegler(p: Projekt, z: BouncePlan): Record<string, number> {
  const r = mergeRegler(p, z.spurIds, z.merge?.unter);
  if (z.art !== 'an_ort') return r;
  const s = sucheSpur(p, z.spurIds[0]);
  if (s) { r[`spur/${s.nr}/fader`] = 0; r[`spur/${s.nr}/pan`] = 0; r[`spur/${s.nr}/mute`] = 0; }
  return r;
}

// R5: the render snapshot holds only the sources; for an_ort the source track's lanes go (an audio track only carries mixer lanes, which stay live)
export function bounceWiedergabe(p: Projekt, z: BouncePlan): Projekt {
  const q = mergeWiedergabe(p, z.spurIds);
  if (z.art === 'an_ort') for (const s of q.spuren) delete s.automation;
  return q;
}

export interface BounceErgebnis { projekt: Projekt; spurId: string; clipId: string; takeId?: string; lanesVerworfen?: number; label: string }

// R7 to R9: the new state, on a copy, every command through fuehreListeAus (like baueMergeProjekt); the result is validated by aendereStand
export function baueBounceProjekt(p0: Projekt, z: BouncePlan, datei: { sha256: string; pfad: string }): BounceErgebnis {
  if (z.art === 'neue_spur') {
    const m = baueMergeProjekt(p0, z.merge!, datei, z.quelle);
    return { projekt: m.projekt, spurId: m.spurId, clipId: sucheSpur(m.projekt, m.spurId)!.clips[0].id, lanesVerworfen: m.lanesVerworfen,
      label: `Bounce ${z.name.slice(BOUNCE_PRAEFIX.length)}`.slice(0, 80) };
  }
  const p = structuredClone(p0);
  const spurId = z.art === 'an_ort' ? z.spurIds[0] : z.ziel!.spurId;
  const s = sucheSpur(p, spurId) ?? ab('veraltet', `track ${spurId} no longer exists`);
  const von = z.art === 'an_ort' ? z.von : z.ziel!.beat, laenge = z.bis - z.von;
  let takeId: string | undefined;
  if (z.art === 'an_ort') {
    // D7: the main clips move with their ids into a new lane at the end; the main lane gets one new clip (a new id from neueId)
    if ((s.takes ?? []).length >= MAX_TAKES_PRO_SPUR) ab('takes_voll', `${s.name} already has ${MAX_TAKES_PRO_SPUR} take lanes`);
    takeId = neueId(p, 'take');
    (s.takes ??= []).push({ id: takeId, name: BOUNCE_LANE_NAME, clips: s.clips as AudioClip[] });
    s.clips = [];
  } else {
    // D6: overwrite [von, von + laenge) of the target's main lane: cut at both edges by the clip_teilen rules, drop what lies inside
    const bis = von + laenge;
    const loop = schneidetLoop(s, von, bis);
    if (loop) ab('ersetzen_loop', loop);
    teileClipsAn(p, s, [von, bis]);
    s.clips = s.clips.filter((c) => !(c.start_beat < bis - EPS && ende(c) > von + EPS));
  }
  const vorher = new Set([...s.clips.map((c) => c.id)]);
  let q = fuehreListeAus(p, [{ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: von, laenge_beats: laenge, sha256: datei.sha256,
    pfad_hinweis: datei.pfad, name: z.name }], { quelle: z.quelle }).projekt;
  const neu = sucheSpur(q, spurId)!.clips.find((c) => !vorher.has(c.id))!;
  q = fuehreListeAus(q, [{ befehl: 'clip_aendern', clip_id: neu.id, gain_db: PAN_MITTE_DB }], { quelle: z.quelle }).projekt;
  const t = sucheSpur(q, spurId)!;
  const i = t.clips.findIndex((c) => c.id === neu.id);
  const [c] = t.clips.splice(i, 1);                                                  // keep the main lane in start order
  const j = t.clips.findIndex((x) => x.start_beat > c.start_beat);
  t.clips.splice(j < 0 ? t.clips.length : j, 0, c);
  const name = sucheSpur(p0, spurId)!.name;
  const label = (z.art === 'an_ort' ? `Bounce in place ${name}` : `Paste bounced audio to ${name}`).slice(0, 80);
  return { projekt: q, spurId, clipId: neu.id, label, ...(takeId ? { takeId } : {}) };
}

// R6: null = still the state of the plan; otherwise the reason (veraltet, takes_voll, merge_keine_spur_frei, ersetzen_loop)
export function pruefeBounceNochGleich(p: Projekt, z: BouncePlan): string | null {
  if (z.art === 'neue_spur') return pruefeMergeNochGleich(p, z.merge!) ?? (bounceSicht(p, z) === z.sicht ? null : 'veraltet');
  if (z.art === 'an_ort' && (sucheSpur(p, z.spurIds[0])?.takes ?? []).length >= MAX_TAKES_PRO_SPUR) return 'takes_voll';
  if (z.art === 'einfuegen') {
    const ziel = sucheSpur(p, z.ziel!.spurId);
    if (ziel && schneidetLoop(ziel, z.ziel!.beat, z.ziel!.beat + z.bis - z.von)) return 'ersetzen_loop';
  }
  return bounceSicht(p, z) === z.sicht ? null : 'veraltet';
}
