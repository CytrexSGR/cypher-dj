import type { Antwort, Koerper, Offen } from './session.ts';
import { ProjFehler } from './session.ts';
import type { BereichKontext } from '../../http/router.ts';
import {
  KERN_AUTO_ZIELE, autoAblehnung, istKernAutoZiel, quittungAbgelehnt, type KernWeg, type Quelle, type Quittung,
} from './core_path.ts';
import { AUFNAHME_ZIELE, modusVon, type AufnahmeZiel, type AutoAufnahme, type Modus } from './recording_auto.ts';
import { sucheSpur, wertImBereich, type Projekt, type Spur, type Ziel } from '../../project/model.ts';

// The part of ProjSitzung that the automation mirror and the arm calls reach (the rest stays with the session). The `get` members read live fields.
export interface AutoHost {
  aendern(d: Koerper, quelle: Quelle, erwartet?: Offen): Promise<Antwort>;
  readonly aufAuto: AutoAufnahme;
  brauchOffen(): Offen;
  readonly ctx: BereichKontext;
  readonly kern: KernWeg;
  readonly offen: Offen | null;
  riegel(quelle: Quelle): void;
  readonly uebersteuert: Map<string, { nr: number; ziele: Set<string> }>;
}

export class SitzungAuto {
  private readonly h: AutoHost;
  private armKette: Promise<void> = Promise.resolve();   // task 8: the arm calls, one at a time
  constructor(h: AutoHost) { this.h = h; }
  istUebersteuert(spurId: string, ziel: string): boolean { return this.h.uebersteuert.get(spurId)?.ziele.has(ziel) === true; }
  // The overridden fields of tracks that still exist, in track order: [{spur_id, ziel}] (stale entries of deleted tracks are not shown)
  uebersteuertListe(p: Projekt): { spur_id: string; ziel: string }[] {
    const liste: { spur_id: string; ziel: string }[] = [];
    for (const s of p.spuren) for (const z of KERN_AUTO_ZIELE) if (this.istUebersteuert(s.id, z)) liste.push({ spur_id: s.id, ziel: z });
    return liste;
  }
  // Track numbers are reused (a new track takes the lowest free nr): an entry that remembers a number now held by ANOTHER track is the mark of a
  // deleted track and is dropped, so an undo of the delete cannot bring it back. Called before the mirror is read or fed.
  raeumeNummern(p: Projekt | undefined): void {
    if (!p || !this.h.uebersteuert.size) return;
    for (const [id, e] of this.h.uebersteuert) if (p.spuren.some((x) => x.nr === e.nr && x.id !== id)) this.h.uebersteuert.delete(id);
  }
  // /e/auto spur(1..32 = track number nr), ziel, zustand: idempotent (the core repeats the full state after an event overflow)
  nimmAuto(f: Record<string, unknown>): void {
    const nr = Number(f.spur), ziel = String(f.ziel), an = Number(f.zustand) === 1;
    if (!istKernAutoZiel(ziel)) return;
    this.raeumeNummern(this.h.offen?.projekt);
    const s = this.h.offen?.projekt.spuren.find((x) => x.nr === nr);
    // the id of the track with this number: from the project, or (a deleted track) from the mirror entry that remembered it
    const id = s?.id ?? [...this.h.uebersteuert].find(([, e]) => e.nr === nr)?.[0];
    if (id === undefined) return;                                            // no such track and nothing remembered: nothing to mirror
    const e = this.h.uebersteuert.get(id) ?? { nr, ziele: new Set<string>() };
    if (an) { if (!s) return; e.ziele.add(ziel); } else e.ziele.delete(ziel);   // a mark is only set for a track that exists
    if (e.ziele.size) this.h.uebersteuert.set(id, e); else this.h.uebersteuert.delete(id);
  }
  private autoZiel(d: Koerper): string {
    if (!istKernAutoZiel(d.ziel)) throw new ProjFehler(400, 'auto_ziel_unbekannt');
    return d.ziel;
  }
  private autoSpur(d: Koerper): Spur {
    if (typeof d.spur_id !== 'string') throw new ProjFehler(400, 'argument_ungueltig', { text: 'spur_id: a track id is required' });
    const s = sucheSpur(this.h.brauchOffen().projekt, d.spur_id);
    if (!s) throw new ProjFehler(404, 'spur_unbekannt');
    return s;
  }
  // The core's answer to a /k/arr/auto: a refusal becomes an error (nur_andreas for Cypher's override, D9), no core is 503. The mirror is not
  // touched here: it follows /e/auto only (D5: while the transport stops, `an 0` is acknowledged and nothing changes).
  private autoAntwort(q: Quittung, extra: Record<string, unknown>): Antwort {
    if (q === null) throw new ProjFehler(503, 'kein_kern');
    if (quittungAbgelehnt(q)) { const [code, fehler] = autoAblehnung(q.grund); throw new ProjFehler(code, fehler, { kern: q }); }
    return { code: 200, j: { ok: true, quittung: q, ...extra } };
  }
  // D4: the page (pointerdown, keydown on a range) asks for the override of one field of one track; `an 0` goes to the core with the real source
  async autoUebersteuern(d: Koerper, quelle: Quelle): Promise<Antwort> {
    this.h.riegel(quelle);
    const s = this.autoSpur(d), ziel = this.autoZiel(d);
    return this.autoAntwort(await this.h.kern.auto(s.nr, ziel, 0, quelle), { spur_id: s.id, ziel });
  }
  // `{alle: true}` gives every lane back (spur 0), `{spur_id, ziel}` one; allowed for both sources
  async autoReEnable(d: Koerper, quelle: Quelle): Promise<Antwort> {
    this.h.riegel(quelle);
    if (d.alle === true) return this.autoAntwort(await this.h.kern.auto(0, 'fader', 1, quelle), { alle: true });
    if (d.alle !== undefined && d.alle !== false) throw new ProjFehler(400, 'argument_ungueltig', { text: 'alle: true, or spur_id and ziel' });
    const s = this.autoSpur(d), ziel = this.autoZiel(d);
    return this.autoAntwort(await this.h.kern.auto(s.nr, ziel, 1, quelle), { spur_id: s.id, ziel });
  }

