// Annahme im Leitstand (ADR 023 Entscheidung 1, SCHNITTSTELLEN §10, §14.1, §14.3, §16.3): Pläne annehmen, verriegeln
// oder zum Vorschlag machen, koppeln, einreichen („A raus“ erst, wenn „B rein“ gestartet ist), Quittungen verfolgen,
// Vorschläge per Taste annehmen, verwerfen, verfallen lassen, nach einem Neustart über /q/stand abgleichen.
import type { Felder } from './adressen.ts';
import { entscheide } from './autonomie.ts';
import type { AnsageArt } from './ereignisse.ts';
import { ansageVerriegelt } from './hinweise.ts';
import { HoerscheinRegister, type Hoerschein } from './hoerscheine.ts';
import { RpcFehler } from './hub.ts';
import { koppeln, type Schwellen } from './kopplung.ts';
import {
  ausMenschenform, FormFehler, geordnet, kanalVonTeil, oscFuer, setzeHoerschein, type MenschenPlan, type Plan, type Teil,
} from './plan.ts';
import { Spiegel } from './spiegel.ts';
import { pruefer } from './vertrag.ts';
import { pruefe, type Grund } from './verriegelung.ts';
import { VorschlagRegister, type Vorschlag } from './vorschlaege.ts';

export interface Umgebung {
  sende(adresse: string, felder: Felder): void;                                     // an den Kern
  ereignis(art: string, daten: Record<string, unknown>, beat?: number, sample?: number): void; // WS ereignis (§9.3)
  ansage(text: string, art: AnsageArt): void;                                       // WS ansage (§9.3)
  journal(typ: string, daten: Record<string, unknown>): void;                        // §15
  jetztBeat(): number;
  bpm(): number;
  kernBereit(): boolean;
  neueId(): number;                                                                 // §1.4, streng steigend
}

export interface Einstellung { stufe: number; kiSpur: string[]; schwellen: Schwellen; maxStretcher: number; mutationen: string[] }

export type TeilStatus = 'ungesendet' | 'wartet_auf_b' | 'gesendet' | 'angenommen' | 'gestartet' | 'fertig'
  | 'verworfen' | 'abgelehnt' | 'abgebrochen' | 'storniert' | 'entfallen';
export interface TeilStand { nr: number; id: number | null; quelle: string; status: TeilStatus; grund: string }
export type PlanStatus = 'vorgeschlagen' | 'verriegelt' | 'abgelehnt' | 'wartet' | 'laeuft' | 'teilweise' | 'fertig'
  | 'abgebrochen' | 'verfallen' | 'verworfen';
export interface PlanStand { plan: Plan; status: PlanStatus; teile: Map<number, TeilStand>; vorschlag: string | null; annahme: string | null }

export interface Ergebnis {
  status: 'angenommen' | 'vorgeschlagen' | 'verriegelt' | 'abgelehnt'; plan_id: string; gruende: Grund[]; ansage: string;
  warnungen: string[];
}

const ENDE: ReadonlySet<TeilStatus> = new Set(['fertig', 'verworfen', 'abgelehnt', 'abgebrochen', 'storniert', 'entfallen']);
const Q_STATUS: Record<number, TeilStatus> = {
  1: 'angenommen', 2: 'gestartet', 3: 'fertig', 4: 'verworfen', 5: 'gestartet', 6: 'abgelehnt', 7: 'abgebrochen', 8: 'storniert',
};
const pruefePlanForm = pruefer('schemas/plan.schema.json');

// B rein ist gestartet, sobald ein Teil gestartet ist, der B hörbar macht (Fader oder Trim nach oben, Deck-Start)
function oeffnetB(t: Teil): boolean {
  return (t.art === 'regler' && /\/(fader|trim)$/.test(t.pfad)) || (t.art === 'deck' && t.aktion === 'start');
}

const NUR_ANZEIGE = new Set(['/k/led', '/k/vorschlag_kanal']);

