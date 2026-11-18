// MIDI learn for the device panel of a project track (device window, #geraet=<track id>): the learn state of the page server (GET /lernen) and the
// three things a hand does with it: switch the learn mode of the panel, arm a knob (the next CC of a controller is assigned to its core row
// spur/<slot>/bk/<k>), remove an assignment. The same routes as LEARN in INSTRUMENTS (learn_view.js); nothing is stored here.
// A following controller place (FOLLOW) rewrites its knob entries when the focus changes: an assignment learned here lasts until then, unless the place
// is saved as the preset of this synth (POST /controller/presets/speichern, the SAVE button of the controller strip).

const MELDUNG = {
  fertig: (f, name) => [`Learned: CC${f.nr} ch${f.kanal}${name ? ` of ${name}` : ''} drives ${f.pfad}`, false],
  geloescht: (f) => [`MIDI assignment of ${f.pfad} removed`, false],
  belegt: (f) => [`CC${f.nr} ch${f.kanal} already drives a knob of the base mapping; nothing changed`, true],
  hand_in: (f) => [String(f.text ?? ''), true],
  abgelaufen: (f) => [`Learn timed out for ${f.pfad}`, true],
  abgelehnt: (f) => [`The core refused the learn table (${f.grund}); the previous table is kept`, true],
  ohne_antwort: () => ['Learn table saved; the core did not answer yet, it loads it at its next start', true],
};

/** o: { holeJson(weg, koerper) -> {status, j}, holeGet(weg) -> {status, j}, melde(text, fehler), beiStand() }. */
export function neuesGeraetLernen(o) {
  let lernen = { zuordnungen: [], wartet: null, controller: [] }, an = false;
  const setze = (neu) => { if (neu && Array.isArray(neu.zuordnungen)) { lernen = neu; o.beiStand?.(); } };
  const lade = async () => { try { const r = await o.holeGet('/lernen'); if (r?.status === 200) setze(r.j); } catch { /* the marks keep what they had */ } };
  const schicke = async (weg, daten) => {
    const r = await o.holeJson(weg, daten);
    if (r.status === 200) { setze(r.j); return; }
    if (r.status === 409 && r.j?.fehler === 'kein_midi_eingang') { an = false; o.beiStand?.(); o.melde('No MIDI input is connected: plug in your controller, then try LEARN again', true); return; }
    o.melde(`Learn refused: ${r.j?.text ?? r.j?.fehler ?? `HTTP ${r.status}`}`, true);
    await lade();
  };
  return {
    /** What a panel needs to mark its controls. */
    stand: () => ({ an, wartet: lernen.wartet?.pfad ?? null, gelernt: new Set(lernen.zuordnungen.map((z) => z.pfad)) }),
    /** GET /lernen as last read: zuordnungen, controller. */
    daten: () => lernen,
    an: () => an,
    umschalten() { an = !an; if (!an && lernen.wartet) void schicke('/lernen', { pfad: null }); o.beiStand?.(); },
    lerne(pfad) { if (pfad) void schicke('/lernen', { pfad: lernen.wartet?.pfad === pfad ? null : pfad }); },   // a second click on the armed control cancels
    vergiss(pfad) { if (pfad) void schicke('/lernen/loeschen', { pfad }); },
    lade,
    /** An event `lernen` of the stream: say what happened, read the table again. */
    ereignis(f) {
      const m = MELDUNG[f?.stand];
      if (m) { const [text, fehler] = m(f, lernen.controller?.find((c) => c.platz === f.platz)?.name ?? ''); if (text) o.melde(text, fehler); }
      void lade();
    },
  };
}
