// Ansage bei einer Verriegelung: jeder Grund sagt, was zu ändern ist (Auftrag Scheibe 21 aus M15, Stand 03,
// 2026-09-26). Gemessen im Kurzlauf M15: ohne Hinweis wiederholte das Modell bei hoerschein_nicht_sync zweimal von
// zwei dieselbe Wahl; mit Material und Ausweg in der Ansage 0 Fehlreparaturen, bei zu_spaet mit Takt 1 von 1 repariert.
// Der Code aus §16.2 bleibt vorn und wörtlich (Cypher und Prüfer lesen ihn); danach kommt der Satz mit dem Ausweg.
import type { Hoerschein } from './hoerscheine.ts';
import { kanalVonTeil, type Plan, type Teil } from './plan.ts';
import { reglerInfo } from './regler_info.ts';
import type { Grund } from './verriegelung.ts';

export interface HinweisUmgebung {
  plan: Plan;
  hoerschein: (id: string) => Hoerschein | undefined;
  stufe: number;
  methode: string;
}

// Material eines Hörscheins: inhalt = <material_id>/<bpm·1000>_r<fassung> (§4.5)
export function materialVon(h: Hoerschein | undefined): string | null {
  if (!h || !h.inhalt) return null;
  return h.inhalt.split('/')[0] || null;
}

// Ablehnung wegen der Stufe (§10): was stattdessen geht
export function autonomieText(stufe: number, methode: string): string {
  return stufe <= 0
    ? `Stufe 0 erlaubt ${methode} nicht, nur zuhören (lage, warte, bestand, passung, markieren); warte, bis Andreas die Stufe hebt`
    : `Stufe ${stufe} erlaubt ${methode} nicht; lass es und schlage vor, was die Stufe erlaubt (Einreichungen werden Vorschläge)`;
}

const taktSchlag = (beat: number): string => `Takt ${Math.floor(beat / 4) + 1} Schlag ${Math.floor(beat % 4) + 1}`;

type Bau = (t: Teil | undefined, g: Grund, u: HinweisUmgebung) => string;

const pfadVon = (t: Teil | undefined): string =>
  !t ? 'der Teil' : t.art === 'regler' ? t.pfad : t.art === 'deck' ? `deck/${t.deck} (${t.aktion})` : 'die Tempo-Rampe';

function hsText(t: Teil | undefined, u: HinweisUmgebung): { id: string; h: Hoerschein | undefined; material: string } {
  const id = (t && t.art !== 'tempo' ? t.hoerschein : '') || '';
  const h = id ? u.hoerschein(id) : undefined;
  return { id: id || '(keiner)', h, material: materialVon(h) ?? 'unbekannt' };
}

