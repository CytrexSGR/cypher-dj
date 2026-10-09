// Der Dehner (siehe include/cypherdj/dehner.h). Vorlagen: messungen/M03-deck-echtzeit/src/m3deck.cpp 100 bis 210
// (vorbereiten Art „zieh“, uebernehmen, fuelle), messungen/M04-tempo-rampen/src/m4kern.h (R3Zeit::render: Speiseweise
// d03, Regler: Verzögerungsmodell) und m4lauf.h 102 bis 125 (Faktor-Takt, Mittelpunkt-Regel). Zählungen in Samples.
// Nach dem Anlegen keine Allokation im Arbeits-Thread: Puffer, Instanzen und Histogramme entstehen im Konstruktor, und
// jede Instanz rechnet dort einmal warm (Rubber Band 3.3.0 legt beim ersten echten process/retrieve rund 31 000 Blöcke
// an, gemessen 07.10.). Ausnahme, gemessen: RubberBand::R3Stretcher::reset() ruft zweimal posix_memalign (5456 Bytes);
// reset läuft nur im Vorbereiter (ansetzen), nie im Arbeits-Thread oder Callback.
#include "cypherdj/dehner.h"

#include <rubberband/RubberBandStretcher.h>
#include <time.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>

#include "cypherdj/dreifach.h"
#include "cypherdj/fassung.h"

namespace cdj {
namespace {

using RBS = RubberBand::RubberBandStretcher;

int64_t jetzt_ns() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return static_cast<int64_t>(ts.tv_sec) * 1000000000LL + ts.tv_nsec;
}

constexpr int QUELL_PUFFER = 1 << 15;  // wie M4 R3Zeit: ib/ob je 32768

// Arbeitspuffer eines Fadens (Prüfung F1): Vorbereiter und Arbeits-Thread rechnen gleichzeitig, jeder mit seiner
// Instanz UND seinen Puffern. Beide entstehen beim Anlegen.
struct Puffer {
  std::vector<float> ib[2], ob[2];
  Puffer() {
    for (int c = 0; c < 2; ++c) {
      ib[c].assign(QUELL_PUFFER, 0.0f);
      ob[c].assign(QUELL_PUFFER, 0.0f);
    }
  }
};

struct Instanz {
  std::unique_ptr<RBS> rb;
  int64_t quell_pos = 0;  // nächster Quellframe, der dem Stretcher gegeben wird (Band-Lesekopf)
};

// Alles, was der Thread über einen übernommenen Ansatz wissen muss (vom Vorbereiter geschrieben, mit Release
// veröffentlicht, vom Thread nach Acquire gelesen). Indiziert wie die Instanz, die ihn trägt.
struct AnsatzDaten {
  uint32_t epoche = 0;
  bool leer = false;
  const DehnerQuelle* quelle = nullptr;
  int64_t s_h = 0;
  DehnerAnker anker;
  uint32_t generation = 0;
  bool intern = false;  // Task 6b: interne Erneuerung (vorbereiter_schritt), nicht Ansatz der Quelle
  uint32_t wurzel = 0;  // Task 6b: Epoche des Quell-Ansatzes, von dem diese Kette von Erneuerungen ausgeht
  double fpb = 0.0, basis_bpm = 128.0;
  double f0 = 1.0;  // Faktor des ersten Fensters (schon nie_eins)
  double p0 = 0.0;  // Band-Start (Quellframe)
  double v_quell = 0.0;  // Versatz-Korrektur in Quellframes: dehner_versatz(f0) · f0, fest je Ansatz
  Karte karte;
  float erst[2][DEHNER_BLOCK];  // der Pull-Zyklus des Vorbereitens: die ersten 256 Frames ab s_h (M3 „zieh“)
};

class Dehner final : public DehnerBasis {
 public:
  Dehner(int kennung, const DehnerOptionen& opt)
      : kennung_(kennung), opt_(opt), vorlauf_(dehner_vorlauf(opt)), ring_(2 * dehner_vorlauf(opt)) {
    const int opts = RBS::OptionProcessRealTime | RBS::OptionEngineFiner | RBS::OptionChannelsTogether |
                     RBS::OptionThreadingNever;  // ADR 006
    zeros_.assign(QUELL_PUFFER, 0.0f);
    for (auto& I : inst_) {
      I.rb.reset(new RBS(48000, 2, opts, 1.0, 1.0));
      I.rb->setMaxProcessSize(QUELL_PUFFER);
      warm(I);
    }
    reserve_ = 0;
    rueck_.store(1, std::memory_order_relaxed);  // die zweite Instanz ist von Anfang an frei
    (void)kennung_;
  }

