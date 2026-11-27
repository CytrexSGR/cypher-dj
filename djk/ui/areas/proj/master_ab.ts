// Loudness-matched A/B of the production master chain (POST/GET /proj/master_ab). A = the project as it is, B = every insert stage of the master
// switched off. Both sides are measured once from an offline render of the range (Ausgabe.rendereMasterAB); the louder side is turned down by the
// difference. Switching sides sets live control rows only (ProjZugang.hoereMaster, the way FIND SOUND COMPARE does): the project is never written and
// no undo step is made.
//
// Every way out restores the rows to the project's own values: `{ an: false }`, a stale revision on `seite`, a project change (stand hook), a project
// close (close hook, sent while the closing project is still open), the idle end (no request for IDLE_MS) and a failed send. A new project load and a
// core restart send all rows of the project anyway. A restart of the page server while A/B is on is covered by the marker file (master_ab_marker.ts):
// the project open of the restart path puts the marked rows back and never takes the fader offset into the project (session.ts).
import type { Projekt } from '../../project/model.ts';
import { AB_MAX_DB, abAusgleich, abMarkePfade, abSperre, abZeilen, type AbAusgleich, type AbSeite, type AbZeile } from '../../project/master_ab.ts';
import { AusgabeFehler, type Ausgabe } from './output.ts';
import type { ProjZugang } from './area.ts';
import type { AbMarkeZugang } from './master_ab_marker.ts';

type Quelle = 'andreas' | 'cypher';
export type AbZustand = 'aus' | 'misst' | 'an' | 'veraltet' | 'fehler';
export interface AbLage {
  an: boolean; seite: AbSeite | null; a_lufs: number | null; b_lufs: number | null; ausgleich_db: number; leiser: AbSeite | null;
  rev: number | null; zustand: AbZustand; text: string;
  /** false: no level match was possible (see `text`); true when A/B is off */
  abgeglichen: boolean;
}
export interface MasterABAbhaengig {
  ausgabe: { rendereMasterAB: Ausgabe['rendereMasterAB']; analyseVorpruefung: Ausgabe['analyseVorpruefung'] };
  zugang: { offen(): { slug: string; projekt: Projekt } | null; hoereMaster: (z: readonly AbZeile[], q: Quelle) => Promise<void>;
    beiSchliessen?: ProjZugang['beiSchliessen']; beiStand?: ProjZugang['beiStand']; beiNeustart?: ProjZugang['beiNeustart'] };
  /** The marker file of a running A/B (a page server restart reads it to put the project's rows back); absent: none is kept. */
  marke?: Pick<AbMarkeZugang, 'schreibe' | 'loesche'>;
  quelle: () => Quelle;
  log: (z: Record<string, unknown>) => void;
  /** Timer of the idle end (default setTimeout / clearTimeout, unref'd). */
  setzeTimer?: (f: () => void, ms: number) => unknown;
  loescheTimer?: (h: unknown) => void;
  leerlaufMs?: number;
}
/** A/B that got no request for this long ends itself and restores the project rows (the page polls GET every second while it looks at a running A/B). */
export const AB_LEERLAUF_MS = 30 * 60_000;
const OHNE: AbAusgleich = { leiser: null, db: 0 };
const fehl = (grund: string, text: string): never => { throw new AusgabeFehler(grund, text); };

export class MasterAB {
  private readonly a: MasterABAbhaengig;
  private zustand: AbZustand = 'aus';
  private seite: AbSeite | null = null;
  private lufs: { a: number | null; b: number | null } = { a: null, b: null };
  private aus: AbAusgleich = OHNE;
  private rev: number | null = null;
  private slug: string | null = null;
  private text = 'A/B is off';
  private ungleich: string | null = null;   // why the sides are not level-matched, or null
  private timer: unknown = null;

  constructor(a: MasterABAbhaengig) {
    this.a = a;
    // a project that closes ends A/B: the rows of the closing project (still open at this call) go back before the project is gone
    a.zugang.beiSchliessen?.(() => { if (this.laeuft()) void this.beendeStill(a.zugang.offen()?.projekt ?? null, 'the project was closed'); });
    // any project change (a new revision, another project) ends A/B at once; the stand hook runs after the new project is assigned
    // a core restart: the new core gets the project's own rows (nachNeustart), so A/B ends without sending rows; only the marker goes
    a.zugang.beiNeustart?.(() => {
      if (!this.laeuft()) return;
      this.setzeAus('A/B ended: the audio engine restarted');
      this.a.marke?.loesche();
    });
    a.zugang.beiStand?.((p) => {
      if (!this.laeuft() || this.rev === null) return;
      const o = a.zugang.offen();
      if (o && o.slug === this.slug && p.rev === this.rev) return;
      void this.beendeStill(o && o.slug === this.slug ? p : null, 'the project changed');
    });
  }