// Je Code aus §16.2, den die Vorprüfung (verriegelung.ts) oder die Annahme (autonomie, ki_gestoppt) meldet.
export const HINWEISE: Record<string, Bau> = {
  unbekannter_regler: (t) => `Regler ${pfadVon(t)} gibt es nicht; nimm einen Pfad aus der Regler-Tabelle §1.5`,
  nur_hand: (t) => `${pfadVon(t)} gehört nur Andreas' Hand; lass diesen Teil weg`,
  ausserhalb_bereich: (t) => {
    const i = t && t.art === 'regler' ? reglerInfo(t.pfad) : null;
    const bereich = i ? `${i.min} bis ${i.max}` : 'dem Bereich aus §1.5';
    return `Wert für ${pfadVon(t)} liegt außerhalb von ${bereich} (Schalter und Stufen nur als setze mit ganzem Wert); wähle einen Wert im Bereich`;
  },
  zu_spaet: (_t, g) => {
    const f = g.fruehestens_beat;
    return f === undefined ? 'der Start liegt zu nah; plane später'
      : `frühestens ${taktSchlag(f)}; setze den Start auf Takt ${Math.floor(f / 4) + 1} oder später`;
  },
  regler_beim_menschen: (t) => `Andreas hält ${pfadVon(t)}; lass diesen Regler, bis er ihn zurückgibt, oder plane einen anderen Kanal`,
  deck_beruehrt: (t) => `Andreas hält ${pfadVon(t)}; lass dieses Deck in Ruhe oder nimm ein anderes`,
  ueberlappung: (t) => `zwei Teile deines Plans greifen gleichzeitig an ${pfadVon(t)}; lege sie nacheinander`,
  regler_verplant: (t) => `${pfadVon(t)} ist in diesem Zeitraum schon verplant; plane nach dem laufenden Plan oder brich deinen eigenen erst ab`,
  kein_hoerschein: (t) => {
    const k = t ? kanalVonTeil(t) : null;
    return `der Teil öffnet ${k ?? 'einen Kanal'} ohne Hörschein; hör das Material erst vor und gib die hs_id seines Hörscheins an`;
  },
  hoerschein_anderer_kanal: (t, _g, u) => {
    const { id, h } = hsText(t, u);
    return `Hörschein ${id} gilt für ${h?.kanal ?? 'einen anderen Kanal'}, der Teil öffnet ${t ? kanalVonTeil(t) ?? '?' : '?'}; nimm den Hörschein dieses Kanals`;
  },
  hoerschein_nicht_sync: (t, _g, u) => {
    const { id, h, material } = hsText(t, u);
    return `Hörschein ${id} meldet Material ${material} ${h ? `auf ${h.kanal} ` : ''}nicht synchron (${h?.urteil ?? 'nicht_sync'}); `
      + 'dieses Material ist gesperrt, wähle ein anderes Material';
  },
  hoerschein_pegel: (t, _g, u) => {
    const { id, h, material } = hsText(t, u);
    return `Hörschein ${id} meldet für Material ${material} den Pegel ${h?.urteil ?? 'daneben'}; dieses Material ist gesperrt, wähle ein anderes Material`;
  },
  hoerschein_anderer_inhalt: (t, _g, u) => {
    const { id, material } = hsText(t, u);
    return `Hörschein ${id} gehört zu Material ${material}, auf dem Kanal liegt jetzt anderes; hör das geladene Material vor und nimm dessen Hörschein`;
  },
  hoerschein_anderes_tempo: (t, _g, u) => {
    const { id, h } = hsText(t, u);
    return `Hörschein ${id} wurde bei ${h?.bpm ?? '?'} BPM gemessen, der Plan spielt anders; plane ohne Tempowechsel oder hör beim neuen Tempo vor`;
  },
  hoerschein_abgelaufen: (t, _g, u) => {
    const { id, h } = hsText(t, u);
    return `Hörschein ${id} ist abgelaufen${h ? ` (gültig bis ${taktSchlag(h.gueltig_bis_beat)})` : ''}; warte auf den erneuerten Hörschein oder hör neu vor`;
  },
  hoerschein_anderer_abschnitt: (t, _g, u) => {
    const { id } = hsText(t, u);
    return `der Teil spielt einen Abschnitt, den Hörschein ${id} nicht gemessen hat; starte am vorgehörten Einstieg`;
  },
  ziel_ungehoert: (t) => `das Ziel von ${pfadVon(t)} ist ungehört; springe nur auf einen vorgehörten Abschnitt oder reiche es als Vorschlag für Andreas ein`,
  budget_stretcher: () => 'die Tempo-Rampe braucht mehr Stretcher, als frei sind; plane ohne Tempowechsel oder erst, wenn ein Deck gestoppt ist',
  autonomie: (_t, _g, u) => autonomieText(u.stufe, u.methode),
  ki_gestoppt: () => 'Andreas hat Cypher gestoppt; reiche nichts ein, bis er Freigabe drückt',
};

// Ein Satz je Grund: „Teil <nr> <code>: <Ausweg>“. Unbekannte Codes bleiben der nackte Code (der Test hält die Liste voll).
export function hinweis(g: Grund, u: HinweisUmgebung): string {
  const t = u.plan.teile.find((x) => x.nr === g.teil);
  const bau = HINWEISE[g.grund];
  return `Teil ${g.teil} ${g.grund}${bau ? `: ${bau(t, g, u)}` : ''}`;
}

// Die Ansage einer Verriegelung oder Ablehnung: je Code ein Hinweis (gleiche Codes an mehreren Teilen einmal, mit allen
// Teilnummern), damit das Modell im selben Zug weiß, was zu ändern ist.
export function ansageVerriegelt(status: string, gruende: Grund[], u: HinweisUmgebung): string {
  const je = new Map<string, Grund[]>();
  for (const g of gruende) je.set(g.grund, [...(je.get(g.grund) ?? []), g]);
  const saetze = [...je.values()].map((gs) => {
    const h = hinweis(gs[0], u);
    return gs.length > 1 ? h.replace(/^Teil \d+/, `Teile ${gs.map((g) => g.teil).join(', ')}`) : h;
  });
  return `Plan ${u.plan.id} ${status}. ${saetze.join('. ')}.`;
}