  // ------------------------------------------------------------------------------------------------ Vorbereiter
  uint32_t ansetzen(const AnsatzAuftrag& a) override {
    const int64_t t0 = jetzt_ns();
    // Reserve: erst die eigene, dann einen wartenden, nicht übernommenen Ansatz ersetzen (Vertrag 3), dann die vom
    // Thread zurückgegebene Instanz (die er erst NACH seiner Quittung zurückgibt).
    int r = reserve_;
    reserve_ = -1;
    if (r < 0) r = wartend_.exchange(-1, std::memory_order_acquire);
    if (r < 0) r = rueck_.exchange(-1, std::memory_order_acquire);
    if (r < 0) return EPOCHE_KEINE;  // besetzt: nichts vergeben

    // Der Dehner ist der einzige Vergeber (Prüfung F4): fortlaufend ab 1, 0 bleibt „keine“.
    const uint32_t e = naechste_epoche_++;
    if (naechste_epoche_ == EPOCHE_KEINE) naechste_epoche_ = 1;
    AnsatzDaten& D = ans_[r];
    D.epoche = e;
    D.leer = a.quelle == nullptr;
    D.quelle = a.quelle;
    D.s_h = a.s_h;
    D.anker = a.anker;
    D.generation = a.generation;
    D.intern = naechster_intern_;
    D.wurzel = naechster_intern_ ? letzter_wurzel_ : e;
    D.karte = a.karte;
    if (!D.leer) {
      D.basis_bpm = a.quelle->basis_bpm();
      D.fpb = FRAMES_JE_MINUTE / D.basis_bpm;
      const double kopf_h = kopf(a.karte, D, static_cast<double>(a.s_h));
      D.f0 = nie_eins(faktor_mitte(a.karte, D.basis_bpm, static_cast<double>(a.s_h)));
      // Der Versatz entsteht beim Ansetzen (Startverzögerung bei Faktor f0) und bleibt danach stehen (gemessen 07.10.:
      // nach einer Rampe 128 -> 132 hält die Quelle ihren Start-Versatz von 128, nicht den von 132): darum je Ansatz fest.
      D.v_quell = opt_.versatz_anwenden ? dehner_versatz(D.f0) * D.f0 : 0.0;
#ifdef CYPHERDJ_MUTATION_DEHNER_BANDSTART_8
      D.p0 = std::round(kopf_h + D.v_quell) + 8;  // Fehlerfall (Keylock 7b.7): Bandstart 8 Frames daneben
#else
      D.p0 = std::round(kopf_h + D.v_quell);
#endif
      bereite_vor(inst_[r], D);
    }
    letzter_ = a;
    letzter_gueltig_ = true;
    letzter_epoche_ = e;
    letzter_wurzel_ = D.wurzel;
    wartend_.store(r, std::memory_order_release);
    // erst nach dem Ansatz veröffentlichen: wer epoche() == e liest, findet den Ansatz e wartend oder übernommen
    epoche_.store(e, std::memory_order_release);
    kosten_ansatz_.rein(jetzt_ns() - t0);
    return e;
  }

  void vorbereiter_schritt(const KartenStand& stand) override {
    meldung_holen();
    if (!letzter_gueltig_ || letzter_.quelle == nullptr) return;
    if (stand.s_jetzt >= letzter_.s_h) return;
    // nur ein NEUERER Stand erneuert (Prüfung F5): ein älterer (der Ansatz kam mit frischerer Karte, als der Vorbereiter
    // sie schon sieht) setzte sonst mit der alten Karte an. Vergleich über den Abstand, damit der Überlauf trägt.
    if (static_cast<int32_t>(stand.generation - letzter_.generation) <= 0) return;
    AnsatzAuftrag neu = letzter_;
    neu.karte = stand.karte;
    neu.anker = stand.anker;
    neu.generation = stand.generation;
    naechster_intern_ = true;
    const uint32_t e = ansetzen(neu);
    naechster_intern_ = false;
    if (e != EPOCHE_KEINE) erneuert_.fetch_add(1, std::memory_order_relaxed);
  }

