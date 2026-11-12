// Sidechain key verdict without any command machinery: the rules that need the project (levels of nested groups, ancestors, track cycles).
// Split from routing_rules.ts so that model.ts can check a loaded project (pruefeAlles) without an import cycle through commands.ts.
import { alleInserts, type Gruppe, type Insert, type Projekt } from './model.ts';
import { SCHLUESSEL_DJ, SCHLUESSEL_ZELLEN, type SchluesselAntwort, type SchluesselArt } from './key_table.ts';

/** A key as the commands hand it over: every source the rules know, including the ones that are always refused (pm, pad). */
export interface SchluesselFrage { quelle: SchluesselArt | 'deck' | 'erz' | 'pad'; nr: number; punkt: 'pre' | 'post' }
export type Ablehnung = { grund: 'sidechain_spaet' | 'sidechain_zyklus' | 'sidechain_quelle'; text: string };

const WER: Readonly<Record<SchluesselArt, string>> = { spur: 'track', grp: 'group', ret: 'return', pm: 'the production master' };
const nummer = (a: SchluesselArt, nr: number): string => (a === 'pm' ? WER.pm : `${WER[a]} ${nr}`);

const gruppenListe = (p: Projekt): Gruppe[] => p.gruppen ?? [];

/** The groups above a group, nearest first (its target, that group's target, ...). Stops at a repeat, so it ends even on a broken tree. */
export function vorfahren(p: Projekt, gruppeId: string): string[] {
  const aus: string[] = [];
  let g = gruppenListe(p).find((x) => x.id === gruppeId);
  while (g?.ausgang && !aus.includes(g.ausgang.id) && g.ausgang.id !== gruppeId) {
    aus.push(g.ausgang.id);
    const id = g.ausgang.id;
    g = gruppenListe(p).find((x) => x.id === id);
  }
  return aus;
}

/** Everything that plays into a group, directly or through other groups: track ids and group ids. */
export function nachkommen(p: Projekt, gruppeId: string): { spuren: string[]; gruppen: string[] } {
  const gruppen: string[] = [], rest = [gruppeId];
  while (rest.length) {
    const id = rest.pop()!;
    for (const g of gruppenListe(p)) if (g.ausgang?.id === id && g.id !== gruppeId && !gruppen.includes(g.id)) { gruppen.push(g.id); rest.push(g.id); }
  }
  const alle = new Set([gruppeId, ...gruppen]);
  return { spuren: p.spuren.filter((s) => s.ausgang && alle.has(s.ausgang.id)).map((s) => s.id), gruppen };
}

// The level of a group: 0 when no group plays into it, else one more than its highest child (the order the core evaluates the groups in).
function stufeVon(p: Projekt, gruppeId: string): number {
  let hoch = 0;
  for (const k of nachkommen(p, gruppeId).gruppen) hoch = Math.max(hoch, vorfahren(p, k).indexOf(gruppeId) + 1);
  return hoch;
}

// the consumer: kind and number of the strip with this ID, and the number of the group a track plays into
function traeger(p: Projekt, id: string): { art: SchluesselArt; nr: number; gruppe: number; oben: number[]; stufe: number } | undefined {
  const nrs = (ids: string[]): number[] => ids.map((i) => gruppenListe(p).find((g) => g.id === i)?.nr ?? 0);
  if (id === 'master') return p.master ? { art: 'pm', nr: 0, gruppe: 0, oben: [], stufe: 0 } : undefined;
  const s = p.spuren.find((x) => x.id === id);
  if (s) {
    const oben = s.ausgang ? [s.ausgang.id, ...vorfahren(p, s.ausgang.id)] : [];   // the group the track plays into and all groups above it
    return { art: 'spur', nr: s.nr, gruppe: nrs(oben)[0] ?? 0, oben: nrs(oben), stufe: 0 };
  }
  const g = gruppenListe(p).find((x) => x.id === id);
  if (g) return { art: 'grp', nr: g.nr, gruppe: 0, oben: nrs(vorfahren(p, g.id)), stufe: stufeVon(p, g.id) };
  const r = (p.returns ?? []).find((x) => x.id === id);
  return r ? { art: 'ret', nr: r.nr, gruppe: 0, oben: [], stufe: 0 } : undefined;
}

// Does track `von` need (transitively, through the post keys of other stages) the output of track `ziel`? `ausser` is the stage being replaced or
// changed: its old edge is gone.
function braucht(p: Projekt, von: number, ziel: number, ausser: Insert | undefined): boolean {
  const kanten = new Map<number, number[]>();
  for (const x of alleInserts(p)) {
    if (x.insert === ausser) continue;
    const k = x.insert.key;
    const s = p.spuren.find((t) => t.id === x.strangId);
    if (!s || !k || k.quelle !== 'spur' || k.punkt !== 'post') continue;
    kanten.set(s.nr, [...(kanten.get(s.nr) ?? []), k.nr]);
  }
  const gesehen = new Set<number>();
  const rest = [von];
  while (rest.length) {
    const n = rest.pop()!;
    if (n === ziel) return true;
    if (gesehen.has(n)) continue;
    gesehen.add(n);
    rest.push(...(kanten.get(n) ?? []));
  }
  return false;
}

