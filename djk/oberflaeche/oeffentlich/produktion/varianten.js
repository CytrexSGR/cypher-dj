// PRODUCTION (Paket 1.18, E-c): Varianten. Spuren mit demselben Text im Feld gruppe sind Alternativen (z. B. drei Basslines). Je Gruppe eine
// Tastenreihe A, B, C … in der Reihenfolge der Spuren in der Transportleiste; ein Klick sendet variante_waehlen {gruppe, spur_id} über aendere()
// (POST /proj/aendern, ein Undo-Schritt): die gewählte Spur wird laut, die übrigen der Gruppe stumm. Annehmen heißt: die anderen Spuren löschen (✕ am Spurkopf).
// Reine Teile (Browser und node): gruppenVon, wahlBefehl, wahlLabel, tastenLabel. Der DOM-Teil läuft in der Browserprobe (pruef/probe_varianten.mjs).
export const buchstabe = (i) => String.fromCharCode(65 + i);

// [{gruppe, tasten: [{spur_id, buchstabe, laut, name}]}] in der Reihenfolge, in der die Gruppen zuerst in der Spurliste vorkommen
export function gruppenVon(projekt) {
  const je = new Map();
  for (const s of projekt?.spuren ?? []) {
    if (typeof s.gruppe !== 'string' || s.gruppe === '') continue;
    if (!je.has(s.gruppe)) je.set(s.gruppe, []);
    je.get(s.gruppe).push(s);
  }
  return [...je].map(([gruppe, spuren]) => ({ gruppe, tasten: spuren.map((s, i) => ({ spur_id: s.id, buchstabe: buchstabe(i), laut: !s.mute, name: s.name })) }));
}
export const wahlBefehl = (gruppe, spurId) => [{ befehl: 'variante_waehlen', gruppe, spur_id: spurId }];
export const wahlLabel = (gruppe, taste) => `Variant ${gruppe} ${taste}`;
export const tastenLabel = (gruppe, t) => `Variant ${t.buchstabe} of ${gruppe}: ${t.name}${t.laut ? ' (playing)' : ''}`;

export function bindeVarianten(behaelter, { aendere }) {
  return {
    zeige(projekt) {
      const gruppen = gruppenVon(projekt);
      behaelter.hidden = gruppen.length === 0;
      behaelter.replaceChildren();
      for (const g of gruppen) {
        const reihe = document.createElement('span');
        reihe.className = 'p-var-reihe';
        const name = document.createElement('span');
        name.className = 'p-var-name';
        name.textContent = g.gruppe;                       // Text, nie HTML: der Name kommt von Cypher
        reihe.append(name);
        for (const t of g.tasten) {
          const b = document.createElement('button');
          b.className = 'p-var';
          b.dataset.gruppe = g.gruppe;
          b.dataset.spur = t.spur_id;
          b.textContent = t.buchstabe;
          b.title = t.name;
          b.setAttribute('aria-pressed', String(t.laut));
          b.setAttribute('aria-label', tastenLabel(g.gruppe, t));
          b.classList.toggle('an', t.laut);
          b.addEventListener('click', () => aendere(wahlLabel(g.gruppe, t.buchstabe), wahlBefehl(g.gruppe, t.spur_id)));
          reihe.append(b);
        }
        behaelter.append(reihe);
      }
    },
  };
}
// Binder für produktion.js: die Tastenreihen folgen dem Projekt
export function bindeVariantenReihen(ctx) {
  const reihen = bindeVarianten(ctx.$('varianten'), { aendere: ctx.aendere });
  ctx.beimProjekt.push((p) => reihen.zeige(p));
}
