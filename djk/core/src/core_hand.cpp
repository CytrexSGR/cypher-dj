// Scheibe 35 (Teil A, MVP): Kern-Hand (INTERFACES §2 Hand, §5.8, §7.1 bis §7.3, §17 „Die Hand (MIDI) wird nie
// blockiert“; ADR 014, ADR 023 Punkt 2). Die MIDI-Ereignisse eines Zyklus kommen roh über hand_midi() herein und werden
// in zyklus() nach dem Einsortieren der Befehle mit dem Blockanfang übersetzt (hand_in.h, Plan 35 E1): Griffe gehen mit
// ihrem Sample in die Hand-Schlange (Scheibe 25) und von dort ins Stellwerk, das erster Wert, Totzone, Übernahme und
// Halter am selben Sample entscheidet. Echtzeitfest: keine Allokation, keine Sperre, kein I/O.
#include <cmath>
#include <cstring>

#include "cypherdj/core.h"
#include "hand/led.h"

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
  led_neu_.store(true, std::memory_order_release);  // B3: the new mapping's LEDs are all unknown to the device
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

int Kern::led_zustand(const char* name) const noexcept {
  const int e = led_kern_eigen(name);
  if (e == 0) return sw_->ki_gestoppt() ? 1 : 0;
  if (e > 0) return decks_ && decks_->deck[e - 1].loop_aktiv() ? 1 : 0;
  for (int i = 0; i < n_led_ext_; ++i)
    if (std::strcmp(led_ext_[i].name, name) == 0) return led_ext_[i].zustand;
  return 0;
}

int Kern::hand_led_hole(uint8_t (*aus)[3], int max) noexcept {
  const bool alle = led_neu_.exchange(false, std::memory_order_acq_rel);
  const hand::Mapping* m = mapping_;
  if (!m) return 0;
  if (alle)
    for (int i = 0; i < hand::MAX_LEDS; ++i) led_gesendet_[i] = -1;
  if (max > LED_MAX_JE_ZYKLUS) max = LED_MAX_JE_ZYKLUS;
  int n = 0;
  for (int i = 0; i < m->n_leds && n < max; ++i) {
    const int z = led_zustand(m->led[i].name);
#ifndef CYPHERDJ_MUTATION_LED_FLUT  // failure case B3: every LED goes out in every cycle
    if (z == led_gesendet_[i]) continue;
#endif
    if (hand::led_nachricht(*m, m->led[i].name, z, aus[n]) != 3) continue;
    led_gesendet_[i] = static_cast<int8_t>(z);
    ++n;
  }
  return n;
}

void Kern::setze_lern_mapping(const hand::Mapping* m, int port) noexcept {
  if (port < 0 || port >= MIDI_EIN_PORTS) return;
  lern_mapping_[port] = m;
  hand_ein_.mapping_ein(m, port);
}

