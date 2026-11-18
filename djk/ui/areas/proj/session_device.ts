import type { Antwort, Koerper, Offen } from './session.ts';
import { ProjFehler } from './session.ts';
import type { Quelle } from './core_path.ts';
import { alleInserts, sucheSpur } from '../../project/model.ts';
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
}

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
    return { code: 200, j: { insert_id: insertId, parameter: r.parameter } };
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
