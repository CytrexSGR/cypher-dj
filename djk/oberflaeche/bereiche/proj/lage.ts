// Was der Bereich proj vom Kern wissen muss (Spec D1 2.2, 2.7, 2.12), gelesen nur aus Kern-Ereignissen über den Haken ereignis
// (Spec 2.10): Uhr, Decks, Loop-Boxen, Regler mit Halter, /zustand/arr, Generation. Keine Innereien der Oberflaeche.
// Was ein Ereignis nie gemeldet hat, ist unbekannt: ein Regler ohne /e/regler seit dem Serverstart gilt als nicht offen (−200).
export interface ArrZustand {
  nr: number; status: number; loop_an: number; projekt_beat: number; ursprung_sample: number; start_beat: number; metronom_an: number;
}

const BOX_LAEUFT = new Set([2, 3, 4]);          // /e/loop, /zustand/box: 2 wartet, 3 läuft, 4 endet (INTERFACES §5.11)
const ERZ_STROEME = ['erz/1', 'erz/2', 'erz/3'];  // Studio-Ströme 1 bis 3 (Strudel), Spec 2.2 „Studio-Strom“

export class KernLage {
  uhr: { beat: number; bpm: number } | null = null;
  arr: ArrZustand | null = null;
  generation: number | null = null;
  private readonly decks = new Map<number, number>();
  private readonly boxen = new Map<number, number>();
  private readonly regler = new Map<string, number>();

  // Liefert neustart: true bei /e/neustart mit neuer Generation (wie server.ts vomKern: „neuerKern“)
  nimm(adresse: string, f: Record<string, unknown>): { neustart: boolean } {
    switch (adresse) {
      case '/uhr': this.uhr = { beat: Number(f.beat), bpm: Number(f.bpm) }; break;
      case '/zustand/deck': this.decks.set(Number(f.deck), Number(f.status)); break;
      case '/e/loop': case '/zustand/box': this.boxen.set(Number(f.box), Number(f.status)); break;
      case '/e/regler': this.regler.set(String(f.pfad), Number(f.wert)); break;
      case '/zustand/arr': this.arr = {
        nr: Number(f.nr), status: Number(f.status), loop_an: Number(f.loop_an), projekt_beat: Number(f.projekt_beat),
        ursprung_sample: Number(f.ursprung_sample), start_beat: Number(f.start_beat), metronom_an: Number(f.metronom_an) };
        break;
      case '/k/willkommen': this.generation = Number(f.generation); break;
      case '/e/neustart': {
        const alt = this.generation, g = Number(f.generation);
        this.generation = g;
        // Spec 6.30: ein neuer Kern kennt nichts von dem, was der alte gemeldet hat (Decks, Boxen, Regler, Arrangement); bis er es
        // neu meldet, ist es unbekannt. Die Uhr bleibt (sie kommt ohnehin laufend nach).
        if (g !== alt) { this.decks.clear(); this.boxen.clear(); this.regler.clear(); this.arr = null; }
        return { neustart: g !== alt };
      }
      default: break;
    }
    return { neustart: false };
  }

  reglerWert(pfad: string): number | null { return this.regler.get(pfad) ?? null; }
  deckLaeuft(): boolean { for (const s of this.decks.values()) if (s >= 2) return true; return false; }
  // Spec 2.2: quant 2, sobald ein Deck, eine Loop-Box oder ein Studio-Strom läuft. Den Strom sieht der Server nur am offenen Kanal
  // (erz/1..3 Fader über −200 dB): ein Strom auf geschlossenem Kanal ist nicht zu hören, Takt-Treue zu ihm ist dann ohne Wirkung.
  djLaeuft(): boolean {
    if (this.deckLaeuft()) return true;
    for (const s of this.boxen.values()) if (BOX_LAEUFT.has(s)) return true;
    return ERZ_STROEME.some((k) => (this.reglerWert(`${k}/fader`) ?? -200) > -200);
  }
}
