// D1 S3: Aufruf von cypherdj-render (Paket K3, Spec 2.5, 6.20, 6.25) für POST /proj/export. Der Render läuft als eigener Prozess mit nice 19
// (zusätzlich zum setpriority im Programm), die Instanz geht über CYPHERDJ_INSTANZ mit, der Arbeitsordner ausdrücklich über --arr-ordner.
// Die Spur-Regler des Projekts gehen IMMER als Datei mit (--spur-regler, Spec 6.20); der Render nimmt sie nur, wenn er keinen Neustart-Zustand
// des Kerns findet, und meldet das als regler_quelle "projekt" (sonst "kern"). Kein Pfad im OSC (Spec 2.9): dies ist ein Prozessaufruf.
// Rückgaben wie render_main.cpp (K3 05a91adb, am Baum gelesen): 0 geschrieben, 2 Aufruf, 3 Konfiguration oder Zustand, 4 Wiedergabe oder Render,
// 5 Wirt-Spur nicht eingefroren, 6 Schreiben, 7 Speicher, 8 Ziel besteht (der Render ersetzt nie; S3 vergibt eigene Namen).
import { spawn } from 'node:child_process';
import { nachkommen, vorfahren } from './routing_rules.ts';
import { HALL_FELDER, insertZeilen, rackZeilen, type Gruppe, type InsertTraeger, type Projekt, type Return, type Spur } from './model.ts';

export interface RenderAufruf {
  programm: string[];        // [Pfad zu cypherdj-render] oder im Test [node, render_mock.mjs]
  nr: number; von_beat: number; bis_beat: number; bpm: number;
  aus: string; arbeitsordner: string; spurRegler: string; instanz: string; zeitlimitMs: number;
  ohneZustand?: boolean;     // Paket 1.18 E-b: --ohne-zustand, die Regler kommen allein aus spurRegler (Quelle projekt), nie aus dem Neustart-Zustand des Kerns
  abbruch?: AbortSignal;     // Fix-Runde 2 S3, F4: der Server endet; tötet die Gruppe wie das Zeitlimit
  // 1.10 (E2, P11): optional. Fehlt es, steht kein --abgriff in der Kommandozeile (das Programm nimmt dann den Ring) und die Antwort wird nicht auf den
  // Abgriff geprüft; die bestehenden rendere()-Tests übergeben keins. Der Server (output.ts) übergibt immer eins.
  abgriff?: Abgriff;
  // 1.10 T9 (AK24): the render-only key mask, ids spur/<n>, grp/<n>, ret/<n> with an optional :ziel or :sends (--nur-schluessel).
  // Absent or empty:
  // no flag in the command line, so a project without keys renders exactly as before.
  nurSchluessel?: string[];
  // 1.10 T10 (AK24): --trocken-aus, render-only. Tracks and groups write zero into the master, the sends stay live: the output is the returns' wet part.
  trockenAus?: boolean;
}
export type Abgriff = 'produktion' | 'set';
export interface RenderAntwort {
  datei: string; frames: number; spitze_db: number; regler_quelle: 'kern' | 'projekt'; abgriff?: Abgriff; ueber_decke?: boolean; limiter_db_max?: number;
}

const RC_TEXT: Record<number, [string, string]> = {
  2: ['Aufruf', 'the render refused its arguments'],
  3: ['Konfiguration oder Neustart-Zustand', 'the render could not read the configuration or the core state'],
  4: ['Wiedergabe oder Render', 'the render could not load or play the arrangement'],
  5: ['Wirt-Spur nicht eingefroren', 'a Surge track is not frozen'],
  6: ['Schreiben', 'the render could not write the WAV file'],
  7: ['Speicher', 'the render ran out of memory'],
  8: ['Ziel besteht', 'the export file already exists'],
  126: ['Programm nicht ausführbar', 'the render program cannot be run'],
  127: ['Programm fehlt', 'the render program is missing'],
};

// grund wie die übrigen Fehler der Ausgabe; text englisch (Spec 6.34), message (deutsch, mit stderr) geht als detail mit
export class RenderFehler extends Error {
  readonly grund = 'render_fehler';
  readonly rc: number | null;
  readonly text: string;
  constructor(meldung: string, rc: number | null = null, text = '') {
    super(`render_fehler: ${meldung}`);
    this.rc = rc;
    this.text = `the export render failed${text ? `: ${text}` : rc !== null && RC_TEXT[rc] ? `: ${RC_TEXT[rc][1]}` : ''}`;
  }
}

