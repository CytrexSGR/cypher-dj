// Vorschläge an Andreas (SCHNITTSTELLEN §14.3, §3: verfällt 1 Takt vor seinem Start). Tasten „annehmen“ und
// „verwerfen“ (§5.8) wirken auf den offenen Vorschlag mit dem frühesten Start (Festlegung dieser Scheibe: der Vertrag
// sagt nicht, welcher bei mehreren gilt; LED und „Cypher hören“ zeigen genau diesen).
export interface Vorschlag {
  id: string; plan_id: string; text: string; start_beat: number; verfaellt_beat: number; kanal: string;
}

export const VERFALL_BEATS = 4; // 1 Takt (§3, V1 nur 4/4)

export class VorschlagRegister {
  private readonly offen = new Map<string, Vorschlag>();
  private zaehler = 0;

  neu(planId: string, text: string, startBeat: number, kanal: string): Vorschlag {
    const v = { id: `v${++this.zaehler}`, plan_id: planId, text, start_beat: startBeat, verfaellt_beat: startBeat - VERFALL_BEATS, kanal };
    this.offen.set(v.id, v);
    return v;
  }

  // Nach einem Leitstand-Neustart aus dem Journal: Zähler weiterführen, offene Vorschläge übernehmen
  uebernehme(v: Vorschlag): void {
    this.offen.set(v.id, v);
    this.zaehler = Math.max(this.zaehler, Number(v.id.slice(1)) || 0);
  }

  get(id: string): Vorschlag | undefined { return this.offen.get(id); }
  alle(): Vorschlag[] { return [...this.offen.values()].sort((a, b) => a.start_beat - b.start_beat || a.id.localeCompare(b.id)); }

  // Der Vorschlag, auf den eine Taste bei Beat b wirkt: frühester Start, noch nicht verfallen (b < verfaellt_beat)
  aktuell(b: number): Vorschlag | undefined { return this.alle().find((v) => b < v.verfaellt_beat); }

  entferne(id: string): Vorschlag | undefined {
    const v = this.offen.get(id);
    this.offen.delete(id);
    return v;
  }
}