  // Task 6b, Fix-Runde W2 (Q1): die vom Thread gemeldete Annahme in den letzten Ansatz übernehmen, damit eine Erneuerung mit
  // dem angenommenen Band ansetzt, und die Nummer bestätigen. Nur für die zuletzt vergebene Epoche: nennt die Meldung eine ältere,
  // hat der Vorbereiter seither neu angesetzt (Quelle oder Erneuerung); dann bestätigt er nichts.
  void meldung_holen() {
    const WechselMeldung* m = nullptr;
    if (!wm_.hole(m)) return;
#ifndef CYPHERDJ_MUTATION_DEHNER_ERNEUERUNG_ALTE_QUELLE  // Fehlerfall (W6): Erneuerung setzt mit dem alten Band an
    if (letzter_gueltig_ && m->epoche == letzter_epoche_) {
      letzter_.quelle = m->neu;
      w_bestaetigt_.store(m->nr, std::memory_order_release);
    }
#endif
  }

  // ------------------------------------------------------------------------------------------------ Thread
  void fuelle_synchron() override {
#ifdef CYPHERDJ_MUTATION_DEHNER_WECHSEL_VOR_UEBERNEHMEN  // Fehlerfall (W3, Prüfung X3): holen vor übernehmen
    wechsel_holen();
    uebernehmen();
#else
    uebernehmen();
    wechsel_holen();  // nach uebernehmen(): ein Auftrag für die gerade wartende Epoche trifft sie schon aktiv an (W3)
#endif
    const KartenStand* neu = nullptr;
    const bool hat_neu = kb_.hole(neu);
    if (aktiv_ < 0 || ans_[aktiv_].leer) return;
    if (hat_neu && neu->generation >= ans_[aktiv_].generation) stand_karte_ = neu->karte;
    const std::size_t abschnitt = DEHNER_BLOCK + StreckRing::KOPF_WOERTER / 2;
    // Höchstens so viele Abschnitte, wie der Ring fasst, und Abbruch, sobald ein neuer Ansatz wartet (Task 2, gemessen
    // 07.10. unter TSan, task-02/tsan_haenger_beobachtet.txt): verwirft die Quelle die alte Epoche, füllt sich der Ring nie, und
    // ein langsamer Thread kam aus dieser Schleife nicht mehr zu uebernehmen() (Antwort Epoche 92, quittiert 91, 30 s;
    // deterministisch: test_deck_keylock Test 13, vorher band() 203 Mal in einem Aufruf, nachher 1, task-02/fuellen_*.txt).
    // Synchron gefahren (Tests) ändert das nichts: dort setzt niemand während der Schleife an.
#ifdef CYPHERDJ_MUTATION_DEHNER_FUELLEN_OHNE_GRENZE
    const std::size_t hoechstens = SIZE_MAX;  // Fehlerfall: keine Obergrenze (Test 13b)
#else
    const std::size_t hoechstens = ring_.kapazitaet_frames() / abschnitt + 1;
#endif
    for (std::size_t n = 0; n < hoechstens && ring_.frames_belegt() < vorlauf_ &&
                            ring_.frames_belegt() + abschnitt <= ring_.kapazitaet_frames();
         ++n) {
      chunk();
#ifndef CYPHERDJ_MUTATION_DEHNER_FUELLEN_OHNE_ABBRUCH
      if (wartend_.load(std::memory_order_relaxed) >= 0) break;  // übernommen wird im nächsten Aufruf (Test 13a)
#endif
    }
  }

  // ------------------------------------------------------------------------------------------------ Callback
  void karte_veroeffentlichen(const KartenStand& s) override { kb_.schreibe(s); }
  StreckRing& ring() override { return ring_; }

  uint32_t epoche() const override { return epoche_.load(std::memory_order_acquire); }

