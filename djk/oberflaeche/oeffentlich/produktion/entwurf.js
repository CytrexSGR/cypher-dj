// PRODUCTION (D1 V2): Entwurf eines Projektstands während eines Zugs (Spec A2/A3). Reine Funktion, Browser und node.
// Die Seite zeigt nie optimistisch, was der Server noch nicht bestätigt hat (V1 schreiber.js); ein Zug mit der Maus braucht
// aber Rückmeldung, bevor er losgelassen wird. Der Entwurf wendet dieselben Befehle, die beim Loslassen an POST /proj/aendern
// gehen, auf eine flache Kopie an: was man sieht, ist genau das, was geschickt wird. Nur die Befehle, die ein Zug erzeugt
// (clip_aendern, noten_neu, noten_aendern, noten_loeschen); alles andere bleibt unverändert. Prüfungen macht der Server.

export function entwurf(projekt, befehle) {
  if (!projekt || !Array.isArray(befehle) || befehle.length === 0) return projekt;
  const p = { ...projekt, spuren: projekt.spuren.map((s) => ({ ...s, clips: [...s.clips] })) };
  const finde = (id) => {
    for (const s of p.spuren) { const i = s.clips.findIndex((c) => c.id === id); if (i >= 0) return { s, i }; }
    return null;
  };
  for (const b of befehle) {
    const f = finde(b?.clip_id);
    if (!f) continue;
    const c = { ...f.s.clips[f.i] };
    if (b.befehl === 'clip_aendern') {
      const { befehl, clip_id, spur_id, ...felder } = b;   // eslint-disable-line no-unused-vars
      Object.assign(c, felder);
      const ziel = spur_id && spur_id !== f.s.id ? p.spuren.find((x) => x.id === spur_id) : null;
      if (ziel) { f.s.clips.splice(f.i, 1); ziel.clips.push(c); continue; }
    } else if (b.befehl === 'noten_aendern') {
      const m = new Map(b.noten.map((n) => [n.id, n]));
      c.noten = c.noten.map((n) => (m.has(n.id) ? { ...n, ...m.get(n.id) } : n));
    } else if (b.befehl === 'noten_loeschen') {
      const weg = new Set(b.ids);
      c.noten = c.noten.filter((n) => !weg.has(n.id));
    } else if (b.befehl === 'noten_neu') {
      c.noten = [...c.noten, ...b.noten];
    } else continue;
    f.s.clips[f.i] = c;
  }
  return p;
}

// Clip nach ID im (Entwurfs-)Projekt: { spur, spurIndex, clip } oder null
export function findeClip(projekt, id) {
  if (!projekt) return null;
  for (let i = 0; i < projekt.spuren.length; i++) {
    const clip = projekt.spuren[i].clips.find((c) => c.id === id);
    if (clip) return { spur: projekt.spuren[i], spurIndex: i, clip };
  }
  return null;
}

// IDs der Clips, die in neu stehen und in alt nicht (nach Duplizieren, Teilen, Anlegen: die Auswahl wandert dorthin)
export function neueClipIds(alt, neu) {
  const vorher = new Set((alt?.spuren ?? []).flatMap((s) => s.clips.map((c) => c.id)));
  return (neu?.spuren ?? []).flatMap((s) => s.clips.map((c) => c.id)).filter((id) => !vorher.has(id));
}

// Lauf eines Zugs (V2 Fix-Runde, Spec 6.34): der Entwurf ist nur Anzeige. Er wird verworfen bei jedem neuen Zug (beginne), bei einem Klick
// ohne Ziehen, bei pointercancel und Esc (verwirf, ohne zu senden) und wenn ein neuer Serverstand eintrifft, während kein Zug läuft
// (neuerStand). Nach dem Loslassen bleibt er stehen, bis die Antwort da ist (deren Stand verwirft ihn) oder die Änderung scheitert.
// stand() → bestätigter Projektstand; zeige(projekt | null) setzt die Anzeige; sende(rechne) → Promise<boolean>, rechne() → {label, befehle, rev}.
// Ein Zug liefert rechne(projekt) → {label, befehle}: beim Bewegen für die Anzeige, beim Senden für die Anfrage.
export function neuerZugLauf({ stand, zeige, sende }) {
  let nr = 0, aktiv = null;
  const anzeige = (z) => {
    const p = stand(), b = z?.rechne ? z.rechne(p).befehle : [];
    zeige(b.length ? entwurf(p, b) : null);
  };
  return {
    beginne() {
      const z = { nr: ++nr, rechne: null };
      aktiv = z;
      zeige(null);
      return {
        bewege(rechne) { if (aktiv !== z) return; z.rechne = rechne; anzeige(z); },
        verwirf() { if (aktiv !== z) return; aktiv = null; zeige(null); },
        async lass() {
          if (aktiv !== z) return false;
          aktiv = null;
          if (!z.rechne) { zeige(null); return false; }
          const ok = await sende(() => { const p = stand(); return { ...z.rechne(p), rev: p?.rev }; });
          if (z.nr === nr && aktiv === null) zeige(null);
          return ok;
        },
        get laeuft() { return aktiv === z; },
      };
    },
    neuerStand() { if (aktiv) anzeige(aktiv); else zeige(null); },
    get laeuft() { return aktiv !== null; },
  };
}
