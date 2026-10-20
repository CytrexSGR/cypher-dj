// PRODUCTION (D1 V2): Tastatur-Schritte undo-gerecht zusammenfassen (Spec 3.3: jede Änderung ein Verlaufseintrag; eine
// gedrückt gehaltene Pfeiltaste soll nicht 30 Einträge je Sekunde machen und keinen Schritt verlieren). Reine Logik.
// Solange eine Änderung unterwegs ist, werden weitere Schritte addiert und danach als EINE Änderung geschickt. Der Sammler reicht nur
// die Summe weiter; gerechnet wird sie erst, wenn ihre Anfrage im Schreiber an der Reihe ist (sende über ctx.aendereAus, V2 Fix-Runde 2
// H1, Spec 6.34), aus genau dem Stand, dessen rev mitgeht. Ein Zug davor, der noch unterwegs ist, steckt dann schon darin; vorher wurde
// beim Weiterreichen gerechnet, und der Zug ging verloren. sende(summe) → Promise; Fehler meldet sende selbst.
// Ein Zug mit der Maus braucht das nicht: er schickt beim Loslassen genau einmal (clip_bedienung.js, pianoroll_bedienung.js).
// D1 S3 Auftrag 16 c: `mit` gehört zum Tastendruck (etwa die gewählten Noten beim Drücken). Schritte mit verschiedenem `mit` werden nie
// zusammengezählt, sondern nacheinander geschickt; sende(summe, mit) rechnet die Lage dann aus dem Stand beim Senden, die Auswahl vom Drücken.
export function neuerSammler(sende) {
  const schlange = [];
  let unterwegs = false;
  async function pumpe() {
    if (unterwegs) return;
    unterwegs = true;
    while (schlange.length) {
      const x = schlange.shift();
      try { await sende(x.d, x.mit); } catch { /* sende meldet selbst; der nächste Schritt rechnet vom Stand, den der Server hat */ }
    }
    unterwegs = false;
  }
  return {
    schritt(d, mit) {
      const schluessel = mit === undefined ? '' : JSON.stringify(mit);
      let x = schlange.at(-1);
      if (!x || x.schluessel !== schluessel) { x = { d: {}, mit, schluessel }; schlange.push(x); }
      for (const [k, v] of Object.entries(d)) x.d[k] = (x.d[k] ?? 0) + v;
      pumpe();
    },
    get unterwegs() { return unterwegs; },
  };
}
