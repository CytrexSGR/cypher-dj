// 1.8 Slice 1: Bereich proj-aufnahme. POST /proj/aufnahme {aktion: start|stopp, von_beat?}, GET /proj/aufnahme (Lauf und letztes Ergebnis).
// Besitzt den Ablauf: Spuren im
// Kern scharf stellen (/k/rec/spur), /k/rec/start, dann der gewöhnliche Transport; beim Stopp Transport aus, auf /e/aufnahme warten, Rohdatei
// -> WAV -> Clip (EIN Undo-Schritt).
// Schutz wie proj (fremdePost). Während des Laufs hält er die Aufnahme-Sperre (sperreLaden('aufnahme'): kein Öffnen/Neu, keine
// wiedergabewirksame Änderung, kein Freeze,
// aber der eigene Transport-Start geht durch, B1) und sperrt Tempo-Änderungen (aufnahmeLauf). Abweichung zur Spec: der Lauf steht unter GET
// /proj/aufnahme, nicht in /proj/aktuell.
// Ein Lauf endet auf dem ersten von drei Wegen (M1, M2): (1) POST stopp; (2) der Take endet im Kern, weil der Transport anders endete
// (Transport-Knopf, Hand-Taste, Ende des
// Arrangements): alle /e/aufnahme des Laufs sind da; (3) der Kern verwirft die Aufnahme (Quittung 7 der Rec-ID: zu_spaet, abbruch, ki_stopp).
// In jedem Fall fällt die Sperre, und
// das Ergebnis liegt in `letzte` (GET /proj/aufnahme); ein späteres POST stopp liefert es einmal, statt keine_aufnahme zu melden.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { grundText } from '../../http/gruende.ts';
import { aendereStand } from '../../projekt/stand.ts';
import { eingangsCode, nehmeTakeAuf, schreibeWavAusF32, TakeFehler } from '../../projekt/aufnahme.ts';
import { MAX_BEAT, type Projekt } from '../../projekt/modell.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from './bereich.ts';
import { ProjFehler, type Antwort } from './sitzung.ts';

type Quelle = 'andreas' | 'cypher';
interface Meldung { spur: number; kennung: number; status: number; frames: number; start_sample: number; luecken: number }
interface Lauf {
  kennung: number; recId: number; startBeat: number; bpm: number; quelle: Quelle; seit: number; spuren: { id: string; nr: number; name: string }[];
  verworfen: string | null;                 // Grund der Quittung 7 (Kern verwirft), solange der Lauf schon als laufend galt
  abschluss: Promise<Antwort> | null;       // gesetzt, sobald der Lauf endet (eine Instanz für alle drei Wege)
}
interface Letzte { kennung: number; antwort: Antwort; geliefert: boolean }

// Frist des Kerns für den Transportstart nach /k/rec/start. Sie endet im Kern, sobald das Arrangement wartet (Quant); bis dahin deckt sie die
// 400 ms Quittungsweg dieses Befehls,
// eine Tempo-Rampe und den Weg des Transportbefehls. Die Vorgabe des Kerns (2 s) war kürzer als der Weg bei laufendem Deck (400 ms + bis 1,9 s Quant): M1.
export const KERN_FRIST_SAMPLES = 480000;   // 10 s
const GEMELDET_MAX = 64;

export class Aufnahme {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private lauf: Lauf | null = null;
  private letzte: Letzte | null = null;
  private frei: (() => void) | null = null;
  private arrStatus = 0;
  private kernBereinigt = false;
  private beobachtet: number | null = null;     // Rec-ID eines Starts, der noch läuft (this.lauf ist dann noch nicht gesetzt)
  private abbruch: string | null = null;        // Grund der Quittung 7 dieser Rec-ID
  private readonly imKern = new Set<number>();
  private readonly gemeldet = new Map<string, Meldung>();
  private readonly wartend = new Map<string, (m: Meldung | null) => void>();
  private readonly fristMs: number;
  constructor(ctx: BereichKontext, zugang: ProjZugang, fristMs = 30000) { this.ctx = ctx; this.zugang = zugang; this.fristMs = fristMs; }

  lage(): Antwort {
    const l = this.lauf, z = this.letzte;
    return { code: 200, j: {
      lauf: l ? { kennung: l.kennung, start_beat: l.startBeat, seit_ms: Date.now() - l.seit, spuren: l.spuren } : null,
      letzte: z ? { kennung: z.kennung, code: z.antwort.code, ...(z.antwort.j as Record<string, unknown>) } : null,
    } };
  }

  private async kern(adresse: '/k/rec/stopp', felder: Record<string, unknown>): Promise<void> {
    const id = this.ctx.sende(adresse, felder);
    const q = await this.ctx.warteQuittung(id);
    if (!q) throw new ProjFehler(409, 'kein_kern');
    if (q.status >= 6) throw new ProjFehler(409, q.grund || 'aufnahme_abgelehnt');
  }

