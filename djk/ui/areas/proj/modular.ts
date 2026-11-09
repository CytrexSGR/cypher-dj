// S17: the sound snapshot of the open project at the page server (capture on demand, restore on open and after a kern restart).
// The Baukasten graphs themselves are loaded through the server's graph bridge (BereichKontext.baukasten, the same checks as POST /graph);
// the eight graph knobs <kanal>/bk/1..8 go through KernWeg like every other control. Plan 2026-11-01-baukasten-s17.md.
import type { BereichKontext } from '../../http/router.ts';
import { BK_KANAELE, BK_REGLER_ZAHL, BK_VORGABE_WERT, bkDefVonId, bkKanalVon, type BkKanalDef } from '../../project/modular.ts';
import type { Befehl } from '../../project/commands.ts';
import type { Projekt } from '../../project/model.ts';
import type { Soll } from './mapping.ts';
import type { KernLage } from './state.ts';
import { quittungAbgelehnt, type KernWeg, type Quelle } from './core_path.ts';
import { grundText } from '../../http/reasons.ts';
import { ProjFehler } from './session.ts';

export interface BkErgebnis {
  kanal: string; graph: string; ok: boolean; regler_gesendet: number;
  grund?: string; text?: string; hinweis?: string; hinweis_text?: string; schon_geladen?: true; regler_fehler?: number;
}
// A reason and a hint always travel with their English text (Spec 6.34)
const grundSetzen = (s: BkErgebnis, grund: string): void => { s.grund = grund; s.text = grundText(grund); };
const hinweisSetzen = (s: BkErgebnis, hinweis: string): void => { s.hinweis = hinweis; s.hinweis_text = grundText(hinweis); };
const GLEICH_EPS = 0.0005;   // the page shows 3 decimals; stored and live values within this count as equal
const KNOPF = Array.from({ length: BK_REGLER_ZAHL }, (_, i) => i + 1);

export class ProjBk {
  private readonly ctx: BereichKontext;
  private readonly lage: KernLage;
  private readonly kern: KernWeg;
  private readonly fristMs: number;
  // no constructor parameter properties: node runs these files in strip-only TypeScript mode
  constructor(ctx: BereichKontext, lage: KernLage, kern: KernWeg, fristMs: number) {
    this.ctx = ctx; this.lage = lage; this.kern = kern; this.fristMs = fristMs;
  }

  private bruecke() {
    const b = this.ctx.baukasten;
    if (!b) throw new ProjFehler(409, 'kein_baukasten');
    return b;
  }

  // Validates a `kanaele` argument: absent = undefined, else a list of distinct channel names of the table.
  kanaeleArg(x: unknown): BkKanalDef[] | undefined {
    if (x === undefined) return undefined;
    if (!Array.isArray(x)) throw new ProjFehler(400, 'argument_ungueltig', { text: 'kanaele: a list of channel names is required' });
    const aus: BkKanalDef[] = [];
    for (const k of x) {
      const d = typeof k === 'string' ? bkKanalVon(k) : null;
      if (!d) {
        throw new ProjFehler(400, 'argument_ungueltig',
          { text: 'kanaele: only channels of the sound snapshot table (erz/2, erz/3, deck/1..4, fx/3, fx/4, erz/5..7, pad/1..2) are allowed' });
      }
      if (!aus.includes(d)) aus.push(d);
    }
    return aus;
  }

  // A6: the commands for ONE aendern call, plus the knob paths whose live value was unknown (their stored value, else 0.5, is kept).
  // Default channels: the table rows with `vorgabe` that have a graph loaded. Named channels must have a graph. Never removes an entry.
  befehleZumMerken(p: Projekt, kanaele: unknown): { befehle: Befehl[]; unbekannt: string[]; gemerkt: string[] } {
    const b = this.bruecke();
    const geladen = b.geladen();
    const genannt = this.kanaeleArg(kanaele);
    const defs = genannt ?? BK_KANAELE.filter((d) => d.vorgabe && geladen[d.kanal]);
    for (const d of defs) if (!geladen[d.kanal]) throw new ProjFehler(409, 'bk_nicht_geladen', { kanal: d.kanal });
    if (defs.length === 0) throw new ProjFehler(409, 'bk_nichts_geladen');
    const befehle: Befehl[] = [], unbekannt: string[] = [];
    for (const d of defs) {
      const name = geladen[d.kanal];
      const alt = p.baukasten?.find((e) => e.id === d.id);
      const regler = KNOPF.map((n) => {
        const behalten = alt?.regler[n - 1] ?? BK_VORGABE_WERT;
        if (!d.regler) return behalten;   // the kern has no knobs here: nothing to read
        const live = this.lage.reglerWert(`${d.kanal}/bk/${n}`);
        if (live === null) { unbekannt.push(`${d.kanal}/bk/${n}`); return behalten; }
        return live;
      });
      const sha = b.graphHash(name);
      befehle.push({ befehl: 'bk_setzen', kanal: d.kanal, graph: name, regler, ...(sha ? { sha256: sha } : {}) });
    }
    return { befehle, unbekannt, gemerkt: defs.map((d) => d.kanal) };
  }