  // Task 6b (Plan Task 6, 3.2): Wechselauftrag vom Callback. Die Nummer vergibt der Dehner (ein Schreiber), wie die Epochen.
  uint32_t wechsel(const WechselAuftrag& a) override {
    const uint32_t nr = w_naechste_++;
    if (w_naechste_ == 0) w_naechste_ = 1;
#ifdef CYPHERDJ_MUTATION_DEHNER_WECHSEL_ALLOKIERT
    std::unique_ptr<WechselAuftrag> kopie(new WechselAuftrag(a));  // Fehlerfall (W4): Allokation im Callback
    WechselAuftrag& p = *kopie;
#else
    WechselAuftrag& p = wb_.platz();
#endif
    p = a;
    p.nr = nr;
#ifdef CYPHERDJ_MUTATION_DEHNER_WECHSEL_OHNE_DREIFACH
    wb_roh_ = p;  // Fehlerfall (W5 unter TSan): Übergabe ohne Dreifachpuffer, Kennzeichen relaxed
    wb_roh_neu_.store(true, std::memory_order_relaxed);
#elif !defined(CYPHERDJ_MUTATION_DEHNER_WECHSEL_ALLOKIERT)
    wb_.veroeffentliche();
#else
    wb_.schreibe(p);
#endif
    return nr;
  }
  uint32_t wechsel_gelesen() const override { return w_gelesen_.load(std::memory_order_acquire); }
  uint32_t wechsel_verfehlt() const override { return w_verfehlt_.load(std::memory_order_acquire); }
  uint64_t wechsel_n_angenommen() const override { return w_n_ang_.load(std::memory_order_relaxed); }
  uint64_t wechsel_n_verfehlt() const override { return w_n_verf_.load(std::memory_order_relaxed); }
  uint64_t wechsel_ueberschrieben() const override { return w_n_ueb_.load(std::memory_order_relaxed); }
  uint32_t wechsel_bestaetigt() const override { return w_bestaetigt_.load(std::memory_order_acquire); }
  uint32_t wechsel_zurueckgenommen() const override { return w_zurueck_.load(std::memory_order_acquire); }
  uint64_t wechsel_n_zurueckgenommen() const override { return w_n_zurueck_.load(std::memory_order_relaxed); }
  int64_t einspeisung_bis() const override {
    return (aktiv_ >= 0 && !ans_[aktiv_].leer) ? inst_[aktiv_].quell_pos : -1;
  }

  uint32_t quittiert_e() const override { return quittiert_.load(std::memory_order_acquire); }
  int ansatz_erneuert() const override { return erneuert_.load(std::memory_order_relaxed); }
  uint64_t auffuellen_kurz() const override { return kurz_.load(std::memory_order_relaxed); }
  uint64_t auffuellen_zwang() const override { return zwang_.load(std::memory_order_relaxed); }
  uint64_t ring_voll() const override { return ring_voll_.load(std::memory_order_relaxed); }
  // nur synchron (dehner.h)
  double faktor_gesetzt() const override { return f_gesetzt_; }
  double faktor_kleinster_abstand() const override { return f_abstand_min_; }
  double regler_c() const override { return c_; }
  int64_t geschrieben_bis() const override {
    return (aktiv_ >= 0 && !ans_[aktiv_].leer) ? ans_[aktiv_].s_h + chunk_nr_ * DEHNER_BLOCK : -1;
  }
  const DehnerKosten& kosten_render() const override { return kosten_render_; }
  const DehnerKosten& kosten_ansatz() const override { return kosten_ansatz_; }

 private:
  // Karten-Tempo in der MITTE des nächsten 43er-Fensters plus Vorhalt (m4lauf.h:108)
  double faktor_mitte(const Karte& k, double basis_bpm, double m) const {
#ifdef CYPHERDJ_MUTATION_DEHNER_FAKTOR_ANFANG
    return k.bpm_at(m) / basis_bpm;  // Fehlerfall (Prüfer M1): Fensteranfang statt Mitte
#else
    return k.bpm_at(m + DEHNER_REGEL_TAKT / 2.0 + opt_.vorhalt_samples) / basis_bpm;
#endif
  }
  // ADR 020, M4 E4: der Stretcher bekommt nie einen Faktor näher als 1e-6 an 1,0
  static double nie_eins(double f) {
    if (std::fabs(f - 1.0) < DEHNER_EINS_ABSTAND) return f < 1.0 ? 1.0 - DEHNER_EINS_ABSTAND : 1.0 + DEHNER_EINS_ABSTAND;
    return f;
  }
  double kopf(const Karte& k, const AnsatzDaten& D, double s) const {
    return D.anker.f + (k.beat_at(s) - D.anker.b) * D.fpb;
  }

