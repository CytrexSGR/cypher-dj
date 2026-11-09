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

// 1.12 S3 task 9: sent + 1 is only a guess at the moment of the event (a server take, e.g. the recorder, can take that revision while our request is in flight).
// The event counts as ours only when the RESPONSE of the request carries that revision; otherwise beiFremdeRev(slug, rev) is called and the page reloads.
export const WIEDERHOLUNGEN = 3, WIEDERHOLE_PAUSE_MS = 80;
export function neuerSchreiber({ holeJson, beiProjekt, beiFehler, beiVerworfen = () => {}, beiFremdeRev = () => {}, beiWiederhole = async () => {} }) {
  let slug = null, rev = null, unterwegs = false, gesendet = null;
  let vorlaeufig = [];       // events taken for ours while the request is in flight: [slug, rev]
  let leerWartende = [];     // resolvers of leerWarten()
  let eingereiht = 0, erledigt = 0, bisWartende = [];   // counters for bisHier(): requests queued so far / finished so far
  const schlange = [];
  function stelle(auftrag) {
    eingereiht++;
    let fertig;
    auftrag.fertig = new Promise((ok) => { fertig = ok; });
    auftrag.ende = (v) => { erledigt++; fertig(v); const w = bisWartende; bisWartende = w.filter(([n, f]) => { if (erledigt >= n) { f(); return false; } return true; }); };
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
      const offen = vorlaeufig; vorlaeufig = [];
      const bestaetigt = r.status === 200 && r.j && typeof r.j.rev === 'number' ? r.j.rev : null;
      for (const [vs, vr] of offen) if (vr !== bestaetigt) beiFremdeRev(vs, vr);
      if (r.status === 200 && r.j && typeof r.j.rev === 'number' && r.j.projekt) {
        rev = r.j.rev;
        beiProjekt(slug, r.j.projekt, rev, r.j);   // D1 V2 Nachzug (7c): die ganze Antwort (kern) für den Hinweis
        a.ende(true);
      } else {
        const veraltet = r.status === 409 && r.j?.fehler === 'rev_veraltet';
        // task 9: a hand value (absolute, idempotent) that met a revision taken by a server take a moment ago is written once more after the reload;
        // no notice for the first answer, after WIEDERHOLUNGEN repeats rev_veraltet is final (the usual path below)
        if (veraltet && a.wiederhole && (a.wiederholt ?? 0) < WIEDERHOLUNGEN) {
          a.wiederholt = (a.wiederholt ?? 0) + 1;
          if (a.wiederholt > 1) await new Promise((ok) => setTimeout(ok, WIEDERHOLE_PAUSE_MS));   // the take is still being written: the reload may not have it yet
          try { await beiWiederhole(); } catch { /* the reload failure belongs to its owner */ }
          schlange.unshift(a);
          continue;
        }
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
    const w = leerWartende; leerWartende = [];
    for (const f of w) f();
  }
  return {
    get rev() { return rev; },
    get slug() { return slug; },
    istEigeneRev: (fremdSlug, neueRev) => {
      const moeglich = gesendet !== null && fremdSlug === slug && slug !== null && neueRev === gesendet + 1;
      if (moeglich) vorlaeufig.push([fremdSlug, neueRev]);
      return moeglich;
    },
    // resolves when no request is in flight and nothing waits (a recorder end must not overtake the page's own writes)
    // resolves when every request queued SO FAR is finished (later ones do not count: a gesture end must not wait for the next gesture's writes)
    bisHier: () => { const n = eingereiht; return erledigt >= n ? Promise.resolve() : new Promise((ok) => { bisWartende.push([n, ok]); }); },
    leerWarten: () => (!unterwegs && schlange.length === 0 ? Promise.resolve() : new Promise((ok) => { leerWartende.push(ok); })),
    // Neuer Stand von außen (Öffnen, SSE, Neuladen): gilt, wenn das Projekt wechselt oder die rev nicht älter ist
    setze(neuSlug, neuRev) {
      if (neuSlug !== slug || rev === null || neuRev >= rev) { slug = neuSlug; rev = neuRev; return true; }
      return false;
    },
    // optionen.wiederhole: see pumpe (a hand value is written again once after rev_veraltet)
    aendere(label, befehle, schluessel = null, optionen = {}) {
      const letzte = schlange.at(-1);
      if (schluessel !== null && letzte && letzte.schluessel === schluessel) { letzte.befehle = befehle; letzte.label = label; return letzte.fertig; }
      return stelle({ weg: '/proj/aendern', label, befehle, schluessel, wiederhole: optionen.wiederhole === true });
    },
    aendereMit: (rechne) => stelle({ weg: '/proj/aendern', rechne, schluessel: null }),
    undo: () => stelle({ weg: '/proj/undo', schluessel: null }),
    redo: () => stelle({ weg: '/proj/redo', schluessel: null }),
    leer: () => !unterwegs && schlange.length === 0,
  };
}