  // A7: puts the saved sound back. Never throws; one result per entry; the whole call is capped at fristMs (entries still pending then
  // report grund 'bk_frist'). Knobs first (the engine hands held values to a swapped graph), then the graph.
  async wiederherstellen(p: Projekt, quelle: Quelle, o: { schonGeladenUeberspringen: boolean; nur?: BkKanalDef[] }): Promise<BkErgebnis[]> {
    const liste = (p.baukasten ?? []).filter((e) => !o.nur || o.nur.some((d) => d.id === e.id));
    const slots: BkErgebnis[] = liste.map((e) => ({ kanal: bkDefVonId(e.id)?.kanal ?? e.id, graph: e.graph, ok: false, regler_gesendet: 0 }));
    const fertig = new Set<number>();
    const b = this.ctx.baukasten;
    if (!b) { for (const sl of slots) grundSetzen(sl, 'kein_baukasten'); return slots; }
    // S17: no kern, no point in sending (every wait would run into its hard cap and the reason would be a misleading bk_frist)
    if (b.kernDa && !b.kernDa()) { for (const sl of slots) grundSetzen(sl, 'kein_kern'); return slots; }
    const laeufe = liste.map(async (e, i) => {
      const slot = slots[i];
      try {
        const def = bkDefVonId(e.id)!;
        if (quelle === 'cypher' && def.kanal.startsWith('erz/') && b.autoAus(def.kanal)) { grundSetzen(slot, 'auto_aus'); return; }
        const hash = b.graphHash(e.graph);
        if (hash === null) { hinweisSetzen(slot, 'bk_graph_fehlt'); return; }
        if (e.sha256 && hash !== e.sha256) hinweisSetzen(slot, 'bk_graph_geaendert');
        if (def.regler) {
          const soll: Soll[] = e.regler.map((w, k) => ({ pfad: `${def.kanal}/bk/${k + 1}`, wert: w }));
          const r = await this.kern.setzeRegler(soll, quelle);
          slot.regler_gesendet = r.length;
          const abgelehnt = r.filter((x) => quittungAbgelehnt(x.quittung)).length;
          if (abgelehnt) slot.regler_fehler = abgelehnt;
        }
        if (o.schonGeladenUeberspringen && b.geladen()[def.kanal] === e.graph) { slot.ok = true; slot.schon_geladen = true; return; }
        const g = await b.setzeGraph(def.kanal, e.graph, quelle);
        const q = g.j.quittung as { status: number; grund: string } | null | undefined;
        if (g.code !== 200) grundSetzen(slot, String(g.j.fehler ?? 'bk_abgelehnt'));
        else if (!q) grundSetzen(slot, 'bk_keine_quittung');
        else if (quittungAbgelehnt(q)) grundSetzen(slot, q.grund || 'bk_abgelehnt');
        else slot.ok = true;
      } catch (err) {
        grundSetzen(slot, 'bk_fehler');
        this.ctx.log({ typ: 'proj_bk_fehler', kanal: slot.kanal, fehler: (err as Error)?.message ?? String(err) });
      } finally { fertig.add(i); }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frist = new Promise<void>((ok) => { timer = setTimeout(ok, this.fristMs); });
    await Promise.race([Promise.all(laeufe), frist]);
    clearTimeout(timer);
    slots.forEach((sl, i) => { if (!fertig.has(i)) grundSetzen(sl, 'bk_frist'); });
    return slots.map((s) => ({ ...s }));   // a copy: an entry finishing after the cap must not change an answer already sent
  }

  // A14: saved against live for every table row
  ansicht(p: Projekt, slug: string): Record<string, unknown> {
    const geladen = this.ctx.baukasten?.geladen() ?? {};
    const kanaele = BK_KANAELE.map((d) => {
      const e = p.baukasten?.find((x) => x.id === d.id) ?? null;
      const live = geladen[d.kanal] ?? null;
      const reglerLive = KNOPF.map((n) => (d.regler ? this.lage.reglerWert(`${d.kanal}/bk/${n}`) : null));
      let gleich: boolean | null = false;
      if (e && live === e.graph) {
        if (!d.regler) gleich = true;
        else {
          const unterschied = reglerLive.some((w, i) => w !== null && Math.abs(w - e.regler[i]) > GLEICH_EPS);
          gleich = unterschied ? false : reglerLive.some((w) => w === null) ? null : true;
        }
      }
      return { kanal: d.kanal, gespeichert: e?.graph ?? null, live, regler_gespeichert: e?.regler ?? null, regler_live: reglerLive, gleich };
    });
    return { slug, gespeichert: p.baukasten ?? [], kanaele };
  }
}
