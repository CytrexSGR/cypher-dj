// Scheibe 31: OSC der Decks im Netz-Faden (SCHNITTSTELLEN.md §4.4, §5.5, §5.9). Nimmt /k/deck/laden, entladen, start
// und stopp an (Form und Bereiche; die Zustandsprüfungen macht der Callback), reicht sie über den Befehlsring weiter und
// schickt /zustand/deck, /e/geladen und /e/frist an alle Abonnenten. Plan E9 (Deck-Bedienung): loop, sprung, hotcue,
// hotcue_setzen und /e/hotcue. Roll, slip, basis_tausch bleiben bis zu ihren Scheiben (38, 52) wie unbekannt.
#include <cmath>
#include <cstring>

#include "cypherdj/fassung.h"
#include "cypherdj/netz.h"

namespace cdj {

namespace v = cypherdj::osc;

namespace {

void kopiere(char* ziel, const char* quelle, size_t n) {
  std::strncpy(ziel, quelle, n - 1);
  ziel[n - 1] = '\0';
}

bool quelle_ok(const char* q) {  // §1.4: die sechs Quellen
  for (const auto& n : v::werte::quelle)
    if (n == q) return true;
  return false;
}

}  // namespace

bool Netz::deck_paket(const v::Adresse* a, const osc::Nachricht& m) {
  // Audit 2026-10-01 F02: alle Deck-Adressen beginnen mit ,hs. Eine andere Vertragsadresse ohne eigenen Zweig (/erz/cc
  // ,iiidf) las hier werte[1].s als nullptr und stürzte den Kern ab; sie gehört nicht hierher.
  if (m.anzahl < 2 || m.typen[0] != 'h' || m.typen[1] != 's') return false;
  Befehl b{};
  b.id = m.werte[0].h;
  kopiere(b.quelle, m.werte[1].s, sizeof b.quelle);
  auto ab = [&](const char* grund) {  // abgelehnt, nicht eingereiht; true: die Adresse gehört hierher
    quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, grund);
    return true;
  };
  if (a->pfad == v::k_deck_laden.pfad) {
    namespace f = v::feld::k_deck_laden;
    b.art = Befehl::DECK_LADEN;
    b.deck = m.werte[f::deck].i;
    kopiere(b.material_id, m.werte[f::material_id].s, sizeof b.material_id);
    b.bpm = m.werte[f::basis_bpm].d;
    b.fassung = m.werte[f::fassung].i;
    b.mit_stems = m.werte[f::mit_stems].i;
    if (!quelle_ok(b.quelle)) return ab("ausserhalb_bereich");
    if (b.deck < 1 || b.deck > 4) return ab("unbekanntes_deck");
    if (!material_id_gueltig(m.werte[f::material_id].s) || !(b.bpm > 0.0 && b.bpm < 1000.0) || b.fassung < 1 ||
        (b.mit_stems != 0 && b.mit_stems != 1))
      return ab("ausserhalb_bereich");
  } else if (a->pfad == v::k_deck_entladen.pfad) {
    b.art = Befehl::DECK_ENTLADEN;
    b.deck = m.werte[v::feld::k_deck_entladen::deck].i;
    if (!quelle_ok(b.quelle)) return ab("ausserhalb_bereich");
    if (b.deck < 1 || b.deck > 4) return ab("unbekanntes_deck");
  } else if (a->pfad == v::k_deck_start.pfad || a->pfad == v::k_deck_stopp.pfad) {
    const bool start = a->pfad == v::k_deck_start.pfad;
    namespace f = v::feld::k_deck_start;  // plan, gruppe, hoerschein, deck, ab_beat an denselben Stellen wie stopp
    namespace g = v::feld::k_deck_stopp;
    static_assert(std::size_t(f::deck) == std::size_t(g::deck) && std::size_t(f::ab_beat) == std::size_t(g::ab_beat));
    b.art = start ? Befehl::DECK_START : Befehl::DECK_STOPP;
    kopiere(b.plan, m.werte[f::plan].s, sizeof b.plan);
    kopiere(b.gruppe, m.werte[f::gruppe].s, sizeof b.gruppe);
    kopiere(b.hoerschein, m.werte[f::hoerschein].s, sizeof b.hoerschein);
    b.deck = m.werte[f::deck].i;
    b.ab_beat = m.werte[f::ab_beat].d;
    b.quell_beat = start ? m.werte[f::quell_beat].d : 0.0;
    b.politik = m.werte[start ? std::size_t(f::politik) : std::size_t(g::politik)].i;
    if (!quelle_ok(b.quelle)) return ab("ausserhalb_bereich");
    if (b.deck < 1 || b.deck > 4) return ab("unbekanntes_deck");
    // §16.1: start und stopp kennen Politik 0 und 1 (2 braucht raster_beats, das diese Adressen nicht tragen)
    if (!std::isfinite(b.ab_beat) || !std::isfinite(b.quell_beat) || (b.politik != 0 && b.politik != 1))
      return ab("ausserhalb_bereich");
  } else if (a->pfad == v::k_deck_loop.pfad || a->pfad == v::k_deck_sprung.pfad || a->pfad == v::k_deck_hotcue.pfad) {
    namespace f = v::feld::k_deck_sprung;  // Plan E9: plan … ab_beat, politik, raster_beats bei allen dreien an denselben Stellen
    namespace fl = v::feld::k_deck_loop;
    namespace fh = v::feld::k_deck_hotcue;
    static_assert(std::size_t(f::ab_beat) == std::size_t(fl::ab_beat) && std::size_t(f::ab_beat) == std::size_t(fh::ab_beat) &&
                  std::size_t(f::politik) == std::size_t(fl::politik) && std::size_t(f::politik) == std::size_t(fh::politik) &&
                  std::size_t(f::raster_beats) == std::size_t(fl::raster_beats) &&
                  std::size_t(f::raster_beats) == std::size_t(fh::raster_beats) &&
                  std::size_t(f::delta_beats) == std::size_t(fl::laenge_beats));
    const bool loop = a->pfad == v::k_deck_loop.pfad, hot = a->pfad == v::k_deck_hotcue.pfad;
    b.art = loop ? Befehl::DECK_LOOP : hot ? Befehl::DECK_HOTCUE : Befehl::DECK_SPRUNG;
    kopiere(b.plan, m.werte[f::plan].s, sizeof b.plan);
    kopiere(b.gruppe, m.werte[f::gruppe].s, sizeof b.gruppe);
    kopiere(b.hoerschein, m.werte[f::hoerschein].s, sizeof b.hoerschein);
    b.deck = m.werte[f::deck].i;
    b.ab_beat = m.werte[f::ab_beat].d;
    if (hot) b.nr = m.werte[fh::nr].i;
    else b.wert_beats = m.werte[f::delta_beats].d;  // loop: laenge_beats an derselben Stelle
    b.politik = m.werte[f::politik].i;
    b.raster_beats = m.werte[f::raster_beats].d;
    if (!quelle_ok(b.quelle)) return ab("ausserhalb_bereich");
    if (b.deck < 1 || b.deck > 4) return ab("unbekanntes_deck");
    bool raster_ok = false;  // §4.4: raster_beats aus der Wertliste des Vertrags (seit Plan E9 mit 16)
    for (double r : v::werte::raster_beats) raster_ok = raster_ok || b.raster_beats == r;
    if (!std::isfinite(b.ab_beat) || b.politik < 0 || b.politik > 2 || (b.politik == 2 && !raster_ok) ||
        (!hot && !(std::fabs(b.wert_beats) <= 100000.0)) || (hot && (b.nr < 1 || b.nr > 8)) ||  // Review F5: 1e300
        (loop && !(b.wert_beats == 0.0 || (b.wert_beats >= 1.0 / 32 && b.wert_beats <= 128.0))))
      return ab("ausserhalb_bereich");
  } else if (a->pfad == v::k_deck_hotcue_setzen.pfad) {
    namespace f = v::feld::k_deck_hotcue_setzen;
    b.art = Befehl::DECK_HOTCUE_SETZEN;
    b.deck = m.werte[f::deck].i;
    b.nr = m.werte[f::nr].i;
    b.quell_beat = m.werte[f::quell_beat].d;  // NaN löscht
    if (!quelle_ok(b.quelle)) return ab("ausserhalb_bereich");
    if (b.deck < 1 || b.deck > 4) return ab("unbekanntes_deck");
    if (b.nr < 1 || b.nr > 8 || std::isinf(b.quell_beat)) return ab("ausserhalb_bereich");
  } else if (a->pfad == v::k_deck_raster.pfad) {  // Plan Grid (§4.4)
    namespace f = v::feld::k_deck_raster;
    b.art = Befehl::DECK_RASTER;
    b.deck = m.werte[f::deck].i;
    kopiere(b.material_id, m.werte[f::material_id].s, sizeof b.material_id);
    b.bpm = m.werte[f::basis_bpm].d;
    b.fassung = m.werte[f::fassung].i;
    b.versatz_f = m.werte[f::versatz_frames].i;
    if (!quelle_ok(b.quelle)) return ab("ausserhalb_bereich");
    if (b.deck < 1 || b.deck > 4) return ab("unbekanntes_deck");
    if (!material_id_gueltig(m.werte[f::material_id].s) || !(b.bpm > 0.0 && b.bpm < 1000.0) || b.fassung < 1 ||
        b.versatz_f < -192000 || b.versatz_f > 192000)
      return ab("ausserhalb_bereich");
  } else {
    return false;
  }
  einreihen(b);
  return true;
}

