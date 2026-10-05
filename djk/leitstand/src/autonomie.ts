// Autonomie-Stufen als Positivliste (SCHNITTSTELLEN §10, ADR 013 Entscheidung 4). Befangen: diese Datei regelt meinen
// eigenen Spielraum. Darum steht hier nur, was ich darf; alles andere wird Vorschlag oder abgelehnt.
// Stufe 2 füllt Scheibe 56 (eigene Spur); bis dahin gilt auf Stufe 2 dasselbe wie auf Stufe 1 (strenger, nie lockerer).
import { autonomieText } from './hinweise.ts';
import { RpcFehler, type Methode } from './hub.ts';
import { kanalVon, machtLeiser } from './regler_info.ts';
import { wertVor, type Wert } from './kopplung.ts';
import type { Plan } from './plan.ts';

export type Weg = 'direkt' | 'vorschlag' | 'abgelehnt';

export const METHODEN_LESEN = ['lage', 'warte', 'bestand', 'passung', 'markieren'] as const;
export const METHODEN_EINREICHEN = ['waehle', 'plan_einreichen'] as const;
export const METHODEN_ALLEIN_AB_1 = ['laden', 'vorhoeren', 'erzeuge', 'plan_abbrechen'] as const;
// Alle Werkzeuge aus §10 (gleich der Liste methode in ws_daten.schema.json#/rpc); keine andere Methode nimmt der Leitstand an
export const METHODEN_10 = [...METHODEN_LESEN, ...METHODEN_EINREICHEN, ...METHODEN_ALLEIN_AB_1, 'spielzettel'] as const;

// §10 Stufe 1: ein Plan, dessen Teile ausschließlich Kanäle der KI-Spur leiser machen (Fader oder Send nach unten,
// Kill an). Ein leerer Plan ist es nicht.
export function nurKiSpurLeiser(plan: Plan, kiSpur: ReadonlySet<string>, wert: Wert): boolean {
  if (plan.teile.length === 0) return false;
  return plan.teile.every((t) => t.art === 'regler' && kiSpur.has(kanalVon(t.pfad) ?? '')
    && machtLeiser(t.pfad, wertVor(plan, t, wert), t.nach));
}

// Entscheidet für eine Methode (und bei Einreichungen den Plan). Rückgabe: der Weg; bei abgelehnt ist der Grund
// immer autonomie (§16.2).
export function entscheide(stufe: number, methode: string, plan: Plan | null, kiSpur: ReadonlySet<string>, wert: Wert): Weg {
  if ((METHODEN_LESEN as readonly string[]).includes(methode)) return 'direkt';
  if (stufe >= 3) return 'direkt';
  if (stufe <= 0) return methode === 'plan_abbrechen' ? 'direkt' : 'abgelehnt';
  // Stufe 1 und (bis Scheibe 56) Stufe 2
  if ((METHODEN_ALLEIN_AB_1 as readonly string[]).includes(methode)) return 'direkt';
  if ((METHODEN_EINREICHEN as readonly string[]).includes(methode)) {
    return plan && nurKiSpurLeiser(plan, kiSpur, wert) ? 'direkt' : 'vorschlag';
  }
  return 'abgelehnt'; // spielzettel und Unbekanntes: nicht auf der Liste
}

// Tor vor jeder Methode, die nicht selbst mit einem Plan entscheidet (alles außer waehle und plan_einreichen, die die
// Annahme mit dem Plan prüft): Stufe nach der Positivliste, danach Cypher-Stopp (ADR 013 Entscheidung 5: weitere
// Cypher-Befehle abgelehnt bis Freigabe; Zuhören und eigene Pläne abbrechen bleiben). null heißt: darf.
export function torFuer(stufe: number, methode: string, kiGestoppt: boolean): { code: string; text: string } | null {
  if (entscheide(stufe, methode, null, new Set(), () => 0) === 'abgelehnt') {
    return { code: 'autonomie', text: autonomieText(stufe, methode) };
  }
  if (kiGestoppt && !(METHODEN_LESEN as readonly string[]).includes(methode) && methode !== 'plan_abbrechen') {
    return { code: 'ki_gestoppt', text: `${methode}: Andreas hat Cypher gestoppt; nichts einreichen, laden oder erzeugen, bis er Freigabe drückt` };
  }
  return null;
}

// Methoden-Tabelle des Hubs mit Tor: nimmt nur Werkzeuge aus §10 an (eine Methode, die die Stufe setzt, gibt es nicht:
// die Stufe liegt auf Andreas' Taste), setzt für jedes Werkzeug aus §10 das Tor davor, auch für die noch nicht gebauten
// (die antworten nach dem Tor mit form), damit eine spätere Scheibe ihr Werkzeug nicht ohne Positivliste einhängt.
export function mitAutonomie(m: Record<string, Methode>, stufe: () => number, kiGestoppt: () => boolean): Record<string, Methode> {
  for (const n of Object.keys(m)) if (!(METHODEN_10 as readonly string[]).includes(n)) {
    throw new Error(`Methode ${n} steht nicht in §10 (Positivliste): nicht einhängen`);
  }
  const aus: Record<string, Methode> = {};
  for (const n of METHODEN_10) {
    const echt = m[n];
    if (echt && (METHODEN_EINREICHEN as readonly string[]).includes(n)) { aus[n] = echt; continue; } // entscheidet die Annahme
    aus[n] = (p, c) => {
      const t = torFuer(stufe(), n, kiGestoppt());
      if (t) throw new RpcFehler(t.code, t.text);
      if (!echt) throw new RpcFehler('form', `Methode ${n} gibt es in diesem Leitstand noch nicht`);
      return echt(p, c);
    };
  }
  return aus;
}
