// Scheibe 35 (Teil A, MVP): Kern-Hand (INTERFACES §2 Hand, §5.8, §7.1 bis §7.3, §17 „Die Hand (MIDI) wird nie
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

void Kern::setze_lern_mapping(const hand::Mapping* m) noexcept {
  lern_mapping_ = m;
  hand_ein_.mapping_ein(m);
}

// I08: die in midi_ein() gesammelten Ereignisse dieses Zyklus mit dem Kern-Sample der Achse stempeln (nach dem Einsortieren, also nach einem
// /k/set/neu auf der neuen Achse) und, wenn kein anderer Leser eingetragen ist, den Ring räumen (nur der Kern ist dann Leser).
// S19: with a learn table (slot 1) the same events are translated as well; the raw ring keeps receiving every event.
void Kern::midi_ein_stempeln(int n) noexcept {
#ifndef CYPHERDJ_MUTATION_LERN_OHNE_FRIST  // failure case S19: the capture never times out
  if (lern_an_ && (lern_rest_ -= n) <= 0) lern_an_ = false;
#endif
  for (int i = 0; i < n_midi_ein_; ++i) {
    const MidiRoh& m = midi_ein_roh_[i];
    midi_ein_.schiebe(sample_, m.versatz, m.d, m.groesse);
    // S19 capture: the first 3-byte CC after arming is reported and consumed (also without a learn table)
    if (lern_an_ && m.groesse == 3 && (m.d[0] & 0xF0) == 0xB0) {
      lern_melden(1, m.d, m.versatz);
#ifndef CYPHERDJ_MUTATION_LERN_WEITERGEREICHT  // failure case S19: reported but also translated
      continue;
#endif
    }
    if (!lern_mapping_) continue;
#ifdef CYPHERDJ_MUTATION_LERN_ALLOKIERT  // failure case S19: one allocation per translated event in the realtime path
    { int* p = new int(i); asm volatile("" : : "r"(p) : "memory"); delete p; }
#endif
    HandAktion a;
    if (!hand_ein_.ereignis_ein(m.d, m.groesse, m.versatz, sample_, static_cast<uint32_t>(n), *sw_, &a)) {
      ++lern_ohne_wirkung_;
      continue;
    }
    hand_aktion(a, &lern_ereignisse_, &lern_ohne_wirkung_);
  }
  n_midi_ein_ = 0;
#ifndef CYPHERDJ_MUTATION_EIN_MIDI_OHNE_ABFLUSS  // Fehlerfall: niemand leert den Ring, nach 4096 Ereignissen zählt jedes weitere als verloren
  if (!midi_ein_extern_.load(std::memory_order_relaxed)) {
    MidiEinEreignis e;
    while (midi_ein_.hole(e)) {}
  }
#endif
}

void Kern::hand_zyklus(int64_t n0, int n) {
  if (neu_verbunden_.exchange(false, std::memory_order_acq_rel)) sw_->stellung_vergessen();  // §7.3 Punkt 2
  HandAktion a;
  for (int i = 0; i < n_midi_; ++i) {
    const MidiRoh& m = midi_[i];
    // S19 capture: a CC on hand_in is reported (the user picked the wrong input) but not consumed
    if (lern_an_ && m.groesse == 3 && (m.d[0] & 0xF0) == 0xB0) lern_melden(0, m.d, m.versatz);
    if (!hand_ein_.ereignis(m.d, m.groesse, m.versatz, n0, static_cast<uint32_t>(n), *sw_, &a)) {
#ifdef CYPHERDJ_MUTATION_LERN_AUCH_HAND_IN  // failure case S19: hand_in events without an entry in slot 0 reach the learn table
      if (lern_mapping_ && hand_ein_.ereignis_ein(m.d, m.groesse, m.versatz, n0, static_cast<uint32_t>(n), *sw_, &a)) {
        hand_aktion(a, &lern_ereignisse_, &lern_ohne_wirkung_);
        continue;
      }
#endif
      ++hand_ohne_wirkung_;
      continue;
    }
    hand_aktion(a, &hand_ereignisse_, &hand_ohne_wirkung_);
  }
  n_midi_ = 0;
}

// S19: report a captured CC as GELERNT and disarm. belegt: the base mapping (slot 0) already uses this CC.
void Kern::lern_melden(int quelle, const uint8_t* d, uint32_t versatz) noexcept {
  const int kanal = (d[0] & 0x0F) + 1, nr = d[1] & 0x7F;
  Ereignis x{};
  x.art = Ereignis::GELERNT;
  x.sample = sample_ + versatz;
  x.id = lern_id_;
  x.deck = quelle;
  x.fassung = kanal;
  x.teil = nr;
  x.neu = d[2] & 0x7F;
#ifndef CYPHERDJ_MUTATION_LERN_OHNE_BELEGT  // failure case S19: a CC of the base mapping is not flagged
  x.status = mapping_ && hand::suche(*mapping_, hand::NachrichtTyp::cc, kanal, nr) >= 0 ? 1 : 0;
#endif
  melde(x);
#ifndef CYPHERDJ_MUTATION_LERN_DAUERHAFT  // failure case S19: stays armed after the report
  lern_an_ = false;
#endif
}

// The effect of one translated action (shared by slot 0 and slot 1); mit/ohne are the counters of the calling slot.
void Kern::hand_aktion(const HandAktion& a, uint64_t* mit, uint64_t* ohne) {
  switch (a.art) {
    case HandArt::griff:  // §7.3 Punkte 1 bis 3: das Stellwerk entscheidet am Sample des Griffs
      if (hand_.rein(HandGriff{a.griff.sample, a.griff.regler, a.griff.x, static_cast<uint8_t>(a.griff.art),
                                a.griff.kurve}))
        ++*mit;
      else
        ++*ohne;
      break;
    case HandArt::deck:  // Scheibe 35 Teil A: play und cue (Plan 35 E3, E4); der Rest der Deck-Tasten kommt mit Teil B
      if ((a.aktion == hand::DeckAktion::play || a.aktion == hand::DeckAktion::cue) &&
          hand_deck(a.deck, a.aktion, a.quant, a.wert, a.sample))
        ++*mit;
      else
        ++*ohne;
      break;
    case HandArt::taste:  // §5.8 /e/taste für jede Taste; die Stopp-Taste wirkt wie /k/ki/stopp (§7.3 Punkt 8, E6)
      hand_taste(a.taste, a.wert, a.sample);
      break;
    case HandArt::arr:  // D1 K1 (§7.2): Transport des Arrangements, vom Kern selbst ausgeführt
      if (arr_hand_start_stopp(a.sample)) ++*mit;
      else ++*ohne;
      break;
    case HandArt::tempo:  // §7.3 Punkt 7: Hand-Tempo kommt mit Scheibe 51
      ++*ohne;
      break;
  }
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
  if (!m) return 0;
  const double q = erste_volle_eins(static_cast<double>(m->erste_eins_quell_beat), dk.schlag0(), m->basis_bpm);
  return std::llround(frame_von(q, dk.schlag0(), m->basis_bpm));
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