  // M4 R3Zeit::render, Speiseweise d03 (02 NP Runde 2 KR1): erst abholen, nur bei leerem Ausgang getSamplesRequired()
  // speisen, nie auffüllen. Genau n Frames (n <= QUELL_PUFFER) nach P.ob, dann nach ol/orr (nullptr: verwerfen).
  // P: die Puffer des rufenden Fadens (pv_ Vorbereiter, pt_ Arbeits-Thread).
  void erzeuge(Instanz& I, Puffer& P, const DehnerQuelle* q, int n, float* ol, float* orr) {
    int got = 0, guard = 0;
    while (got < n) {
      const int av = I.rb->available();
      if (av > 0) {
        float* o[2] = {P.ob[0].data() + got, P.ob[1].data() + got};
        got += static_cast<int>(I.rb->retrieve(o, static_cast<size_t>(std::min(av, n - got))));
        continue;
      }
      if (++guard > 64) break;
      int req = static_cast<int>(I.rb->getSamplesRequired());
      if (req <= 0) {
        req = DEHNER_BLOCK;
        zwang_.fetch_add(1, std::memory_order_relaxed);
      }
      req = std::min(req, QUELL_PUFFER);
      q->band(I.quell_pos, req, P.ib[0].data(), P.ib[1].data());
      const float* in[2] = {P.ib[0].data(), P.ib[1].data()};
      I.rb->process(in, static_cast<size_t>(req), false);
      I.quell_pos += req;
    }
    if (got < n) {
      kurz_.fetch_add(1, std::memory_order_relaxed);
      for (int i = got; i < n; ++i) P.ob[0][static_cast<std::size_t>(i)] = P.ob[1][static_cast<std::size_t>(i)] = 0.0f;
    }
    if (ol) {
      std::memcpy(ol, P.ob[0].data(), static_cast<size_t>(n) * sizeof(float));
      std::memcpy(orr, P.ob[1].data(), static_cast<size_t>(n) * sizeof(float));
    }
  }

  // Beim Anlegen: einmal echt rechnen (Ton, zwei Faktoren), damit Rubber Band seine späten Allokationen hier macht.
  // Läuft im Konstruktor (noch kein anderer Faden), mit den Puffern des Vorbereiters.
  void warm(Instanz& I) {
    static constexpr int N = 4096;
    Puffer& P = pv_;
    for (int i = 0; i < N; ++i) {
      P.ib[0][static_cast<std::size_t>(i)] = P.ib[1][static_cast<std::size_t>(i)] =
          static_cast<float>(0.25 * std::sin(0.13 * i));
    }
    const float* in[2] = {P.ib[0].data(), P.ib[1].data()};
    float* o[2] = {P.ob[0].data(), P.ob[1].data()};
    for (int runde = 0; runde < 2; ++runde) {
      I.rb->setTimeRatio(runde == 0 ? 1.0 / 1.04 : 1.0 / 0.97);
      for (int k = 0; k < 24; ++k) {
        I.rb->process(in, N / 4, false);
        const int av = I.rb->available();
        if (av > 0) I.rb->retrieve(o, static_cast<size_t>(std::min(av, QUELL_PUFFER)));
      }
    }
    I.rb->reset();
  }

  // M3 vorbereiten, Art „zieh“ (ADR 006): reset, Faktor, Pad mit Nullen, Startverzögerung ab Band-Start verwerfen,
  // ein Pull-Zyklus samt retrieve. Der Pull-Zyklus ist kein Wegwurf: er liefert die ersten 256 Frames ab s_h.
  void bereite_vor(Instanz& I, AnsatzDaten& D) {
    I.rb->reset();
    I.rb->setTimeRatio(1.0 / D.f0);
    I.rb->setPitchScale(1.0);
    I.quell_pos = static_cast<int64_t>(D.p0);
    size_t rest = I.rb->getPreferredStartPad();
    const float* z[2] = {zeros_.data(), zeros_.data()};
    while (rest > 0) {
      const size_t m = std::min<size_t>(rest, QUELL_PUFFER);
      I.rb->process(z, m, false);
      rest -= m;
    }
    int64_t verwerfen = static_cast<int64_t>(I.rb->getStartDelay());
    while (verwerfen > 0) {
      const int m = static_cast<int>(std::min<int64_t>(verwerfen, QUELL_PUFFER));
      erzeuge(I, pv_, D.quelle, m, nullptr, nullptr);
      verwerfen -= m;
    }
    erzeuge(I, pv_, D.quelle, DEHNER_BLOCK, D.erst[0], D.erst[1]);
  }

