// Was der Bereich proj vom Kern wissen muss (Spec D1 2.2, 2.7, 2.12), gelesen nur aus Kern-Ereignissen über den Haken ereignis
// (Spec 2.10): Uhr, Decks, Loop-Boxen, Regler mit Halter, /zustand/arr, Generation. Keine Innereien der Oberflaeche.
// Was ein Ereignis nie gemeldet hat, ist unbekannt: ein Regler ohne /e/regler seit dem Serverstart gilt als nicht offen (−200).
import type { ZielEingang } from './szenen_bar.ts';
import { insHostListe } from '../../plugins/hostverwaltung.ts';
import type { Projekt, Modulator } from '../../project/model.ts';
import { sucheStrang, zielBereichVon, sendZielVon, zerlegeKettenZiel, istSendZiel } from '../../project/model.ts';
import { modVersatz, modWert } from '../../project/mod_formula.ts';

export interface ArrZustand {
  nr: number; status: number; loop_an: number; projekt_beat: number; ursprung_sample: number; start_beat: number; metronom_an: number;
  limiter_db: number;   // 1.10: gain reduction of the set limiter in dB (<= 0); NaN from an older core that does not send the field
}

export type ZielLage = ZielEingang;

// strand 7 task 3.3: what the core reports of one MIDI stage (/zustand/arr/midi): held input pitches and the counters since the playback was loaded
export interface MidiZaehler { gehalten: number; ein: number; aus: number; verloren: number }

const ERZ_STROEME = ['erz/1', 'erz/2', 'erz/3'];  // Studio-Ströme 1 bis 3 (Strudel), Spec 2.2 „Studio-Strom“

export class KernLage {
  uhr: { beat: number; bpm: number } | null = null;
  arr: ArrZustand | null = null;
  generation: number | null = null;
  // What feeds container A..D as the core reported it (/e/container/quelle: 0 empty, 1 player, 2 module). A new core starts with every container on its player.
  container: (0 | 1 | 2)[] = [1, 1, 1, 1];
  // SEQ scenes: core beat minus project beat from one same-block pair. The core emits /uhr and then /zustand/arr in one cycle (core.cpp), so a
  // /zustand/arr pairs with the newest /uhr that arrived since the previous /zustand/arr; without a fresh /uhr it forms no pair.
  private paarBeat: number | null = null;
  private offset: number | null = null;
  private readonly decks = new Map<number, number>();
  private readonly regler = new Map<string, number>();
  private readonly mod = new Map<number, number>();   // strand 6: the latest /zustand/mod output per modulator number (-1..1, before depth)
  private readonly midi = new Map<number, MidiZaehler>();   // strand 7 task 3.3: the latest /zustand/arr/midi per track slot (1..128)

  // Liefert neustart: true bei /e/neustart mit neuer Generation (wie server.ts vomKern: „neuerKern“)
  nimm(adresse: string, f: Record<string, unknown>): { neustart: boolean } {
    switch (adresse) {
      case '/uhr': this.uhr = { beat: Number(f.beat), bpm: Number(f.bpm) }; this.paarBeat = this.uhr.beat; break;
      case '/zustand/deck': this.decks.set(Number(f.deck), Number(f.status)); break;
      case '/zustand/mod': if (Number.isFinite(Number(f.nr)) && Number.isFinite(Number(f.wert))) this.mod.set(Number(f.nr), Number(f.wert)); break;
      case '/e/regler': this.regler.set(String(f.pfad), Number(f.wert)); break;
      case '/zustand/arr/midi': {
        const spur = Number(f.spur), z = { gehalten: Number(f.gehalten), ein: Number(f.ein), aus: Number(f.aus), verloren: Number(f.verloren) };
        if (Number.isInteger(spur) && Object.values(z).every(Number.isFinite)) this.midi.set(spur, z);
        break;
      }
      case '/zustand/arr': this.arr = {
        nr: Number(f.nr), status: Number(f.status), loop_an: Number(f.loop_an), projekt_beat: Number(f.projekt_beat),
        ursprung_sample: Number(f.ursprung_sample), start_beat: Number(f.start_beat), metronom_an: Number(f.metronom_an), limiter_db: Number(f.limiter_db) };
        if (this.paarBeat !== null && Number.isFinite(this.paarBeat) && Number.isFinite(this.arr.projekt_beat)) {
          this.offset = this.paarBeat - this.arr.projekt_beat;
        }
        this.paarBeat = null;
        break;
      case '/zustand/ins_host': this.insHost = insHostListe(f); break;   // plan 1.11: per effect host the core's health and last round trip
      case '/e/container/quelle': {
        const c = Number(f.container), art = Number(f.art);
        if (Number.isInteger(c) && c >= 1 && c <= 4 && (art === 0 || art === 1 || art === 2)) this.container[c - 1] = art;
        break;
      }
      case '/k/willkommen': this.generation = Number(f.generation); break;
      case '/e/neustart': {
        const alt = this.generation, g = Number(f.generation);
        this.generation = g;
        // Spec 6.30: ein neuer Kern kennt nichts von dem, was der alte gemeldet hat (Decks, Boxen, Regler, Arrangement); bis er es
        // neu meldet, ist es unbekannt. Die Uhr bleibt (sie kommt ohnehin laufend nach).
        if (g !== alt) {
          this.decks.clear(); this.regler.clear(); this.mod.clear(); this.midi.clear();
          this.arr = null; this.insHost = null; this.offset = null; this.paarBeat = null;
          this.container = [1, 1, 1, 1];
        }
        return { neustart: g !== alt };
      }
      default: break;
    }
    return { neustart: false };
  }