// Spur-Regler des Projekts im Format des Neustart-Fachs (Pfad → Wert, Einheiten wie der Kern: fader dB −200..+6, pan −1..1,
// mute/solo 0/1), dieselben Pfade wie commands.ts reglerAenderungen.
export function reglerAusProjekt(p: Projekt): Record<string, number> {
  const r: Record<string, number> = {};
  for (const s of [...p.spuren].sort((a, b) => a.nr - b.nr)) {
    r[`spur/${s.nr}/fader`] = s.fader_db;
    r[`spur/${s.nr}/pan`] = s.pan;
    r[`spur/${s.nr}/mute`] = s.mute ? 1 : 0;
    r[`spur/${s.nr}/solo`] = s.solo ? 1 : 0;
  }
  for (const g of [...(p.gruppen ?? [])].sort((a, b) => a.nr - b.nr)) {   // 1.10: Gruppen-Regler, nur für vorhandene Gruppen
    r[`grp/${g.nr}/fader`] = g.fader_db; r[`grp/${g.nr}/pan`] = g.pan; r[`grp/${g.nr}/mute`] = g.mute ? 1 : 0; r[`grp/${g.nr}/solo`] = g.solo ? 1 : 0;
  }
  if ((p.master?.fader_db ?? 0) !== 0) r['pm/fader'] = p.master.fader_db;   // nur wenn nicht 0 dB (ein älteres Render-Programm kennt den Pfad nicht)
  Object.assign(r, routingRegler(p));
  return r;
}