export class Annahme {
  stufe: number;
  readonly kiSpur: Set<string>;
  readonly spiegel: Spiegel;
  readonly hoerscheine = new HoerscheinRegister();
  readonly vorschlaege = new VorschlagRegister();
  readonly plaene = new Map<string, PlanStand>();
  private readonly idIndex = new Map<string, { plan: string; nr: number }>();
  private planZaehler = 0;
  private readonly led = new Map<string, number>();
  private readonly kernKenntNicht = new Set<string>();
  private vorschlagKanal: string | null = null;
  private abgleich: { grund: 'kern_neustart' | 'leitstand_neustart'; bestaetigt: Set<string>; q_stand: number } | null = null;
  private stumm = false; // beim Nachspielen des Journals: Zustand ja, Nachrichten nein
  private readonly e: Einstellung;
  private readonly u: Umgebung;

  constructor(u: Umgebung, e: Einstellung) {
    this.u = u;
    this.e = e;
    this.stufe = e.stufe;
    this.kiSpur = new Set(e.kiSpur);
    this.spiegel = new Spiegel(() => u.jetztBeat());
  }

  private mut(m: string): boolean { return this.e.mutationen.includes(m); }
  private journal(typ: string, daten: Record<string, unknown>): void { if (!this.stumm) this.u.journal(typ, daten); }
  private ereignis(art: string, daten: Record<string, unknown>, beat?: number, sample?: number): void {
    if (!this.stumm) this.u.ereignis(art, daten, beat, sample);
  }
  private sende(adresse: string, felder: Felder): void {
    if (!this.stumm && !this.kernKenntNicht.has(adresse)) this.u.sende(adresse, felder);
  }

  // Reine Anzeige-Adressen (LED, Vorschlag-Kanal) kennt der Kern erst mit 35 Teil B. Lehnt er eine mit
  // unbekannte_adresse ab, schweigt der Leitstand dazu bis zum nächsten Kern-Neustart, statt bei jeder Änderung
  // einen Protokollfehler auszulösen (die Oberfläche zeigt ihn Andreas rot). Andere Adressen bleiben unberührt.
  kernUnbekannt(adresse: string): void { if (NUR_ANZEIGE.has(adresse)) this.kernKenntNicht.add(adresse); }
  kernNeu(): void { this.kernKenntNicht.clear(); this.led.clear(); this.vorschlagKanal = null; }

  // ---------- Einreichen ----------

  // plan_einreichen (§10, Menschenform). Formfehler werfen FormFehler (der Hub antwortet rpc_fehler code form).
  einreichen(eingabe: MenschenPlan, quelle = 'cypher'): Ergebnis {
    const plan = ausMenschenform(eingabe, `p${++this.planZaehler}`, quelle);
    if (eingabe.hoerschein) setzeHoerschein(plan, eingabe.hoerschein, (p) => this.spiegel.wert(p));
    return this.einreichenKanonisch('plan_einreichen', plan);
  }

  // Kanonischer Plan (§14.1), etwa aus waehle über den Rechner (Scheibe 41)
  einreichenKanonisch(methode: string, plan: Plan): Ergebnis {
    if (!plan.id) plan.id = `p${++this.planZaehler}`;
    const form = pruefePlanForm(plan);
    if (!form.ok) throw new FormFehler(`Plan verletzt plan.schema.json: ${form.fehler}`);
    const alle = (grund: string) => plan.teile.map((t) => ({ teil: t.nr, grund }));
    const abweisen = (status: 'abgelehnt' | 'verriegelt', gruende: Grund[]): Ergebnis => {
      this.plaene.set(plan.id, { plan, status, teile: new Map(), vorschlag: null, annahme: null });
      this.journal('plan_eingereicht', { methode, plan, status, gruende });
      this.ereignis('plan_verriegelt', { plan_id: plan.id, status, gruende });
      // M15 (Stand 03): jede Verriegelungs-Ansage sagt, was zu ändern ist (hinweise.ts)
      const text = ansageVerriegelt(status, gruende, { plan, hoerschein: (id) => this.hoerscheine.get(id), stufe: this.stufe, methode });
      return { status, plan_id: plan.id, gruende, ansage: text, warnungen: [] };
    };
    if (this.spiegel.kiGestoppt) return abweisen('abgelehnt', alle('ki_gestoppt'));
    // Mutation autonomie_aus (nur Prüfung): ohne Positivliste ginge jede Einreichung direkt an den Kern
    const weg = this.mut('autonomie_aus') ? 'direkt' : entscheide(this.stufe, methode, plan, this.kiSpur, (p) => this.leisesterWert(p, plan.id));
    if (weg === 'abgelehnt') return abweisen('abgelehnt', alle('autonomie'));
    koppeln(plan, (p) => this.spiegel.wert(p), this.e.schwellen, !this.mut('kopplung_aus'));
    const gruende = pruefe(plan, this.pruefumgebung(plan.id, weg === 'vorschlag'));
    if (gruende.length) return abweisen('verriegelt', gruende);
    const warnungen = ['keine_vorhersage']; // §16.3: ohne Rechner keine Vorhersage (Scheibe 41 füllt sie)
    if (weg === 'vorschlag') {
      const v = this.vorschlagFuer(plan);
      this.plaene.set(plan.id, { plan, status: 'vorgeschlagen', teile: new Map(), vorschlag: v.id, annahme: null });
      this.journal('plan_eingereicht', { methode, plan, status: 'vorgeschlagen', gruende: [], vorschlag: v });
      this.ereignis('plan_vorgeschlagen', { plan_id: plan.id, vorschlag: v });
      if (!this.stumm) this.u.ansage(v.text, 'vorschlag');
      this.vorschlagAnzeige();
      return { status: 'vorgeschlagen', plan_id: plan.id, gruende: [], ansage: v.text, warnungen };
    }
    const ps: PlanStand = { plan, status: 'wartet', teile: new Map(), vorschlag: null, annahme: null };
    this.plaene.set(plan.id, ps);
    this.journal('plan_eingereicht', { methode, plan, status: 'angenommen', gruende: [] });
    this.einreichenAnKern(ps);
    const text = this.text(plan);
    this.ereignis('plan_angenommen', { plan_id: plan.id });
    if (!this.stumm) this.u.ansage(text, 'plan');
    return { status: 'angenommen', plan_id: plan.id, gruende: [], ansage: text, warnungen };
  }