  // M3 uebernehmen: am Anfang des Füllens den vorbereiteten Ansatz übernehmen, quittieren, dann erst die abgelöste
  // Instanz als Reserve zurückgeben (Vertrag 3).
  void uebernehmen() {
    const int p = wartend_.exchange(-1, std::memory_order_acquire);
    if (p < 0) return;
    const int alt = aktiv_;
    aktiv_ = p;
    const AnsatzDaten& D = ans_[p];
    // Task 6b (Q1): eine interne Erneuerung DERSELBEN Kette (gleiche Wurzel), die das Band der abgelösten Epoche nicht trägt, hat
    // der Vorbereiter vor der Meldung einer Annahme angesetzt: die Annahme ist damit zurückgenommen (gezählt, nie bestätigt).
    // Trägt sie es, gilt die Annahme weiter. Jeder andere Ansatz (Quelle, oder Erneuerung eines nie aktiven Ansatzes) beendet sie.
    const bool kette = D.intern && alt >= 0 && D.wurzel == ans_[alt].wurzel;
    if (w_ang_akt_ != 0 && !(kette && D.quelle == ans_[alt].quelle)) {
      if (kette) {
        w_zurueck_.store(w_ang_akt_, std::memory_order_release);
        w_n_zurueck_.fetch_add(1, std::memory_order_relaxed);
      }
      w_ang_akt_ = 0;
    }
    chunk_nr_ = 0;
    c_ = 0.0;
    P_.setze(D.p0);
    e_ = 0.0;
    if (!D.leer) {
      f_gesetzt_ = D.f0;
      f_abstand_min_ = std::min(f_abstand_min_, std::fabs(f_gesetzt_ - 1.0));
      for (double& h : f_hist_) h = f_gesetzt_;
      stand_karte_ = D.karte;
    }
    quittiert_.store(D.epoche, std::memory_order_release);  // Leer-Epoche: „Band fallen gelassen“ (Vertrag 4)
    if (alt >= 0) rueck_.store(alt, std::memory_order_release);
  }

  // Task 6b (Plan Task 6, 3.2): einen gestellten Wechsel holen, nach uebernehmen() und vor dem ersten Abschnitt. Angenommen,
  // wenn die Epoche die des aktiven Ansatzes ist und die Einspeisung (I.quell_pos: nächster Quellframe, den R3 bekäme) noch
  // <= p_gleich_bis liegt: R3 hat dann nur Frames < p_gleich_bis bekommen, in denen Alt und Neu gleich sind (Vertrag in
  // dehner.h), und alle folgenden erzeuge()-Aufrufe lesen das Neue. Sonst verfehlt, nichts geändert. Übersprungene Nummern
  // hat der Callback überschrieben, bevor der Thread las (die Nummern sind fortlaufend, ein Schreiber).
  void wechsel_holen() {
    const WechselAuftrag* w = nullptr;
#ifdef CYPHERDJ_MUTATION_DEHNER_WECHSEL_OHNE_DREIFACH
    if (!wb_roh_neu_.exchange(false, std::memory_order_relaxed)) return;
    w = &wb_roh_;
#else
    if (!wb_.hole(w)) return;
#endif
    const uint32_t nr = w->nr;
#ifndef CYPHERDJ_MUTATION_DEHNER_WECHSEL_UEBERSCHRIEBEN_AUS  // Fehlerfall (W5): Überschriebene nicht gezählt
    const uint32_t luecke = dehner_wechsel_luecke(w_letzte_nr_, nr);  // dehner.h: trägt auch den Überlauf
    if (luecke > 0) w_n_ueb_.fetch_add(luecke, std::memory_order_relaxed);
#endif
    w_letzte_nr_ = nr;
    bool an = aktiv_ >= 0 && !ans_[aktiv_].leer && w->neu != nullptr && w->epoche == ans_[aktiv_].epoche;
#ifndef CYPHERDJ_MUTATION_PLAN_WECHSEL_SPAET_ANNEHMEN  // Fehlerfall (W2): auch hinter p_gleich_bis angenommen
    an = an && inst_[aktiv_].quell_pos <= w->p_gleich_bis;
#endif
    if (an) {
#ifndef CYPHERDJ_MUTATION_DEHNER_WECHSEL_ZAEHLT_NUR  // Fehlerfall (W1b): nur gezählt, die Quelle bleibt
      ans_[aktiv_].quelle = w->neu;
#endif
      w_n_ang_.fetch_add(1, std::memory_order_relaxed);
      w_ang_akt_ = nr;
      WechselMeldung& m = wm_.platz();
      m.epoche = w->epoche;
      m.nr = nr;
      m.neu = w->neu;
      wm_.veroeffentliche();
      w_gelesen_.store(nr, std::memory_order_release);
    } else {
      w_n_verf_.fetch_add(1, std::memory_order_relaxed);
      w_verfehlt_.store(nr, std::memory_order_release);
    }
  }