// 1.10 T9 (AK24): the key sources of the stages on the path of ONE measured track. The path: the track's own chain, its target group, the returns the track
// or its group feeds, and the master chain. Isolating the track mutes every other track, which would also silence a key source, so a keyed compressor on
// the path would stop ducking. The sources are instead listed for the render-only mask (`nurSchluessel`): they run and capture their key, and add nothing.
// Ids: a key-source track, group or return is bare (target and sends zeroed); the members of a key-source group are `:ziel` (they keep feeding it, their
// sends are zeroed); the tracks and groups that send to a key-source return are `:sends` (they keep their sends, their target is zeroed). A track that
// must keep BOTH ends (a member of a key group that also sends into a key return) is left out of the list: it needs no mask, because its target is a masked
// key group and its sends go only into masked key returns, so it stays inaudible. The closure is transitive: the stages of a key source are keyed
// by sources too. A `pre` track key (row sc) needs none (taken before the mute); DJ keys are ignored (an export has no deck signal, E7); a source that
// does not exist is ignored. Real limit: a key taken from the measured track's OWN group or
// return sees only the measured track (the other members and senders stay muted by the isolation; they cannot run silently inside an audible strip).
// 1.10 T10: what sounds in one measured entry. A track entry: the track and its group. A group entry: all members of the group and the group. The key plan, the
// insert rows and the routing rows of an entry are taken from this path (a track alone is the path of one track).
// Nested groups: `gruppen` holds every group that sounds in the entry. A track entry: the chain of its target group,
// nearest first (the group, its target, ...).
// A group entry: the group, all groups below it and its chain above (the chain order is only guaranteed for a track entry).
export interface Pfad { spuren: Spur[]; gruppen: Gruppe[] }
/** the group with this id and the groups above it, nearest first (empty for an unknown id) */
export function gruppenKette(p: Projekt, id: string): Gruppe[] {
  const alle = p.gruppen ?? [];
  const g = alle.find((x) => x.id === id);
  return g ? [g, ...vorfahren(p, id).map((v) => alle.find((x) => x.id === v)).filter((x): x is Gruppe => !!x)] : [];
}
/** the path of a group entry: its tracks (all levels below), the group, the groups below it and the chain above it */
export function pfadVonGruppe(p: Projekt, g: Gruppe): Pfad {
  const n = nachkommen(p, g.id), alle = p.gruppen ?? [];
  return { spuren: p.spuren.filter((s) => n.spuren.includes(s.id)),
    gruppen: [...gruppenKette(p, g.id), ...n.gruppen.map((i) => alle.find((x) => x.id === i)).filter((x): x is Gruppe => !!x)] };
}
export const pfadVon = (p: Projekt, s: Spur): Pfad => ({ spuren: [s], gruppen: s.ausgang ? gruppenKette(p, s.ausgang.id) : [] });
const alsPfad = (p: Projekt, nur: Spur | Pfad): Pfad => ('spuren' in nur ? nur : pfadVon(p, nur));
export interface SchluesselPlan { ids: string[]; spuren: Spur[]; gruppen: Gruppe[]; returns: Return[] }
const SEND_AUS_DB = -120;
export function schluesselPlan(p: Projekt, nur: Spur | Pfad): SchluesselPlan {
  const gruppen = p.gruppen ?? [], returns = p.returns ?? [];
  const pfad = alsPfad(p, nur);
  const gespeist = new Set([...pfad.spuren.flatMap((t) => t.sends ?? []), ...pfad.gruppen.flatMap((x) => x.sends ?? [])].map((sd) => sd.id));
  const bedarf = new Map<string, { ziel: boolean; sends: boolean }>();
  const sp = new Map<number, Spur>(), gr = new Map<number, Gruppe>(), rt = new Map<number, Return>();
  const fertig = new Set<InsertTraeger>(), warte: InsertTraeger[] = [];
  const reihe = (st: InsertTraeger): void => { if (!fertig.has(st)) { fertig.add(st); warte.push(st); } };
  const vermerke = (id: string, art: '' | 'ziel' | 'sends'): void => {
    const b = bedarf.get(id) ?? { ziel: false, sends: false };
    bedarf.set(id, { ziel: b.ziel || art === 'ziel', sends: b.sends || art === 'sends' });
  };
  const sendetAn = (sends: { id: string; db: number }[] | undefined, r: Return): boolean => (sends ?? []).some((sd) => sd.id === r.id && sd.db > SEND_AUS_DB);
  const spurQuelle = (t: Spur, art: '' | 'ziel' | 'sends'): void => {
    if (pfad.spuren.includes(t)) return;
    sp.set(t.nr, t); vermerke(`spur/${t.nr}`, art); reihe(t);
  };
  // the members of a key group: its tracks and, nested, the tracks and groups below it; they keep feeding it (`:ziel`)
  const mitglieder = (gg: Gruppe): void => {
    const n = nachkommen(p, gg.id);
    for (const m of p.spuren) if (n.spuren.includes(m.id)) spurQuelle(m, 'ziel');
    for (const k of gruppen) if (n.gruppen.includes(k.id) && !pfad.gruppen.includes(k)) { gr.set(k.nr, k); vermerke(`grp/${k.nr}`, 'ziel'); reihe(k); }
  };
  const gruppeQuelle = (gg: Gruppe, art: '' | 'sends', post: boolean): void => {
    if (pfad.gruppen.includes(gg)) return;
    gr.set(gg.nr, gg); vermerke(`grp/${gg.nr}`, art);
    if (post || art === 'sends') reihe(gg);
    mitglieder(gg);
  };
  const returnQuelle = (r: Return, post: boolean): void => {
    if (gespeist.has(r.id)) return;                                                // on the path: it plays with the measured track's send only
    rt.set(r.nr, r); vermerke(`ret/${r.nr}`, '');
    if (post) reihe(r);
    for (const t of p.spuren) if (!pfad.spuren.includes(t) && sendetAn(t.sends, r)) spurQuelle(t, 'sends');
    for (const gg of gruppen) if (!pfad.gruppen.includes(gg) && sendetAn(gg.sends, r)) gruppeQuelle(gg, 'sends', true);
  };
  const strang = (st: InsertTraeger): void => {
    for (const i of st.inserts ?? []) {
      const k = i.key;
      if (!k || i.art !== 'komp') continue;
      if (k.quelle === 'spur' && k.punkt === 'post') { const t = p.spuren.find((x) => x.nr === k.nr); if (t) spurQuelle(t, ''); }
      else if (k.quelle === 'grp') { const gg = gruppen.find((x) => x.nr === k.nr); if (gg) gruppeQuelle(gg, '', k.punkt === 'post'); }
      else if (k.quelle === 'ret') { const r = returns.find((x) => x.nr === k.nr); if (r) returnQuelle(r, k.punkt === 'post'); }
    }
  };
  for (const t of pfad.spuren) reihe(t);
  for (const x of pfad.gruppen) reihe(x);
  for (const r of returns) if (gespeist.has(r.id)) reihe(r);
  if (p.master) reihe(p.master);
  for (let i = 0; i < warte.length; i++) strang(warte[i]);
  const ids: string[] = [];
  const liste = (kurz: string, nrn: number[]): void => {
    for (const n of [...nrn].sort((a, b) => a - b)) {
      const b = bedarf.get(`${kurz}/${n}`)!;
      if (b.ziel && b.sends) continue;   // both ends: no mask; silent anyway (target = a masked key group, sends only into masked key returns)
      ids.push(`${kurz}/${n}${b.ziel ? ':ziel' : b.sends ? ':sends' : ''}`);
    }
  };
  liste('spur', [...sp.keys()]); liste('grp', [...gr.keys()]); liste('ret', [...rt.keys()]);
  return { ids, spuren: [...sp.values()], gruppen: [...gr.values()], returns: [...rt.values()] };
}
// 1.10 T10 fix 1: the key returns of the stages that sound in the entry of return `x`. All tracks and groups run live there, so their keys need no mask;
// the other returns are muted, which would silence a return key (it sits behind the mute fade). The key returns are instead un-muted (the project's
// own state) and listed bare for the mask: they run and capture their key and add nothing. `x` itself left
// out, a return that does not exist ignored.
export function schluesselReturns(p: Projekt, x: Return): Return[] {
  const returns = p.returns ?? [], aus = new Map<number, Return>();
  const warte: InsertTraeger[] = [...p.spuren, ...(p.gruppen ?? []), x, ...(p.master ? [p.master] : [])];
  const fertig = new Set<InsertTraeger>(warte);
  for (let i = 0; i < warte.length; i++) {
    for (const ins of warte[i].inserts ?? []) {
      const k = ins.key;
      if (!k || ins.art !== 'komp' || k.quelle !== 'ret') continue;
      const r = returns.find((y) => y.nr === k.nr);
      if (!r || r === x) continue;
      aus.set(r.nr, r);
      if (!fertig.has(r)) { fertig.add(r); warte.push(r); }
    }
  }
  return [...aus.values()].sort((u, v) => u.nr - v.nr);
}
/** the ids for RenderAufruf.nurSchluessel (see schluesselPlan); empty for a project without keys on the path */
export const schluesselQuellen = (p: Projekt, spur: Spur | Pfad): string[] => schluesselPlan(p, spur).ids;

