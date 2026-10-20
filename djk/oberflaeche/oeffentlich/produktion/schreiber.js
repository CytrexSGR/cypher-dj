// PRODUCTION (D1 V1): Schreibweg zur Projekt-API (Spec 3.4). Alles nacheinander, jede Anfrage mit der zuletzt bekannten
// rev; eine wartende Änderung mit demselben Schlüssel (Fader derselben Spur) wird durch die neueste ersetzt, statt sich
// anzustauen (Muster sende/pumpe in app.js). Die Seite zeigt erst die Antwort des Servers, nie optimistisch.
// holeJson(weg, koerper) → Promise<{ status, j }>; beiProjekt(slug, projekt, rev, antwort); beiFehler(auftrag, antwort).
// 409 rev_veraltet (der Stand wurde anderswo geändert): die Schlange hält an, beiFehler darf ein Promise liefern (neu laden und
// den Stand setzen); erst danach werden die Wartenden verworfen (ihre rev wäre ebenfalls veraltet) und mit beiVerworfen(anzahl)
// gemeldet. Der Auftrag, der selbst scheiterte, wird nicht wiederholt: die Person sieht den neuen Stand und entscheidet.
// istEigeneRev(slug, rev): die rev, die die gerade unterwegs befindliche Anfrage erzeugen wird (gesendete rev + 1). Das SSE-Ereignis
// dazu kommt vor der HTTP-Antwort; die Seite lädt dafür nicht nach.
// aendereMit(rechne) (V2 Fix F2, Spec 6.34): die Änderung wird erst gerechnet, wenn sie an der Reihe ist; rechne() → {label, befehle, rev} aus
// genau dem Stand, dessen rev mitgeht. Leere befehle: nichts senden (false).

export function neuerSchreiber({ holeJson, beiProjekt, beiFehler, beiVerworfen = () => {} }) {
  let slug = null, rev = null, unterwegs = false, gesendet = null;
  const schlange = [];
  function stelle(auftrag) {
    let fertig;
    auftrag.fertig = new Promise((ok) => { fertig = ok; });
    auftrag.ende = fertig;
    schlange.push(auftrag);
    pumpe();
    return auftrag.fertig;
  }
  async function pumpe() {
    if (unterwegs) return;
    unterwegs = true;
    while (schlange.length) {
      const a = schlange.shift();
      let sendeRev = rev;
      if (a.rechne) {
        let x = null;
        try { x = a.rechne(); } catch { x = null; }
        if (!x || !Array.isArray(x.befehle) || x.befehle.length === 0) { a.ende(false); continue; }
        a.label = x.label; a.befehle = x.befehle;
        if (typeof x.rev === 'number') sendeRev = x.rev;
      }
      const koerper = a.weg === '/proj/aendern' ? { rev: sendeRev, label: a.label, befehle: a.befehle } : { rev };
      let r;
      gesendet = koerper.rev;
      try { r = await holeJson(a.weg, koerper); } catch (e) { r = { status: 0, j: { fehler: 'netz', text: e.message } }; }
      gesendet = null;
      if (r.status === 200 && r.j && typeof r.j.rev === 'number' && r.j.projekt) {
        rev = r.j.rev;
        beiProjekt(slug, r.j.projekt, rev, r.j);   // D1 V2 Nachzug (7c): die ganze Antwort (kern) für den Hinweis
        a.ende(true);
      } else {
        const veraltet = r.status === 409 && r.j?.fehler === 'rev_veraltet';
        const neu = beiFehler(a, r);
        if (veraltet) {
          try { await neu; } catch { /* der Neuladen-Fehler gehört dem Aufrufer; die Wartenden sind trotzdem veraltet */ }
          const wartende = schlange.splice(0);
          for (const w of wartende) w.ende(false);
          if (wartende.length) beiVerworfen(wartende.length);
        }
        a.ende(false);
      }
    }
    unterwegs = false;
  }
  return {
    get rev() { return rev; },
    get slug() { return slug; },
    istEigeneRev: (fremdSlug, neueRev) => gesendet !== null && fremdSlug === slug && slug !== null && neueRev === gesendet + 1,
    // Neuer Stand von außen (Öffnen, SSE, Neuladen): gilt, wenn das Projekt wechselt oder die rev nicht älter ist
    setze(neuSlug, neuRev) {
      if (neuSlug !== slug || rev === null || neuRev >= rev) { slug = neuSlug; rev = neuRev; return true; }
      return false;
    },
    aendere(label, befehle, schluessel = null) {
      const letzte = schlange.at(-1);
      if (schluessel !== null && letzte && letzte.schluessel === schluessel) { letzte.befehle = befehle; letzte.label = label; return letzte.fertig; }
      return stelle({ weg: '/proj/aendern', label, befehle, schluessel });
    },
    aendereMit: (rechne) => stelle({ weg: '/proj/aendern', rechne, schluessel: null }),
    undo: () => stelle({ weg: '/proj/undo', schluessel: null }),
    redo: () => stelle({ weg: '/proj/redo', schluessel: null }),
    leer: () => !unterwegs && schlange.length === 0,
  };
}