  // Vergleichswert für „leiser“ (§10 Stufe 1): das Leiseste aus Ist-Wert und den Zielen aller offenen Teile anderer
  // Pläne an diesem Regler. Gegen den Ist-Wert allein wäre „auf −3“ nach einem angenommenen „auf −20“ leiser gewesen
  // (gefunden 2026-09-23 mit pruef/folgen/ki_spur_leiser.jsonl).
  private leisesterWert(pfad: string, ohnePlan: string): number {
    let w = this.spiegel.wert(pfad);
    for (const ps of this.plaene.values()) {
      if (ps.plan.id === ohnePlan) continue;
      for (const t of ps.plan.teile) {
        const st = ps.teile.get(t.nr);
        if (t.art === 'regler' && t.pfad === pfad && st && !ENDE.has(st.status)) w = Math.min(w, t.nach);
      }
    }
    return w;
  }

  private pruefumgebung(ohnePlan: string, wirdVorschlag: boolean) {
    const angenommen: Array<{ plan: string; teil: Teil }> = [];
    for (const ps of this.plaene.values()) {
      if (ps.plan.id === ohnePlan) continue;
      for (const t of ps.plan.teile) {
        const st = ps.teile.get(t.nr);
        if (st && !ENDE.has(st.status)) angenommen.push({ plan: ps.plan.id, teil: t });
      }
    }
    return {
      jetztBeat: this.u.jetztBeat(), bpm: this.u.bpm(), spiegel: this.spiegel, hoerscheine: this.hoerscheine,
      schwellen: this.e.schwellen, maxStretcher: this.e.maxStretcher, angenommen, wirdVorschlag,
    };
  }

  private text(plan: Plan): string {
    const start = Math.min(...plan.teile.map((t) => t.ab_beat));
    const tausch = plan.teile.find((t) => t.art !== 'tempo' && t.gruppe === 'basstausch');
    return `T ${Math.floor(start / 4) + 1}: ${plan.grund}${tausch ? `, Basstausch T ${Math.floor(tausch.ab_beat / 4) + 1}` : ''}`;
  }

  private vorschlagFuer(plan: Plan): Vorschlag {
    const start = Math.min(...plan.teile.map((t) => t.ab_beat));
    const b = plan.teile.find((t) => t.art !== 'tempo' && t.gruppe === 'b_rein');
    const kanal = (b ? kanalVonTeil(b) : null) ?? plan.teile.map(kanalVonTeil).find((k) => k !== null) ?? '';
    return this.vorschlaege.neu(plan.id, this.text(plan), start, kanal);
  }

