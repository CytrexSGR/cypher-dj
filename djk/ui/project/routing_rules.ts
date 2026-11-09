// 1.10 slice 5 (plan E3, E5, E8, E20, section 3.1): which sidechain key a compressor stage may listen to. The cell table, the DJ list and the reason of
// each answer come from the
// generated `key_table.ts` (docs/interfaces/schluessel_regeln.json, the same file the core loader reads); the dynamic rules that need the
// project sit here and in the core
// (arr_key.h): a strip keyed by its own output, a member track keyed by its own group, a cycle of tracks keyed by each other's post.
//
// `pruefeSchluessel` refuses with the reason literal the reason scanner sees (tests/support/reasons.mjs); a test pins the three literals to
// SCHLUESSEL_GRUND. `schluesselErlaubt` is the
// same question without a throw, for the matrix and the page.
import { BefehlFehler } from './commands.ts';
import { alleInserts, type Insert, type Projekt } from './model.ts';
import { SCHLUESSEL_DJ, SCHLUESSEL_ZELLEN, type SchluesselAntwort, type SchluesselArt } from './key_table.ts';

/** A key as the commands hand it over: every source the rules know, including the ones that are always refused (pm, pad). */
export interface SchluesselFrage { quelle: SchluesselArt | 'deck' | 'erz' | 'pad'; nr: number; punkt: 'pre' | 'post' }
export type Ablehnung = { grund: 'sidechain_spaet' | 'sidechain_zyklus' | 'sidechain_quelle'; text: string };

const WER: Readonly<Record<SchluesselArt, string>> = { spur: 'track', grp: 'group', ret: 'return', pm: 'the production master' };
const nummer = (a: SchluesselArt, nr: number): string => (a === 'pm' ? WER.pm : `${WER[a]} ${nr}`);

// the consumer: kind and number of the strip with this ID, and the number of the group a track plays into
function traeger(p: Projekt, id: string): { art: SchluesselArt; nr: number; gruppe: number } | undefined {
  if (id === 'master') return p.master ? { art: 'pm', nr: 0, gruppe: 0 } : undefined;
  const s = p.spuren.find((x) => x.id === id);
  if (s) return { art: 'spur', nr: s.nr, gruppe: s.ausgang ? ((p.gruppen ?? []).find((g) => g.id === s.ausgang!.id)?.nr ?? 0) : 0 };
  const g = (p.gruppen ?? []).find((x) => x.id === id);
  if (g) return { art: 'grp', nr: g.nr, gruppe: 0 };
  const r = (p.returns ?? []).find((x) => x.id === id);
  return r ? { art: 'ret', nr: r.nr, gruppe: 0 } : undefined;
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
function bewerte(p: Projekt, traegerId: string, key: SchluesselFrage, ausser?: Insert): Ablehnung | null {
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
    } else if (v.art === 'spur' && q === 'grp' && v.gruppe === key.nr) {
      antwort = 'zyklus';
      warum = 'the group sums this track, so its key depends on the track';
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

/** Throws the BefehlFehler of the rules (sidechain_spaet, sidechain_zyklus, sidechain_quelle) when the stage on `traegerId` may not listen to `key`. */
export function pruefeSchluessel(p: Projekt, traegerId: string, key: SchluesselFrage, ausser?: Insert): void {
  const a = bewerte(p, traegerId, key, ausser);
  if (!a) return;
  switch (a.grund) {
    case 'sidechain_spaet': throw new BefehlFehler('sidechain_spaet', a.text);
    case 'sidechain_zyklus': throw new BefehlFehler('sidechain_zyklus', a.text);
    default: throw new BefehlFehler('sidechain_quelle', a.text);
  }
}

/** The same question without a throw: null = allowed, else the reason and its English text. */
export function schluesselErlaubt(p: Projekt, traegerId: string, key: SchluesselFrage, ausser?: Insert): Ablehnung | null {
  try {
    pruefeSchluessel(p, traegerId, key, ausser);
    return null;
  } catch (e) {
    if (e instanceof BefehlFehler) return { grund: e.grund as Ablehnung['grund'], text: e.detail ?? e.message };
    throw e;
  }
}