// 1.10 slice 3 (P12): the send and return controls of the project for the export render (the render sets them like the playback does). Sends only for
// returns that exist; every existing return with all its controls (fader, pan, mute, solo, Hall on and the six Hall values). Without returns: nothing,
// so the file of a project without returns stays as it was. `nur`: the render of ONE track alone (spec 5.10): the track, its group, their sends and only
// the returns they feed (their solo off, so that a return solo of the project does not silence the isolated track).
// 1.10 slice 4a: the insert rows ins/<art>/<slot>/* of the stages that sound in this render. Whole project: every strip. `nur` (one track alone): the
// track, its group, the master and the returns the track or its group feeds (like routingRegler returns). The dry merge render has none (a source with a
// chain is refused by merge_inserts, the groups are neutral, there is no master). The live path sets the values first and the switch `an` last; the export file
// is parsed into a sorted map by the render, so there the order is not kept (harmless: all rows are set before the first block).
export function insertRegler(p: Projekt, nur?: Spur | Pfad, plan?: SchluesselPlan): Record<string, number> {
  const straenge: InsertTraeger[] = [];
  if (nur) {
    const pf = alsPfad(p, nur);
    const gespeist = new Set([...pf.spuren.flatMap((t) => t.sends ?? []), ...pf.gruppen.flatMap((x) => x.sends ?? [])].map((sd) => sd.id));
    straenge.push(...pf.spuren, ...pf.gruppen, ...(p.master ? [p.master] : []), ...(p.returns ?? []).filter((x) => gespeist.has(x.id)));
    if (plan) straenge.push(...plan.spuren, ...plan.gruppen, ...plan.returns);   // T9: the stages of the key sources run for their key too
  } else {
    straenge.push(...p.spuren, ...(p.gruppen ?? []), ...(p.returns ?? []), ...(p.master ? [p.master] : []));
  }
  // slice 4c: the macro rows of the racks of those strips (the mapping table travels in the playback file)
  return Object.assign({}, ...straenge.flatMap((st) => (st.inserts ?? []).map((i) => insertZeilen(i))),
    ...straenge.filter((st) => st.rack).map((st) => rackZeilen(st.rack!)));
}

