// PRODUCTION (D1 V1): Laden des Projektstands vom Server, rein und in node getestet.
// Zwei Regeln: (1) Ist der Server weg (Status 0, der Abruf selbst scheiterte, oder 5xx), bleibt der gezeigte Stand stehen;
// nur eine Antwort des Servers („kein Projekt“, 4xx) leert die Ansicht. (2) Überlappen sich Ladungen, gilt nur die Antwort
// der jüngsten, auch wenn eine ältere später ankommt (Zähler).

export function ladeErgebnis(r) {
  if (r.status === 0 || r.status >= 500) return 'behalten';
  if (r.status === 200 && r.j?.projekt) return 'uebernehmen';
  return 'leeren';
}

// D1 V2 Nachzug (7b): OFFLINE heißt „der Server antwortet nicht“. Status 0 (der Abruf scheiterte) oder 5xx OHNE Grundfeld; ein 5xx
// mit Grund (503 katalog_fehlt, 503 kein_kern, 500 intern) ist eine Antwort des Servers und zeigt ihren Text, kein OFFLINE.
const grundVon = (r) => r?.j?.fehler ?? r?.j?.grund;
export const serverWeg = (r) => r?.status === 0 || (r?.status >= 500 && !grundVon(r));
// Anzeige OFFLINE nach einer Antwort: true setzen, false zurücknehmen (jede erfolgreiche Antwort, auch eine Schreibantwort), null lassen
export const offlineNach = (r) => (serverWeg(r) ? true : r?.status >= 200 && r?.status < 300 ? false : null);

// hole() → Promise<{ status, j }>; uebernimm(slug, projekt, j); leere(j); beiWeg(antwort) bei Ausfall; beiDa() bei jeder Antwort des Servers.
// j ist die ganze Antwort (V2 Fix F14: ausgabe_lauf aus GET /proj/aktuell).
export function neuerLader({ hole, uebernimm, leere, beiWeg, beiDa }) {
  let zaehler = 0;
  return async function lade() {
    const mein = ++zaehler;
    const r = await hole();
    if (mein !== zaehler) return 'ueberholt';
    const e = ladeErgebnis(r);
    if (e === 'behalten') { beiWeg(r); return e; }
    beiDa();
    if (e === 'uebernehmen') uebernimm(r.j.slug, r.j.projekt, r.j); else leere(r.j);
    return e;
  };
}

// Umhüllt einen Abruf so, dass die Antwort einer überholten Anfrage als { gilt: false } zurückkommt
export function nurJuengste(hole) {
  let zaehler = 0;
  return async (...args) => {
    const mein = ++zaehler;
    const r = await hole(...args);
    return mein === zaehler ? { gilt: true, r } : { gilt: false };
  };
}
