import type { Antwort, Koerper, Offen } from './session.ts';
import { ProjFehler } from './session.ts';
import type { Quelle } from './core_path.ts';
import { alleInserts, sucheSpur, MAX_PLUGIN_REGLER, MAX_PLUGIN_INDEX, type Insert } from '../../project/model.ts';
import { LernFehler } from '../learn/store.ts';
import type { HostVerwaltung } from '../../plugins/hostverwaltung.ts';
import type { InstrumentWirte } from '../../plugins/instrumentwirte.ts';
import { surgeBereich, type SurgeSpiegel } from './surge.ts';

// The part of ProjSitzung that the plugin and device parameter calls of a session reach (the rest stays with the session).
export interface GeraetHost {
  brauchOffen(): Offen;
  riegel(quelle: Quelle): void;
  readonly hosts: HostVerwaltung;
  readonly instrumente: InstrumentWirte;
  readonly surge: SurgeSpiegel;
  /** a project command list as one history step (`ProjSitzung.aendern`) */
  aendere(d: Koerper, quelle: Quelle): Promise<Antwort>;
  /** strand 2 task 2.4: sets the assigned knob rows of a stage to the plugin's current values */
  pickup(insertId: string): Promise<void>;
  /** the learn Bereich (set after the session is built; null before) */
  lernen(): ReglerLernen | null;
}

/** What the knob learn route borrows from the learn Bereich (areas/learn/area.ts `LernenBereich`). */
export interface ReglerLernen {
  pruefeBereit(): void;
  arme(pfad: string): void;
  wartet(): string | null;
  abbrechen(): void;
  loesche(pfad: string): Promise<void>;
  /** the paths that have a learned CC assignment */
  gelernt(): Set<string>;
}

const knopfPfad = (insert: Insert, knopf: number): string => `plug/${String(insert.slot)}/k${String(knopf)}`;
const alsProjFehler = (e: unknown): unknown => (e instanceof LernFehler ? new ProjFehler(e.code, e.grund) : e);   // the reason's own text comes from reasons.ts