  async start(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    const o = this.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    if (this.lauf) throw new ProjFehler(409, 'aufnahme_laeuft');
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    if (this.arrStatus !== 0) throw new ProjFehler(409, quelle === 'cypher' ? 'transport_laeuft' : 'ueberlappung');
    const beat = d.von_beat === undefined ? 0 : d.von_beat;
    if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 0 || beat > MAX_BEAT) throw new ProjFehler(400, 'beat_ungueltig');
    const scharf = o.projekt.spuren.filter((s) => s.art === 'audio' && s.aufnahme?.scharf && s.aufnahme.eingang);
    if (scharf.length === 0) throw new ProjFehler(409, 'nichts_scharf');
    // B1: die Aufnahme-Sperre, nicht die Freeze-Sperre (sie ließe den Transport-Start nicht durch). Synchron, vor dem ersten await: ein
    // zweiter gleichzeitiger Start
    // bekommt beschaeftigt; ebenso, solange ein Freeze, ein Export oder ein Öffnen läuft.
    const freigabe = this.zugang.sperreLaden('aufnahme');
    let behalten = false;
    this.abbruch = null;
    try {
      await this.zugang.tempoAnMaster();
      // Scharf-Stand im Kern angleichen: einmalig alle Spuren bereinigen (der Kern kann von früher armiert sein), dann nur die Unterschiede
      const nrScharf = new Set(scharf.map((s) => s.nr));
      const alle = this.kernBereinigt ? [...new Set([...this.imKern, ...nrScharf])] : Array.from({ length: 32 }, (_, i) => i + 1);
      const ids = alle.map((nr) => {   // alle Nachrichten zugleich senden, dann alle Quittungen abwarten (32 mal einzeln wären rund eine Sekunde)
        const s = scharf.find((x) => x.nr === nr);
        return { nr, an: nrScharf.has(nr),
          id: this.ctx.sende('/k/rec/spur', { spur: nr, scharf: s ? 1 : 0, eingang: s ? eingangsCode(s.aufnahme!.eingang!.name) : 0 }) };
      });
      for (const x of ids) {
        const q = await this.ctx.warteQuittung(x.id);
        if (!q) throw new ProjFehler(409, 'kein_kern');
        if (q.status >= 6) throw new ProjFehler(409, q.grund || 'aufnahme_abgelehnt');
        // auch aufnahme_laeuft, solange der Faden die letzte Datei schließt (m1)
        if (x.an) this.imKern.add(x.nr); else this.imKern.delete(x.nr);
      }
      this.kernBereinigt = true;
      const kennung = this.zugang.naechsteNummer();
      const recId = this.ctx.sende('/k/rec/start', { kennung, nachlauf_samples: 0, frist_samples: KERN_FRIST_SAMPLES });
      this.beobachtet = recId;
      const q0 = await this.ctx.warteQuittung(recId);
      if (!q0) throw new ProjFehler(409, 'kein_kern');
      if (q0.status >= 6) throw new ProjFehler(409, q0.grund || 'aufnahme_abgelehnt');
      // R1: wirft der Transport (transport_laeuft, tempo_*, Zustand), hat der Kern /k/rec/start schon: ohne /k/rec/stopp bliebe er bis zur Frist scharf
      // und nähme den nächsten Transport-Start als Take auf, den kein Lauf kennt.
      let t: Antwort;
      try { t = await this.zugang.transport({ aktion: 'start', beat }, quelle); } catch (e) {
        try { await this.kern('/k/rec/stopp', {}); } catch { /* der Kern bricht den wartenden Start ohnehin ab */ }
        throw e;
      }
      const tq = (t.j as { quittung?: { status: number } | null } | null)?.quittung;
      if (t.code !== 200 || tq === null || (tq && [4, 6, 7, 8].includes(tq.status))) {
        try { await this.kern('/k/rec/stopp', {}); } catch { /* der Kern bricht den wartenden Start ohnehin ab */ }
        return t.code === 200 ? { code: 409, j: { fehler: 'transport_abgelehnt', text: 'the transport did not start; nothing was recorded' } } : t;
      }
      // M1: hat der Kern die Aufnahme verworfen (Quittung 7 der Rec-ID: zu_spaet, abbruch, ki_stopp)? Dann läuft nichts mit. Der erste Entwurf
      // prüfte nur die Quittung des
      // Transports und meldete 200 laeuft; beim Stopp wartete er 30 s auf ein /e/aufnahme, das nie kam. Die Quittung 2 (Einsatz) kommt im
      // selben Block wie die des Transports.
      const rq = await this.ctx.warteQuittung(recId);
      const verworfen = this.abbruch ?? (rq && rq.status === 7 ? (rq.grund || 'abbruch') : null);
      if (verworfen !== null) {
        try { await this.zugang.transport({ aktion: 'stopp' }, quelle); } catch { /* der Transport endet ohnehin oder gehört nicht mehr uns */ }
        throw new ProjFehler(409, 'aufnahme_abgebrochen', { grund: verworfen });
      }
      this.lauf = { kennung, recId, startBeat: beat, bpm: o.projekt.tempo_bpm, quelle, seit: Date.now(), verworfen: null, abschluss: null,
        spuren: scharf.map((s) => ({ id: s.id, nr: s.nr, name: s.name })) };
      this.letzte = null;
      this.zugang.aufnahmeLauf(this.lauf);
      this.frei = freigabe;
      behalten = true;
      return { code: 200, j: { aufnahme: 'laeuft', kennung, spuren: this.lauf.spuren } };
    } finally {
      this.beobachtet = null;
      this.abbruch = null;
      if (!behalten) freigabe();
    }
  }

  private warteMeldung(nr: number, kennung: number): Promise<Meldung | null> {
    const k = `${nr}:${kennung}`;
    const da = this.gemeldet.get(k);
    if (da) return Promise.resolve(da);
    return new Promise((ok) => {
      const uhr = setTimeout(() => { this.wartend.delete(k); ok(null); }, this.fristMs);
      this.wartend.set(k, (m) => { clearTimeout(uhr); ok(m); });
    });
  }

  async stopp(quelle: Quelle): Promise<Antwort> {
    const l = this.lauf;
    if (!l) {
      const z = this.letzte;   // M2: der Lauf endete auf anderem Weg; das Ergebnis liegt bereit und wird einmal geliefert
      if (z && !z.geliefert) { z.geliefert = true; return z.antwort; }
      throw new ProjFehler(409, 'keine_aufnahme');
    }
    // N3: erst der Transport. Lehnt er ab (Cypher will einen Lauf stoppen, den Andreas gestartet hat: transport_laeuft), bleibt der Lauf
    // unberührt und die Sperre gehalten.
    // Der erste Entwurf gab den Lauf in einem finally frei, auch wenn der Stopp abgelehnt wurde; der Kern nahm weiter auf, der Server hielt nichts mehr.
    if (!l.abschluss) await this.zugang.transport({ aktion: 'stopp' }, quelle);
    try { return await this.beende(l); } finally { if (this.letzte?.kennung === l.kennung) this.letzte.geliefert = true; }
  }

  // Ein Ende pro Lauf, egal von welchem Weg (POST stopp, Meldungen des Kerns, Quittung 7)
  private beende(l: Lauf): Promise<Antwort> {
    l.abschluss ??= this.schliesseAb(l);
    return l.abschluss;
  }
  private async schliesseAb(l: Lauf): Promise<Antwort> {
    try {
      const antwort = l.verworfen !== null
        ? alsAntwort(new ProjFehler(409, 'aufnahme_abgebrochen', { grund: l.verworfen }), this.ctx)
        : await this.uebernehmen(l, await Promise.all(l.spuren.map((s) => this.warteMeldung(s.nr, l.kennung))));
      this.letzte = { kennung: l.kennung, antwort, geliefert: false };
      return antwort;
    } catch (e) {
      this.letzte = { kennung: l.kennung, antwort: alsAntwort(e, this.ctx), geliefert: false };
      throw e;
    } finally {
      this.lauf = null;
      this.zugang.aufnahmeLauf(null);
      for (const s of l.spuren) this.gemeldet.delete(`${s.nr}:${l.kennung}`);
      const f = this.frei; this.frei = null;
      if (f) f();
    }
  }

  private async uebernehmen(l: Lauf, meldungen: (Meldung | null)[]): Promise<Antwort> {
    const o = this.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    const meta = { quelle: l.quelle, label: `Record ${l.spuren.map((s) => s.name).join(', ')}` };
    const ergebnis: Record<string, unknown>[] = [];
    let neu: Projekt = structuredClone(o.projekt);
    l.spuren.forEach((s, i) => {
      const m = meldungen[i];
      const roh = path.join(this.zugang.arbeitsordner(), `aufnahme-${s.nr}-${l.kennung}.f32`);
      if (!m || !fs.existsSync(roh)) {   // Status 2 (abgebrochen) sendet der Kern nie (abbrechen() meldet nicht); der Zweig bleibt für später
        ergebnis.push({ spur_id: s.id, fehler: 'datei_fehlt', text: 'the take file is missing; nothing was placed on the track' });
        return;
      }
      const wav = path.join(o.ordner, 'aufnahmen', `take-${l.kennung}-${s.nr}.wav`);
      try {
        const w = schreibeWavAusF32(roh, wav);
        if (w.frames === 0) {   // jedes Gründe-Literal braucht ein text daneben (proj_gruende_text.test.mjs, N9)
          ergebnis.push({ spur_id: s.id, fehler: 'leer', text: 'the take contains no audio; the file is kept', datei: wav });
          return;
        }
        const zusatz = m.status === 1 ? ' (gaps)' : m.status === 2 ? ' (aborted)' : m.status === 3 ? ' (disk full)' : '';
        neu = nehmeTakeAuf(neu, { spurId: s.id, startBeat: l.startBeat, laengeBeats: (w.frames / 48000) * (l.bpm / 60), sha256: w.sha256, pfadHinweis: wav,
          name: `Take ${l.kennung}${zusatz}` });
        ergebnis.push({ spur_id: s.id, frames: w.frames, luecken: m.luecken, status: m.status, datei: wav });
      } catch (e) {
        // R1: ein Fehler dieser Spur verwirft die anderen Spuren des Laufs nicht; die Rohdatei bleibt, der Clip wird nicht gesetzt
        if (e instanceof TakeFehler) ergebnis.push({ spur_id: s.id, fehler: e.grund, text: grundText(e.grund), datei: wav });
        else {
          ergebnis.push({ spur_id: s.id, fehler: 'uebernahme_fehler', text: 'the take could not be placed on the track; the raw file is kept',
            detail: String((e as Error).message ?? e), datei: wav });
        }
      }
    });
    if (ergebnis.every((e) => e.fehler)) return { code: 200, j: { takes: ergebnis, rev: o.projekt.rev } };
    // kein Clip gesetzt: die Dateien bleiben, der Stand ändert sich nicht
    const w = aendereStand(o.verlauf, o.projekt, neu, meta, this.zugang.haken());
    if (w.eintrag !== null) await this.zugang.uebernimm(w, meta);
    return { code: 200, j: { takes: ergebnis, rev: this.zugang.offen()?.projekt.rev ?? w.projekt.rev } };
  }

  ereignis(adresse: string, f: Record<string, unknown>): void {
    if (adresse === '/zustand/arr') { this.arrStatus = Number(f.status); return; }
    if (adresse === '/q') {   // Weg 3: der Kern verwirft die Aufnahme (Quittung 7 der Rec-ID)
      if (Number(f.status) !== 7) return;
      const id = Number(f.id), grund = String(f.grund ?? '') || 'abbruch';
      const l = this.lauf;
      if (l && id === l.recId) { l.verworfen = grund; void this.beende(l).catch(() => { /* das Ergebnis steht in letzte */ }); }
      else if (id === this.beobachtet) this.abbruch = grund;
      return;
    }
    if (adresse === '/e/aufnahme') {
      const m: Meldung = { spur: Number(f.spur), kennung: Number(f.kennung), status: Number(f.status), frames: Number(f.frames),
        start_sample: Number(f.start_sample), luecken: Number(f.luecken) };
      const k = `${m.spur}:${m.kennung}`;
      this.gemeldet.set(k, m);
      if (this.gemeldet.size > GEMELDET_MAX) this.gemeldet.delete(this.gemeldet.keys().next().value as string);
      this.wartend.get(k)?.(m);
      this.wartend.delete(k);
      // Weg 2: sind alle Takes des Laufs gemeldet, ist der Lauf zu Ende, auch wenn niemand POST stopp gerufen hat (Transport anders gestoppt,
      // Arrangement zu Ende)
      const l = this.lauf;
      if (l && !l.abschluss && m.kennung === l.kennung && l.spuren.every((s) => this.gemeldet.has(`${s.nr}:${l.kennung}`))) {
        void this.beende(l).catch(() => { /* das Ergebnis steht in letzte */ });
      }
    }
  }
  schliesse(): void {
    for (const f of this.wartend.values()) f(null);
    this.wartend.clear();
    const f = this.frei; this.frei = null;
    if (f) f();
    this.lauf = null;
  }
}

export function aufnahmeBereich(ctx: BereichKontext, zugang: ProjZugang, opt: { fristMs?: number } = {}): Bereich & { aufnahme: Aufnahme } {
  const a = new Aufnahme(ctx, zugang, opt.fristMs);
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  const routen = (): Route[] => [
    { methode: 'GET', pfad: '/proj/aufnahme', schutz: 'offen', handler: (_q, r) => antworte(r, () => a.lage()) },
    { methode: 'POST', pfad: '/proj/aufnahme', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();
      await antworte(r, async () => {
        const d = await leseKoerper(q);
        if (d.aktion === 'start') return a.start(d, quelle);
        if (d.aktion === 'stopp') return a.stopp(quelle);
        throw new ProjFehler(400, 'aktion_unbekannt');
      });
    } },
  ];
  return { name: 'proj-aufnahme', aufnahme: a, routen, ereignis: (adresse, felder) => a.ereignis(adresse, felder) };
}