  private laeuft(): boolean { return this.zustand === 'an' || this.zustand === 'veraltet'; }
  private veraltet(): boolean {
    const o = this.a.zugang.offen();
    return !o || o.slug !== this.slug || o.projekt.rev !== this.rev;
  }
  private fehlerText(e: unknown): string {
    return (e as { extra?: { text?: string } }).extra?.text ?? (e instanceof Error ? e.message : String(e));
  }
  private sende(zeilen: AbZeile[]): Promise<void> { return this.a.zugang.hoereMaster(zeilen, this.a.quelle()); }

  // the project's own rows (its switches and its fader) back into the core; never throws
  // the marker goes only after the rows are back (a failed restore keeps it: a restart then sends them again)
  private async stelleHer(p: Projekt | null): Promise<void> {
    if (!p) return;
    try { await this.sende(abZeilen(p, 'a', OHNE)); this.a.marke?.loesche(); } catch (e) {
      this.a.log({ typ: 'proj_master_ab_rueckweg_fehler', fehler: this.fehlerText(e) });
    }
  }
  // ends A/B (state first, so a second path sees `aus`), then restores `p`'s rows (null: there is no project to restore)
  private async beendeStill(p: Projekt | null, grund: string): Promise<void> {
    this.setzeAus(`A/B ended: ${grund}`);
    await this.stelleHer(p);
  }
  private setzeAus(text: string): void {
    this.stoppeTimer();
    this.zustand = 'aus'; this.seite = null; this.aus = OHNE; this.ungleich = null; this.text = text;
  }
  private stoppeTimer(): void {
    if (this.timer === null) return;
    (this.a.loescheTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.timer);
    this.timer = null;
  }
  private beruehre(): void {
    this.stoppeTimer();
    if (!this.laeuft()) return;
    const f = (): void => {
      this.timer = null;
      if (this.laeuft()) void this.beendeStill(this.a.zugang.offen()?.projekt ?? null, 'no request for a long time');
    };
    const h = this.a.setzeTimer ? this.a.setzeTimer(f, this.a.leerlaufMs ?? AB_LEERLAUF_MS) : setTimeout(f, this.a.leerlaufMs ?? AB_LEERLAUF_MS);
    if (!this.a.setzeTimer) (h as NodeJS.Timeout).unref();
    this.timer = h;
  }
  private seitenText(): string {
    const { leiser, db } = this.aus, cut = db.toFixed(1);
    const vor = this.ungleich === null ? '' : `not level-matched: ${this.ungleich}; `;
    if (this.seite === 'b') {
      return vor + (leiser === 'b' ? `B: master stages bypassed, turned down ${cut} dB to match A` : 'B: master stages bypassed, at project level');
    }
    return vor + (leiser === 'a' ? `A: processed, turned down ${cut} dB to match B` : 'A: processed, at project level');
  }

  lage(): AbLage {
    if (this.zustand === 'an' && this.veraltet()) { this.zustand = 'veraltet'; this.text = 'the project changed since the measurement; switch A/B off'; }
    this.beruehre();
    const an = this.laeuft();
    return { an, seite: an ? this.seite : null, a_lufs: an ? this.lufs.a : null, b_lufs: an ? this.lufs.b : null,
      ausgleich_db: an ? this.aus.db : 0, leiser: an ? this.aus.leiser : null, rev: an ? this.rev : null, zustand: this.zustand,
      text: an && this.zustand === 'an' ? this.seitenText() : this.text, abgeglichen: !an || this.ungleich === null };
  }