  // SEQ scenes: what szenenZielBeat needs; null until a pair is known (or after a new core). The loop ends are project data, the caller passes them.
  zielLage(loop: { von_beat: number; bis_beat: number }): ZielLage | null {
    if (!this.uhr || !this.arr || this.offset === null) return null;
    return { kBeat: this.uhr.beat, offset: this.offset, bpm: this.uhr.bpm, loopVon: loop.von_beat, loopBis: loop.bis_beat,
      loopAn: this.arr.loop_an === 1, laeuft: this.arr.status === 2 };
  }

  insHost: ReturnType<typeof insHostListe> | null = null;
  modAusgang(nr: number): number | null { return this.mod.get(nr) ?? null; }
  reglerWert(pfad: string): number | null { return this.regler.get(pfad) ?? null; }
  midiZaehler(spur: number): MidiZaehler | null { return this.midi.get(spur) ?? null; }   // null while the core has reported none for this track
  deckLaeuft(): boolean { for (const s of this.decks.values()) if (s >= 2) return true; return false; }
  // Spec 2.2: quant 2, sobald ein Deck oder ein Studio-Strom läuft. Den Strom sieht der Server nur am offenen Kanal
  // (erz/1..3 Fader über −200 dB): ein Strom auf geschlossenem Kanal ist nicht zu hören, Takt-Treue zu ihm ist dann ohne Wirkung.
  djLaeuft(): boolean {
    if (this.deckLaeuft()) return true;
    return ERZ_STROEME.some((k) => (this.reglerWert(`${k}/fader`) ?? -200) > -200);
  }
}

// proj_lage: the modulators of the project in readable form (strand 6); `einheit` says what `tiefe` is counted in: dB (fader, send), pan, 0..1 (device and
// plugin parameter: fraction of the range) or Bereich (chain and rack parameter: fraction of the parameter's own range). Absent when there are none.
export function modulatorenLage(p: Projekt, lage?: KernLage): Record<string, unknown>[] | undefined {
  if (!p.modulatoren?.length) return undefined;
  const einheit = (z: string): string => z === 'fader' || z.startsWith('send.') ? 'dB' : z === 'pan' ? 'pan'
    : z.startsWith('geraet.') || z.startsWith('plugin.') ? '0..1' : 'Bereich';
  return p.modulatoren.map((m) => ({
    mod_id: m.id, nr: m.nr, ...(m.name !== undefined ? { name: m.name } : {}), art: m.art,
    ...(m.art === 'folger'
      ? { quelle: m.quelle ?? null, angriff_ms: m.angriff_ms ?? 5, abfall_ms: m.abfall_ms ?? 150, empfindlich_db: m.empfindlich_db ?? 0 }
      : { form: m.form ?? 'sinus', ...(m.hz !== undefined ? { hz: m.hz } : { takt: m.takt ?? 4 }), phase: m.phase ?? 0 }),
    glatt_ms: m.glatt_ms ?? 1, an: m.an !== false,
    ausgang: lage?.modAusgang(m.nr) ?? null,   // the core's live output -1..1 before depth; null while the core has reported none
    ziele: m.ziele.map((z) => ({
      strang_id: z.strang_id, ziel: z.ziel, tiefe: z.tiefe, polaritaet: m.art === 'folger' ? 'uni' : z.polaritaet ?? 'bi', einheit: einheit(z.ziel) })),
  }));
}

