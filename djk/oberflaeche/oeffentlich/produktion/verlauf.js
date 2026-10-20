// PRODUCTION (D1 V1): Undo-Stand und Verlaufsanzeige aus GET /proj/verlauf (Spec 3.3/3.4). Reine Funktionen.
// Der Undo-Zeiger ergibt sich aus dem Durchlauf über das Log (Spec 3.3): aendern legt auf den Getan-Stapel und leert
// den Redo-Stapel, undo nimmt den obersten Getan-Eintrag zurück, redo den obersten Redo-Eintrag. Undo und Redo kehren
// immer den obersten Eintrag um, darum genügt die Folge der Arten; das Feld bezug braucht die Seite nicht.

export function undoStand(verlauf) {
  const getan = [], rueck = [];
  for (const e of [...(verlauf ?? [])].sort((a, b) => a.rev - b.rev)) {
    if (e.art === 'aendern') { getan.push(e); rueck.length = 0; }
    else if (e.art === 'undo') { const x = getan.pop(); if (x) rueck.push(x); }
    else if (e.art === 'redo') { const x = rueck.pop(); if (x) getan.push(x); }
  }
  return { undo: getan.at(-1) ?? null, redo: rueck.at(-1) ?? null, tiefe: getan.length };
}

const QUELLE_TEXT = { andreas: 'You', cypher: 'Cypher' };
const zwei = (n) => String(n).padStart(2, '0');
export function zeitText(zeit) {
  const d = new Date(zeit ?? NaN);          // Millisekunden (Attrappe) oder ISO-Text (S2, verlauf.ts); null nicht als Epoche lesen
  return Number.isNaN(d.getTime()) ? '–' : `${zwei(d.getHours())}:${zwei(d.getMinutes())}:${zwei(d.getSeconds())}`;
}
// Neueste zuerst, höchstens max Zeilen. Das Label zeigt die Seite unverändert: S2 schreibt „Undo: <label>“ und „Redo: <label>“ selbst
// ins Label (verlauf.ts protokolliere); ein Präfix der Seite machte daraus „Undo: Undo: Tempo 124“.
export function verlaufZeilen(verlauf, max = 40) {
  return [...(verlauf ?? [])].sort((a, b) => b.rev - a.rev).slice(0, max).map((e) => ({
    rev: e.rev, text: e.label, quelle: QUELLE_TEXT[e.quelle] ?? e.quelle, zeit: zeitText(e.zeit), art: e.art,
  }));
}