// The verdict of the rules for a stage on the strip `traegerId` keyed by `key`: null = allowed. `ausser` = the stage that is being replaced or rewritten
// (it does not count
// as an edge of the track order). A strip that does not exist has no verdict: the callers resolve their strips first.
export function bewerte(p: Projekt, traegerId: string, key: SchluesselFrage, ausser?: Insert): Ablehnung | null {
  const v = traeger(p, traegerId);
  if (!v) return { grund: 'sidechain_quelle', text: `${traegerId} is not a strip of this project` };
  const q = key.quelle;
  const wie = `${q === 'deck' || q === 'erz' || q === 'pad' ? `${q}/${key.nr}` : `${nummer(q, key.nr)} ${key.punkt}`}`;
  const wer = nummer(v.art, v.nr);
  let antwort: SchluesselAntwort;
  let warum = '';
  if (q === 'deck' || q === 'erz' || q === 'pad') {
    antwort = SCHLUESSEL_DJ.find((e) => e.quelle === q && key.nr >= e.von && key.nr <= e.bis)?.antwort ?? 'quelle';   // everything not listed is 'quelle'
    warum = antwort === 'zyklus' ? 'it is the input the arrangement output goes into'
      : 'it is not available in the block of the arrangement (computed after the production mixer)';
  } else {
    antwort = SCHLUESSEL_ZELLEN[v.art][q][key.punkt];
    if (v.art === q && v.art !== 'pm' && v.nr === key.nr) {
      antwort = 'zyklus';
      warum = 'a strip cannot listen to its own output';
    } else if (v.art === 'spur' && q === 'grp' && v.oben.includes(key.nr)) {
      antwort = 'zyklus';
      warum = 'the group sums this track, so its key depends on the track';
    } else if (v.art === 'grp' && q === 'grp') {
      // nested groups (decision 6): an ancestor sums this group; otherwise pre needs level(source) <= level(consumer), post needs <
      const quelle = gruppenListe(p).find((g) => g.nr === key.nr);
      const stufeQ = quelle ? stufeVon(p, quelle.id) : 0;
      if (v.oben.includes(key.nr)) {
        antwort = 'zyklus';
        warum = 'that group sums this group, so its key depends on this group';
      } else if (key.punkt === 'pre' ? stufeQ > v.stufe : stufeQ >= v.stufe) {
        antwort = 'spaet';
        warum = 'a group is computed after the groups below it, but not after a group on its own level or above';
      } else antwort = 'ja';
    } else if (v.art === 'spur' && q === 'spur' && key.punkt === 'post' && braucht(p, key.nr, v.nr, ausser)) {
      antwort = 'zyklus';
      warum = 'the two tracks key each other through their post, a cycle';
    } else if (antwort === 'zyklus') warum = 'the production master sums every strip, so its key is always the output of the strip itself';
    else if (antwort === 'spaet') {
      warum = 'groups, returns and the production master are computed after all tracks (a track stage can only listen to tracks and DJ inputs)';
    }
  }
  if (antwort === 'ja') return null;
  const text = `${wer} cannot be keyed by ${wie}: ${warum}`;
  // the three reasons are literals so that the reason scanner finds them; tests/project_key.test.mjs pins them to SCHLUESSEL_GRUND
  switch (antwort) {
    case 'spaet': return { grund: 'sidechain_spaet', text };
    case 'zyklus': return { grund: 'sidechain_zyklus', text };
    default: return { grund: 'sidechain_quelle', text };
  }
}

/** The first stage key of the project that the rules refuse, or null. Used after a change of the group tree and when a project is loaded. */
export function ersterUngueltigerSchluessel(p: Projekt, nurGruppenbaum = false): { strangId: string; insert: Insert; ablehnung: Ablehnung } | null {
  for (const x of alleInserts(p)) {
    const k = x.insert.key;
    if (!k) continue;
    const a = bewerte(p, x.strangId, k, x.insert);
    // loading a file: only what the group tree decides (a group keyed by a group, a key on an ancestor group); the cell rules are the commands' business
    if (a && nurGruppenbaum && !(k.quelle === 'grp' && ((p.gruppen ?? []).some((g) => g.id === x.strangId) || a.grund === 'sidechain_zyklus'))) continue;
    if (a) return { strangId: x.strangId, insert: x.insert, ablehnung: a };
  }
  return null;
}
