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
