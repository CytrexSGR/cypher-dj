// Scheibe 25: der Kern und die zwei Bibliotheken im Callback. Befehle aus §4.3, §4.7 und §19.0 gehen ans Stellwerk
// (djk/core/signalbox, Scheibe 11), seine Verläufe je Sample in den Mixer (mixer.h, Kanalzüge aus djk/core/dsp,
// Scheibe 04), seine Ausgaben als /q, /e/regler, /e/hand, /e/halter, /e/ki, /e/invariante hinaus (§5.1, §5.7 bis §5.9).
// Reihenfolge je Teilblock: Griffe der Hand mit ihrem Sample ins Stellwerk, Stellwerk-Zyklus, Verläufe in den Mixer,
// Prüfklicks in die Eingänge, Mixer, Ausgaben. Innerhalb eines Samples ordnet das Stellwerk: Hand zuerst, dann Starts
// in Startfolge (Sample, Plan, Nummer), dann Rückgabe an frei (signalbox.h). Keine Allokation, keine Sperre, kein I/O.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>

#include "cypherdj/core.h"
#include "osc_addresses.h"  // Plan 3: Kanalliste der Beat-FX (fx_kanal) aus dem Vertrag

namespace cdj {

namespace sw = cypherdj::stellwerk;

namespace {

// Kopiert höchstens n − 1 Zeichen und schließt immer ab (gekürzt, wenn die Quelle länger ist).
void kopiere(char* ziel, const char* quelle, size_t n) {
  size_t i = 0;
  if (quelle)
    for (; i + 1 < n && quelle[i]; ++i) ziel[i] = quelle[i];
  ziel[i] = '\0';
}

sw::Quelle quelle_von(const char* text) {
  sw::Quelle q = sw::Quelle::leitstand;
  sw::quelle_aus_text(text, &q);  // das Netz lässt nur die sechs Namen aus §1.4 durch
  return q;
}

// "*" -> -1 (alle); "0,2,5" -> Anzahl; Formfehler -> -2. Ohne Allokation.
int teile_lesen(const char* liste, int32_t* nrs, int max) {
  if (!std::strcmp(liste, "*")) return -1;
  int n = 0;
  const char* p = liste;
  while (*p) {
    if (*p < '0' || *p > '9' || n >= max) return -2;
    int32_t v = 0;
    while (*p >= '0' && *p <= '9') {
      v = v * 10 + (*p - '0');
      if (v > 1000000) return -2;
      ++p;
    }
    nrs[n++] = v;
    if (*p == ',') {
      ++p;
      if (!*p) return -2;
    } else if (*p) {
      return -2;
    }
  }
  return n > 0 ? n : -2;
}

}  // namespace

void Kern::klick_befehl(const Befehl& c, double beat0) {
  const int k = Mixer::kanal_index(c.pfad);
  if (k < 0) {  // das Netz prüft den Kanal schon; hier nur, falls ein Test den Ring direkt füllt
    quittung(c.id, c.quelle, 6, sample_, beat0, "unbekannter_regler");
    return;
  }
  KlickZiel& q = kanal_klick_q_[k];
  quittung(c.id, c.quelle, 1, sample_, beat0);
  if (c.an) {
    kanal_klick_[k].an();
    q.quittung_offen = true;  // Z1: Status 2 beim ersten Klick
    q.id = c.id;
    std::memcpy(q.quelle, c.quelle, sizeof q.quelle);
    q.seit_sample = sample_;
    q.seit_beat = beat0;
  } else {
    kanal_klick_[k].aus();
    q.quittung_offen = false;
    q.id = 0;
    quittung(c.id, c.quelle, 2, sample_, beat0);
  }
}

void Kern::bk_zurueck(CypherBk* g, int64_t s) {
  if (!g) return;
  Ereignis x{};
  x.art = Ereignis::ERZ_BK_ALT;
  x.sample = s;
  x.zeiger = g;
  melde(x);
}

void Kern::einsortieren25(const Befehl& c) {
  const double beat0 = plan_.karte().beat_at((double)sample_);
  const sw::Quelle q = quelle_von(c.quelle);
  switch (c.art) {
    case Befehl::FX: {  // AUFTRAG 2026-09-28 (§4.10): Einheits-Parameter, am Blockanfang
      const int einheit = c.deck;
      namespace fxb = cypherdj::osc::bereich::k_fx;   // Arten aus dem Vertrag (seit 2026-10-11 bis 5 REVERB)
      if (einheit < 1 || einheit > Mixer::FX_EINHEITEN || c.nr < fxb::art_min || c.nr > fxb::art_max) {
        quittung(c.id, c.quelle, 6, sample_, beat0, "ausserhalb_bereich");
        break;
      }
      mixer_->fx_einheit_setze(einheit - 1, c.nr, c.dauer_beats, c.wert, static_cast<float>(c.wert_beats),
                               c.raster_beats, c.quell_beat, c.an != 0);
      quittung(c.id, c.quelle, 1, sample_, beat0);
      Ereignis x{};
      x.art = Ereignis::FX;
      x.sample = sample_;
      x.beat = beat0;
      x.deck = einheit;
      x.fx_art = c.nr;
      x.fx_beats = c.dauer_beats;
      x.fx_wet = c.wert;
      x.fx_param = static_cast<float>(c.wert_beats);
      x.beats_bis_ende = c.raster_beats;
      x.faktor = c.quell_beat;
      x.status = c.an != 0 ? 1 : 0;
      melde(x);
      quittung(c.id, c.quelle, 2, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    }
    case Befehl::FX_ZUWEISUNG: {  // §4.10: Kanal an/ab einer Einheit, am Blockanfang; das Netz hat schon geprüft
      const int einheit = c.deck;
      bool erlaubt = false;  // auch am Netz vorbei geprüft (fünf Kanäle und master)
      for (const auto& n : cypherdj::osc::werte::fx_kanal) erlaubt = erlaubt || n == c.pfad;
      const bool master = !std::strcmp(c.pfad, "master");   // Mixer::kanal_index kennt "master" nicht (-1)
      const int k = master ? Mixer::FX_MASTER : Mixer::kanal_index(c.pfad);
      if (einheit < 1 || einheit > Mixer::FX_EINHEITEN || !erlaubt || k == Mixer::FX_KEIN) {
        quittung(c.id, c.quelle, 6, sample_, beat0, "ausserhalb_bereich");
        break;
      }
      mixer_->fx_zuweisung_setze(einheit - 1, k, c.an != 0);
      quittung(c.id, c.quelle, 1, sample_, beat0);
      Ereignis x{};
      x.art = Ereignis::FX_ZUWEISUNG;
      x.sample = sample_;
      x.beat = beat0;
      x.deck = einheit;
      kopiere(x.pfad, c.pfad, sizeof x.pfad);
      x.status = c.an != 0 ? 1 : 0;
      melde(x);
      quittung(c.id, c.quelle, 2, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    }
    case Befehl::KANAL_GRAPH: {  // Baukasten S3c (§4.10): am Blockanfang; das Netz hat geladen und geprüft
      CypherBk* g = static_cast<CypherBk*>(const_cast<void*>(c.zeiger));
      // S6: the send returns fx/3, fx/4 take graphs too. The mapping to the mixer's bus index (2, 3) sits here, before
      // Mixer::kanal_index (which returns -1 for fx/3).
      int send = -1;
      if (std::strcmp(c.pfad, "fx/3") == 0) send = 2;
      else if (std::strcmp(c.pfad, "fx/4") == 0) send = 3;
#ifdef CYPHERDJ_MUTATION_FX_GRAPH_FALSCHER_BUS
      if (send >= 0) send = 5 - send;   // fx/3 <-> fx/4
#endif
#ifndef CYPHERDJ_MUTATION_KANAL_GRAPH_KI_OFFEN
      if (q == sw::Quelle::cypher && sw_->ki_gestoppt()) {  // §4.7 Stopp-Taste, Muster LOOP_LADEN
#ifndef CYPHERDJ_MUTATION_KANAL_GRAPH_KI_LECK
#ifdef CYPHERDJ_MUTATION_FX_GRAPH_KI_LECK
        if (send < 0)   // mutation: only the send path leaks
#endif
        bk_zurueck(g, sample_);
#endif
        quittung(c.id, c.quelle, 6, sample_, beat0, "ki_gestoppt");
        break;
      }
#endif
      const int k = send >= 0 ? -1 : Mixer::kanal_index(c.pfad);
      if (send < 0 && (k < 0 || k >= Mixer::MIX_GRAPH_KANAELE)) {  // am Netz vorbei: der Graph gehört uns noch, zurück in die Freigabe
#ifndef CYPHERDJ_MUTATION_KANAL_GRAPH_BEREICH_LECK
#ifdef CYPHERDJ_MUTATION_FX_GRAPH_BEREICH_LECK
        if (std::strncmp(c.pfad, "fx/", 3) != 0)   // mutation: only fx/<n> paths leak
#endif
        bk_zurueck(g, sample_);
#endif
        quittung(c.id, c.quelle, 6, sample_, beat0, "ausserhalb_bereich");
        break;
      }
#ifndef CYPHERDJ_MUTATION_KANAL_GRAPH_NICHT_SETZEN
#ifdef CYPHERDJ_MUTATION_FX_GRAPH_NICHT_GESETZT
      if (send < 0)   // mutation: the send path never sets
#endif
      {
        if (send >= 0) mixer_->setze_send_graph(send, g);
        else mixer_->setze_kanal_graph(k, g);
      }
#endif
#ifndef CYPHERDJ_MUTATION_KANAL_GRAPH_BURST_LECK
      {  // sofort abholen: ein Burst vieler Wechsel vor demselben Block liefe sonst über die Ablage (MIX_BK_FREI) und leckte
        CypherBk* frei[Mixer::MIX_BK_FREI];
        for (int nf; (nf = mixer_->bk_frei(frei, Mixer::MIX_BK_FREI)) > 0;)
          for (int i = 0; i < nf; ++i) bk_zurueck(frei[i], sample_);
      }
#endif
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 2, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    }
    case Befehl::FX_ROUTING: {  // Ohr T17 (§4.10): Post Fader oder Insert, am Blockanfang; die Taste ist Andreas' Hand
      if (q == sw::Quelle::cypher) {
        quittung(c.id, c.quelle, 6, sample_, beat0, "nur_hand");
        break;
      }
      if (c.an != 0 && c.an != 1) {  // das Netz hat schon geprüft, hier auch am Netz vorbei
        quittung(c.id, c.quelle, 6, sample_, beat0, "ausserhalb_bereich");
        break;
      }
      mixer_->fx_routing_setze(c.an);
      quittung(c.id, c.quelle, 1, sample_, beat0);
      Ereignis x{};
      x.art = Ereignis::FX_ROUTING;
      x.sample = sample_;
      x.beat = beat0;
      x.status = c.an;
      melde(x);
      quittung(c.id, c.quelle, 2, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    }
    case Befehl::TEIL: {  // §4.3; Quittungen 1, 4, 6 kommen vom Stellwerk und räumen den Schatten mit auf
      SchattenTeil* t = schatten_.neu();
      if (!t) {
        quittung(c.id, c.quelle, 6, sample_, beat0, "ausserhalb_bereich");  // 256 offene Teile wie im Stellwerk
        break;
      }
      t->id = c.id;
      kopiere(t->quelle, c.quelle, sizeof t->quelle);
      kopiere(t->plan, c.plan, sizeof t->plan);
      t->nr = c.nr;
      kopiere(t->pfad, c.pfad, sizeof t->pfad);
      t->ab_beat = c.ab_beat;
      t->dauer_beats = c.dauer_beats;
      t->nach = c.wert;
      t->form = static_cast<uint8_t>(c.form);
      t->politik = static_cast<uint8_t>(c.politik);
      kopiere(t->gruppe, c.gruppe, sizeof t->gruppe);
      kopiere(t->hoerschein, c.hoerschein, sizeof t->hoerschein);
      sw_->teil(sw::TeilBefehl{c.id, q, c.plan, c.nr, c.pfad, c.ab_beat, c.dauer_beats, c.wert, c.form, c.politik,
                               c.gruppe, c.hoerschein});
      break;
    }
    case Befehl::ABBRUCH: {  // §4.3 /k/abbruch
      int32_t nrs[64];
      const int n = teile_lesen(c.liste, nrs, 64);
      if (n == -2) {
        quittung(c.id, c.quelle, 6, sample_, beat0, "ausserhalb_bereich");
        break;
      }
      sw_->abbruch(c.id, q, c.plan, nrs, n);
      if (n == -1) decks_abbruch(c.quelle, c.plan);  // Scheibe 31: wartende Deck-Teile des Plans (§4.3)
      break;
    }
    case Befehl::HAND_FREI: {  // §4.3 /k/hand/frei: a project switch is a fresh start (Andreas, 2026-11-02); only Andreas' hand
      if (q != sw::Quelle::andreas) {
        quittung(c.id, c.quelle, 6, sample_, beat0, "nur_andreas");
        break;
      }
      sw_->hand_frei(c.liste, sample_);
      // A restart that restores holders replays them in the SECOND cycle (nachreichen_in_, teile_nachreichen): drop the named ones from that list,
      // else the holder would come back after this command.
      int n = 0;
      for (int i = 0; i < n_mensch_wieder_; ++i)
        if (!sw::pfad_in_liste(c.liste, sw_->tabelle().def(mensch_wieder_[i]).pfad)) mensch_wieder_[n++] = mensch_wieder_[i];
      n_mensch_wieder_ = n;
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    }
    case Befehl::KI_STOPP: sw_->ki_stopp(c.id, q); break;  // §4.7 (F13: wartende cypher-Loops verwirft Kern::audio)
    case Befehl::KI_FREI: sw_->ki_frei(c.id, q); break;
    case Befehl::KI_SPUR:
      if (sw_->ki_spur(c.id, q, c.liste)) ki_spur_id_ = c.id;   // eine abgelehnte Liste nimmt der gültigen im selben Zyklus die Kennung nicht
      break;
    case Befehl::KI_STUFE:  // §4.7: nur für LEDs (Scheibe 35); die Stufe durchsetzen tut der Leitstand
      ki_stufe_ = c.an;
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    case Befehl::MAPPING: {  // Scheibe 35, §4.7 /k/mapping: das Netz hat geladen und geprüft, der Tausch gilt ab diesem Zyklus
      const bool lern = c.nr == 1;  // S19: slot 1 is the learn table on midi_ein_1, slot 0 the base mapping on hand_in
      const hand::Mapping* alt = lern ? lern_mapping_ : mapping_;
      if (lern) {
#ifndef CYPHERDJ_MUTATION_LERN_NICHT_TAUSCHEN  // failure case S19: acknowledged, but the learn table is not swapped
        setze_lern_mapping(static_cast<const hand::Mapping*>(c.zeiger));
#endif
      } else {
#ifndef CYPHERDJ_MUTATION_MAPPING_NICHT_TAUSCHEN  // Fehlerfall Plan 35 Task 8: quittiert, tauscht aber nicht
        setze_mapping(static_cast<const hand::Mapping*>(c.zeiger));
#endif
      }
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 2, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      if (alt) {  // das Netz gibt es frei; der Kern liest es nach dem Tausch nicht mehr
        Ereignis x{};
        x.art = Ereignis::MAPPING_ALT;
        x.sample = sample_;
        x.zeiger = alt;
        melde(x);
      }
      break;
    }
    case Befehl::LERNEN:  // S19 (§4.7 /k/lernen): arm (an 1, restarts the 20 s countdown, replaces the id) or disarm
#ifndef CYPHERDJ_MUTATION_LERN_NIE_SCHARF  // failure case S19: acknowledged, never armed
      lern_an_ = c.an == 1;
#endif
      lern_id_ = c.id;
      lern_rest_ = LERN_FRIST;
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    case Befehl::HOERSCHEIN: {  // Ohr T14 (§4.5 /k/hoerschein): registriert im Register, sofort fertig
      sw::Schein s{};
      kopiere(s.hs_id, c.hoerschein, sizeof s.hs_id);
      kopiere(s.kanal, c.pfad, sizeof s.kanal);
      kopiere(s.inhalt.material_id, c.material_id, sizeof s.inhalt.material_id);
      s.inhalt.bpm_milli = c.bpm_milli;
      s.inhalt.fassung = c.fassung;
      s.bpm = c.bpm;
      s.gueltig_bis = c.ab_beat;
      s.quell_von = c.quell_von;
      s.quell_bis = c.quell_bis;
      hoerschein_reg_.setze(s, beat0);
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 2, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    }
    case Befehl::HOERSCHEIN_WEG: {  // Ohr T14 (§4.5 /k/hoerschein/weg): zieht ihn zurück
      hoerschein_reg_.weg(c.hoerschein);
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 2, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    }
    case Befehl::HAND: {  // §19.0 /test/hand: bis zum Zyklus seines Samples in der Schlange
      int dn = 0;
      bool play = false;
      if (arr_taste_pfad(c.pfad)) {  // D1 K1: arr/start_stopp wie die Hand-Zielart, Druck ab 0,5
        if (c.wert >= 0.5f && arr_hand_start_stopp(c.sample < sample_ ? sample_ : c.sample)) ++hand_ereignisse_;
        else ++hand_ohne_wirkung_;
        break;
      }
      if (deck_taste_pfad(c.pfad, &dn, &play)) {  // Scheibe 35 E5 a: deck/<n>/play|cue wie die Deck-Taste des Controllers
        if (hand_deck_taste(dn, play, c.wert >= 0.5f ? 1 : 0, c.sample)) ++hand_ereignisse_;
        else ++hand_ohne_wirkung_;
        break;
      }
      hand::Taste tk;
      if (test_taste_pfad(c.pfad, &tk)) {  // Zusatz 35: taste/<name> wie die Taste des Controllers, am Zyklusanfang oder später
        if (c.wert >= 0.5f) hand_taste(tk, 1, c.sample < sample_ ? sample_ : c.sample);
        else ++hand_ohne_wirkung_;  // Loslassen
        break;
      }
      const int r = sw_->tabelle().suche(c.pfad);
      if (r >= 0) hand_.rein(HandGriff{c.sample, static_cast<int16_t>(r), c.wert});
      break;
    }
    default:
      einsortieren31(c);  // Scheibe 31: /k/deck/laden, entladen, start, stopp (core_deck.cpp)
      break;
  }
}

// /k/set/neu: offene Planteile der alten Zeitachse enden (Quittung 7 abbruch), wie ihre Tempo-Rampen (Scheibe 08);
// die Regler behalten ihre Werte, wartende Griffe der Hand verfallen.
void Kern::set_neu_teile_ab() {
  for (int i = 0; i < TeilSchatten::MAX; ++i) {
    const SchattenTeil* t = schatten_.teil(i);
    if (t->belegt) sw_->abbruch(0, quelle_von(t->quelle), t->plan, nullptr, -1);
  }
  hand_.leeren();
}

void spur_pegel_name(int i, char* aus) {
  std::memcpy(aus, "spur/", 5);
  int n = i + 1, k = 5;
  char z[4];
  int m = 0;
  do { z[m++] = static_cast<char>('0' + n % 10); n /= 10; } while (n > 0 && m < 3);
  while (m > 0) aus[k++] = z[--m];
  aus[k] = '\0';
}

// §5.6 /pegel, 20 Hz (im Zyklus, der ein Vielfaches von 2 400 Samples enthält): je geladenem Deck, master und cue die
// Abtast-Spitze seit der letzten Meldung in dB (−200 unter −200). Echtspitze, LUFS und Bänder misst erst 43: −200.
void Kern::pegel_melden(int64_t n0, int n) {
  constexpr int64_t ABSTAND = 2400;
  if ((n0 + ABSTAND - 1) / ABSTAND * ABSTAND >= n0 + n) return;
  auto melden = [&](const char* name, int k) {
    const float sp = mixer_->spitze_lesen(k);
    Ereignis e{};
    e.art = Ereignis::PEGEL;
    e.sample = n0;
    for (size_t i = 0; i + 1 < sizeof e.pfad && name[i]; ++i) e.pfad[i] = name[i];  // ohne snprintf: Kosten im Callback
    e.pegel[0] = sp > 1e-10f ? 20.0f * std::log10(sp) : -200.0f;
    for (int i = 1; i < 7; ++i) e.pegel[i] = -200.0f;
    melde(e);
  };
  for (int d = 0; d < DECKS; ++d) {
    if (decks_->deck[d].geladen()) melden(Mixer::kanal_name(d), d);
    else mixer_->spitze_lesen(d);
  }
  melden("erz/1", 4);  // Plan 2026-09-27: Strudel-Kanal, immer (auch ohne Strom: −200)
  melden("erz/2", 5);  // Studio S1: Bass
  melden("erz/3", 6);  // Studio S1: Melodie
#ifndef CYPHERDJ_MUTATION_PEGEL_OHNE_ERZ567
  melden("erz/5", 8);  // S18: Baukasten instruments on erz/5..7, always (-200 without a stream), like pad
  melden("erz/6", 9);
  melden("erz/7", 10);
#endif
  melden("pad/1", 12);  // MVP 2: Loop-Boxen, immer (ohne Loop −200)
  melden("pad/2", 13);
  for (int i = 0; i < ARR_SPUREN; ++i) {  // D1 K1 (§5.6): spur/<n> je Spur mit Inhalt, Spitze nach dem Spur-Fader
    const float sp = arr_->spitze_lesen(i);
    if (!arr_->spur_belegt(i)) continue;
    Ereignis e{};
    e.art = Ereignis::PEGEL;
    e.sample = n0;
    spur_pegel_name(i, e.pfad);
    e.pegel[0] = sp > 1e-10f ? 20.0f * std::log10(sp) : -200.0f;
    for (int j = 1; j < 7; ++j) e.pegel[j] = -200.0f;
    melde(e);
  }
  for (int g = 0; g < ARR_GRUPPEN; ++g) {  // 1.10: grp/<n> je Gruppe mit Mitgliedern, Spitze nach dem Gruppen-Fader
    const float sp = arr_->spitze_gruppe_lesen(g);
    if (!arr_->gruppe_belegt(g)) continue;
    Ereignis e{};
    e.art = Ereignis::PEGEL;
    e.sample = n0;
    std::memcpy(e.pfad, "grp/", 4);
    e.pfad[4] = static_cast<char>('1' + g);
    e.pfad[5] = '\0';
    e.pegel[0] = sp > 1e-10f ? 20.0f * std::log10(sp) : -200.0f;
    for (int j = 1; j < 7; ++j) e.pegel[j] = -200.0f;
    melde(e);
  }
  for (int r = 0; r < ARR_RETURNS; ++r) {  // 1.10 slice 3: ret/<r> per return the playback knows, peak after the return fader
    const float sp = arr_->spitze_ret_lesen(r);
    if (!arr_->ret_belegt(r)) continue;
    Ereignis e{};
    e.art = Ereignis::PEGEL;
    e.sample = n0;
    std::memcpy(e.pfad, "ret/", 4);
    e.pfad[4] = static_cast<char>('1' + r);
    e.pfad[5] = '\0';
    e.pegel[0] = sp > 1e-10f ? 20.0f * std::log10(sp) : -200.0f;
    for (int j = 1; j < 7; ++j) e.pegel[j] = -200.0f;
    melde(e);
  }
  {  // 1.10: pm, die Spitze des Produktions-Masters nach dem PM-Fader (ohne Metronom), sobald eine Wiedergabe geladen ist
    const float sp = arr_->spitze_pm_lesen();
    if (arr_->snapshot()) {
      Ereignis e{};
      e.art = Ereignis::PEGEL;
      e.sample = n0;
      std::memcpy(e.pfad, "pm", 3);
      e.pegel[0] = sp > 1e-10f ? 20.0f * std::log10(sp) : -200.0f;
      for (int j = 1; j < 7; ++j) e.pegel[j] = -200.0f;
      melde(e);
    }
  }
  for (int k = 0; k < ARR_INS_KOMP; ++k) {  // 1.10 slice 4a: ins/komp/<n>, the gain reduction of every pooled insert stage that computed in the last block
    if (!arr_->inserts().lief(k)) continue;
    Ereignis e{};
    e.art = Ereignis::INS_GR;
    e.sample = n0;
    {  // "ins/komp/<n>", n = 1..12, written by hand: no snprintf in the callback (like the neighbours)
      const char kopf[] = "ins/komp/";
      std::memcpy(e.pfad, kopf, sizeof kopf - 1);
      char* z = e.pfad + sizeof kopf - 1;
      const int n = k + 1;
      if (n >= 10) *z++ = static_cast<char>('0' + n / 10);
      *z++ = static_cast<char>('0' + n % 10);
      *z = '\0';
    }
    e.wert = arr_->inserts().gr_db(k);
    melde(e);
  }
  melden("master", Mixer::PEGEL_MASTER);
  melden("cue", Mixer::PEGEL_CUE);
  for (int k = 1; k <= EIN_PAARE; ++k) {  // I08: ein/<k>, immer (ohne Verbindung −200)
    const float sp = ein_bank_.spitze_lesen(k);
    Ereignis e{};
    e.art = Ereignis::PEGEL;
    e.sample = n0;
    e.pfad[0] = 'e'; e.pfad[1] = 'i'; e.pfad[2] = 'n'; e.pfad[3] = '/'; e.pfad[4] = static_cast<char>('0' + k); e.pfad[5] = '\0';
    e.pegel[0] = sp > 1e-10f ? 20.0f * std::log10(sp) : -200.0f;
    for (int i = 1; i < 7; ++i) e.pegel[i] = -200.0f;
    melde(e);
  }
  Ereignis z{};  // I08: /zustand/ein (§5.14), im Takt der Pegel
  z.art = Ereignis::EIN_ZUSTAND;
  z.sample = n0;
  z.status = static_cast<int32_t>(ein_verbunden_.load(std::memory_order_relaxed));
  z.ein_gesehen = static_cast<int64_t>(midi_ein_.gesehen());
  z.ein_verloren = static_cast<int64_t>(midi_ein_.verloren());
  z.ein_midi_sample = midi_ein_.letztes_sample();
  z.ein_flanke = ein_bank_.flanke(1);
  melde(z);
  rec_zustand_melden(n0, n);
}

// 1.12 slice 3, D1: a grip is every hand step the Stellwerk applied to a track regulator in the sub-block just processed (value or touch; the holder does not matter).
// It overrides the lane of that track and field from the grip sample on. Order in audio(): hand, prozess, aenderungen, arr_->verlauf, HERE, arr_->block.
// Only spur/1..32/{fader,pan,mute,solo} count; the reverse table of the Arrangement has exactly these 128 entries. Not a grip: the touches teile_nachreichen replays
// after a restart (nachreichen_sperre_, cleared after the first sub-block of that cycle). Allocation-free.
void Kern::arr_griffe_pruefen(int64_t s0, int m) {
  if (nachreichen_sperre_) {
    nachreichen_sperre_ = false;
    return;
  }
  auto_punkte_melden(s0, m);   // D12: before the override loop, which only reads the same grip signal
  if (!arr_->auto_spielt()) return;   // D5: a stopped transport takes no override
  for (int i = 0; i < ARR_SPUREN; ++i)
    for (int f = 0; f < 4; ++f) {
      const int r = arr_->auto_regler(i, f);
      int64_t sample;
      if (r >= 0 && sw_->griff_im_zyklus(r, sample)) arr_->auto_uebersteuern(i, f, true, sample);
    }
}

// 1.12 S3 (D12, D13): the points of a hand gesture on an ARMED track, for /e/auto_punkt. Called once per sub-block after the grips are known. A grip (the same signal that
// overrides the lane: a hand step the Stellwerk applied, value or touch) while the transport PLAYS makes the point of that regulator pending: project beat at the grip sample
// (computed now, stored with the value: after a seam the origin has moved, so it can never be recomputed at send time), value of the regulator at the end of the sub-block.
// A newer grip replaces a pending point. The point is sent at once when the 50 Hz window of the regulator (REGLER_MELDUNG_ABSTAND from the last sent point) is free, else it
// waits for the window to end (trailing value: the last value of a gesture always arrives). A stopped transport takes no new point but sends the pending one. A full
// event ring keeps the point pending. Allocation-free.
void Kern::auto_punkte_melden(int64_t s0, int m) {
#ifndef CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_ARM
  if (auto_armiert_ == 0) return;
#endif
  const int64_t ende = s0 + m;
#ifdef CYPHERDJ_MUTATION_ARR_PUNKT_IM_STOPP   // error case: the stopped transport reports like a playing one
  const bool spielt = true;
#else
  const bool spielt = arr_->auto_spielt();
#endif
  const Karte& karte = plan_.karte();
  for (int i = 0; i < ARR_SPUREN; ++i) {
#if defined(CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_ARM)
    // error case: armed or not, every track reports
#elif defined(CYPHERDJ_MUTATION_ARR_PUNKT_ALLE_SPUREN)
    // error case: one armed track arms them all (auto_armiert_ > 0 is checked above)
#else
    if (!auto_arm_[i]) continue;
#endif
    for (int f = 0; f < Arrangement::AUTO_FELDER; ++f) {
      AutoPunkt& p = auto_punkt_[i][f];
      const int r = arr_->auto_regler(i, f);
      int64_t gs;
#ifdef CYPHERDJ_MUTATION_ARR_PUNKT_PAARUNG_ERSTER   // error case: the beat of the FIRST grip of the sub-block with the value at its END
      if (spielt && r >= 0 && sw_->griff_im_zyklus(r, gs)) {
        p.beat = arr_->projekt_beat_bei(karte, gs);
        p.wert = sw_->wert_fest(r);
        p.aus = true;
      }
#else
      if (spielt && r >= 0 && sw_->griff_letzter_im_zyklus(r, gs)) {
#ifdef CYPHERDJ_MUTATION_ARR_PUNKT_NACHZUEGLER_ERSTER   // error case: a held point is never replaced, the first value of the window is sent
        if (!p.aus)
#endif
        {
#ifdef CYPHERDJ_MUTATION_ARR_PUNKT_BEAT_JETZT   // error case: the beat is taken when the block ends, not at the grip sample
          p.beat = arr_->projekt_beat_bei(karte, ende);
#else
          p.beat = arr_->projekt_beat_bei(karte, gs);
#endif
          // D12: beat and value of ONE sample, the last grip of the sub-block. After a grip the Stellwerk value stays where the hand put it until the next step (a plan part
          // cannot take a regulator the human holds, setze_direkt runs in the command phase), so the value after the sub-block IS the value at the last grip. A switch
          // (mute, solo) has the target of its ramp, which holds from the grip sample on (wert_fest).
          p.wert = sw_->wert_fest(r);
          p.aus = true;
        }
      }
#endif
      if (!p.aus) continue;
#ifdef CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_DROSSEL   // error case: no rate cap, every grip is sent
      const bool frei = true;
#else
      const bool frei = ende - p.gemeldet >= sw::REGLER_MELDUNG_ABSTAND;
#endif
#ifdef CYPHERDJ_MUTATION_ARR_PUNKT_STOPP_VERWIRFT   // error case: what is held when the transport stops is dropped
      if (!spielt) {
        p.aus = false;
        continue;
      }
#endif
#ifdef CYPHERDJ_MUTATION_ARR_PUNKT_OHNE_NACHZUEGLER   // error case: a point inside the window is dropped, nothing trails
      if (!frei) {
        p.aus = false;
        continue;
      }
#endif
      if (!frei && spielt) continue;   // held until the window ends
      Ereignis x{};
      x.art = Ereignis::AUTO_PUNKT;
      x.sample = ende;
      x.beat = p.beat;
      x.wert = p.wert;
      {   // "spur/<n>/<field>": the one helper of the neighbours (no snprintf in the callback), then the field name of the contract
        spur_pegel_name(i, x.pfad);
        size_t o = std::strlen(x.pfad);
        x.pfad[o++] = '/';
        const auto ziel = cypherdj::osc::werte::auto_ziel[static_cast<size_t>(f)];
        for (size_t c = 0; c < ziel.size() && o + 1 < sizeof x.pfad; ++c) x.pfad[o++] = ziel[c];
        x.pfad[o] = '\0';
      }
      if (!ereignisse_->schiebe(x)) {   // the ring is full: the point stays pending and goes in the next sub-block that finds room (a newer grip replaces it, a disarm drops it: no other loss)
#ifdef CYPHERDJ_MUTATION_ARR_PUNKT_VOLL_VERWIRFT   // error case: a point that finds the ring full is dropped
        p.aus = false;
#endif
        continue;
      }
      p.aus = false;
      p.gemeldet = ende;
    }
  }
}

// D4 (the core side of "/k/arr/auto an 0|1"): the pickup of D2 for the page path. uebersteuern = true: the Stellwerk value is first set to the value the lane played
// last, then the override starts, so the value stays there until the next /k/teil. The value is only taken when the lane has really played (auto_gespielt, the
// condition of the Stellwerk pickup as well): a lane just swapped in or never played has no value, then nothing is set and the override just starts. An override
// never starts without a lane or while the transport stands (D5). uebersteuern = false (re-enable) also works while stopped (D6): the state is cleared.
bool Kern::auto_uebersteuern(int spur, int feld, bool uebersteuern) {
  const int r = arr_->auto_regler(spur, feld);
  if (r < 0) return false;
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_SETZE_OHNE_WAR
  if (uebersteuern && arr_->auto_kann_uebersteuern(spur, feld)) sw_->setze_direkt(r, arr_->auto_letzter_wert(spur, feld));   // error case: no check that the lane has played
#else
  if (uebersteuern && arr_->auto_kann_uebersteuern(spur, feld) && arr_->auto_gespielt(spur, feld)) sw_->setze_direkt(r, arr_->auto_letzter_wert(spur, feld));
#endif
  return arr_->auto_uebersteuern(spur, feld, uebersteuern, sample_);
}

void Kern::audio(int64_t n0, int n) {
  const Karte& karte = plan_.karte();
  for (int off = 0; off < n;) {
    const int m = std::min(n - off, MIX_BLOCK);
    const int64_t s0 = n0 + off;
    ein_bank_.messe(s0, off, m);  // I08: Spitzen und Flanke der Eingänge ein_1..4
    // Hand am Versatz (§7.3 Punkt 1, ADR 023 Punkt 2): jeder Griff wirkt an seinem Sample, nicht am Blockanfang
    HandGriff g;
    while (hand_.raus_vor(s0 + m, g)) {
      sw::Griff gr{g.sample, g.regler, static_cast<sw::GriffArt>(g.art), g.x, g.kurve};  // 35: Art und Kurve
#ifdef CYPHERDJ_MUTATION_HAND_BLOCKANFANG
      gr.sample = s0;  // Fehlerfall der Abnahme: Griff am Blockanfang statt am Versatz (09 Probe b naiv_block)
#endif
      sw_->hand(gr);
    }
    sw_->prozess(s0, m);
    const sw::Aenderung* a;
    const int na = sw_->aenderungen(&a);
    for (int i = 0; i < na; ++i) {
      mixer_->verlauf(a[i].regler, a[i].verlauf);
      decks_verlauf(a[i].regler, a[i].verlauf);  // Scheibe 31: stem/* ins Deck
      keylock_verlauf(a[i].regler, a[i].verlauf, s0, m);  // Keylock Task 3: Regler keylock an Decks und Boxen
      arr_->verlauf(a[i].regler, a[i].verlauf);  // D1 K1: spur/<n>/* ins Modul Arrangement (Verlauf je Sample)
      if (const int o = bk_ort_[a[i].regler]; o >= 0) {
#ifdef CYPHERDJ_MUTATION_BK_RAMPE_TOTZONE   // failure case S23: a change smaller than 0.005 inside one block is dropped, so every slow ramp stands still and only jumps get through
        if (std::fabs(a[i].verlauf[m - 1] - a[i].verlauf[0]) < 0.005f) continue;
#endif
        bk_wert_[o / cypherdj::stellwerk::BK_REGLER_N][o % cypherdj::stellwerk::BK_REGLER_N] = a[i].verlauf[m - 1];  // S5r K6: Endwert des Blocks (m wie keylock_verlauf), die FFI glättet
      }
    }
    arr_griffe_pruefen(s0, m);  // 1.12 S3 (D1): grips on spur/n/{fader,pan,mute,solo} override the lanes from their sample, before arr_->block
    decks_block(s0, m);  // Scheibe 31: Decks in die Eingänge deck/1..4, Starts und Stopps am Sample
    ErzAusloeser ausl;
    erz_->block(karte, s0, m, erz_l_, erz_r_, midi_aus_, zyklus_n0_, &ausl);  // Plan 2026-09-27 + Studio S5 (MIDI-Ströme)
    {  // Baukasten S3a: ausgeklungene Graphen zur Freigabe in den Netz-Faden
      CypherBk* frei[8];
      for (int nf; (nf = erz_->bk_frei(frei, 8)) > 0;)
        for (int i = 0; i < nf; ++i) {
          Ereignis x{};
          x.art = Ereignis::ERZ_BK_ALT;
          x.sample = s0;
          x.zeiger = frei[i];
          melde(x);
        }
    }
    // D1 K1 (Spec 2.2): Arrangement nach dem Erzeuger, vor Rückwegen, Prüfklicks und Mixer. Summe in den Eingang von
    // erz/4, Metronom in die Master-Summe vor dem Limiter oder in die PFL-Summe. Ein KI-Stopp beendet Cyphers wartenden Start und ihren Freeze, einen laufenden Transport nicht (E-a).
    if (sw_->ki_gestoppt()) arr_->ki_stopp(s0, karte);
    // 1.8 S3 (R10): the external input of every armed track goes to the arrangement for THIS block (the pointers of the JACK buffers of the cycle plus the sub-block offset;
    // the arrangement clears them after the block, so a track that is not fed here is not monitored). Internal sources sound on their own mixer channel (D11).
    // A take that is collecting its tail (status 4) still records, so auto keeps monitoring.
    {
      const int rst = aufnahme_.status();
      const bool nimmt = rst == 3 || rst == 4;
      for (int nr = 1; nr <= ARR_SPUREN; ++nr) {
        const RecSpur* rs = aufnahme_.spur(nr);
        if (!rs || !rec_extern(rs->eingang)) continue;
        const float* pl = ein_bank_.links(rs->eingang);
        const float* pr = ein_bank_.rechts(rs->eingang);
        arr_->monitor_quelle(nr - 1, pl ? pl + off : nullptr, pr ? pr + off : nullptr, rs->modus, rs->monitor.load(std::memory_order_relaxed), nimmt);
      }
    }
    arr_bk_->takt(karte.beat_at((double)s0), karte.bpm_at((double)s0) / 60.0 / 48000.0);   // S20: beat and tempo for the graphs of the bk tracks
    arr_->dj_schluessel(erz_l_, erz_r_);   // 1.10 slice 5 U2b (E6, E7): deck/1..4 and erz/1 (indices 0..4) for the sidechain keys; always handed, live and in a render (a render's inputs are silent)
    for (int h = 1; h <= ARR_INS_HOST; ++h)   // plan 1.11 T4: the effect-host ports of this cycle, offset to this sub-block (pointer stores; a port that is not there stays nullptr: the stage plays dry)
      arr_->host_stufe().setze_zeiger(h, ins_aus_[h - 1][0] ? ins_aus_[h - 1][0] + off : nullptr, ins_aus_[h - 1][1] ? ins_aus_[h - 1][1] + off : nullptr,
                                      ins_rueck_[h - 1][0] ? ins_rueck_[h - 1][0] + off : nullptr, ins_rueck_[h - 1][1] ? ins_rueck_[h - 1][1] + off : nullptr);
    arr_->setze_zyklus_start(zyklus_ns_ != 0 ? zyklus_ns_ + static_cast<int64_t>(off) * 1000000000LL / 48000 : 0);   // mehrkern 3.2: the nominal start of this sub-block, for the time gates of phase Q
    arr_->block(karte, s0, m, erz_l_[arr_kanal_], erz_r_[arr_kanal_], mixer_->summe_eingang_l(),
                mixer_->summe_eingang_r(), mixer_->pfl_eingang_l(), mixer_->pfl_eingang_r());
    ins_mess_block(off, m);   // plan 1.11 T5: a running round-trip measurement owns the send buffers of its host (after the stage wrote its copy of the input)
    std::memcpy(pm_abgriff_l_ + off, arr_->pm_l(), sizeof(float) * static_cast<size_t>(m));   // 1.10: Export-Abgriff (Spec 5.4)
    std::memcpy(pm_abgriff_r_ + off, arr_->pm_r(), sizeof(float) * static_cast<size_t>(m));
    arr_quittungen(karte);
    arr_freeze_quittungen(karte);  // Paket K3: Freeze 2, 3, 7 und Rückgabe des Auftrags
    // K2: der Duck setzt AM Kick-Ereignis ein, nicht um den Wirt-Rundweg verzögert. Seit Glanz 2.7 (F19) gehen MIDI-Noten um den
    // Rundweg früher hinaus: eine Bassnote mit dem Kick kommt gleichzeitig mit ihm an (vorher ~545 Samples später, Abnahme
    // 2026-09-30) und trifft den Duck in seinem Attack (240 Samples, duck.h:17) statt im schon abgesenkten Pegel.
#ifdef CYPHERDJ_MUTATION_DUCK_VERSATZ_NULL
    for (int i = 0; i < ausl.n; ++i) mixer_->duck_ausloesen(0);   // Mutation: Duck am Blockanfang, ohne Auslöser-Sample
#else
    for (int i = 0; i < ausl.n; ++i) mixer_->duck_ausloesen(ausl.sample[i] - s0);
#endif
    for (int e = 0; e < 8; ++e) {  // Studio S5: Rückwege der Wirte in den Eingang erz/<e+1>, vor Trim (§8)
      if (!rueck_l_[e] || !rueck_r_[e]) continue;
#ifndef CYPHERDJ_MUTATION_ARR_RUECK_ERZ4
      if (4 + e == arr_kanal_) continue;  // D1 K1 (Spec 2.3): erz/4 gehört der Produktion, rueck_erz_4 klingt nicht
#endif
      float* l = erz_l_[4 + e];
      float* r = erz_r_[4 + e];
      const int64_t o = s0 - zyklus_n0_;
      for (int i = 0; i < m; ++i) {  // Audit F01: einziger Audio-Eingang ohne Prüfung; NaN/Inf raus, Ausreißer auf ±8
        const float a = rueck_l_[e][o + i], c = rueck_r_[e][o + i];
        const bool ok = std::isfinite(a) && std::isfinite(c);
        l[i] += ok ? std::clamp(a, -8.0f, 8.0f) : 0.0f;
        r[i] += ok ? std::clamp(c, -8.0f, 8.0f) : 0.0f;
        if (!ok) ++rueck_unendlich_;
      }
    }  // Plan 2026-09-27: Erzeuger-Einsätze am Sample in erz/*, pad/*
    // Prüfklicks (Z1): Kanäle in ihren Eingang vor Trim, master in die Summe vor master/pegel
    KlickEinsatz e[8];
    for (int k = 0; k < MIX_KANAELE; ++k) {
      const int ne = kanal_klick_[k].block(karte, s0, m, mixer_->eingang_l(k), mixer_->eingang_r(k), e, 8);
      KlickZiel& q = kanal_klick_q_[k];
      if (ne > 0 && q.quittung_offen) {
        quittung(q.id, q.quelle, 2, e[0].sample, e[0].beat);
        q.quittung_offen = false;
        q.seit_sample = e[0].sample;
        q.seit_beat = e[0].beat;
      }
    }
    const int ne = klick_.block(karte, s0, m, mixer_->master_eingang_l(), mixer_->master_eingang_r(), e, 8);
    if (ne > 0 && klick_quittung_offen_) {
      quittung(klick_id_, klick_quelle_, 2, e[0].sample, e[0].beat);
      klick_quittung_offen_ = false;
      klick_seit_sample_ = e[0].sample;
      klick_seit_beat_ = e[0].beat;
    }
    BoxMeldung bm[4];  // MVP 2: Loop-Boxen in pad/1, pad/2 (nach Erzeuger und Klicks, vor dem Mixer)
    Mitschnitt* mt_fertig = nullptr;  // MVP 2 Scheibe 2: derselbe Aufruf kopiert erz/1 in einen laufenden Mitschnitt
    // F13 x §4.7 (Prüfung 2.3 Befund 1): jeder Weg eines KI-Stopps (Befehl KI_STOPP, Stopp-Taste der Hand, Neustart-
    // Zustand, teile_nachreichen) endet im Stellwerk-Zustand ki_gestoppt; hier, vor dem Block, in dem ein wartender Loop
    // übernehmen könnte, gehen wartende cypher-Loops zurück. Ein Punkt für alle Wege, nicht je Aufrufer.
    if (sw_->ki_gestoppt()) loops_->cypher_wartende_verwerfen();
    const int nb = loops_->block(karte, s0, m, erz_l_, erz_r_, bm, 4, &mt_fertig);
    loops_frei(s0);  // Keylock: Varianten, die eine Blende zu Ende gebracht hat, zurück an den Netz-Faden
    for (int i = 0; i < nb; ++i) loop_melden(bm[i].box, bm[i].sample, karte.beat_at((double)bm[i].sample));
    if (mt_fertig) mitschnitt_melden(mt_fertig, mt_fertig->abgebrochen ? 1 : 0);  // voll: das Netz schreibt und gibt frei; abgebrochen (Scheibe 3 E4): nur frei
    // 1.8: Abgriff erz/1..3 (rec_tap) nach den Loop-Boxen, vor dem Mixer; Einsatz und Ende kommen aus dem Arrangement
    // S2a: the external pairs ein_1..4 of this sub-block (the JACK buffers of the cycle plus the sub-block offset); nullptr = the pair has no port
    const float* el[EIN_PAARE];
    const float* er[EIN_PAARE];
    for (int k = 0; k < EIN_PAARE; ++k) {
      const float* pl = ein_bank_.links(k + 1);
      const float* pr = ein_bank_.rechts(k + 1);
      el[k] = pl ? pl + off : nullptr;
      er[k] = pr ? pr + off : nullptr;
    }
    auto rec_abgriff = [&](const float* const* tl, const float* const* tr) {
      const int rst0 = aufnahme_.status();
      if (sw_->ki_gestoppt()) aufnahme_.ki_stopp(s0);
      aufnahme_.block(s0, m, rec_arr_lage(), tl, tr, el, er);
      if (rst0 != 0 && aufnahme_.status() == 0) arr_->live_alle_aus(s0 + m);   // 1.8 T7b: the run is over (end, abort): held live keys end with it
      rec_meldungen(karte);
    };
#ifndef CYPHERDJ_MUTATION_REC_TAP_NACH_MIXER
    {
      const float* tl[REC_ABGRIFFE];   // S18: one entry per code of REC_CODES (erz/1..3, erz/5..7, pad/1..2), before the fader
      const float* tr[REC_ABGRIFFE];
      for (int i = 0; i < REC_ABGRIFFE; ++i) {
#ifdef CYPHERDJ_MUTATION_REC_PAD_VERTAUSCHT
        const int mi = i == 6 ? 13 : i == 7 ? 12 : REC_MIXER[i];   // mutation: pad/1 and pad/2 swapped
#else
        const int mi = REC_MIXER[i];
#endif
        tl[i] = erz_l_[mi];
        tr[i] = erz_r_[mi];
      }
      rec_abgriff(tl, tr);
    }
#endif
    mixer_->fx_takt(karte.beat_at((double)s0), karte.bpm_at((double)s0) / 60.0 / 48000.0);  // Plan 3: LFO aus dem Beat
    {   // voice channel (voice.h): the input pair ein_<k> of this sub-block into the mixer, which sums it in front of the limiter
#ifdef CYPHERDJ_MUTATION_STIMME_IMMER_AN
      const int k = mixer_->stimme().an() ? mixer_->stimme().eingang() : 4;   // error case: pair 4 always reaches the mixer
#else
      const int k = mixer_->stimme().an() ? mixer_->stimme().eingang() : 0;
#endif
      const float* vl = ein_bank_.l(k);
      const float* vr = ein_bank_.r(k);
      if (vl && vr) {
        std::memcpy(mixer_->stimme_eingang_l(), vl + off, sizeof(float) * static_cast<size_t>(m));
        std::memcpy(mixer_->stimme_eingang_r(), vr + off, sizeof(float) * static_cast<size_t>(m));
      }
    }
    mixer_->verarbeite(m, links_ + off, rechts_ + off, cue_l_ + off, cue_r_ + off);
    {  // Baukasten S3c: abgelöste Kanal-Graphen zur Freigabe in den Netz-Faden (dasselbe Ereignis wie beim Erzeuger)
#ifndef CYPHERDJ_MUTATION_KANAL_GRAPH_NICHT_ABHOLEN
      CypherBk* frei[Mixer::MIX_BK_FREI];
      for (int nf; (nf = mixer_->bk_frei(frei, Mixer::MIX_BK_FREI)) > 0;)
        for (int i = 0; i < nf; ++i) {
          bk_zurueck(frei[i], s0);
#ifdef CYPHERDJ_MUTATION_KANAL_GRAPH_DOPPELT
          bk_zurueck(frei[i], s0);  // Fehlerfall: derselbe Zeiger zweimal gemeldet, der Netz-Faden gäbe ihn zweimal frei
#endif
        }
#endif
    }
    limiter_beobachten(s0, m);
#ifdef CYPHERDJ_MUTATION_REC_TAP_NACH_MIXER
    {  // Fehlerfall (AK4): der Abgriff hinter dem Mixer, mit Fader und Limiter
      const float* tl[REC_ABGRIFFE];
      const float* tr[REC_ABGRIFFE];
      for (int i = 0; i < REC_ABGRIFFE; ++i) { tl[i] = links_ + off; tr[i] = rechts_ + off; }
      rec_abgriff(tl, tr);
    }
#endif
    huellen_block(s0, m, cue_l_ + off, cue_r_ + off);  // Ohr (§6.2): Mess-Abgriff vor dem Fader
    decks_verlauf_ende(m);  // Scheibe 31
    ereignisse_uebernehmen();
    off += m;
  }
}

// Ohr (§6.2): je Block ein Datensatz je vollendetem 48-Sample-Fenster, für alle 16 Kanäle. Belegt heißt: Deck k<4
// geladen; erz/1..3, pad/1, pad/2, master, cue immer; erz/4 immer (D1 K1: Summe der Produktion); erz/5..8 nie. Der Master-Analysator
// (immer belegt) bestimmt die Fenster; leere Kanäle schreiben Nullen, damit ihre Fenster bündig liegen, sobald sie
// belegt werden. Echtzeit: keine Allokation, kein I/O.
void Kern::huellen_block(int64_t s0, int m, const float* cue_l, const float* cue_r) {
  if (!huellen_) return;
  constexpr int HK = HUELLEN_KANAELE;  // Ring hat 16 Kanäle, der Mixer 18 (Busse 14..17 gehören nicht in den Ring)
  if (huellen_naechstes_s0_ != s0) {  // M1: Sample-Sprung (SET_NEU, Neustart) — alle 16 neu ausrichten
    for (int c = 0; c < HK; ++c) huellen_an_[c]->zuruecksetzen(s0);
  }
  huellen_naechstes_s0_ = s0 + m;

  constexpr int kMaxFenster = HUELLEN_MAX_FENSTER;
  using cypherdj::dsp::HuellenWerte;
  HuellenWerte(&hw)[HK][kMaxFenster] = huellen_werte_;
  int n[HK];
  bool belegt[HK];
  const float* l[HK];
  const float* r[HK];
  for (int c = 0; c < HK; ++c) {
    if (c < 4) belegt[c] = decks_->deck[c].geladen();
    else if (c <= 6) belegt[c] = true;    // erz/1..3 (Studio S1)
    else if (c == arr_kanal_) belegt[c] = true;  // D1 K1 (Spec 2.3): erz/4 = Summe der Produktion
    else if (c <= 11) belegt[c] = false;  // erz/5..8: nie
    else belegt[c] = true;                // pad/1, pad/2, master, cue: immer
  }
  for (int c = 0; c < 14; ++c) {
    l[c] = mixer_->kanalzug(c).abgriff(0);
    r[c] = mixer_->kanalzug(c).abgriff(1);
  }
  l[14] = mixer_->master_summe_l();
  r[14] = mixer_->master_summe_r();
  l[15] = cue_l;
  r[15] = cue_r;
  for (int c = 0; c < HK; ++c) {
    if (belegt[c]) n[c] = huellen_an_[c]->verarbeite(l[c], r[c], m, hw[c], kMaxFenster);
    else {
      huellen_an_[c]->zuruecksetzen(s0 + m);
      n[c] = 0;
    }
  }
  const Karte& karte = plan_.karte();
  const int fenster = n[14];  // master ist immer belegt, bestimmt die Fenster
  for (int i = 0; i < fenster; ++i) {
    const uint64_t r_idx = cdj_lade(&huellen_->w);
    const int64_t sample = s0 + hw[14][i].ende_offset;
    const double beat = karte.beat_at((double)sample);
    for (int c = 0; c < HK; ++c) {
      cdj_huellen_satz* satz = cdj_huellen_ort(huellen_, r_idx, c);
      satz->sample = sample;
      satz->beat = beat;
      satz->reserve[0] = satz->reserve[1] = 0.0f;
      if (belegt[c] && i < n[c]) {
        satz->quell_beat = (c < 4) ? decks_->deck[c].quell_beat_bei(sample) : std::numeric_limits<double>::quiet_NaN();
        std::memcpy(satz->band, hw[c][i].band, sizeof(satz->band));
        satz->k_leistung = hw[c][i].k_leistung;
        satz->spitze = hw[c][i].spitze;
      } else {
        satz->quell_beat = std::numeric_limits<double>::quiet_NaN();
        std::memset(satz->band, 0, sizeof(satz->band));
        satz->k_leistung = 0.0f;
        satz->spitze = 0.0f;
      }
    }
    cdj_setze(&huellen_->w, r_idx + 1);
  }
}

void Kern::ereignisse_uebernehmen() {
  const sw::Ereignis* ev;
  const int ne = sw_->ereignisse(&ev);
  const sw::ReglerTabelle& tab = sw_->tabelle();
  const Karte& karte = plan_.karte();
  for (int i = 0; i < ne; ++i) {
    const sw::Ereignis& s = ev[i];
    const double beat = karte.beat_at((double)s.sample);
    if (s.art == sw::EreignisArt::quittung) {
      const char* qn = sw::name(s.quelle);
      const int st = static_cast<int>(s.status);
      if (schatten_.quittung(s.id, qn, st, s.sample, beat)) continue;  // Neustart: schon gemeldet
      if (s.id == ki_spur_id_ && st == 3) {   // E3 P1: die Kanal-Liste in Normalform, nicht der letzte Text
        sw_->ki_spur_text(ki_spur_, sizeof ki_spur_);
        ki_spur_id_ = 0;
      }
      quittung(s.id, qn, st, s.sample, beat, sw::name(s.grund));
      continue;
    }
    Ereignis x{};
    x.sample = s.sample;
    x.beat = beat;
    switch (s.art) {
      case sw::EreignisArt::regler:
        x.art = Ereignis::REGLER;
        kopiere(x.pfad, tab.def(s.regler).pfad, sizeof x.pfad);
        x.wert = s.wert;
        kopiere(x.text, s.halter, sizeof x.text);
        break;
      case sw::EreignisArt::hand:
        x.art = Ereignis::HAND;
        kopiere(x.pfad, tab.def(s.regler).pfad, sizeof x.pfad);
        x.wert = s.wert;
        break;
      case sw::EreignisArt::halter:
        x.art = Ereignis::HALTER;
        kopiere(x.pfad, tab.def(s.regler).pfad, sizeof x.pfad);
        kopiere(x.text, s.halter, sizeof x.text);
        break;
      case sw::EreignisArt::ki:
        x.art = Ereignis::KI;
        x.status = s.gestoppt ? 1 : 0;
        kopiere(x.grund, sw::name(s.grund), sizeof x.grund);
        break;
      case sw::EreignisArt::invariante:
        x.art = Ereignis::INVARIANTE;
        kopiere(x.grund, sw::name(s.inv), sizeof x.grund);
        kopiere(x.text, s.plan, sizeof x.text);
        x.teil = s.teil;
        break;
      default:
        continue;
    }
    melde(x);
  }
  sw_->ereignisse_leeren();
}

// Zweiter Zyklus einer fortgesetzten Generation (core_state.cpp setzt nachreichen_in_): das Stellwerk steht jetzt auf
// dem Anfang dieses Zyklus, verspätet heißt also dasselbe wie ohne Neustart. KI-Spur und KI-Stopp, Halter der Hand,
// dann die Teile: wartende wie eingereicht, laufende ab jetzt auf ihrer Kurve bis zum unveränderten Ende-Beat.
void Kern::teile_nachreichen() {
  const Karte& karte = plan_.karte();
  const int64_t s = sample_;
  const double b = karte.beat_at((double)s);
  if (ki_spur_[0]) sw_->ki_spur(0, sw::Quelle::leitstand, ki_spur_);
  if (ki_stopp_wieder_) sw_->ki_stopp(0, sw::Quelle::andreas);
  ki_stopp_wieder_ = false;
  for (int i = 0; i < n_mensch_wieder_; ++i)
    sw_->hand(sw::Griff{s, mensch_wieder_[i], sw::GriffArt::beruehrung, 0.0f, nullptr});
#ifndef CYPHERDJ_MUTATION_ARR_AUTO_UEBER_NACHREICHEN_GRIFF
  nachreichen_sperre_ = n_mensch_wieder_ > 0;   // 1.12 S3: these touches restore a holder, they are no grips (no pickup, no override)
#endif
  n_mensch_wieder_ = 0;
  const sw::ReglerTabelle& tab = sw_->tabelle();
  for (int i = 0; i < TeilSchatten::MAX; ++i) {
    SchattenTeil* t = schatten_.teil(i);
    if (!t->belegt || !t->wieder) continue;
    const int r = tab.suche(t->pfad);
    if (r < 0) {
      schatten_.entferne(t);
      continue;
    }
    sw::TeilBefehl tb{t->id, quelle_von(t->quelle), t->plan, t->nr, t->pfad, t->ab_beat, t->dauer_beats, t->nach,
                      t->form, t->politik, t->gruppe, t->hoerschein};
    if (t->wieder == 2) {  // lief: ab jetzt auf der Kurve weiter, Politik 1 (nie verworfen, Ende-Beat bleibt)
      const double ende = t->ab_beat + t->dauer_beats;
      const bool db = tab.def(r).db;
      if (t->dauer_beats > 0.0 && b >= ende) {  // im Ausfall zu Ende gelaufen
        sw_->setze_direkt(r, static_cast<float>(fortsetzwert(*t, db, b)));
        quittung(t->id, t->quelle, 3, std::llround(karte.sample_at(ende)), ende);
        schatten_.entferne(t);
        continue;
      }
      if (t->dauer_beats > 0.0) {
        sw_->setze_direkt(r, static_cast<float>(fortsetzwert(*t, db, b)));
        t->dauer_beats = ende - b;
        t->ab_beat = b;
      } else {
        t->ab_beat = b;  // Setzen: die Schaltrampe beginnt neu vom Ist-Wert
      }
      tb.ab_beat = t->ab_beat;
      tb.dauer_beats = t->dauer_beats;
      tb.politik = 1;
    }
    sw_->teil(tb);
  }
}

}  // namespace cdj