export function routingRegler(p: Projekt, opt: { nur?: Spur | Pfad; trocken?: boolean; schluessel?: SchluesselPlan } = {}): Record<string, number> {
  const nur = opt.nur;
  const r: Record<string, number> = {};
  const returns = p.returns ?? [];
  // 1.10 slice 4a: before the early return, a project may have inserts and no return
  if (!opt.trocken) Object.assign(r, insertRegler(p, nur, opt.schluessel));
  if (returns.length === 0) return r;
  if (opt.trocken) {                                                       // the merge renders dry: every send explicitly off, every existing return muted
    for (const s of p.spuren) for (const x of returns) r[`spur/${s.nr}/send/${x.nr}`] = -200;
    for (const g of p.gruppen ?? []) for (const x of returns) r[`grp/${g.nr}/send/${x.nr}`] = -200;
    for (const x of returns) r[`ret/${x.nr}/mute`] = 1;
    return r;
  }
  const nrVon = new Map(returns.map((x) => [x.id, x.nr] as const));
  const gespeist = new Set<string>();
  const strang = (kurz: string, nr: number, sends: { id: string; db: number }[] | undefined): void => {
    for (const sd of sends ?? []) {
      const rn = nrVon.get(sd.id);
      if (rn === undefined) continue;                                      // a send without its return is not translated
      r[`${kurz}/${nr}/send/${rn}`] = sd.db; gespeist.add(sd.id);
    }
  };
  if (nur) {
    const pf = alsPfad(p, nur);
    for (const t of pf.spuren) strang('spur', t.nr, t.sends);
    for (const x of pf.gruppen) strang('grp', x.nr, x.sends);   // a parent's fader does not act on the sends of its children (the child's own fader does)
    const sl = opt.schluessel;   // T9: the sends of the key sources into the key returns only (the mask silences the rest)
    if (sl) {
      const ids = new Set(sl.returns.map((x) => x.id));
      for (const t of sl.spuren) strang('spur', t.nr, t.sends?.filter((sd) => ids.has(sd.id)));
      for (const gg of sl.gruppen) strang('grp', gg.nr, gg.sends?.filter((sd) => ids.has(sd.id)));
    }
  } else {
    for (const s of p.spuren) strang('spur', s.nr, s.sends);
    for (const g of p.gruppen ?? []) strang('grp', g.nr, g.sends);
  }
  for (const x of [...returns].sort((a, b) => a.nr - b.nr)) {
    if (nur && !gespeist.has(x.id)) continue;
    r[`ret/${x.nr}/fader`] = x.fader_db; r[`ret/${x.nr}/pan`] = x.pan; r[`ret/${x.nr}/mute`] = x.mute ? 1 : 0;
    r[`ret/${x.nr}/solo`] = nur ? 0 : (x.solo ? 1 : 0);
    r[`ret/${x.nr}/hall/an`] = x.hall.an ? 1 : 0;
    for (const k of HALL_FELDER) r[`ret/${x.nr}/hall/${k}`] = x.hall[k];
  }
  return r;
}

export function renderArgumente(a: RenderAufruf): string[] {
  return ['--nr', String(a.nr), '--von-beat', String(a.von_beat), '--bis-beat', String(a.bis_beat), '--bpm', String(a.bpm),
    '--aus', a.aus, '--arr-ordner', a.arbeitsordner, '--spur-regler', a.spurRegler, ...(a.ohneZustand ? ['--ohne-zustand'] : []),
    ...(a.abgriff !== undefined ? ['--abgriff', a.abgriff] : []), ...(a.nurSchluessel?.length ? ['--nur-schluessel', a.nurSchluessel.join(',')] : []),
    ...(a.trockenAus ? ['--trocken-aus'] : [])];
}

const AUS_MAX = 65536, ERR_MAX = 8192;