  // Einreichen an den Kern. Phase 1: alles außer a_raus. Phase 2 (a_raus) erst nach dem Start eines Teils, der B
  // hörbar macht (§14.1); hat der Plan kein solches b_rein, geht a_raus sofort mit.
  private einreichenAnKern(ps: PlanStand): void {
    const mitB = ps.plan.teile.some((t) => t.art !== 'tempo' && t.gruppe === 'b_rein' && oeffnetB(t));
    for (const t of geordnet(ps.plan.teile)) {
      const zweite = mitB && t.art !== 'tempo' && t.gruppe === 'a_raus';
      ps.teile.set(t.nr, { nr: t.nr, id: null, quelle: ps.plan.quelle, status: zweite ? 'wartet_auf_b' : 'ungesendet', grund: '' });
    }
    this.sendeOffene(ps);
  }

  private sendeOffene(ps: PlanStand): void {
    if (!this.u.kernBereit() || this.stumm) return; // §16.3: Kern weg → Einreichungen anhalten
    for (const t of geordnet(ps.plan.teile)) {
      const st = ps.teile.get(t.nr);
      if (!st || st.status !== 'ungesendet') continue;
      const id = this.u.neueId();
      const osc = oscFuer(ps.plan, t, id, st.quelle, t.art === 'deck' && ps.annahme ? `annahme:${ps.annahme}` : null);
      st.id = id;
      st.status = 'gesendet';
      this.idIndex.set(`${st.quelle}:${id}`, { plan: ps.plan.id, nr: t.nr });
      this.journal('teil_gesendet', { plan_id: ps.plan.id, teil: t.nr, id, quelle: st.quelle, adresse: osc.adresse });
      this.sende(osc.adresse, osc.felder);
    }
  }

  // ---------- Quittungen ----------

  quittung(felder: Felder, stand: boolean): void {
    const key = `${felder.quelle}:${felder.id}`;
    const ort = this.idIndex.get(key);
    if (!ort) return;
    // während des Abgleichs bestätigt jede Quittung des Kerns den Befehl, /q/stand zählt zusätzlich (Plan 18 B3: ein eben
    // gestarteter Teil kann nach dem Kern-Neustart live noch einmal mit gestartet kommen statt über /q/stand)
    if (this.abgleich) { this.abgleich.bestaetigt.add(key); if (stand) this.abgleich.q_stand++; }
    const ps = this.plaene.get(ort.plan);
    const st = ps?.teile.get(ort.nr);
    if (!ps || !st) return;
    const neu = Q_STATUS[felder.status as number];
    if (!neu || (ENDE.has(st.status) && !stand)) return;
    if (st.status === neu && stand) return; // /q/stand bestätigt nur, was der Leitstand schon weiß
    // Plan 18 B3: doppeltes gestartet (2 oder 5) nach einem Kern-Neustart hinnehmen, kein zweites teil_gestartet
    if (st.status === neu) { this.journal('quittung_doppelt', { plan_id: ps.plan.id, teil: st.nr, id: felder.id, status: felder.status }); return; }
    st.status = neu;
    st.grund = String(felder.grund ?? '');
    const daten = { plan_id: ps.plan.id, teil: st.nr, status: felder.status, grund: st.grund };
    const [b, s] = [felder.ist_beat as number, felder.ist_sample as number];
    if (neu === 'gestartet') this.ereignis('teil_gestartet', daten, b, s);
    else if (neu === 'fertig') this.ereignis('teil_fertig', daten, b, s);
    else if (ENDE.has(neu)) this.ereignis('teil_abgebrochen', daten, b, s);
    this.kopplungFolgen(ps, st.nr, neu, st.grund);
    this.planStatus(ps);
  }

