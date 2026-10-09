// Englische Meldungen der Seite, die auch der Seiten-Server und die Tests brauchen (kein DOM, reines Modul).

// Antwort des Seiten-Servers auf POST /laden, wenn nichts an den Kern ging
export const KOPIE_TEXT = {
  pruefung: 'failed the check against its fassung.json (size or checksum), nothing was loaded',
  nicht_im_index: 'is not in the library index (index.sqlite), nothing was loaded',
  material_fehlt: 'is missing its audio file (or fassung.json) in the library folder, nothing was loaded',
  unbekanntes_deck: 'unknown deck',
};

// Der Kern nimmt /test/hand nur im Prüfmodus an (§19.0), bis Scheibe 35 hand_osc bringt
export const HAND_PRUEFMODUS_TEXT = 'hand input needs test mode until slice 35';

// Cyphers Vorschlag und Stopp aus den Leitstand-Ereignissen (Plan M-1 Annahme-Weg). Rein, damit ohne Browser prüfbar.
// stand = { vorschlag: {id, text, start_beat} | null, gestoppt: bool }; Rückgabe: neuer Stand, oder null wenn das Ereignis nichts ändert.
export function cypherStand(stand, e) {
  switch (e.art) {
    case 'plan_vorgeschlagen':
      return { ...stand, vorschlag: { id: e.vorschlag.id, text: e.vorschlag.text, start_beat: e.vorschlag.start_beat } };
    case 'vorschlag_angenommen': case 'vorschlag_verworfen': case 'vorschlag_verfallen': case 'plan_verriegelt':
      return stand.vorschlag && stand.vorschlag.id === e.vorschlag_id ? { ...stand, vorschlag: null } : null;
    case 'ki_stopp':
      return { ...stand, gestoppt: e.gestoppt === 1 };
    default:
      return null;
  }
}

// Glanz 2.1 (F22): Punkt OUT und Meldung aus GET /ausgang. vorher = zuletzt gesehene Fallzahl (null beim ersten Abruf).
// Rückgabe { klasse: 'an' | 'alarm' | 'leer', titel, meldung: null | { text, dauerhaft } }.
export function ausgangAnzeige(a, vorher) {
  const karte = a.karte === null ? '' : ` (card ${a.karte})`;
  const ms = a.letzter?.erkannt_bis_an_ms;
  switch (a.zustand) {
    case 'gut': {
      const neu = vorher !== null && a.faelle > vorher;
      return { klasse: 'an', titel: `Digital output on${karte}, ${a.faelle} dropouts this session`,
        meldung: neu ? { text: `Digital output switched itself off and was turned back on after ${ms} ms (${a.faelle}× this session)`, dauerhaft: false } : null };
    }
    case 'aus': return { klasse: 'alarm', titel: `Digital output OFF${karte}`, meldung: { text: 'DIGITAL OUTPUT OFF: the IEC958 switch stays off, nothing reaches the speakers', dauerhaft: true } };
    case 'kampf': return { klasse: 'alarm', titel: `Digital output keeps dropping${karte}`, meldung: { text: 'Digital output keeps switching itself off (more than 3 times in 10 s); the watch turns it back on each time', dauerhaft: true } };
    case 'karte_fehlt': return { klasse: 'alarm', titel: 'Digital output card not found', meldung: { text: 'Digital output card not found (sound card gone?)', dauerhaft: true } };
    case 'unlesbar': return { klasse: 'alarm', titel: 'Digital output switch unreadable', meldung: { text: 'Digital output switch cannot be read', dauerhaft: true } };
    case 'wache_stumm': return { klasse: 'alarm', titel: `Digital output watch silent for ${a.alter_s ?? '?'} s`, meldung: { text: 'Digital output watch is silent: the output is no longer checked', dauerhaft: true } };
    default: return { klasse: 'leer', titel: 'Digital output not watched (silent sink, or started without --ton-frei)', meldung: null };
  }
}

// Keylock 3b (Plan 2026-10-06-keylock-echtzeit.md, Fassung 4; Prüfung MINOR 4 bis 6): EIN Knopf `keylock` für alle Quellen.
// Stand aus /e/regler (der Kern schickt ihn auch jedem neuen Abonnenten, also der Seite nach ihrem Neustart); ohne Meldung
// unbekannt (null), nicht stillschweigend an.
export function keylockStand(regler) {
  const w = regler?.keylock;
  return typeof w === 'number' ? w >= 0.5 : null;
}
// Klick: das Gegenteil, sofort; unbekannt -> an (Vorgabe)
export function keylockAnfrage(knopf) {
  return { pfad: 'keylock', nach: knopf === true ? 0 : 1, ab: 'jetzt' };
}
// Antwort von POST /regler: null = nichts zu melden
export function keylockMeldung(code, j) {
  if (code !== 200) return `Keylock refused: ${j?.fehler ?? code}`;
  const q = j?.quittung;
  if (!q) return 'Keylock: no answer from the core';
  if (q.status === 6) return `Keylock refused: ${q.grund}`;
  if (q.status === 4) return 'Keylock: too late, not switched (try again)';
  return null;
}
// VARI nur, wenn das Deck wirklich im Varispeed klingt: Master ≠ Basis und nicht (Knopf an UND Hörweg 1 = Ring aus dem Dehner,
// /zustand/deck hoerweg). Knopf an ohne Ring (kern.toml keylock = false, Loop auf dem Deck bis Task 5, Brücke nach einem
// Ereignis) zeigt VARI. Rückgabe Text oder null.
export function variText({ bpm, basis, knopf, hoerweg }) {
  if (!basis || bpm == null || Math.abs(bpm / basis - 1) < 1e-6) return null;
  if (knopf === true && hoerweg === 1) return null;
  const st = 12 * Math.log2(bpm / basis);
  return `VARI ${st >= 0 ? '+' : '−'}${Math.abs(st).toFixed(1)} st (master ${bpm.toFixed(2)})`;
}