// Liest die letzte nicht leere stdout-Zeile als JSON und prüft die Felder, die S3 weiterreicht. erwartet (1.10, P11): der verlangte Abgriff; der Render
// muss ihn genannt haben, sonst hätte ein älteres Programm still den Ring gelesen, während der Server „produktion“ behauptet.
export function leseRenderAntwort(stdout: string, erwartet?: Abgriff): RenderAntwort {
  const zeile = stdout.split('\n').map((z) => z.trim()).filter(Boolean).at(-1) ?? '';
  let j: Record<string, unknown>;
  try { j = JSON.parse(zeile) as Record<string, unknown>; } catch {
    throw new RenderFehler(`Ausgabe ist kein JSON: ${zeile.slice(0, 200)}`, 0, 'the render gave no readable answer');
  }
  if (typeof j.datei !== 'string' || !Number.isInteger(j.frames) || (j.frames as number) < 1 || typeof j.spitze_db !== 'number') {
    throw new RenderFehler(`Ausgabe ohne datei/frames/spitze_db: ${zeile.slice(0, 200)}`, 0, 'the render gave no readable answer');
  }
  if (j.regler_quelle !== 'kern' && j.regler_quelle !== 'projekt') {
    throw new RenderFehler(`Ausgabe ohne regler_quelle (K3-Nachtrag Spec 6.20 fehlt?): ${zeile.slice(0, 200)}`, 0,
      'the render did not say whose mixer it used');
  }
  if (erwartet !== undefined) {
    if (j.abgriff !== erwartet) {
      throw new RenderFehler(`Abgriff ${String(j.abgriff)} statt ${erwartet}: ${zeile.slice(0, 200)}`, 0,
        'the render did not use the requested tap (is the render program up to date?)');
    }
    if (typeof j.ueber_decke !== 'boolean' || typeof j.limiter_db_max !== 'number') {
      throw new RenderFehler(`Ausgabe ohne ueber_decke/limiter_db_max: ${zeile.slice(0, 200)}`, 0, 'the render gave no readable answer');
    }
  }
  return { datei: j.datei, frames: j.frames as number, spitze_db: j.spitze_db, regler_quelle: j.regler_quelle,
    ...(j.abgriff === 'produktion' || j.abgriff === 'set' ? { abgriff: j.abgriff as Abgriff } : {}),
    ...(typeof j.ueber_decke === 'boolean' ? { ueber_decke: j.ueber_decke } : {}),
    ...(typeof j.limiter_db_max === 'number' ? { limiter_db_max: j.limiter_db_max } : {}) };
}

// Fix-Runde S3 R3: der Render läuft als eigene Prozessgruppe (detached). Das Zeitlimit tötet die ganze Gruppe (kill(-pid)), auch einen Enkel, der
// stdout offen hält, und entscheidet sofort, nicht erst bei close (das ohne Gruppen-Kill nie käme, solange der Enkel lebt). Entschieden wird einmal.
// Fix-Runde 2 S3, F4: als eigene Gruppe bekommt der Render Strg-C an den Server nicht mit; abbruch (Ausgabe.schliesse) tötet ihn wie das Zeitlimit.
const ABGEBROCHEN = (): RenderFehler => new RenderFehler('abgebrochen: der Server endet', null, 'the server is shutting down, the render was stopped');
export function rendere(a: RenderAufruf): Promise<RenderAntwort> {
  return new Promise((ok, fehl) => {
    if (a.abbruch?.aborted) { fehl(ABGEBROCHEN()); return; }
    const k = spawn('nice', ['-n', '19', ...a.programm, ...renderArgumente(a)], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CYPHERDJ_INSTANZ: a.instanz }, detached: true,
    });
    let aus = '', err = '', fertig = false;
    const ende = (f: () => void): void => {
      if (fertig) return;
      fertig = true; clearTimeout(uhr); a.abbruch?.removeEventListener('abort', abbrechen); f();
    };
    const toeteGruppe = (): void => {
      try { if (k.pid !== undefined) process.kill(-k.pid, 'SIGKILL'); } catch { /* Gruppe schon weg */ }
      try { k.kill('SIGKILL'); } catch { /* schon weg */ }
    };
    k.stdout.on('data', (b: Buffer) => { if (aus.length < AUS_MAX) aus += b.toString('utf8'); });
    k.stderr.on('data', (b: Buffer) => { err = (err + b.toString('utf8')).slice(-ERR_MAX); });
    const uhr = setTimeout(() => ende(() => {
      toeteGruppe();
      k.stdout.destroy(); k.stderr.destroy();                              // nicht auf Daten eines Enkels warten
      fehl(new RenderFehler(`Zeitlimit ${a.zeitlimitMs} ms überschritten`, null, `no result within ${a.zeitlimitMs} ms`));
    }), a.zeitlimitMs);
    const abbrechen = (): void => ende(() => { toeteGruppe(); k.stdout.destroy(); k.stderr.destroy(); fehl(ABGEBROCHEN()); });
    a.abbruch?.addEventListener('abort', abbrechen, { once: true });
    k.once('error', (e) => ende(() => fehl(new RenderFehler(`Start: ${e.message}`, null, 'the render program could not be started'))));
    k.once('close', (rc) => ende(() => {
      const letzte = err.split('\n').map((z) => z.trim()).filter(Boolean).at(-1) ?? '';
      if (rc !== 0) return fehl(new RenderFehler(`Rückgabe ${rc} (${RC_TEXT[rc ?? -1]?.[0] ?? 'unbekannt'}): ${letzte}`, rc));
      try { ok(leseRenderAntwort(aus, a.abgriff)); } catch (e) { fehl(e); }
    }));
  });
}