  // --- 1.12 slice 3 (task 8): arm and takes -------------------------------------------------------------------------------
  async armFreiMitLog(): Promise<void> {
    try {
      const q = await this.h.kern.armFrei();
      if (q === null || quittungAbgelehnt(q)) this.h.ctx.log({ typ: 'proj_arm_frei_fehler', quittung: q });
    } catch (e) { this.h.ctx.log({ typ: 'proj_arm_frei_fehler', fehler: (e as Error).message }); }
  }
  // D16: one aendern with the label `Record ...` (one undo step); rev_veraltet is read again, the rest is thrown to the collector
  async schreibeTake(label: string, befehle: Record<string, unknown>[], kennung: Offen): Promise<void> {
    for (let versuch = 0; ; versuch++) {
      if (this.h.offen !== kennung) throw new ProjFehler(409, 'projekt_gewechselt');
      try { await this.h.aendern({ rev: kennung.projekt.rev, label, befehle }, 'andreas', kennung); return; } catch (e) {
        if ((e as { grund?: string }).grund === 'rev_veraltet' && versuch < 4) continue;
        throw e;
      }
    }
  }
  private armAnsicht(): { modus: string; spuren: string[] } { return this.h.aufAuto.ansicht(); }
  private armMelden(): void { this.h.ctx.verteile({ a: 'proj', f: { auto_arm: this.armAnsicht() } }); }
  // POST /proj/auto/arm. {spur_id, an: true|false, modus?}: arm or disarm one track; {alle: true}: disarm all; {modus} alone: switch the mode and send the
  // arm again for every armed track (D11). Only Andreas arms: the core refuses the source cypher with nur_andreas (D9 style); the AI stop comes first.
  // The arm calls run one at a time (their own chain): two overlapping calls would interleave their core calls and leave core and server different.
  autoArm(d: Koerper, quelle: Quelle): Promise<Antwort> {
    const p = this.armKette.then(() => this.autoArmEins(d, quelle));
    this.armKette = p.then(() => undefined, () => undefined);
    return p;
  }
  private async autoArmEins(d: Koerper, quelle: Quelle): Promise<Antwort> {
    this.h.riegel(quelle);
    // D9: only Andreas arms. Refused here, before any state changes, for every body form (the core refuses the source too)
    if (quelle !== 'andreas') throw new ProjFehler(403, 'nur_andreas');
    const m = d.modus === undefined ? null : modusVon(d.modus);
    if (d.modus !== undefined && m === null) throw new ProjFehler(400, 'argument_ungueltig', { text: 'modus: touch, latch, write (or 0, 1, 2) expected' });
    const alt = this.h.aufAuto.modusNr(), modus = m ?? alt;
    const offen = this.h.offen;                                       // the project this call means; checked again after every wait for the core
    const q0: Quittung[] = [];
    const pruefe = (q: Quittung): void => {
      if (q === null) throw new ProjFehler(503, 'kein_kern');
      if (quittungAbgelehnt(q)) { const [code, fehler] = autoAblehnung(q.grund); throw new ProjFehler(code, fehler, { kern: q }); }
      q0.push(q);
    };
    const gleich = (): void => {
      if (this.h.offen === offen) return;
      void this.armFreiMitLog();                                    // the open ended every arm; a late acknowledgement must not leave one behind
      throw new ProjFehler(409, 'projekt_gewechselt');
    };
    if (d.alle === true) {
      pruefe(await this.h.kern.arm(0, 0, modus, quelle));
      gleich();
      this.h.aufAuto.alleFrei();
    } else if (d.spur_id !== undefined || m !== null) {
      // the steps: the named track (arm or disarm), and with a mode every other armed track again in the new mode. Each step remembers the state
      // before it, so a failure halfway rolls the steps already done back; if that fails too, everything is disarmed in core and session (equal)
      const schritte: { nr: number; an: boolean; id: string; vorher: { an: boolean; modus: Modus } }[] = [];
      let ziel: { id: string; nr: number; an: boolean } | null = null;
      if (d.spur_id !== undefined) {
        const s = this.autoSpur(d), an = d.an !== false;
        if (typeof d.an !== 'boolean' && d.an !== undefined) throw new ProjFehler(400, 'argument_ungueltig', { text: 'an: true or false expected' });
        ziel = { id: s.id, nr: s.nr, an };
        schritte.push({ nr: s.nr, an, id: s.id, vorher: { an: this.h.aufAuto.armiert(s.id), modus: alt } });
      }
      // a mode alone re-sends the arm of every armed track even if the mode did not change (a resync); with a named track only a change does
      if (m !== null && (m !== alt || d.spur_id === undefined)) {
        for (const a of this.h.aufAuto.armiertListe()) if (a.id !== ziel?.id) schritte.push({ nr: a.nr, an: true, id: a.id, vorher: { an: true, modus: alt } });
      }
      const getan: typeof schritte = [];
      try {
        for (const x of schritte) {
          const q = await this.h.kern.arm(x.nr, x.an ? 1 : 0, modus, quelle);
          if (q === null) getan.push(x);      // no acknowledgement: the outcome is unknown, so the step is rolled back too
          pruefe(q);
          if (q !== null) getan.push(x);
          gleich();
        }
      } catch (e) {
        if ((e as { grund?: string }).grund !== 'projekt_gewechselt') await this.armZurueck(getan);
        throw e;
      }
      if (m !== null) this.h.aufAuto.setzeModus(m);   // the mode changes only after the core acknowledged
      if (ziel) this.h.aufAuto.armiereNur(ziel.id, ziel.nr, ziel.an);
    } else throw new ProjFehler(400, 'argument_ungueltig', { text: 'spur_id and an, or alle: true, or modus' });
    this.armMelden();
    return { code: 200, j: { ok: true, quittung: q0.at(-1) ?? null, auto_arm: this.armAnsicht() } };
  }
  // Roll the arm calls already acknowledged back to the state before them (the server never changed). A rollback the core refuses leaves core and
  // server different, so then everything is disarmed on both sides: unequal states are the one result this must not give.
  private async armZurueck(getan: { nr: number; an: boolean; vorher: { an: boolean; modus: Modus } }[]): Promise<void> {
    try {
      for (const x of [...getan].reverse()) {
        const q = await this.h.kern.arm(x.nr, x.vorher.an ? 1 : 0, x.vorher.modus, 'andreas');
        if (q === null || quittungAbgelehnt(q)) throw new Error('rollback refused');
      }
    } catch (e) {
      this.h.ctx.log({ typ: 'proj_arm_zurueck_fehler', fehler: (e as Error).message });
      await this.armFreiMitLog();
      this.h.aufAuto.alleFrei();
      this.armMelden();
    }
  }
  // POST /proj/auto/geste: a mouse or keyboard value of one field of an armed track while the transport plays (D12 mouse time base).
  // {spur_id, ziel, wert?, ende?: true, quelle?: "maus"|"tasten"}. ende closes the gesture (pointerup, pointercancel, lostpointercapture, window blur).
  autoGeste(d: Koerper, quelle: Quelle): Antwort {
    this.h.riegel(quelle);
    if (quelle !== 'andreas') throw new ProjFehler(403, 'nur_andreas');
    const s = this.autoSpur(d);
    if (!(AUFNAHME_ZIELE as readonly unknown[]).includes(d.ziel)) throw new ProjFehler(400, 'auto_ziel_unbekannt');
    if (d.wert !== undefined && (typeof d.wert !== 'number' || !Number.isFinite(d.wert))) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: 'wert: a number expected' });
    }
    if (d.wert !== undefined && !wertImBereich(d.ziel as Ziel, d.wert)) {            // the range of a lane value (one rule: model.ts), refused at the entry
      throw new ProjFehler(400, 'argument_ungueltig', { text: `wert: ${d.ziel} is out of range` });
    }
    if (d.wert === undefined && d.ende !== true) throw new ProjFehler(400, 'argument_ungueltig', { text: 'wert, or ende: true' });
    if (d.quelle !== undefined && d.quelle !== 'maus' && d.quelle !== 'tasten') {
      throw new ProjFehler(400, 'argument_ungueltig', { text: 'quelle: maus or tasten' });
    }
    const wert = d.wert === undefined ? null : Number(d.wert);
    const r = this.h.aufAuto.mausPunkt(s.id, d.ziel as AufnahmeZiel, wert, d.ende === true, d.quelle === 'tasten' ? 'tasten' : 'maus');
    return { code: 200, j: { ok: true, aufgenommen: r.aufgenommen, beat: r.beat } };
  }
}
