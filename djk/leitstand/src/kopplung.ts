// Kopplung vergibt der Leitstand, nicht das LLM (SCHNITTSTELLEN §14.1, ADR 023): Basstausch-Paare bekommen die Gruppe
// basstausch, die übrigen Teile des einblendenden Kanals b_rein, die des ausblendenden Kanals a_raus. Politik nach §16.1:
// Ausblenden, Fader zu, Kill an und Stopp-Folgen 1 (zustand), alles andere 0 (musik).
// Beleg für die Regel: das Beispiel §14.1 kommt ohne Gruppen hinein und mit genau seinen Gruppen und Politiken heraus
// (tests/kopplung.test.ts); 09 NP K1: 0 von 105 LLM-Plänen setzen selbst eine Gruppe.
import { kanalVon, machtLeiser } from './regler_info.ts';
import { geordnet, type Plan, type ReglerTeil, type Teil } from './plan.ts';

export interface Schwellen { hoerbarDb: number; tiefOffenDb: number }
export type Wert = (pfad: string) => number;

export interface Kopplung { b: string[]; a: string[]; paare: Array<[number, number]> }

// Wert eines Reglers unmittelbar vor Teil t: Spiegel, dann frühere Teile desselben Plans am selben Regler
export function wertVor(plan: Plan, t: ReglerTeil, wert: Wert): number {
  let v = wert(t.pfad);
  for (const u of geordnet(plan.teile)) {
    if (u === t) break;
    if (u.art === 'regler' && u.pfad === t.pfad) v = u.nach;
  }
  return v;
}

const BASS = /^(deck\/[1-4]|erz\/[1-8]|pad\/[12])\/(eq\/tief|kill\/tief|stem\/bass)$/;

// Öffnet (+1) oder schließt (−1) der Teil den Bass seines Kanals (§1.6 tief_offen: Kill tief aus, EQ tief und Stem Bass
// über tief_offen_db)? 0: weder noch.
export function bassRichtung(plan: Plan, t: ReglerTeil, wert: Wert, s: Schwellen): number {
  if (!BASS.test(t.pfad)) return 0;
  const vor = wertVor(plan, t, wert);
  const offen = (x: number) => (t.pfad.endsWith('/kill/tief') ? x === 0 : x > s.tiefOffenDb);
  if (!offen(vor) && offen(t.nach)) return 1;
  if (offen(vor) && !offen(t.nach)) return -1;
  return 0;
}

const ueberlappt = (x: Teil, y: Teil) => {
  const xe = x.art === 'deck' ? x.ab_beat : x.ab_beat + x.dauer_beats;
  const ye = y.art === 'deck' ? y.ab_beat : y.ab_beat + y.dauer_beats;
  return x.ab_beat <= ye && y.ab_beat <= xe;
};

export function erkenne(plan: Plan, wert: Wert, s: Schwellen): Kopplung {
  const rauf = new Set<string>();
  const runter = new Set<string>();
  for (const t of plan.teile) {
    if (t.art === 'deck') {
      if (t.aktion === 'start') rauf.add(`deck/${t.deck}`);
      if (t.aktion === 'stopp') runter.add(`deck/${t.deck}`);
    } else if (t.art === 'regler' && /\/fader$/.test(t.pfad) && kanalVon(t.pfad) !== null) {
      const k = kanalVon(t.pfad) as string;
      const vor = wertVor(plan, t, wert);
      if (t.nach > vor) rauf.add(k);
      if (t.nach < vor) runter.add(k);
    }
  }
  const b = [...rauf].filter((k) => !runter.has(k));
  const a = [...runter].filter((k) => !rauf.has(k));
  const oeffner = plan.teile.filter((t): t is ReglerTeil => t.art === 'regler' && b.includes(kanalVon(t.pfad) ?? '')
    && bassRichtung(plan, t, wert, s) === 1);
  const schliesser = plan.teile.filter((t): t is ReglerTeil => t.art === 'regler' && a.includes(kanalVon(t.pfad) ?? '')
    && bassRichtung(plan, t, wert, s) === -1);
  const paare: Array<[number, number]> = [];
  const vergeben = new Set<number>();
  for (const o of geordnet(oeffner)) {
    const partner = geordnet(schliesser).find((x) => !vergeben.has(x.nr) && ueberlappt(o, x));
    if (partner) { paare.push([partner.nr, o.nr]); vergeben.add(partner.nr); vergeben.add(o.nr); }
  }
  return { b, a, paare };
}

// Setzt gruppe und politik jedes Teils (auch überschreibend: Gruppen aus dem Plan zählen nicht, §14.1).
// mitKopplung = false ist die Mutation kopplung_aus (Fehlerfall 09 NP K1 vorher).
export function koppeln(plan: Plan, wert: Wert, s: Schwellen, mitKopplung = true): Kopplung {
  const k = erkenne(plan, wert, s);
  const imPaar = new Set(k.paare.flat());
  for (const t of plan.teile) {
    if (t.art === 'tempo') continue;
    const kanal = t.art === 'deck' ? `deck/${t.deck}` : kanalVon(t.pfad);
    let gruppe = '';
    if (imPaar.has(t.nr)) gruppe = 'basstausch';
    else if (kanal && k.b.includes(kanal)) gruppe = 'b_rein';
    else if (kanal && k.a.includes(kanal)) gruppe = 'a_raus';
    t.gruppe = mitKopplung ? gruppe : '';
    if (t.art === 'deck') t.politik = t.aktion === 'stopp' ? 1 : (t.politik === 2 ? 2 : 0);
    else t.politik = gruppe === 'a_raus' || machtLeiser(t.pfad, wertVor(plan, t, wert), t.nach) ? 1 : 0;
  }
  return k;
}