  private kopplungFolgen(ps: PlanStand, nr: number, neu: TeilStatus, grund: string): void {
    const t = ps.plan.teile.find((x) => x.nr === nr);
    if (!t || t.art === 'tempo' || t.gruppe !== 'b_rein' || !oeffnetB(t)) return;
    const wartend = [...ps.teile.values()].filter((s) => s.status === 'wartet_auf_b');
    if (!wartend.length) return;
    if (neu === 'gestartet') {
      for (const s of wartend) s.status = 'ungesendet';
      this.journal('kopplung', { plan_id: ps.plan.id, b_rein_gestartet: nr, sende: wartend.map((s) => s.nr) });
      this.sendeOffene(ps);
    } else if (ENDE.has(neu) && neu !== 'fertig') {
      // B verriegelt oder abgebrochen, bevor B hörbar wurde: A raus entfällt samt Deck-Stopp, der Basstausch fällt mit
      for (const s of wartend) {
        s.status = 'entfallen';
        s.grund = grund;
        this.ereignis('teil_abgebrochen', { plan_id: ps.plan.id, teil: s.nr, status: 0, grund, wegen_teil: nr });
      }
      const tausch = ps.plan.teile.filter((x) => x.art !== 'tempo' && x.gruppe === 'basstausch'
        && !ENDE.has(ps.teile.get(x.nr)?.status ?? 'fertig')).map((x) => x.nr);
      if (tausch.length) this.sende('/k/abbruch', { id: this.u.neueId(), quelle: 'leitstand', plan: ps.plan.id, teile: tausch.join(',') });
      this.journal('kopplung', { plan_id: ps.plan.id, b_rein_gescheitert: nr, grund, entfallen: wartend.map((s) => s.nr), abbruch: tausch });
    }
  }

  private planStatus(ps: PlanStand): void {
    if (!['wartet', 'laeuft', 'teilweise'].includes(ps.status)) return;
    const s = [...ps.teile.values()].map((x) => x.status);
    const alt = ps.status;
    if (s.every((x) => ENDE.has(x))) ps.status = s.every((x) => x === 'fertig') ? 'fertig' : s.some((x) => x === 'fertig') ? 'teilweise' : 'abgebrochen';
    else if (s.some((x) => x === 'gestartet' || x === 'fertig')) ps.status = 'laeuft';
    if (alt !== ps.status) this.journal('plan_status', { plan_id: ps.plan.id, status: ps.status });
    this.planLed();
  }

  // ---------- Tasten, Stopp, Stufe, Verfall ----------

  annehmen(beat: number): void {
    const v = this.vorschlaege.aktuell(beat);
    if (!v) { this.ansageSag(`Nichts anzunehmen bei Beat ${beat.toFixed(2)}`, 'info'); return; }
    const ps = this.plaene.get(v.plan_id);
    this.vorschlaege.entferne(v.id);
    this.journal('vorschlag_ende', { vorschlag_id: v.id, wie: 'angenommen', beat });
    if (!ps) return;
    ps.vorschlag = null;
    const gruende = this.spiegel.kiGestoppt ? ps.plan.teile.map((t) => ({ teil: t.nr, grund: 'ki_gestoppt' }))
      : pruefe(ps.plan, this.pruefumgebung(ps.plan.id, true)); // Zweitprüfung; Sprung und Hotcue deckt annahme:
    if (gruende.length) {
      ps.status = 'verriegelt';
      this.journal('plan_status', { plan_id: ps.plan.id, status: 'verriegelt', gruende });
      this.ereignis('plan_verriegelt', { plan_id: ps.plan.id, status: 'verriegelt', gruende, vorschlag_id: v.id });
      this.ansageSag(`${v.text}: nach Annahme ${ansageVerriegelt('verriegelt', gruende, { plan: ps.plan, hoerschein: (id) => this.hoerscheine.get(id), stufe: this.stufe, methode: 'annehmen' })}`, 'warnung');
    } else {
      ps.status = 'wartet';
      ps.annahme = v.id;
      this.ereignis('vorschlag_angenommen', { vorschlag_id: v.id, plan_id: ps.plan.id }, beat);
      this.ereignis('plan_angenommen', { plan_id: ps.plan.id, vorschlag_id: v.id });
      this.einreichenAnKern(ps);
    }
    this.vorschlagAnzeige();
  }

  verwerfen(beat: number, grund = 'andreas'): void {
    const v = this.vorschlaege.aktuell(beat);
    if (v) this.beendeVorschlag(v, 'verworfen', grund, beat);
    this.vorschlagAnzeige();
  }

  private beendeVorschlag(v: Vorschlag, wie: 'verworfen' | 'verfallen', grund: string, beat: number): void {
    this.vorschlaege.entferne(v.id);
    const ps = this.plaene.get(v.plan_id);
    if (ps) { ps.status = wie; ps.vorschlag = null; }
    this.journal('vorschlag_ende', { vorschlag_id: v.id, wie, grund, beat });
    const daten = { vorschlag_id: v.id, plan_id: v.plan_id, grund, verfaellt_beat: v.verfaellt_beat, erkannt_beat: beat };
    this.ereignis(wie === 'verfallen' ? 'vorschlag_verfallen' : 'vorschlag_verworfen', daten, wie === 'verfallen' ? v.verfaellt_beat : beat);
  }