// The pooled row prefix of a strip as the core reports it in /e/regler (spur/3, grp/1, ret/2, pm), or null when the id names no strip.
function reihenPraefix(p: Projekt, strangId: string): string | null {
  if (strangId === 'master') return 'pm';
  const sp = p.spuren.find((x) => x.id === strangId); if (sp) return `spur/${sp.nr}`;
  const g = (p.gruppen ?? []).find((x) => x.id === strangId); if (g) return `grp/${g.nr}`;
  const r = (p.returns ?? []).find((x) => x.id === strangId); return r ? `ret/${r.nr}` : null;
}

// The base of one target as the server knows it: the last /e/regler value of its row when the core reported one, else the project value; null when
// neither is known here (device and plugin targets: the server keeps no value for them).
function zielBasis(p: Projekt, lage: KernLage, strangId: string, ziel: string): number | null {
  const strang = sucheStrang(p, strangId);
  const pf = reihenPraefix(p, strangId);
  if (!strang || !pf) return null;
  if (ziel === 'fader' || ziel === 'pan') {
    const live = pf === 'pm' && ziel === 'pan' ? null : lage.reglerWert(`${pf}/${ziel}`);
    return live ?? (ziel === 'fader' ? (strang as { fader_db: number }).fader_db : (strang as { pan?: number }).pan ?? null);
  }
  if (istSendZiel(ziel)) {
    const rid = sendZielVon(ziel), ret = (p.returns ?? []).find((x) => x.id === rid);
    if (!ret) return null;
    return lage.reglerWert(`${pf}/send/${ret.nr}`) ?? (strang as { sends?: { id: string; db: number }[] }).sends?.find((x) => x.id === rid)?.db ?? null;
  }
  const k = zerlegeKettenZiel(ziel);
  if (k && 'makro' in k) return (strang as { rack?: { werte: number[] } }).rack?.werte[k.makro - 1] ?? null;
  if (k) return (strang as { inserts?: { id: string; werte: Record<string, number> }[] }).inserts?.find((x) => x.id === k.insert)?.werte[k.param] ?? null;
  return null;
}

// GET /proj/auto?mod_id=: every target of one modulator with base, offset and the clamped value in real units. versatz is already in the unit of the
// target (an insert depth is a fraction of the parameter range and is multiplied by max - min here, D6). basis, versatz and wert are null while the
// core has reported no output or the server knows no base for that target (device and plugin targets). Null for an unknown modulator.
export function modAutoAntwort(p: Projekt, modId: string, lage: KernLage): Record<string, unknown> | null {
  const m: Modulator | undefined = (p.modulatoren ?? []).find((x) => x.id === modId);
  if (!m) return null;
  const out = lage.modAusgang(m.nr);
  const einheit = (z: string): string => z === 'fader' || z.startsWith('send.') ? 'dB' : z === 'pan' ? 'pan'
    : z.startsWith('geraet.') || z.startsWith('plugin.') ? '0..1' : 'Bereich';
  return { mod_id: m.id, nr: m.nr, art: m.art, an: m.an !== false, ausgang: out, ziele: m.ziele.map((z) => {
    const bereich = zielBereichVon(z.ziel, sucheStrang(p, z.strang_id));
    const basis = zielBasis(p, lage, z.strang_id, z.ziel);
    const uni = z.polaritaet === 'uni' || m.art === 'folger';
    let versatz: number | null = null, wert: number | null = null;
    if (out !== null && m.an !== false) {
      versatz = modVersatz(out, z.tiefe, uni);   // the follower is reported as 2*out-1 like every output and is always unipolar: tiefe * out01
      if (bereich && /^(insert)\./.test(z.ziel)) versatz *= bereich.max - bereich.min;
      if (basis !== null && bereich) wert = modWert(basis, versatz, bereich);
    }
    return { strang_id: z.strang_id, ziel: z.ziel, einheit: einheit(z.ziel), basis, versatz, wert, tiefe: z.tiefe, polaritaet: uni ? 'uni' : 'bi' };
  }) };
}
