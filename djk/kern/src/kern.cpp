#include "cypherdj/kern.h"

#include <cmath>
#include <cstring>

#include "cypherdj/pruef_cue.h"

namespace cdj {

Kern::Kern(double start_bpm, cdj_ring_kopf* ring, Befehlsring* befehle, Ereignisring* ereignisse)
    : plan_(start_bpm), ring_(ring), befehle_(befehle), ereignisse_(ereignisse) {
  w_ = cdj_lade(&ring_->w);  // SCHNITTSTELLEN §6.1: beim Start liest der Kern w und setzt fort
  // Ohr T14 (§17 I3a): Deck-Modell und Prüfer vor dem Stellwerk, das ihn als Pointer bekommt (Vorgabe: aus).
  deck_modell_ = std::make_unique<DeckModellImpl>(decks_);
  pruefer_i3_ = std::make_unique<cypherdj::stellwerk::PrueferI3>(hoerschein_reg_, *deck_modell_);
  // Scheibe 25: Stellwerk und Mixer einmal hier (nicht im Callback), der Mixer mit der Regler-Tabelle des Stellwerks
  sw_ = std::make_unique<cypherdj::stellwerk::Stellwerk>(uhr_, pruefer_i3_.get());
  mixer_ = std::make_unique<Mixer>(sw_->tabelle());
  erz_ = std::make_unique<Erzeuger>();  // Plan 2026-09-27: 400 KB, darum hier und nicht im Callback
  for (int k = 0; k < MIX_KANAELE; ++k) {
    erz_l_[k] = mixer_->eingang_l(k);
    erz_r_[k] = mixer_->eingang_r(k);
  }
  loops_ = std::make_unique<LoopBoxen>();  // MVP 2: feste Puffer, darum hier und nicht im Callback
  decks_anlegen();  // Scheibe 31: Decks, Regler-Indizes für offen und hörbar (kern_deck.cpp)
  std::memset(cue_l_, 0, sizeof cue_l_);
  std::memset(cue_r_, 0, sizeof cue_r_);
  // Ohr (§6.2): ein Analysator je Kanal, auf dem Heap (nicht im Callback), zunächst auf Sample 0 ausgerichtet.
  for (int k = 0; k < HUELLEN_KANAELE; ++k) {
    huellen_an_[k] = std::make_unique<cypherdj::dsp::AnalyseBaender>(cypherdj::dsp::vertrag_baender());
    huellen_an_[k]->zuruecksetzen(0);
  }
}

Kern::~Kern() = default;

void Kern::melde(const Ereignis& e) {
  if (!ereignisse_->schiebe(e)) ++verloren_;
}

void Kern::quittung(int64_t id, const char* quelle, int32_t status, int64_t s, double b, const char* grund) {
  Ereignis e{};
  e.art = Ereignis::QUITTUNG;
  e.status = status;
  e.id = id;
  e.sample = s;
  e.beat = b;
  // Scheibe 25: quelle kann ein kurzes Literal sein (stellwerk::name), darum begrenzt kopieren, nicht memcpy über
  // sizeof (ASan: global-buffer-overflow in test_kern_hand); e ist genullt, bleibt also abgeschlossen.
  std::strncpy(e.quelle, quelle, sizeof e.quelle - 1);
  std::strncpy(e.grund, grund, sizeof e.grund - 1);
  melde(e);
}

// Prüfung beim Einsortieren am Blockanfang (§5.1 Status 1 heißt: im Ring und diese Prüfung bestanden)
void Kern::einsortieren(const Befehl& c) {
  const double beat0 = plan_.karte().beat_at((double)sample_);
  switch (c.art) {
    case Befehl::SET_NEU:  // §4.2: Beat 0 am nächsten Zyklus, §1.1: sample 0 ab dort
      if (ein_deck_laeuft()) {  // Scheibe 31, §4.2: abgelehnt, solange ein Deck läuft
        quittung(c.id, c.quelle, 6, sample_, beat0, "deck_laeuft");
        break;
      }
      for (int i = 0; i < plan_.eintraege(); ++i) {  // Rampen der alten Zeitachse enden hier (Befund B6 c im Plan)
        const RampeEintrag& e = plan_.eintrag(i);
        quittung(e.id, e.quelle, 7, sample_, beat0, "abbruch");
      }
      set_neu_teile_ab();  // Scheibe 25: Planteile der alten Zeitachse ebenso
      decks_set_neu();     // Scheibe 31: wartende Deck-Befehle ebenso; geladene Decks bleiben geladen
      erz_->leeren();      // Plan 2026-09-27: Erzeuger-Ereignisse der alten Zeitachse ebenso
      if (Mitschnitt* mt = loops_->leeren()) mitschnitt_melden(mt, 1);  // MVP 2 Scheibe 2: laufender Mitschnitt = abgebrochen
      for (int b = 1; b <= LOOP_BOXEN; ++b) loop_melden(b, sample_, beat0);
      plan_.neu(c.bpm);
      sample_ = 0;
      generation_ = 0;
      takt_letzt_ = takt_vorletzt_ = -1;  // Taktfelder der neuen Zeitachse beginnen bei Beat 0
      neue_zeitachse_ = true;
      quittung(c.id, c.quelle, 1, 0, 0.0);
      quittung(c.id, c.quelle, 2, 0, 0.0);
      break;
    case Befehl::ERZ_STROM: {  // §4.8 /erz/strom mit kit:<name> (ADR 024): das Netz hat geladen und geprüft
      const Kit* alt = erz_->setze_strom(c.nr, static_cast<const Kit*>(c.zeiger), Mixer::kanal_index(c.pfad));
      erz_->setze_midi(c.nr, c.form, c.politik);  // Studio S5: midi:<p>:<c> (form = Port, politik = Kanal); Kit: form 0
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      if (alt) {  // das Netz gibt es frei; der Callback liest es nach dem Tausch nicht mehr
        Ereignis x{};
        x.art = Ereignis::ERZ_ALT;
        x.sample = sample_;
        x.zeiger = alt;
        melde(x);
      }
      break;
    }
    case Befehl::ERZ_FENSTER: {  // §4.8 Fenster ersetzen; das verbrauchte Fenster geht mit der Quittung zurück
      const auto* f = static_cast<const ErzFenster*>(c.zeiger);
      const ErzZaehler z = erz_->fenster(*f, beat0);
      Ereignis x{};
      x.art = Ereignis::ERZ_QUITTUNG;
      x.sample = sample_;
      x.deck = f->strom;
      x.fassung = f->sendung;
      x.erz_zahl[0] = z.verworfen;
      x.erz_zahl[1] = z.verworfen_anderes_muster;
      x.erz_zahl[2] = z.eingefuegt;
      x.erz_zahl[3] = z.zu_spaet;
      x.erz_zahl[4] = z.ungehoert;
      x.zeiger = f;
      melde(x);
      break;
    }
    case Befehl::LOOP_LADEN:
    case Befehl::LOOP_START:
    case Befehl::LOOP_STOPP: {  // MVP 2 (§4.9, ADR 025)
      if (!std::strcmp(c.quelle, "cypher") && sw_->ki_gestoppt()) {  // §4.7 Stopp-Taste
        if (c.art == Befehl::LOOP_LADEN && c.zeiger) {  // der geladene Loop geht ungenutzt zur Freigabe zurück
          Ereignis x{};
          x.art = Ereignis::LOOP_ALT;
          x.sample = sample_;
          x.zeiger = c.zeiger;
          melde(x);
        }
        quittung(c.id, c.quelle, 6, sample_, beat0, "ki_gestoppt");
        break;
      }
      if (c.art == Befehl::LOOP_LADEN) {
        const Loop* alt = loops_->laden(c.deck, static_cast<const Loop*>(c.zeiger));
        if (alt) {
          Ereignis x{};
          x.art = Ereignis::LOOP_ALT;
          x.sample = sample_;
          x.zeiger = alt;
          melde(x);
        }
        loops_frei(sample_);  // Keylock: die Variante des abgelösten Loops
        if (alt && alt == c.zeiger) {  // ungültige Box: der Loop kam gleich zurück
          quittung(c.id, c.quelle, 6, sample_, beat0, "ausserhalb_bereich");
          break;
        }
        quittung(c.id, c.quelle, 1, sample_, beat0);
        quittung(c.id, c.quelle, 3, sample_, beat0);
      } else {
        const bool ok = c.art == Befehl::LOOP_START ? loops_->start(c.deck, beat0) : loops_->stopp(c.deck, beat0);
        if (!ok) {
          quittung(c.id, c.quelle, 6, sample_, beat0, "nicht_geladen");
          break;
        }
        quittung(c.id, c.quelle, 1, sample_, beat0);
      }
      loop_melden(c.deck, sample_, beat0);
      break;
    }
    case Befehl::LOOP_VARIANTE: {  // Keylock: vorgerenderte Variante der Box; die abgelöste geht wie ein alter Loop zurück
      const Loop* v = static_cast<const Loop*>(c.zeiger);
      if (!std::strcmp(c.quelle, "cypher") && sw_->ki_gestoppt()) {  // §4.7 Stopp-Taste: die Variante geht ungenutzt zurück
        if (v) {
          Ereignis x{};
          x.art = Ereignis::LOOP_ALT;
          x.sample = sample_;
          x.zeiger = v;
          melde(x);
        }
        break;
      }
      const Loop* alt = loops_->variante_setzen(c.deck, v);  // ungültige Box oder leere Box: v selbst
      if (alt) {
        Ereignis x{};
        x.art = Ereignis::LOOP_ALT;
        x.sample = sample_;
        x.zeiger = alt;
        melde(x);
      }
      break;
    }
    case Befehl::LOOP_RASTER: {  // Plan Grid (§4.9 /k/loop/raster): sofort, absolut
      if (!std::strcmp(c.quelle, "cypher") && sw_->ki_gestoppt()) {
        quittung(c.id, c.quelle, 6, sample_, beat0, "ki_gestoppt");
        break;
      }
      const int r = loops_->raster(c.deck, c.versatz_f);
      if (r != 0) {
        quittung(c.id, c.quelle, 6, sample_, beat0, r == 1 ? "nicht_geladen" : "ausserhalb_bereich");
        break;
      }
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    }
    case Befehl::MITSCHNITT: {  // MVP 2 Scheibe 2 (§4.9 /k/loop/rec, ADR 025 Folgeplan)
      Mitschnitt* mt = static_cast<Mitschnitt*>(const_cast<void*>(c.zeiger));
      if (!std::strcmp(c.quelle, "cypher") && sw_->ki_gestoppt()) {  // §4.7 Stopp-Taste
        mitschnitt_melden(mt, 1);
        quittung(c.id, c.quelle, 6, sample_, beat0, "ki_gestoppt");
        break;
      }
      // Plan Tempo-Folge: jedes feste Tempo. Keylock Slice 4 (F3): abgelehnt nur, wenn jetzt eine Rampe läuft oder eine
      // (wartende oder laufende) Rampe vor dem Ende des Mitschnitts beginnt. Eine Rampe, die erst danach startet (auch auf
      // dem End-Beat), berührt die aufgenommenen Beats nicht; der Block in LoopBoxen::block bricht ab, falls sie doch hineinreicht.
      const double ende_beat = LoopBoxen::mitschnitt_ab_beat(beat0, mt->beats) + (double)mt->beats;
      bool tempo_fest = plan_.karte().k_at((double)sample_) == 0.0;
      for (int i = 0; i < plan_.eintraege(); ++i)
        if (plan_.eintrag(i).start_beat < ende_beat - 1e-9) tempo_fest = false;
      if (!tempo_fest) {
        mitschnitt_melden(mt, 1);
        quittung(c.id, c.quelle, 6, sample_, beat0, "ausserhalb_bereich");
        break;
      }
      if (!loops_->mitschnitt(mt, beat0, plan_.karte())) {
        mitschnitt_melden(mt, 1);
        quittung(c.id, c.quelle, 6, sample_, beat0, "ueberlappung");
        break;
      }
      quittung(c.id, c.quelle, 1, sample_, beat0);
      break;
    }
    case Befehl::KLICK:
      if (c.pfad[0] && std::strcmp(c.pfad, "master")) {  // Scheibe 25: Z1 für die Kanäle aus §1.5
        klick_befehl(c, beat0);
        break;
      }
      quittung(c.id, c.quelle, 1, sample_, beat0);
      if (c.an) {
        klick_.an();
        klick_quittung_offen_ = true;  // Z1: Status 2 beim ersten Klick
        klick_id_ = c.id;
        std::memcpy(klick_quelle_, c.quelle, sizeof klick_quelle_);
        klick_seit_sample_ = sample_;
        klick_seit_beat_ = beat0;
      } else {
        klick_.aus();
        klick_quittung_offen_ = false;
        quittung(c.id, c.quelle, 2, sample_, beat0);
      }
      break;
    case Befehl::TEMPO_RAMPE:
      if (ein_deck_laeuft()) {  // Scheibe 31, §4.4: bis Scheibe 50 nur der Direktweg
        quittung(c.id, c.quelle, 6, sample_, beat0, "kein_stretcher");
        break;
      }
      switch (plan_.rampe(c.id, c.quelle, c.ab_beat, c.ziel_bpm, c.dauer_beats, sample_)) {
        case Einsortiert::angenommen: quittung(c.id, c.quelle, 1, sample_, beat0); break;
        case Einsortiert::verspaetet: break;  // Quittung 5 am Start, in faellige()
        case Einsortiert::ueberlappung: quittung(c.id, c.quelle, 6, sample_, beat0, "ueberlappung"); break;
        case Einsortiert::karte_voll: quittung(c.id, c.quelle, 6, sample_, beat0, "karte_voll"); break;
      }
      break;
    case Befehl::STORNO:
      if (plan_.storno(c.ziel_id, c.quelle)) {
        quittung(c.ziel_id, c.quelle, 8, sample_, beat0);
        quittung(c.id, c.quelle, 1, sample_, beat0);
        quittung(c.id, c.quelle, 2, sample_, beat0);
      } else {  // schon gestartet, fertig, andere Quelle oder unbekannt (Befund B6 a im Plan)
        quittung(c.id, c.quelle, 6, sample_, beat0, "zu_spaet");
      }
      break;
    default:
      einsortieren25(c);  // Scheibe 25: Teile, Abbruch, KI, Hand (kern_stellwerk.cpp)
      break;
  }
}

void Kern::zyklus(int n, int64_t mono_ns) {
  if (mitschnitt_wartend_) mitschnitt_nachreichen();  // MVP 2 Scheibe 3 (E4)
  if (n > MAX_BLOCK) n = MAX_BLOCK;
  // 1) Vergangene Segmente verwerfen, Befehle am Blockanfang einsortieren, Fälliges im Block melden (§1.3, §4.2)
  neue_zeitachse_ = false;
  plan_.verwerfe_vor(sample_);
  if (nachreichen_in_ > 0 && --nachreichen_in_ == 0) teile_nachreichen();  // Scheibe 25: zweiter Zyklus nach Neustart
  Befehl c;
  while (befehle_->hole(c)) einsortieren(c);
  decks_uebernehmen();  // Scheibe 31: Rückgaben an den Lader, Lade-Ergebnisse tauschen, KI-Stopp
  hand_zyklus(sample_, n);  // Scheibe 35: MIDI dieses Zyklus am Versatz (nach /k/set/neu: Blockanfang der neuen Achse)
  const int64_t n0 = sample_;
  for (MidiAus& m : midi_aus_) m.leer();  // Studio S5: MIDI dieses Zyklus
  zyklus_n0_ = n0;
  plan_.faellige(n0, n, [&](const RampeEintrag& e, int32_t st, int64_t s, double b) { quittung(e.id, e.quelle, st, s, b); });
  const Karte& karte = plan_.karte();
  const double beat0 = karte.beat_at((double)n0);

  // 2) Uhr je Zyklus (§5.2)
  Ereignis u{};
  u.art = Ereignis::UHR;
  u.sample = n0;
  u.mono_ns = mono_ns;
  u.beat = beat0;
  u.bpm = karte.bpm_at((double)n0);
  u.k = karte.k_at((double)n0);
  u.generation = generation_;
  melde(u);
  decks_zustand(n0, n);  // Scheibe 31: /zustand/deck direkt nach /uhr desselben Zyklus (§5.5)

  // 3) Takt-Anfänge in diesem Block (§5.3): Beats 4(t-1) mit llround(sample_at) in [n0, n0+n)
  const double b_lo = karte.beat_at((double)n0 - 0.5);
  const double b_hi = karte.beat_at((double)(n0 + n) - 0.5);
  for (double b = 4.0 * std::ceil(b_lo / 4.0); b < b_hi; b += 4.0) {
    const int64_t s = std::llround(karte.sample_at(b));
    if (s < n0 || s >= n0 + n) continue;
    Ereignis t{};
    t.art = Ereignis::TAKT;
    t.takt = takt_nr(b);
    t.phrase = phrase_nr(b);
    t.sample = s;
    t.beat = b;
    t.bpm = karte.bpm_at((double)s);
    melde(t);
    takt_vorletzt_ = takt_letzt_;  // für die Taktfelder des Rings (Schritt 5)
    takt_letzt_ = s;
    takt_letzt_beat_ = b;
  }

  // 4) Scheibe 25: Stellwerk, Prüfklicks, Mixer (Kanalzüge, Master, Cue) in Teilblöcken (kern_stellwerk.cpp)
  audio(n0, n);
#ifndef CYPHERDJ_MUTATION_KEIN_PEGEL  // Fehlerfall Scheibe 35: der Kern sendet kein /pegel
  pegel_melden(n0, n);  // Scheibe 35: /pegel (§5.6)
#endif
  decks_frist(n0, n);  // Scheibe 31: /e/frist (§5.9)

  // 5) Audio-Ring: Daten, dann Taktfelder, dann w (je Release, §6.1)
  float* d = cdj_ring_daten(ring_);
  for (int i = 0; i < n; ++i) {
    const uint64_t f = (w_ + (uint64_t)i) % CDJ_RING_CAP;
    d[f * 4 + 0] = links_[i];
    d[f * 4 + 1] = rechts_[i];
    // Scheibe 18: Prüfsignal hinter --pruef-cue; sonst der Cue des Mixers (Scheibe 25)
    d[f * 4 + 2] = pruef_cue_ ? pruef_cue_wert(n0 + i) : cue_l_[i];
    d[f * 4 + 3] = pruef_cue_ ? pruef_cue_wert(n0 + i) : cue_r_[i];
  }
  // Taktfelder aus den gemerkten Taktanfängen, nicht aus der Karte: deren vergangene Segmente sind verworfen (§1.3),
  // ein Takt, der in einer Rampe begann, ließe sich aus ihr nicht mehr rechnen (Scheibe 08, test_befehle Fall 7).
  int64_t s_takt, takt_frames;
#ifdef CYPHERDJ_MUTATION_TAKT_AUS_KARTE
  // Fehlerfall (Scheibe 08, test_befehle Fall 7): Taktfelder aus der Karte wie in Scheibe 01, trotz verworfener Segmente
  if (false) {
#else
  if (takt_letzt_ >= 0) {
#endif
    s_takt = takt_letzt_;
    // Länge des zuletzt vollendeten Takts; im ersten Takt einer Zeitachse gibt es keinen, dann die des laufenden
    takt_frames = (takt_vorletzt_ >= 0) ? takt_letzt_ - takt_vorletzt_
                                        : std::llround(karte.sample_at(takt_letzt_beat_ + 4.0)) - takt_letzt_;
  } else {  // noch kein Taktanfang gesehen (Zeitachse beginnt nicht auf einer Eins): wie Scheibe 01 aus der Karte
    const double takt_b = 4.0 * std::floor(karte.beat_at((double)(n0 + n - 1)) / 4.0);
    s_takt = std::llround(karte.sample_at(takt_b));
    takt_frames = (takt_b >= 4.0) ? s_takt - std::llround(karte.sample_at(takt_b - 4.0))
                                  : std::llround(karte.sample_at(takt_b + 4.0)) - s_takt;
  }
  cdj_setze(&ring_->takt_frames, (uint64_t)takt_frames);
  cdj_setze(&ring_->takt_anfang_w, (uint64_t)((int64_t)w_ + (s_takt - n0)));
  w_ += (uint64_t)n;
  cdj_setze(&ring_->w, w_);
  sample_ = n0 + n;
}

void Kern::loops_frei(int64_t smp) {  // Keylock: Freigabe-Ring der Boxen leeren; jeder Zeiger geht einmal an den Netz-Faden
  while (const Loop* q = loops_->abholen()) {
    Ereignis x{};
    x.art = Ereignis::LOOP_ALT;
    x.sample = smp;
    x.zeiger = q;
    melde(x);
  }
}

void Kern::loop_melden(int box, int64_t smp, double beat) {  // MVP 2, §5.11; im Callback: ohne snprintf
  Ereignis x{};
  x.art = Ereignis::LOOP;
  x.sample = smp;
  x.beat = beat;
  x.deck = box;
  x.status = static_cast<int32_t>(loops_->status(box));
  x.fx_beats = 1.0;
  if (const Loop* l = loops_->loop(box)) {
    for (size_t i = 0; i + 1 < sizeof x.pfad && i < l->name.size(); ++i) x.pfad[i] = l->name[i];
    x.fassung = l->beats;
  }
  melde(x);
}

void Kern::mitschnitt_melden(const Mitschnitt* mt, int32_t status) {  // MVP 2 Scheibe 2, §5.11 /e/mitschnitt
  Ereignis x{};
  x.art = Ereignis::MITSCHNITT;
  x.status = status;
  x.sample = mt->ab_sample;
  x.beat = mt->ab_beat;
  x.fassung = mt->beats;
  std::memcpy(x.pfad, mt->name, sizeof x.pfad);
  x.zeiger = mt;
#ifdef CYPHERDJ_MUTATION_MITSCHNITT_VERLIERBAR
  melde(x);  // Fehlerfall der Probe: wie vor Scheibe 3, voller Ring verliert die Meldung
  return;
#endif
  mitschnitt_nachreichen();  // Reihenfolge: Wartendes zuerst
  if (mitschnitt_wartend_ == 0 && ereignisse_->schiebe(x)) return;
  if (mitschnitt_wartend_ < 4) mitschnitt_wartet_[mitschnitt_wartend_++] = x;
  else ++verloren_;  // nicht erreichbar (höchstens ein Mitschnitt zugleich), gezählt statt still
}

void Kern::mitschnitt_nachreichen() {
  int w = 0;
  for (int i = 0; i < mitschnitt_wartend_; ++i)
    if (!ereignisse_->schiebe(mitschnitt_wartet_[i])) mitschnitt_wartet_[w++] = mitschnitt_wartet_[i];
  mitschnitt_wartend_ = w;
}

}  // namespace cdj