  // Ein Ausgabe-Abschnitt von 256 Frames ab s_h + rel: Faktor im Takt von REGEL_TAKT Samples (M4 E3), Stretcher, Ring,
  // dann den Regler fortschreiben (M4 Regler::nach_block).
  void chunk() {
    const int64_t t0 = jetzt_ns();
    Instanz& I = inst_[aktiv_];
    AnsatzDaten& D = ans_[aktiv_];
    const int64_t rel = chunk_nr_ * DEHNER_BLOCK;  // Samples seit s_h
    const int64_t m = D.s_h + rel;
    float l[DEHNER_BLOCK], r[DEHNER_BLOCK];
    if (chunk_nr_ == 0) {  // schon im Vorbereiten gerechnet (Faktor f0, c = 0)
      std::memcpy(l, D.erst[0], sizeof l);
      std::memcpy(r, D.erst[1], sizeof r);
    } else {
      if (rel % DEHNER_REGEL_TAKT == 0) {
        const double f_basis = faktor_mitte(stand_karte_, D.basis_bpm, static_cast<double>(m));
        // M4 Regler::stelle: Soll c = e / (f · H), H = Horizont in Samples, |c| <= CMAX
        const double H = DEHNER_HORIZONT_BEATS * FRAMES_JE_MINUTE / stand_karte_.bpm_at(static_cast<double>(m));
#ifdef CYPHERDJ_MUTATION_DEHNER_OHNE_REGLER
        c_ = 0.0;  // Fehlerfall: kein Phasenregler
#else
        // Totband: liegt der Modellfehler unter DEHNER_E_TOTBAND, bleibt c = 0 (jede Faktoränderung kostet Phase, M4 E3;
        // nach einer Rampe ließen die kleinen Stellschritte die Quelle sonst weiterlaufen, gemessen 07.10.)
        c_ = std::fabs(e_) <= DEHNER_E_TOTBAND ? 0.0 : std::max(-DEHNER_CMAX, std::min(DEHNER_CMAX, e_ / (f_basis * H)));
#endif
        // Jede Faktoränderung kostet R3 Phase, unabhängig von ihrer Größe (M4 E3). Ohne Totband (und ohne Schwelle)
        // ließen die kleinen Stellschritte des Reglers die Quelle in 400 Beats bei 132 BPM bis +99,8 Samples weglaufen
        // (Prüfung P13, task-01-pruefung/p13.txt). Das Totband allein hält das (P13: max 6,95, gleich wie mit beidem):
        // mit c = 0 bleibt f_basis · (1 + c) bei konstantem Tempo bitgleich, es wird nicht neu gesetzt. Die frühere
        // zusätzliche Schwelle für kleine Faktoränderungen (1e-9) war neben dem Totband bitgleich wirkungslos und ist
        // entfernt (Fix-Runde F7: 4 Läufe über 402 Beats, konstant 132 und Rampe 8..40 -> 132, Vorhalt 0 und 2400, Ring-
        // Ausgabe per cmp ohne Unterschied; Positiv-Kontrolle ohne Totband weicht ab; task-01-fix/f7_schwelle.txt).
        const double f = nie_eins(f_basis * (1.0 + c_));
        if (f != f_gesetzt_) I.rb->setTimeRatio(1.0 / f);
        f_gesetzt_ = f;
        f_abstand_min_ = std::min(f_abstand_min_, std::fabs(f - 1.0));
      }
      erzeuge(I, pt_, D.quelle, DEHNER_BLOCK, l, r);
    }
    f_hist_[static_cast<std::size_t>(chunk_nr_) & (HIST - 1)] = f_gesetzt_;
    // Prüfung F8: die Füllschleife prüft den Platz vorher; scheitert es trotzdem, fehlt der Abschnitt im Ring (die Quelle
    // sieht einen Unterlauf) und das wird gezählt statt still verloren
    if (!ring_.schreibe(D.epoche, m, DEHNER_BLOCK, l, r)) ring_voll_.fetch_add(1, std::memory_order_relaxed);
    // gehört wird jetzt, was mit dem Faktor von vor D Samples eingespeist wurde: P(m+1) = P(m) + f(m − D)
    dehner_summe_abschnitt(P_, DEHNER_BLOCK, [&](int j) { return f_gehoert(D, rel + j); });
    e_ = kopf(stand_karte_, D, static_cast<double>(m + DEHNER_BLOCK)) + D.v_quell - P_.wert();
    ++chunk_nr_;
    kosten_render_.rein(jetzt_ns() - t0);
  }

  double f_gehoert(const AnsatzDaten& D, int64_t rel) const {
    const double t = static_cast<double>(rel) - DEHNER_D;
    if (t < 0) return D.f0;
    const int64_t b = static_cast<int64_t>(t / DEHNER_BLOCK);
    return f_hist_[static_cast<std::size_t>(b) & (HIST - 1)];
  }

  static constexpr int HIST = 64;  // Faktor-Verlauf je Abschnitt, > D / 256 + 1
  static_assert(HIST * DEHNER_BLOCK > DEHNER_D + 2 * DEHNER_BLOCK, "Faktor-Verlauf zu kurz für D");