bool Netz::deck_ereignis(const Ereignis& e) {
  if (e.art == Ereignis::DECK) {  // §5.5 /zustand/deck ,iisdidddfiif
    osc::Schreiber s(v::zustand_deck);
    s.i(e.deck).i(e.status).s(e.material_id).d(e.basis_bpm).i(e.fassung).d(e.quell_beat).d(e.beats_bis_ende)
        .d(e.faktor).f(e.vorlauf_ms).i(0).i(-1).f(0.0f);  // hoerweg 0 direkt, stretcher_fuell −1, versatz 0
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::GELADEN) {  // §5.9 /e/geladen ,isdiih
    osc::Schreiber s(v::e_geladen);
    s.i(e.deck).s(e.material_id).d(e.basis_bpm).i(e.fassung).i(e.mit_stems).h(e.sample);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::HOTCUE) {  // §5.9 /e/hotcue ,isidh (Plan E9)
    osc::Schreiber s(v::e_hotcue);
    s.i(e.deck).s(e.material_id).i(e.status).d(e.quell_beat).h(e.sample);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::RASTER) {  // §5.9 /e/raster ,isdfh (Plan Grid): versatz_ms = Änderung
    osc::Schreiber s(v::e_raster);
    s.i(e.deck).s(e.material_id).d(e.quell_beat).f(e.wert).h(e.sample);
    an_alle(s);
    return true;
  }
  if (e.art == Ereignis::FRIST) {  // §5.9 /e/frist ,iddh
    osc::Schreiber s(v::e_frist);
    s.i(e.deck).d(e.beats_bis_ende).d(e.beat).h(e.sample);
    an_alle(s);
    return true;
  }
  return false;
}

}  // namespace cdj