  // je /uhr: Vorschläge verfallen am Beat verfaellt_beat (§3), Hörschein-LEDs
  tick(beat: number): void {
    for (const v of this.vorschlaege.alle()) if (beat >= v.verfaellt_beat) this.beendeVorschlag(v, 'verfallen', 'verfall', beat);
    this.vorschlagAnzeige();
    this.hoerscheinLeds(beat);
  }

  kiStopp(gestoppt: boolean, beat: number): void {
    if (!gestoppt) return;
    for (const v of this.vorschlaege.alle()) this.beendeVorschlag(v, 'verworfen', 'ki_stopp', beat);
    for (const ps of this.plaene.values()) {
      for (const s of ps.teile.values()) {
        if (s.status === 'wartet_auf_b' || s.status === 'ungesendet') {
          s.status = 'entfallen';
          s.grund = 'ki_stopp';
          this.ereignis('teil_abgebrochen', { plan_id: ps.plan.id, teil: s.nr, status: 0, grund: 'ki_stopp' });
        }
      }
      this.planStatus(ps);
    }
    this.vorschlagAnzeige();
  }

  setzeStufe(stufe: number): void {
    if (!(stufe >= 0 && stufe <= 3)) return;
    this.stufe = stufe;
    this.journal('autonomie', { stufe });
    this.ereignis('autonomie', { stufe });
    this.stufeAnKern();
  }

  // ---------- Hörscheine ----------

  hoerschein(h: Hoerschein): void {
    const a = this.hoerscheine.aufnehmen(h);
    this.ereignis('hoerschein', { hs_id: h.id, kanal: h.kanal, urteil: h.urteil, gueltig_bis_beat: h.gueltig_bis_beat });
    if (a) this.sende(a.adresse, { id: this.u.neueId(), quelle: 'leitstand', ...a.felder });
    this.hoerscheinLeds(this.u.jetztBeat());
  }

  // ---------- Kern-Verbindung, Abgleich ----------

  // nach /k/willkommen: KI-Spur und Stufe an den Kern, LEDs neu, angehaltene Teile einreichen
  verbunden(): void {
    this.led.clear();
    this.vorschlagKanal = null;
    this.sende('/k/ki/spur', { id: this.u.neueId(), quelle: 'leitstand', kanaele: [...this.kiSpur].join(',') });
    this.stufeAnKern();
    this.vorschlagAnzeige();
    this.planLed();
  }

  abgleichBeginnen(grund: 'kern_neustart' | 'leitstand_neustart'): void {
    this.abgleich = { grund, bestaetigt: new Set(), q_stand: 0 };
    this.journal('abgleich_beginn', { grund });
  }

  get abgleichOffen(): boolean { return this.abgleich !== null; }

  // §16.3: was weder /q/stand noch eine Endquittung hat, gilt nach einem Kern-Neustart als verloren (Grund neustart).
  // Nach einem Leitstand-Neustart ohne /q/stand bleibt der Stand aus dem Journal stehen (quelle journal).
  abgleichSchliessen(): void {
    const a = this.abgleich;
    if (!a) return;
    this.abgleich = null;
    const teile: Array<Record<string, unknown>> = [];
    for (const ps of this.plaene.values()) {
      for (const s of ps.teile.values()) {
        if (s.id === null || ENDE.has(s.status) || s.status === 'wartet_auf_b' || s.status === 'ungesendet') continue;
        const bestaetigt = a.bestaetigt.has(`${s.quelle}:${s.id}`);
        if (!bestaetigt && a.grund === 'kern_neustart') {
          s.status = 'abgebrochen';
          s.grund = 'neustart';
          this.ereignis('teil_abgebrochen', { plan_id: ps.plan.id, teil: s.nr, status: 0, grund: 'neustart' });
        }
        teile.push({ plan_id: ps.plan.id, teil: s.nr, id: s.id, status: s.status, bestaetigt });
      }
      this.planStatus(ps);
    }
    this.journal('abgleich', { grund: a.grund, q_stand: a.q_stand, teile });
    for (const ps of this.plaene.values()) this.sendeOffene(ps);
  }

