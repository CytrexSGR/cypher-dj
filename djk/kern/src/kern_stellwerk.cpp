// Scheibe 25: der Kern und die zwei Bibliotheken im Callback. Befehle aus §4.3, §4.7 und §19.0 gehen ans Stellwerk
// (djk/kern/stellwerk, Scheibe 11), seine Verläufe je Sample in den Mixer (mixer.h, Kanalzüge aus djk/kern/dsp,
// Scheibe 04), seine Ausgaben als /q, /e/regler, /e/hand, /e/halter, /e/ki, /e/invariante hinaus (§5.1, §5.7 bis §5.9).
// Reihenfolge je Teilblock: Griffe der Hand mit ihrem Sample ins Stellwerk, Stellwerk-Zyklus, Verläufe in den Mixer,
// Prüfklicks in die Eingänge, Mixer, Ausgaben. Innerhalb eines Samples ordnet das Stellwerk: Hand zuerst, dann Starts
// in Startfolge (Sample, Plan, Nummer), dann Rückgabe an frei (stellwerk.h). Keine Allokation, keine Sperre, kein I/O.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>

#include "cypherdj/kern.h"
#include "osc_adressen.h"  // Plan 3: Kanalliste der Beat-FX (fx_kanal) aus dem Vertrag

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

void Kern::einsortieren25(const Befehl& c) {
  const double beat0 = plan_.karte().beat_at((double)sample_);
  const sw::Quelle q = quelle_von(c.quelle);
  switch (c.art) {
    case Befehl::FX: {  // AUFTRAG 2026-09-28 (§4.10): Einheits-Parameter, am Blockanfang
      const int einheit = c.deck;
      if (einheit < 1 || einheit > Mixer::FX_EINHEITEN || c.nr < 1 || c.nr > 4) {
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
    case Befehl::KI_STOPP: sw_->ki_stopp(c.id, q); break;  // §4.7
    case Befehl::KI_FREI: sw_->ki_frei(c.id, q); break;
    case Befehl::KI_SPUR:
      kopiere(ki_spur_neu_, c.liste, sizeof ki_spur_neu_);  // gilt erst mit der Quittung fertig des Stellwerks
      ki_spur_id_ = c.id;
      sw_->ki_spur(c.id, q, c.liste);
      break;
    case Befehl::KI_STUFE:  // §4.7: nur für LEDs (Scheibe 35); die Stufe durchsetzen tut der Leitstand
      ki_stufe_ = c.an;
      quittung(c.id, c.quelle, 1, sample_, beat0);
      quittung(c.id, c.quelle, 3, sample_, beat0);
      break;
    case Befehl::MAPPING: {  // Scheibe 35, §4.7 /k/mapping: das Netz hat geladen und geprüft, der Tausch gilt ab diesem Zyklus
      const hand::Mapping* alt = mapping_;
#ifndef CYPHERDJ_MUTATION_MAPPING_NICHT_TAUSCHEN  // Fehlerfall Plan 35 Task 8: quittiert, tauscht aber nicht
      setze_mapping(static_cast<const hand::Mapping*>(c.zeiger));
#endif
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
      einsortieren31(c);  // Scheibe 31: /k/deck/laden, entladen, start, stopp (kern_deck.cpp)
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
  melden("pad/1", 12);  // MVP 2: Loop-Boxen, immer (ohne Loop −200)
  melden("pad/2", 13);
  melden("master", Mixer::PEGEL_MASTER);
  melden("cue", Mixer::PEGEL_CUE);
}

void Kern::audio(int64_t n0, int n) {
  const Karte& karte = plan_.karte();
  for (int off = 0; off < n;) {
    const int m = std::min(n - off, MIX_BLOCK);
    const int64_t s0 = n0 + off;
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
    }
    decks_block(s0, m);  // Scheibe 31: Decks in die Eingänge deck/1..4, Starts und Stopps am Sample
    ErzAusloeser ausl;
    erz_->block(karte, s0, m, erz_l_, erz_r_, midi_aus_, zyklus_n0_, &ausl);  // Plan 2026-09-27 + Studio S5 (MIDI-Ströme)
    // K2: der Duck setzt AM Kick-Ereignis ein, nicht um den Wirt-Rundweg verzögert: ein gehaltener Bass läge sonst die
    // ersten ~11 ms ungeduckt unter dem Kick-Anschlag; eine Note, die mit dem Kick startet, kommt erst nach ~545 Samples an
    // und trifft auf den schon abgesenkten Duck (Abnahme 2026-09-30: gemessen 545 Samples Rundweg).
#ifdef CYPHERDJ_MUTATION_DUCK_VERSATZ_NULL
    for (int i = 0; i < ausl.n; ++i) mixer_->duck_ausloesen(0);   // Mutation: Duck am Blockanfang, ohne Auslöser-Sample
#else
    for (int i = 0; i < ausl.n; ++i) mixer_->duck_ausloesen(ausl.sample[i] - s0);
#endif
    for (int e = 0; e < 8; ++e) {  // Studio S5: Rückwege der Wirte in den Eingang erz/<e+1>, vor Trim (§8)
      if (!rueck_l_[e] || !rueck_r_[e]) continue;
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
    const int nb = loops_->block(karte, s0, m, erz_l_, erz_r_, bm, 4, &mt_fertig);
    loops_frei(s0);  // Keylock: Varianten, die eine Blende zu Ende gebracht hat, zurück an den Netz-Faden
    for (int i = 0; i < nb; ++i) loop_melden(bm[i].box, bm[i].sample, karte.beat_at((double)bm[i].sample));
    if (mt_fertig) mitschnitt_melden(mt_fertig, mt_fertig->abgebrochen ? 1 : 0);  // voll: das Netz schreibt und gibt frei; abgebrochen (Scheibe 3 E4): nur frei
    mixer_->fx_takt(karte.beat_at((double)s0), karte.bpm_at((double)s0) / 60.0 / 48000.0);  // Plan 3: LFO aus dem Beat
    mixer_->verarbeite(m, links_ + off, rechts_ + off, cue_l_ + off, cue_r_ + off);
    huellen_block(s0, m, cue_l_ + off, cue_r_ + off);  // Ohr (§6.2): Mess-Abgriff vor dem Fader
    decks_verlauf_ende(m);  // Scheibe 31
    ereignisse_uebernehmen();
    off += m;
  }
}

// Ohr (§6.2): je Block ein Datensatz je vollendetem 48-Sample-Fenster, für alle 16 Kanäle. Belegt heißt: Deck k<4
// geladen; erz/1, pad/1, pad/2, master, cue immer; erz/2..8 nie (YAGNI, I3b/I3c nicht gebaut). Der Master-Analysator
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
    else if (c <= 11) belegt[c] = false;  // erz/4..8: nie
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
      if (s.id == ki_spur_id_ && st == 3) {
        std::memcpy(ki_spur_, ki_spur_neu_, sizeof ki_spur_);
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

// Zweiter Zyklus einer fortgesetzten Generation (kern_zustand.cpp setzt nachreichen_in_): das Stellwerk steht jetzt auf
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