  async steuere(d: Record<string, unknown>): Promise<AbLage> {
    for (const k of Object.keys(d)) if (!['an', 'seite', 'von_beat', 'bis_beat'].includes(k)) fehl('argument_ungueltig', `unknown field ${k}`);
    if (d.an !== undefined && typeof d.an !== 'boolean') fehl('argument_ungueltig', 'an: true or false is required');
    if (d.seite !== undefined && d.seite !== 'a' && d.seite !== 'b') fehl('argument_ungueltig', 'seite: "a" or "b" is required');
    if ((d.an === undefined) === (d.seite === undefined)) fehl('argument_ungueltig', 'exactly one of an and seite is required');
    if (d.an === true) return this.starte(d);
    if (d.an === false) return this.ende();
    return this.wechsle(d.seite as AbSeite);
  }

  private async starte(d: Record<string, unknown>): Promise<AbLage> {
    if (this.zustand === 'misst') fehl('beschaeftigt', 'the two sides are being measured; wait until it is done');
    const o = this.a.zugang.offen();
    if (!o) fehl('kein_projekt', 'no project is open');
    const sperre = abSperre(o.projekt);
    if (sperre === 'keine_stufe') fehl('keine_stufe', 'the master has no insert stage; there is nothing to bypass');
    if (sperre === 'master_lane') fehl('master_lane', 'the master fader has an automation lane; it would fight the A/B fader row');
    const v = this.a.ausgabe.analyseVorpruefung({ quelle: { art: 'master' }, von_beat: d.von_beat, bis_beat: d.bis_beat });
    const war = this.laeuft();
    this.stoppeTimer();
    this.zustand = 'misst'; this.seite = null; this.text = 'measuring both sides of the range';
    try {
      if (war) await this.sende(abZeilen(o.projekt, 'a', OHNE));   // a running A/B goes back to the project before it is measured again
      const m = await this.a.ausgabe.rendereMasterAB(v.von, v.bis);
      const jetzt = this.a.zugang.offen();
      if (!jetzt || jetzt.slug !== v.slug || jetzt.projekt.rev !== m.rev) {
        this.setzeAus('the project changed during the measurement');
        return fehl('ab_veraltet', 'the project changed during the measurement; start A/B again');
      }
      const aus = abAusgleich(m.a.lufs_i, m.b.lufs_i);
      const ungleich = m.a.lufs_i === null || m.b.lufs_i === null ? 'the loop range is silent'
        : Math.abs(m.a.lufs_i - m.b.lufs_i) > AB_MAX_DB ? `the difference is over ${AB_MAX_DB} dB` : null;
      this.a.marke?.schreibe(jetzt.slug, abMarkePfade(jetzt.projekt));   // before the first live row; a failing write refuses the start
      try { await this.sende(abZeilen(jetzt.projekt, 'a', aus)); } catch (e) { await this.stelleHer(jetzt.projekt); throw e; }
      this.lufs = { a: m.a.lufs_i, b: m.b.lufs_i }; this.aus = aus; this.ungleich = ungleich;
      this.rev = m.rev; this.slug = v.slug; this.seite = 'a'; this.zustand = 'an';
      this.beruehre();
      return this.lage();
    } catch (e) {
      if (this.zustand === 'misst') { this.zustand = 'fehler'; this.seite = null; this.aus = OHNE; this.text = this.fehlerText(e); }
      throw e;
    }
  }

  private async wechsle(seite: AbSeite): Promise<AbLage> {
    if (!this.laeuft()) fehl('ab_nicht_an', 'A/B is not on; switch it on first');
    const o = this.a.zugang.offen();
    if (this.veraltet() || !o) {
      await this.beendeStill(o && o.slug === this.slug ? o.projekt : null, 'the project changed');
      return fehl('ab_veraltet', 'the project changed since the measurement; start A/B again');
    }
    try { await this.sende(abZeilen(o.projekt, seite, this.aus)); } catch (e) {
      this.setzeAus(this.fehlerText(e)); this.zustand = 'fehler';
      await this.stelleHer(o.projekt);
      throw e;
    }
    this.seite = seite;
    this.beruehre();
    return this.lage();
  }

  private async ende(): Promise<AbLage> {
    if (this.zustand === 'misst') fehl('beschaeftigt', 'the two sides are being measured; wait until it is done');
    const o = this.a.zugang.offen();
    this.setzeAus('A/B is off');
    // always sent when a project is open, even when A/B was not on: a retry after a failed send must still restore the rows
    if (o) { await this.sende(abZeilen(o.projekt, 'a', OHNE)); this.a.marke?.loesche(); }
    return this.lage();
  }
}