  // ---------- Wiederaufnahme aus dem Journal (Leitstand-Neustart) ----------

  wiederaufnehmen(zeilen: Array<{ typ: string; von: string; daten: Record<string, unknown> }>): number {
    if (this.mut('wiederaufnahme_aus')) return 0;
    this.stumm = true;
    let n = 0;
    try {
      for (const z of zeilen) {
        const d = z.daten;
        if (z.typ === 'plan_eingereicht') {
          const plan = d.plan as Plan;
          this.planZaehler = Math.max(this.planZaehler, Number(plan.id.slice(1)) || 0);
          const status = d.status === 'angenommen' ? 'wartet' : d.status as PlanStatus;
          const ps: PlanStand = { plan, status, teile: new Map(), vorschlag: null, annahme: null };
          this.plaene.set(plan.id, ps);
          if (d.vorschlag) { this.vorschlaege.uebernehme(d.vorschlag as Vorschlag); ps.vorschlag = (d.vorschlag as Vorschlag).id; }
          if (status === 'wartet') this.einreichenAnKern(ps);
          n++;
        } else if (z.typ === 'vorschlag_ende') {
          const v = this.vorschlaege.entferne(d.vorschlag_id as string);
          const ps = v ? this.plaene.get(v.plan_id) : undefined;
          if (ps && d.wie === 'angenommen') { ps.status = 'wartet'; ps.annahme = v!.id; ps.vorschlag = null; this.einreichenAnKern(ps); }
          else if (ps) { ps.status = d.wie as PlanStatus; ps.vorschlag = null; }
        } else if (z.typ === 'plan_status') {
          const ps = this.plaene.get(d.plan_id as string);
          if (ps && d.status === 'verriegelt') ps.status = 'verriegelt';
        } else if (z.typ === 'teil_gesendet') {
          const ps = this.plaene.get(d.plan_id as string);
          const st = ps?.teile.get(d.teil as number);
          if (st) { st.id = d.id as number; st.status = 'gesendet'; this.idIndex.set(`${d.quelle}:${d.id}`, { plan: ps!.plan.id, nr: st.nr }); }
        } else if (z.typ === 'kopplung') {
          const ps = this.plaene.get(d.plan_id as string);
          for (const nr of (d.sende as number[] | undefined) ?? []) { const st = ps?.teile.get(nr); if (st && st.status === 'wartet_auf_b') st.status = 'ungesendet'; }
          for (const nr of (d.entfallen as number[] | undefined) ?? []) { const st = ps?.teile.get(nr); if (st) { st.status = 'entfallen'; st.grund = String(d.grund); } }
        } else if (z.typ === '/q' && z.von === 'kern') {
          this.quittung(d as Felder, false);
        } else if (z.typ === 'autonomie') {
          this.stufe = d.stufe as number;
        } else if (z.von === 'kern' && z.typ.startsWith('/e/')) {
          this.spiegel.aufnehmen({ adresse: z.typ, felder: d as Felder });
        } else if (z.typ === 'hoerschein' && (d.daten as Hoerschein | undefined)?.id) {
          this.hoerscheine.aufnehmen(d.daten as Hoerschein);
        }
      }
    } finally {
      this.stumm = false;
    }
    this.journal('wiederaufnahme', { plaene: n, offen: this.offeneTeile().length, stufe: this.stufe });
    return n;
  }

  offeneTeile(): TeilStand[] {
    return [...this.plaene.values()].flatMap((ps) => [...ps.teile.values()]).filter((s) => !ENDE.has(s.status));
  }

  // ---------- plan_abbrechen (§10) ----------