// I08: die in midi_ein() gesammelten Ereignisse dieses Zyklus mit dem Kern-Sample der Achse stempeln (nach dem Einsortieren, also nach einem
// /k/set/neu auf der neuen Achse) und, wenn kein anderer Leser eingetragen ist, den Ring räumen (nur der Kern ist dann Leser).
// S19: with a learn table (slots 1..8, one per port) the events of that port are translated as well; the raw ring keeps receiving every event.
void Kern::midi_ein_stempeln(int n) noexcept {
#ifndef CYPHERDJ_MUTATION_LERN_OHNE_FRIST  // failure case S19: the capture never times out
  if (lern_an_ && (lern_rest_ -= n) <= 0) lern_an_ = false;
#endif
  {   // 1.8 T7b: a midi_ein went away (any of bits 8..15 of the connection mask fell): a key held on an armed track would never get its off
    const uint32_t vb = ein_verbunden_.load(std::memory_order_relaxed);
    constexpr uint32_t MIDI_BITS = ((1u << MIDI_EIN_PORTS) - 1u) << 8;
    if ((ein_verb_gesehen_ & ~vb & MIDI_BITS) != 0) {
      arr_->live_alle_aus(sample_);
      erz_->tasten_alle_aus();   // Task N2: the keys held on the stream of /k/live/tasten close as well
    }
    ein_verb_gesehen_ = vb;
  }
  aufnahme_.midi_beginn();   // 1.8 T7a: the recorder keeps the events of ONE cycle; this stamping runs before arr_->block and before Aufnahme::block of the cycle
  for (int i = 0; i < n_midi_ein_; ++i) {
    const MidiRoh& m = midi_ein_roh_[i];
    midi_ein_.schiebe(sample_, m.versatz, m.d, m.groesse);
#ifdef CYPHERDJ_MUTATION_MIDI_STEMPEL_BLOCKANFANG
    aufnahme_.midi(sample_, m.d, m.groesse);   // mutation (T7a): the stamp of the take is the cycle start, the offset in the cycle is lost
#else
    aufnahme_.midi(sample_ + static_cast<int64_t>(m.versatz), m.d, m.groesse);   // 1.8 T7a: the same stamp as the ring above (cycle start + JACK offset)
#endif
    if (m.groesse == 3) {   // 1.8 T7b: live notes on every MIDI-armed instrument track, also when nothing records; the stamp is clamped into the first sub-block
      const uint8_t t = m.d[0] & 0xF0;
      if (t == 0x80 || t == 0x90) {
        const int64_t z = Arrangement::live_ziel(sample_, m.versatz, n);
        const bool an = t == 0x90 && m.d[2] != 0;
        for (uint32_t bits = aufnahme_.midi_maske(); bits != 0; bits &= bits - 1) arr_->live_note(__builtin_ctz(bits), z, m.d[1], m.d[2], an);
        // Task N2: the stream of /k/live/tasten (one test of the target when none is set). A note that the learn table of its place maps is a button, not a key: it only triggers its action.
        // (The armed-track path above does not make this distinction and is left as it was.)
        const hand::Mapping* lm = m.port < MIDI_EIN_PORTS ? lern_mapping_[m.port] : nullptr;
        if (!(lm && hand::suche(*lm, hand::NachrichtTyp::note, (m.d[0] & 0x0F) + 1, m.d[1]) >= 0)) erz_->taste(m.d[1], m.d[2], an, z);
      }
    }
    // S19 capture: the first 3-byte CC after arming is reported and consumed (also without a learn table)
    if (lern_an_ && m.groesse == 3 && (m.d[0] & 0xF0) == 0xB0) {
      lern_melden(1 + m.port, m.d, m.versatz);
#ifndef CYPHERDJ_MUTATION_LERN_WEITERGEREICHT  // failure case S19: reported but also translated
      continue;
#endif
    }
#ifdef CYPHERDJ_MUTATION_LERN_PORT_EGAL  // failure case S19: every port is translated with the table of port 1
    const int tp = 0;
#else
    const int tp = m.port;
#endif
    if (!lern_mapping_[tp]) continue;
#ifdef CYPHERDJ_MUTATION_LERN_ALLOKIERT  // failure case S19: one allocation per translated event in the realtime path
    { int* p = new int(i); asm volatile("" : : "r"(p) : "memory"); delete p; }
#endif
    HandAktion a;
    if (!hand_ein_.ereignis_ein(m.d, m.groesse, m.versatz, sample_, static_cast<uint32_t>(n), *sw_, &a, tp)) {
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
      if (lern_mapping_[0] && hand_ein_.ereignis_ein(m.d, m.groesse, m.versatz, n0, static_cast<uint32_t>(n), *sw_, &a)) {
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

// SYNC (CDJ phase meter): the bar phase of deck d follows the deck that is playing, not the clock bar. Shared by the hand
// path (quant takt) and /k/deck/start with takt. Reference = lowest running other deck that is neither stopping (ramp or
// waiting stop) nor in cue preview; there is no master-deck concept in the core, the clock is the tempo source. Its track
// beat advances 1:1 with the clock (keylock), so for a start from track beat q_start at clock sample s_ab the answer is
// aus in [0, 4) beats: start at (clock beat of s_ab) + aus, where
//   (q_start - eins_d) = (q_ref - eins_ref)  (mod 4),  q_ref = the reference's track beat at that clock beat.
// false: no usable reference (the caller keeps the clock bar). O(1), no allocation.
bool Kern::sync_takt_aus(int d, double q_start, int64_t s_ab, double* aus) const noexcept {
  const DeckWerk& w = *decks_;
  const Material* m = w.deck[d].material();
  if (!m) return false;
  const Deck* ref = nullptr;
  for (int e = 0; e < DECKS && !ref; ++e) {
    if (e == d || !w.deck[e].laeuft() || w.deck[e].stoppt() || w.vorschau[e] || !w.deck[e].material()) continue;
    bool stoppt = false;
    for (const DeckAktion& x : w.aktion)
      if (x.belegt && x.deck == e + 1 && x.art == 2) stoppt = true;
    if (!stoppt) ref = &w.deck[e];
  }
  if (!ref) return false;
  const double ziel = q_start - m->erste_eins_quell_beat + ref->material()->erste_eins_quell_beat;
  double v = std::fmod(ziel - ref->quell_beat_bei(s_ab), 4.0);
  if (v < 0.0) v += 4.0;
  if (v > 4.0 - 1e-9) v = 0.0;
  *aus = v;
  return true;
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
  if (quant == hand::Quant::takt) {
    const double q_start = std::round(quell_beat_von(static_cast<double>(pos), dk.schlag0(), m->basis_bpm));
    double aus = 0.0;
    if (sync_takt_aus(d, q_start, s, &aus)) b = master + aus;  // else: the clock bar from above
  }
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
