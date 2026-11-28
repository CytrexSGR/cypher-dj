// Loop (schleife) supervision of a track run: watcher, bar ticks, passes, hand-grip handling (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import { oeffnetKanal, beatZuMono, wirtRuf } from '../../track.ts';
import { planeDurchlauf, type Spur } from '../../track.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { VORLAUF_SCHLEIFE_BEATS } from '../../server_kopf.ts';
import type { SpurLauf, SchleifenStand } from '../../server_kopf.ts';
import type { Oberflaeche } from '../../server.ts';

// 1.12 S7 (M13): GET /spur fields of a loop. anker_beat/ende_beat name the RUNNING pass (the last sent one whose start the core beat
// has reached; before that the first one), durchlauf its number k, schleife_takte its length, naechste whether a change waits.
export function schleifenInfo(this: Oberflaeche, s: SchleifenStand): Record<string, unknown> {
  const beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat ?? -Infinity;
  const d = s.durchlaeufe.filter((x) => x.anfang <= beat).at(-1) ?? s.durchlaeufe[0];
  return { schleife_takte: (d.ende - d.anfang) / (d.proTakt ?? 4), durchlauf: d.k, anker_beat: d.anfang, ende_beat: d.ende, naechste: s.naechste !== null };
}
// 1.12 S7: one watcher per loop track (like musterTimer, 50 ms, core beat instead of wall clock). MAJOR 1: it is serial; while a pass is
// being planned (lauf.planend, set before the first await) further ticks do nothing, so two ticks during one await never plan a pass twice.
export function schleifenWaechter(this: Oberflaeche, name: string, lauf: SpurLauf): void {
  const zeit = setInterval(() => {
    if (this.spuren.get(name) !== lauf) { clearInterval(zeit); return; }
    if (lauf.planend !== undefined) return;
    void this.schleifenTakt(name, lauf);
  }, 50);
  zeit.unref();
  lauf.timer.push(zeit);
}
// One tick. MAJOR 2: the pass to send is the one starting at anker_naechster; once the core beat is within VORLAUF_SCHLEIFE_BEATS of it,
// it goes out. If its start is not in the future any more (the clock was away, the server was down), the missed passes are skipped:
// with k = floor((beat − anker_naechster) / 4n) + 1 passes dropped, the next start lies after the beat. A pass whose start lies in the
// past is never sent.
export async function schleifenTakt(this: Oberflaeche, name: string, lauf: SpurLauf): Promise<void> {
  const s = lauf.schleife as SchleifenStand, u = this.kern.uhr as unknown as { beat: number; bpm: number; mono_ns: number } | null;
  if (!u || u.beat < s.anker_naechster - VORLAUF_SCHLEIFE_BEATS) return;
  if (s.anker_naechster <= u.beat) {
    this.schleifeUeberspringen(name, s, Math.floor((u.beat - s.anker_naechster) / (this.proTakt() * s.n)) + 1, u.beat);
    if (u.beat < s.anker_naechster - VORLAUF_SCHLEIFE_BEATS) { this.spurenSichern(); return; }
  }
  lauf.planend = s.anker_naechster + this.proTakt() * s.n;   // sendeDurchlauf sets the exact end before its first await
  try { await this.sendeDurchlauf(name, lauf, u); } finally { lauf.planend = undefined; }
}
export function schleifeUeberspringen(this: Oberflaeche, name: string, s: SchleifenStand, weg: number, beat: number): void {
  this.opt.log?.({ typ: 'spur_schleife_uebersprungen', name, durchlauf: s.durchlauf, durchlaeufe: weg, ab_beat: s.anker_naechster, beat });
  s.anker_naechster += weg * this.proTakt() * s.n;
  s.durchlauf += weg;
}
// Send the pass at anker_naechster: wirt first (fahre with a start in the future), then the core parts (/k/teil, plan spur:<name>, part
// numbers continuing). After every await the loop must still be this one (MAJOR 1: a STOP during the await lets no part follow); a wirt
// error ends the loop with a log entry (there is no HTTP answer inside the watcher). spuren.json is written once per pass (MINOR 6).
export async function sendeDurchlauf(this: Oberflaeche, name: string, lauf: SpurLauf, u: { beat: number; bpm: number; mono_ns: number }): Promise<void> {
  const s = lauf.schleife as SchleifenStand;
  const spur: Spur = s.naechste ?? { name, fahrten: lauf.fahrten, schleife_takte: s.n };
  const g = planeDurchlauf(spur, s.anker_naechster, 0, s.teilNr, this.proTakt());
  lauf.planend = g.ende_beat;
  if (lauf.quelle === 'cypher') {   // MAJOR 3: Stop Cypher, AUTO and D8 hold for every pass of Cypher's loop, not only at the start
    const sperre = this.schleifenSperre(spur, g.teile);
    if (sperre) return this.schleifeBeenden(name, lauf, sperre);
  }
  for (const w of g.wirt) {
    const uhr = (this.kern.uhr as unknown as typeof u | null) ?? u;
    // The fahre and, if the run ended meanwhile, its compensating halte form one in-flight unit per track name: a new run of that name
    // waits for it (wirtFlugAbwarten), so the wirt sees old fahre, halte, new fahre in this order. A halte after the new fahre would drop the
    // new ramps; no halte would leave the old ramp where it is older than the new one (host_control.py: a fahre replaces only t0 >= its ab).
    const antwort = await this.wirtFlug(name, async () => {
      const r = await wirtRuf(this.wirtSock(w.gruppe), { befehl: 'fahre', name: w.name, bis: w.bis, dauer: w.dauer_beats * 60 / uhr.bpm,
        ab: beatZuMono(uhr, w.ab_beat), spur: name, form: w.form, ...(w.von !== undefined ? { von: w.von } : {}) });
      if (this.spuren.get(name) !== lauf && r.ok) await wirtRuf(this.wirtSock(w.gruppe), { befehl: 'halte', spur: name });   // stopped while waiting: the STOP's halte may have come first
      return r;
    });
    if (this.spuren.get(name) !== lauf) return;
    if (!antwort.ok) return this.schleifeBeenden(name, lauf, { grund: 'wirt', gruppe: w.gruppe, text: String(antwort.fehler ?? '') });
    lauf.gruppen.add(w.gruppe);
    this.opt.log?.({ typ: 'spur_wirt', name, gruppe: w.gruppe, parameter: w.name, ab_beat: w.ab_beat, durchlauf: s.durchlauf });
    if (Number(antwort.ersetzt) > 0) this.opt.log?.({ typ: 'spur_wirt_ersetzt', name, gruppe: w.gruppe, parameter: w.name, ersetzt: Number(antwort.ersetzt) });
  }
  const jetzt = (this.kern.uhr as unknown as { beat: number } | null)?.beat ?? u.beat;
  if (g.anfang_beat <= jetzt) {   // the wirt took so long that the start has passed: the core parts of this pass are not sent (MAJOR 2)
    this.opt.log?.({ typ: 'spur_schleife_uebersprungen', name, durchlauf: s.durchlauf, durchlaeufe: 1, ab_beat: g.anfang_beat, beat: jetzt });
    this.schleifeUebernimm(lauf, spur);
    s.durchlauf++;
    s.anker_naechster = g.ende_beat;   // the length of this pass, which may already be the new n
    this.spurenSichern();
    return;
  }
  for (const t of g.teile) {
    const kernPfad = this.kernPfadVon(t.pfad);
    if (kernPfad === null) { this.opt.log?.({ typ: 'spur_ziel_aufgeloest_nicht', name, pfad: t.pfad }); continue; }
    const felder = { id: Number(++this.id), quelle: lauf.quelle, plan: `spur:${name}`, teil: t.nr, pfad: kernPfad, ab_beat: t.ab_beat,
      dauer_beats: t.dauer_beats, nach: t.nach, form: t.form, politik: t.politik, gruppe: '', hoerschein: '' };
    this.kern.sende('/k/teil', felder);
    this.gesendet++;
    lauf.ids.push(felder.id);
    lauf.teile.push({ id: felder.id, teil: t.nr, pfad: t.pfad });
  }
  this.schleifeUebernimm(lauf, spur);
  s.durchlaeufe = [...s.durchlaeufe, { k: s.durchlauf, anfang: g.anfang_beat, ende: g.ende_beat, teile: g.teile.length, ...(this.proTakt() !== 4 ? { proTakt: this.proTakt() } : {}) }].slice(-2);
  const behalten = s.durchlaeufe.reduce((n, d) => n + d.teile, 0);   // MINOR 6: ids and teile of the last two passes only
  lauf.ids = behalten ? lauf.ids.slice(-behalten) : [];
  lauf.teile = behalten ? lauf.teile.slice(-behalten) : [];
  this.opt.log?.({ typ: 'spur_durchlauf', name, durchlauf: s.durchlauf, anfang_beat: g.anfang_beat, teile: g.teile.length, wirt: g.wirt.length });
  s.durchlauf++;
  s.teilNr += g.teile.length;
  s.anker_naechster = g.ende_beat;
  lauf.ende = g.ende_beat;
  this.spurenSichern();
}
// The line a pass used is now the loop's; a change that came in during the awaits stays waiting for the next pass
export function schleifeUebernimm(this: Oberflaeche, lauf: SpurLauf, spur: Spur): void {
  const s = lauf.schleife as SchleifenStand;
  lauf.fahrten = spur.fahrten;
  s.n = spur.schleife_takte as number;
  if (s.naechste === spur) s.naechste = null;
}
// Why Cypher's loop may not play its next pass (null: it may): Stop Cypher, AUTO off on a stream it moves (F4), a part that opens a
// closed channel against the current values (Plan Hand D8)
export function schleifenSperre(this: Oberflaeche, spur: Spur, teile: { pfad: string; nach: number }[]): Record<string, unknown> | null {
  if (this.kiGestoppt) return { grund: 'ki_gestoppt' };
  for (const f of spur.fahrten) {
    const st = this.stromVonZielOffen(f.ziel);
    if (st !== null && !leseMusterStand(this.musterOrdner(st)).autonom) return { grund: 'auto_aus', strom: st, ziel: f.ziel };
  }
  const p = oeffnetKanal(this.stand.regler, teile as Parameters<typeof oeffnetKanal>[1]);
  return p ? { grund: 'kein_hoerschein', pfad: p } : null;
}
// MAJOR 3: a hand on a target of Cypher's loop (the core reports holder mensch) ends that loop; Andreas' own loops keep running
export function schleifenHandgriff(this: Oberflaeche, pfad: string): void {
  for (const [name, l] of this.spuren) {
    if (!l.schleife || l.quelle !== 'cypher') continue;
    const ziele = [...l.fahrten, ...(l.schleife.naechste?.fahrten ?? [])].map((f) => f.ziel);
    if (ziele.includes(pfad)) void this.schleifeBeenden(name, l, { grund: 'hand', pfad });
  }
}
export async function schleifeBeenden(this: Oberflaeche, name: string, lauf: SpurLauf, grund: Record<string, unknown>): Promise<void> {
  if (this.spuren.get(name) !== lauf) return;
  this.opt.log?.({ typ: 'spur_schleife_ende', name, quelle: lauf.quelle, ...grund });
  await this.spurAbbrechen(name, lauf, lauf.quelle);
}