  abbrechen(planId: string, teile?: number[]): Record<string, unknown> {
    const ps = this.plaene.get(planId);
    if (!ps) throw new FormFehler(`plan_abbrechen: ${planId} gibt es nicht`);
    // §10: allein erlaubt ist nur plan_abbrechen eigener Pläne
    if (ps.plan.quelle !== 'cypher') throw new RpcFehler('autonomie', `plan_abbrechen: ${planId} ist kein eigener Plan (Quelle ${ps.plan.quelle}); brich nur eigene Pläne ab`);
    if (ps.vorschlag) {
      const v = this.vorschlaege.get(ps.vorschlag);
      if (v) this.beendeVorschlag(v, 'verworfen', 'abbruch', this.u.jetztBeat());
      this.vorschlagAnzeige();
    } else {
      const nrn = teile ?? ps.plan.teile.map((t) => t.nr);
      for (const nr of nrn) {
        const s = ps.teile.get(nr);
        if (s && (s.status === 'wartet_auf_b' || s.status === 'ungesendet')) { s.status = 'entfallen'; s.grund = 'abbruch'; }
      }
      this.sende('/k/abbruch', { id: this.u.neueId(), quelle: 'cypher', plan: planId, teile: teile ? teile.join(',') : '*' });
      this.planStatus(ps);
    }
    return { plan_id: planId, status: ps.status, teile: [...ps.teile.values()].map((s) => ({ teil: s.nr, status: s.status })) };
  }

  // ---------- Takt-Zustand (§14.7) ----------

  lage(beat: number): { plaene: unknown[]; vorschlaege: unknown[]; hoerscheine: unknown[]; autonomie: number; ki_gestoppt: boolean } {
    // §14.7: Vorschläge stehen unter vorschlaege; plaene zeigt angenommene und verriegelte Pläne, beendete noch 16 Takte
    const status: Partial<Record<PlanStatus, string>> = {
      wartet: 'wartet', laeuft: 'laeuft', teilweise: 'teilweise', fertig: 'fertig', abgebrochen: 'teilweise',
      verriegelt: 'verriegelt', abgelehnt: 'verriegelt',
    };
    const plaene = [...this.plaene.values()]
      .filter((p) => status[p.status] && (['wartet', 'laeuft'].includes(p.status)
        || Math.max(...p.plan.teile.map((t) => (t.art === 'deck' ? t.ab_beat : t.ab_beat + t.dauer_beats))) + 64 > beat))
      .map((p) => ({ id: p.plan.id, quelle: p.plan.quelle, status: status[p.status] as string,
        teile: p.plan.teile.map((t) => p.teile.get(t.nr)?.status ?? 'nicht_gesendet') }));
    const vorschlaege = this.vorschlaege.alle().map((v) => ({ id: v.id, verfaellt_takt: Math.floor(v.verfaellt_beat / 4) + 1 }));
    return { plaene, vorschlaege, hoerscheine: this.hoerscheine.liste(beat), autonomie: this.stufe, ki_gestoppt: this.spiegel.kiGestoppt };
  }

  // ---------- LEDs und Vorschlag-Kanal (§4.7, §7.4), nur bei Änderung ----------

  private setzeLed(name: string, zustand: number): void {
    if (this.led.get(name) === zustand) return;
    this.led.set(name, zustand);
    this.sende('/k/led', { id: this.u.neueId(), quelle: 'leitstand', name, zustand });
  }

  private vorschlagAnzeige(): void {
    const v = this.vorschlaege.alle()[0];
    this.setzeLed('vorschlag', v ? 2 : 0);
    const kanal = v?.kanal ?? '';
    if (kanal !== this.vorschlagKanal) {
      this.vorschlagKanal = kanal;
      this.sende('/k/vorschlag_kanal', { id: this.u.neueId(), quelle: 'leitstand', kanal });
    }
  }

  private planLed(): void {
    const laeuft = [...this.plaene.values()].some((p) => p.plan.quelle === 'cypher' && p.status === 'laeuft');
    this.setzeLed('plan_laeuft', laeuft ? 1 : 0);
  }

  private stufeAnKern(): void {
    this.sende('/k/ki/stufe', { id: this.u.neueId(), quelle: 'leitstand', stufe: this.stufe });
    for (const n of [0, 1, 2, 3]) this.setzeLed(`autonomie_${n}`, n === this.stufe ? 1 : 0);
  }

  private hoerscheinLeds(beat: number): void {
    for (const n of [1, 2, 3, 4]) {
      const hs = this.hoerscheine.alle().filter((h) => h.kanal === `deck/${n}` && beat <= h.gueltig_bis_beat);
      const ok = hs.some((h) => h.urteil === 'ok');
      this.setzeLed(`deck${n}_hoerschein_ok`, ok ? 1 : 0);
      this.setzeLed(`deck${n}_hoerschein_rot`, !ok && hs.length > 0 ? 1 : 0);
    }
  }

  private ansageSag(text: string, art: AnsageArt): void { if (!this.stumm) this.u.ansage(text, art); }
}
