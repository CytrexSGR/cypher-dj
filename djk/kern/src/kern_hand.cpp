// Scheibe 35 (Teil A, MVP): Kern-Hand (SCHNITTSTELLEN §2 Hand, §5.8, §7.1 bis §7.3, §17 „Die Hand (MIDI) wird nie
// blockiert“; ADR 014, ADR 023 Punkt 2). Die MIDI-Ereignisse eines Zyklus kommen roh über hand_midi() herein und werden
// in zyklus() nach dem Einsortieren der Befehle mit dem Blockanfang übersetzt (hand_ein.h, Plan 35 E1): Griffe gehen mit
// ihrem Sample in die Hand-Schlange (Scheibe 25) und von dort ins Stellwerk, das erster Wert, Totzone, Übernahme und
// Halter am selben Sample entscheidet. Echtzeitfest: keine Allokation, keine Sperre, kein I/O.
#include <cmath>
#include <cstring>

#include "cypherdj/kern.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;

namespace {
void kopiere_text(char* ziel, size_t n, const char* q) {
  size_t i = 0;
  for (; i + 1 < n && q && q[i]; ++i) ziel[i] = q[i];
  ziel[i] = '\0';
}
}  // namespace

void Kern::setze_mapping(const hand::Mapping* m) noexcept {
  mapping_ = m;
  hand_ein_.mapping(m);
}

void Kern::hand_midi(const uint8_t* daten, size_t groesse, uint32_t versatz) noexcept {
  if (n_midi_ >= MAX_MIDI) {  // Plan 35: höchstens 256 je Zyklus, Überlauf gezählt
    ++hand_ueberlauf_;
    return;
  }
  if (groesse == 0 || groesse > 3) {  // Hand-Nachrichten (Note, CC) haben 3 Bytes; SysEx und Echtzeit-Bytes nicht
    ++hand_ohne_wirkung_;
    return;
  }
  MidiRoh& m = midi_[n_midi_++];
  std::memcpy(m.d, daten, groesse);
  m.groesse = static_cast<uint8_t>(groesse);
  m.versatz = versatz;
}

void Kern::hand_zyklus(int64_t n0, int n) {
  if (neu_verbunden_.exchange(false, std::memory_order_acq_rel)) sw_->stellung_vergessen();  // §7.3 Punkt 2
  HandAktion a;
  for (int i = 0; i < n_midi_; ++i) {
    const MidiRoh& m = midi_[i];
    if (!hand_ein_.ereignis(m.d, m.groesse, m.versatz, n0, static_cast<uint32_t>(n), *sw_, &a)) {
      ++hand_ohne_wirkung_;
      continue;
    }
    switch (a.art) {
      case HandArt::griff:  // §7.3 Punkte 1 bis 3: das Stellwerk entscheidet am Sample des Griffs
        if (hand_.rein(HandGriff{a.griff.sample, a.griff.regler, a.griff.x, static_cast<uint8_t>(a.griff.art),
                                  a.griff.kurve}))
          ++hand_ereignisse_;
        else
          ++hand_ohne_wirkung_;
        break;
      case HandArt::deck:  // Scheibe 35 Teil A: play und cue (Plan 35 E3, E4); der Rest der Deck-Tasten kommt mit Teil B
        if ((a.aktion == hand::DeckAktion::play || a.aktion == hand::DeckAktion::cue) &&
            hand_deck(a.deck, a.aktion, a.quant, a.wert, a.sample))
          ++hand_ereignisse_;
        else
          ++hand_ohne_wirkung_;
        break;
      case HandArt::taste:  // §5.8 /e/taste für jede Taste; die Stopp-Taste wirkt wie /k/ki/stopp (§7.3 Punkt 8, E6)
        hand_taste(a.taste, a.wert, a.sample);
        break;
      case HandArt::tempo:  // §7.3 Punkt 7: Hand-Tempo kommt mit Scheibe 51
        ++hand_ohne_wirkung_;
        break;
    }
  }
  n_midi_ = 0;
}

namespace {
}

bool Kern::hand_taste(hand::Taste t, int32_t wert, int64_t s) noexcept {
  Ereignis x{};
  x.art = Ereignis::TASTE;
  x.sample = s;
  x.beat = plan_.karte().beat_at(static_cast<double>(s));
  x.status = wert;
  kopiere_text(x.pfad, sizeof x.pfad, hand::name(t));
  melde(x);
  if (t == hand::Taste::stopp) {
#ifndef CYPHERDJ_MUTATION_HAND_STOPP_MELDEN  // Fehlerfall Plan 35 Task 6: Stopp nur melden, kein ki_stopp
    sw_->ki_stopp(0, sw::Quelle::andreas);  // wirkt ab dem Anfang dieses Zyklus (früher ist beim Stopp die sichere Seite)
#endif
  }
  ++hand_ereignisse_;
  return true;
}

