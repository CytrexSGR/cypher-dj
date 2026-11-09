// Ringpuffer der Kern-/pegel-Ereignisse je Kanal, UNGEDROSSELT (die SSE-Drossel auf 10 Hz verschluckt Spitzen).
// Hält die letzten FENSTER_MAX_MS; lies() wertet ein kürzeres Fenster aus. lufs_s wird bewusst nicht geführt:
// der Kern liefert es heute immer als −200.
export const FENSTER_MAX_MS = 10_000;

export interface PegelKanal { n: number; max_db: number; median_db: number | null }

export class PegelPuffer {
  private readonly ereignisse: { t: number; kanal: string; db: number }[] = [];
  private readonly jetzt: () => number;
  constructor(jetzt: () => number = Date.now) { this.jetzt = jetzt; }

  nimm(f: { kanal: string; spitze_db: number }): void {
    const t = this.jetzt();
    this.ereignisse.push({ t, kanal: String(f.kanal), db: Number(f.spitze_db) });
    let i = 0;
    while (i < this.ereignisse.length && t - this.ereignisse[i].t > FENSTER_MAX_MS) i++;
    if (i) this.ereignisse.splice(0, i);
  }

  groesse(): number { return this.ereignisse.length; }

  lies(sekunden: number): Record<string, PegelKanal> {
    const ab = this.jetzt() - sekunden * 1000;
    const je = new Map<string, number[]>();
    for (const e of this.ereignisse) {
      if (e.t < ab) continue;
      (je.get(e.kanal) ?? je.set(e.kanal, []).get(e.kanal)!).push(e.db);
    }
    const aus: Record<string, PegelKanal> = {};
    for (const [kanal, dbs] of je) {
      const hoerbar = dbs.filter((d) => d > -199).sort((a, b) => a - b);
      const m = hoerbar.length;
      const median = m === 0 ? null : m % 2 ? hoerbar[(m - 1) / 2] : (hoerbar[m / 2 - 1] + hoerbar[m / 2]) / 2;
      aus[kanal] = { n: dbs.length, max_db: Math.max(...dbs), median_db: median };
    }
    return aus;
  }
}