  int kennung_;
  DehnerOptionen opt_;
  std::size_t vorlauf_;
  StreckRing ring_;
  Instanz inst_[2];
  AnsatzDaten ans_[2];
  Puffer pv_, pt_;             // Arbeitspuffer: pv_ nur der Vorbereiter (und warm im Konstruktor), pt_ nur der Thread
  std::vector<float> zeros_;  // nach dem Anlegen nur gelesen

  // Übergabe Vorbereiter <-> Thread (Vertrag 3)
  std::atomic<int> wartend_{-1}, rueck_{-1};
  std::atomic<uint32_t> epoche_{EPOCHE_KEINE}, quittiert_{EPOCHE_KEINE};
  std::atomic<int> erneuert_{0};
  std::atomic<uint64_t> kurz_{0}, zwang_{0};  // aus beiden Fäden gezählt (erzeuge)
  std::atomic<uint64_t> ring_voll_{0};        // Arbeits-Thread: Abschnitt passte nicht in den Ring
  // nur der Vorbereiter
  int reserve_ = -1;
  uint32_t naechste_epoche_ = 1;
  AnsatzAuftrag letzter_;
  bool letzter_gueltig_ = false;
  uint32_t letzter_epoche_ = EPOCHE_KEINE;  // Task 6b: Epoche des letzten Ansatzes (für die Meldung)
  uint32_t letzter_wurzel_ = EPOCHE_KEINE;  // Task 6b: dessen Wurzel
  bool naechster_intern_ = false;           // Task 6b: der laufende ansetzen()-Aufruf ist eine interne Erneuerung
  // Karten-Stand der Quelle: der Callback schreibt (karte_veroeffentlichen), der Arbeits-Thread liest (fuelle_synchron);
  // der Vorbereiter fasst ihn nicht an, er bekommt seinen Stand über vorbereiter_schritt (Prüfung F8: Kommentar stand falsch)
  Dreifach<KartenStand> kb_;
  // Task 6b: Wechselaufträge, der Callback schreibt (wechsel), der Arbeits-Thread liest (fuelle_synchron)
  Dreifach<WechselAuftrag> wb_;
#ifdef CYPHERDJ_MUTATION_DEHNER_WECHSEL_OHNE_DREIFACH
  WechselAuftrag wb_roh_;
  std::atomic<bool> wb_roh_neu_{false};
#endif
  uint32_t w_naechste_ = 1;  // nur der Callback
  std::atomic<uint32_t> w_gelesen_{0}, w_verfehlt_{0};
  std::atomic<uint64_t> w_n_ang_{0}, w_n_verf_{0}, w_n_ueb_{0};
  // Rückmeldung Thread -> Vorbereiter (Q1): ein Schreiber (Thread), ein Leser (Vorbereiter)
  struct WechselMeldung {
    uint32_t epoche = EPOCHE_KEINE, nr = 0;
    const DehnerQuelle* neu = nullptr;
  };
  Dreifach<WechselMeldung> wm_;
  std::atomic<uint32_t> w_bestaetigt_{0}, w_zurueck_{0};
  std::atomic<uint64_t> w_n_zurueck_{0};

  // nur der Thread
  int aktiv_ = -1;
  uint32_t w_letzte_nr_ = 0;  // Task 6b: Nummer des zuletzt gelesenen Wechsels
  uint32_t w_ang_akt_ = 0;    // Task 6b (Q1): zuletzt angenommene Nummer, die in der aktiven Epoche gilt (0: keine)
  int64_t chunk_nr_ = 0;
  Karte stand_karte_;
  DehnerSumme P_;  // gehörte Quellposition (Task 5b: Ganzzahl + Bruchteil)
  double c_ = 0.0, e_ = 0.0, f_gesetzt_ = 1.0, f_abstand_min_ = 1e9;
  double f_hist_[HIST] = {};
  DehnerKosten kosten_render_, kosten_ansatz_;
};

}  // namespace

std::unique_ptr<DehnerBasis> dehner_neu(int kennung, const DehnerOptionen& opt) {
  if (opt.maschine == DehnerMaschine::Bungee) {
#ifdef CYPHERDJ_BUNGEE
    return dehner_bungee_neu(kennung, opt);
#else
    return nullptr;  // ohne Bungee gebaut: keine Maschine, Keylock aus (wie der Stub)
#endif
  }
  return std::unique_ptr<DehnerBasis>(new Dehner(kennung, opt));
}

}  // namespace cdj