// Frame des Beats im Raster des Decks, der f am nächsten liegt (Quantize für Play und Cue der Hand; Plan Grid: mit Versatz).
static int64_t auf_beat(const Deck& dk, int64_t f) noexcept {
  const Material& m = *dk.material();
  const double q = quell_beat_von(static_cast<double>(f), dk.schlag0(), m.basis_bpm);
  return std::llround(frame_von(std::round(q), dk.schlag0(), m.basis_bpm));
}

int64_t Kern::cue_frame(int d) const noexcept {
  const DeckWerk& w = *decks_;
  if (w.cue_gesetzt[d]) return w.cue_f[d];
  const Deck& dk = w.deck[d];
  const Material* m = dk.material();
  return m ? std::llround(frame_von(static_cast<double>(m->erste_eins_quell_beat), dk.schlag0(), m->basis_bpm)) : 0;
}

DeckAktion* Kern::hand_aktion_neu(int d, int art, int64_t s, int64_t f) {
  DeckWerk& w = *decks_;
  for (DeckAktion& x : w.aktion)
    if (!x.belegt) {
      x = DeckAktion{};
      x.belegt = true;
      x.hand = true;
      x.art = static_cast<uint8_t>(art);
      x.politik = 1;  // nie „zu spät“ abbrechen: was vor dem Blockrest liegt, läuft am Blockrest
      x.deck = d + 1;
      x.seq = ++w.seq;
      x.ziel_sample = s;
      x.ziel_frame = f;
      return &x;
    }
  return nullptr;  // 64 wartende Deck-Aktionen: die Taste bleibt ohne Wirkung
}

bool Kern::hand_deck_taste(int deck, bool play, int32_t wert, int64_t s) noexcept {
  // /test/hand (Plan 35 E5 a): Bezugssample max(sample, Zyklusanfang), quant beat (MVP.md: „Start auf dem Beat“)
  return hand_deck(deck, play ? hand::DeckAktion::play : hand::DeckAktion::cue, hand::Quant::beat, wert,
                   s < sample_ ? sample_ : s);
}