export class SitzungGeraet {
  private readonly h: GeraetHost;
  constructor(h: GeraetHost) { this.h = h; }
  // POST /proj/insert/<insert_id>/param {werte: {<index>: 0..1}} (plan 1.11 D3): a plugin knob goes straight to the host.
  // It is no command: no history entry, no project write, not queued behind a playback load. Stop Cypher blocks the source cypher.
  async insertParam(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> {
    this.h.riegel(quelle);
    const o = this.h.brauchOffen();
    const t = alleInserts(o.projekt).find((x) => x.insert.id === insertId);
    if (!t || t.insert.art !== 'host') throw new ProjFehler(404, 'insert_unbekannt');
    const roh = d.werte;
    if (roh === null || typeof roh !== 'object' || Array.isArray(roh) || Object.keys(roh).length < 1 || Object.keys(roh).length > 256) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: 'werte: an object {index: 0..1} with 1 to 256 entries is required' });
    }
    const werte: Record<string, number> = {};
    for (const [k, v] of Object.entries(roh as Record<string, unknown>)) {
      if (!/^\d{1,5}$/.test(k) || typeof v !== 'number' || !Number.isFinite(v)) {
        throw new ProjFehler(400, 'argument_ungueltig', { text: 'werte: every key is a parameter index and every value a number from 0 to 1' });
      }
      werte[k] = v;
    }
    const r = await this.h.hosts.param(insertId, werte);
    if (!r.ok) {
      if (r.fehler === 'wert_ungueltig') throw new ProjFehler(400, 'argument_ungueltig', { text: 'werte: a value the plugin host refused' });
      throw new ProjFehler(r.fehler === 'param_unbekannt' ? 404 : 409, r.fehler);
    }
    return { code: 200, j: { ok: true, werte: r.werte } };
  }
  // GET /proj/insert/<insert_id>/parameter (plan 1.11 T10): the host's parameter list joined with the current values
  async insertParameter(insertId: string): Promise<Antwort> {
    const o = this.h.brauchOffen();
    const t = alleInserts(o.projekt).find((x) => x.insert.id === insertId);
    if (!t || t.insert.art !== 'host') throw new ProjFehler(404, 'insert_unbekannt');
    const r = await this.h.hosts.parameter(insertId);
    if (!r.ok) throw new ProjFehler(409, r.fehler);
    // strand 2 task 2.4: per parameter the knob (1..16) that drives it and whether a CC is learned onto that knob
    const regler = t.insert.regler ?? [];
    const gelernt = this.h.lernen()?.gelernt() ?? new Set<string>();
    const parameter = r.parameter.map((q) => {
      const m = regler.indexOf(Number(q.index));
      return m < 0 ? q : { ...q, knopf: m + 1, gelernt: gelernt.has(knopfPfad(t.insert, m + 1)) };
    });
    return { code: 200, j: { insert_id: insertId, parameter } };
  }
  // POST /proj/insert/<insert_id>/lernen {index} (strand 2 task 2.4): the parameter gets the knob it already has or the lowest free one (one history
  // step "Controller"), the knob row takes the plugin's current value, then the learn flow waits for a controller. Andreas' hand only.
  async insertLernen(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> {
    if (quelle !== 'andreas') throw new ProjFehler(403, 'nur_andreas');
    const lernen = this.h.lernen();
    if (!lernen) throw new ProjFehler(409, 'kein_lernen');
    const index = this.indexArg(d);
    const o = this.h.brauchOffen();
    const t = alleInserts(o.projekt).find((x) => x.insert.id === insertId);
    if (!t || t.insert.art !== 'host') throw new ProjFehler(404, 'insert_unbekannt');
    try { lernen.pruefeBereit(); } catch (e) { throw alsProjFehler(e); }
    const liste = t.insert.regler ?? [];
    let m = liste.indexOf(index);
    if (m < 0) {
      m = liste.findIndex((v) => v === null);
      if (m < 0) m = liste.length;
      if (m >= MAX_PLUGIN_REGLER) throw new ProjFehler(409, 'plugin_regler_voll');
      const r = await this.knopfSetzen(o.projekt.rev, insertId, m + 1, index, quelle);
      if (r.code !== 200) return r;
    }
    const pfad = knopfPfad(t.insert, m + 1);
    await this.h.pickup(insertId);
    try { lernen.arme(pfad); } catch (e) { throw alsProjFehler(e); }
    return { code: 200, j: { ok: true, pfad, knopf: m + 1 } };
  }
  // POST /proj/insert/<insert_id>/lernen/loeschen {index}: frees the knob of that parameter and removes the learned CC. Andreas' hand only.
  async insertLernenLoeschen(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> {
    if (quelle !== 'andreas') throw new ProjFehler(403, 'nur_andreas');
    const lernen = this.h.lernen();
    if (!lernen) throw new ProjFehler(409, 'kein_lernen');
    const index = this.indexArg(d);
    const o = this.h.brauchOffen();
    const t = alleInserts(o.projekt).find((x) => x.insert.id === insertId);
    if (!t || t.insert.art !== 'host') throw new ProjFehler(404, 'insert_unbekannt');
    const m = (t.insert.regler ?? []).indexOf(index);
    if (m < 0) throw new ProjFehler(404, 'keine_zuordnung');
    const pfad = knopfPfad(t.insert, m + 1);
    const r = await this.knopfSetzen(o.projekt.rev, insertId, m + 1, null, quelle);
    if (r.code !== 200) return r;
    if (lernen.wartet() === pfad) lernen.abbrechen();
    try { await lernen.loesche(pfad); } catch (e) {   // armed but never learned: nothing to remove
      if (!(e instanceof LernFehler && e.grund === 'keine_zuordnung')) throw alsProjFehler(e);
    }
    return { code: 200, j: { ok: true, pfad, knopf: m + 1 } };
  }
  private knopfSetzen(rev: unknown, insertId: string, knopf: number, index: number | null, quelle: Quelle): Promise<Antwort> {
    const befehle = [{ befehl: 'plugin_regler_setzen', insert_id: insertId, knopf, index }];
    return this.h.aendere({ rev, label: 'Controller', befehle }, quelle);
  }
  private indexArg(d: Koerper): number {
    const i = d.index;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i > MAX_PLUGIN_INDEX) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: `index: an integer 0..${String(MAX_PLUGIN_INDEX)} (the plugin parameter) is required` });
    }
    return i;
  }
  // POST /proj/insert/<insert_id>/fenster {an} (plan 1.11 T15, D4/D8): the plugin's own window; Andreas' hand only
  async insertFenster(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> {
    if (quelle !== 'andreas') throw new ProjFehler(403, 'nur_andreas');
    const o = this.h.brauchOffen();
    const t = alleInserts(o.projekt).find((x) => x.insert.id === insertId);
    if (!t || t.insert.art !== 'host') throw new ProjFehler(404, 'insert_unbekannt');
    if (typeof d.an !== 'boolean') throw new ProjFehler(400, 'argument_ungueltig', { text: 'an: true or false is required' });
    const r = await this.h.hosts.fenster(insertId, d.an);
    if (!r.ok) throw new ProjFehler(409, r.fehler);
    return { code: 200, j: { ok: true, fenster: r.fenster } };
  }
  // plan 1.11 task 17: parameters and window of the plugin instrument of a track (GET .../geraet/parameter, POST .../geraet/param, POST .../geraet/fenster)
  private pluginSpur(spurId: string): void {
    const o = this.h.brauchOffen();
    const g = sucheSpur(o.projekt, spurId)?.geraet;
    if (!g || g.art !== 'wirt' || g.name !== 'plugin') throw new ProjFehler(404, 'spur_unbekannt');
  }
  async geraetParam(spurId: string, d: Koerper, quelle: Quelle): Promise<Antwort> {
    this.h.riegel(quelle);
    this.pluginSpur(spurId);
    const roh = d.werte;
    if (roh === null || typeof roh !== 'object' || Array.isArray(roh) || Object.keys(roh).length < 1 || Object.keys(roh).length > 256) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: 'werte: an object {index: 0..1} with 1 to 256 entries is required' });
    }
    const werte: Record<string, number> = {};
    for (const [k, v] of Object.entries(roh as Record<string, unknown>)) {
      if (!/^\d{1,5}$/.test(k) || typeof v !== 'number' || !Number.isFinite(v)) {
        throw new ProjFehler(400, 'argument_ungueltig', { text: 'werte: every key is a parameter index and every value a number from 0 to 1' });
      }
      werte[k] = v;
    }
    const r = await this.h.instrumente.param(spurId, werte);
    if (!r.ok) {
      if (r.fehler === 'wert_ungueltig') throw new ProjFehler(400, 'argument_ungueltig', { text: 'werte: a value the plugin host refused' });
      throw new ProjFehler(r.fehler === 'param_unbekannt' ? 404 : 409, r.fehler);
    }
    return { code: 200, j: { ok: true, werte: r.werte } };
  }
  // front panels: the display values the host of a Surge track plays now, for the names (comma separated) the track's map does not hold yet
  async geraetIst(spurId: string, namenText: string): Promise<Antwort> {
    const g = sucheSpur(this.h.brauchOffen().projekt, spurId)?.geraet;
    if (!g || g.art !== 'wirt' || g.name !== 'surge') throw new ProjFehler(404, 'spur_unbekannt');
    const namen = namenText.split(',').filter((n) => n !== '');
    if (namen.length < 1 || namen.length > 64 || namen.some((n) => surgeBereich(n) === null)) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: 'namen: 1..64 comma separated Surge parameter names of surge_bereiche.json' });
    }
    const w = await this.h.surge.ist(g.slot, namen);
    if (!w) throw new ProjFehler(409, 'wirt_antwortet_nicht');
    return { code: 200, j: { spur_id: spurId, werte: w } };
  }
  async geraetParameter(spurId: string): Promise<Antwort> {
    this.pluginSpur(spurId);
    const r = await this.h.instrumente.parameter(spurId);
    if (!r.ok) throw new ProjFehler(409, r.fehler);
    return { code: 200, j: { spur_id: spurId, parameter: r.parameter } };
  }
  async geraetFenster(spurId: string, d: Koerper, quelle: Quelle): Promise<Antwort> {
    if (quelle !== 'andreas') throw new ProjFehler(403, 'nur_andreas');
    this.pluginSpur(spurId);
    if (typeof d.an !== 'boolean') throw new ProjFehler(400, 'argument_ungueltig', { text: 'an: true or false is required' });
    const r = await this.h.instrumente.fenster(spurId, d.an);
    if (!r.ok) throw new ProjFehler(409, r.fehler);
    return { code: 200, j: { ok: true, fenster: r.fenster } };
  }
}