// Play und Cue am Sample s (Plan 35 E3 und E4). Der Zustand des Decks ist der am Anfang des Zyklus; wartende Aktionen
// der Hand werden mitgeführt (ein zweiter Druck vor einem wartenden Start nimmt ihn zurück).
bool Kern::hand_deck(int deck, hand::DeckAktion aktion, hand::Quant quant, int32_t wert, int64_t s) {
  if (deck < 1 || deck > DECKS) return false;
  DeckWerk& w = *decks_;
  const int d = deck - 1;
  Deck& dk = w.deck[d];
  const bool play = aktion == hand::DeckAktion::play;
  if (!dk.geladen()) return false;
  const Karte& k = plan_.karte();
  if (wert == 0) {  // Loslassen: nur Cue in der Vorschau wirkt (halten, zurück zum Cue-Punkt)
    if (play || !w.vorschau[d]) return false;
    w.vorschau[d] = false;
    return hand_aktion_neu(d, 4, s, 0) != nullptr;
  }
  sw_->deck_taste(deck, s);  // §7.3 Punkt 5: jede Transport-Taste setzt den Deck-Halter für 32 Beats
  // Plan E9, Review F1: eine Transport-Taste verwirft wartende Sprünge, Hotcues und Loops dieses Decks; ihr Delta galt
  // für den Zustand vor der Taste (gemessen: Deck 14,6 Beats neben dem Ziel)
  for (DeckAktion& x : w.aktion)
    if (x.belegt && !x.hand && x.deck == deck && x.art >= 5 && x.art <= 7) {
      quittung(x.id, x.quelle, 7, sample_, plan_.karte().beat_at(static_cast<double>(sample_)), "abbruch");
      x.belegt = false;
    }
  const int64_t pos = dk.position();
  if (play) {
    if (w.vorschau[d]) {  // Play in der Cue-Vorschau: das Deck bleibt an (CDJ)
      w.vorschau[d] = false;
      return true;
    }
    for (DeckAktion& x : w.aktion)  // wartender Start der Hand: zweiter Druck nimmt ihn zurück
      if (x.belegt && x.hand && x.deck == deck && x.art == 1) {
        x.belegt = false;
        return true;
      }
    if (dk.laeuft()) {  // anhalten: 10-ms-Rampe; der Loop bleibt (Pause, Review F2)
      DeckAktion* x = hand_aktion_neu(d, 2, s, 0);
      if (x) x->loop_halten = true;
      return x != nullptr;
    }
  } else {
    if (dk.laeuft()) {  // Cue laufend: anhalten, nach der Rampe auf den Cue-Punkt
      w.vorschau[d] = false;
      return hand_aktion_neu(d, 4, s, 0) != nullptr;
    }
    const int64_t pos_q = auf_beat(dk, pos);  // Quantize: der Cue-Punkt sitzt immer auf einem Beat des Tracks
    if (pos_q != cue_frame(d)) {  // stehend anderswo: neuer Cue-Punkt
      w.cue_f[d] = pos_q;
      w.cue_gesetzt[d] = true;
      return true;
    }
    w.vorschau[d] = true;  // stehend am Cue-Punkt: Vorschau ab dem Cue-Punkt, solange gedrückt
    return hand_aktion_neu(d, 1, s, cue_frame(d)) != nullptr;
  }
  // Play auf stehendem Deck, bei jedem Master-Tempo: seit Keylock in Echtzeit (ADR 029, 2026-10-08) folgt das Deck jedem
  // Tempo wie der Cypher-Start (/k/deck/start). Die alte Sperre „nur beim Tempo der Basis“ (Plan 31 F8, kein Stretcher im
  // MVP) liess Andreas nach jeder BPM-Änderung kein gestopptes Deck mehr starten (gemessen 2026-10-09 bei 135 BPM).
  // Während einer laufenden Tempo-Rampe bleibt Play ohne Wirkung: die Phase am Ziel-Beat wäre noch nicht bestimmt.
  const Material* m = dk.material();
  if (plan_.eintraege() > 0) return false;
  const double master = k.beat_at(static_cast<double>(s));
#ifdef CYPHERDJ_MUTATION_HAND_OHNE_PHASE
  // Fehlerfall Plan 35 Task 5: „Start sofort ohne Phase“: am Griff, am Frame der Position, gleich welche Quantisierung
  return hand_aktion_neu(d, 1, s, pos) != nullptr;
#endif
  if (quant == hand::Quant::sofort) {  // phasentreu: der Frame nahe der Position, dessen Beat-Phase die des Masters ist
    const double phi = master - std::floor(master);
    const double q_pos = quell_beat_von(static_cast<double>(pos), dk.schlag0(), m->basis_bpm);
    const double q = std::round(q_pos - phi) + phi;
    DeckAktion* x = hand_aktion_neu(d, 1, s, std::llround(frame_von(q, dk.schlag0(), m->basis_bpm)));
    if (x) x->loop_halten = true;
    return x != nullptr;
  }
  const double schritt = quant == hand::Quant::takt ? 4.0 : 1.0;  // nächster erreichbarer Beat bzw. Takt-Eins des Masters
  double b = schritt * std::ceil(master / schritt - 1e-9);
  int64_t ss = std::llround(k.sample_at(b));
  while (ss < s) {
    b += schritt;
    ss = std::llround(k.sample_at(b));
  }
  // Quantize wie am CDJ: gestartet wird vom nächsten Beat des Tracks, sonst läuft ein mitten im Track gestopptes Deck
  // um den Bruchteil versetzt zum Master (Befund 2026-09-27, Andreas: „nicht mehr sync“).
#ifndef CYPHERDJ_MUTATION_HAND_START_SPAET
  DeckAktion* x = hand_aktion_neu(d, 1, ss, auf_beat(dk, pos));
#else
  // Fehlerfall der Prüfung 2.3 (M1): Hand-Start 5000 Samples zu spät, phasentreu (die Klicks bleiben auf dem Raster)
  DeckAktion* x = hand_aktion_neu(d, 1, ss + 5000, auf_beat(dk, pos) + 5000);
#endif
  if (x) x->loop_halten = true;   // Play nach Pause: der Loop bleibt (Review F2)
  return x != nullptr;
}

void Kern::hand_ausfuehren(DeckAktion& a, int64_t s) {
  DeckWerk& w = *decks_;
  const int d = a.deck - 1;
  Deck& dk = w.deck[d];
  if (!dk.geladen()) return;
  const Karte& k = plan_.karte();
  switch (a.art) {
    case 1: {  // Start am Sample s mit Frame ziel_frame
      dk.start(s, a.ziel_frame, a.loop_halten, a.seq);  // Keylock 6a: Schlüssel eines geplanten Starts
      if (w.stopp_offen[d]) quittung(w.stopp_id[d], w.stopp_quelle[d], 3, s, k.beat_at(static_cast<double>(s)));
      w.stopp_offen[d] = false;
      w.frist_gemeldet[d] = 0;
      const double rest = dk.beats_bis_ende_bei(s);
      static const double FRIST[4] = {128.0, 64.0, 32.0, 16.0};
      for (int i = 0; i < 4; ++i)
        if (rest <= FRIST[i]) w.frist_gemeldet[d] |= static_cast<uint8_t>(1u << i);
      break;
    }
    case 2:  // anhalten mit der 10-ms-Rampe
      dk.stopp(s, a.loop_halten);
      break;
    case 3:  // Position setzen, wenn das Deck inzwischen steht
      if (!dk.laeuft()) dk.setze_position(a.ziel_frame);
      break;
    case 4: {  // anhalten, nach der Rampe auf den Cue-Punkt
      const int64_t ende = dk.stopp(s);
      if (ende > s) hand_aktion_neu(d, 3, ende, cue_frame(d));
      else dk.setze_position(cue_frame(d));
      break;
    }
    default: break;
  }
}

}  // namespace cdj
