// Der Dehner mit Bungee statt R3 (Umbauplan 2026-10-09-bungee-umbau, S1). Dieselbe Naht wie dehner.cpp (DehnerBasis), aber
// ohne Reserve-Instanz, Vorbereiter, Faktor-Takt und Phasenregler: Bungees Positions-API bekommt je Korn die absolute
// Quellposition aus der Karte (Anker + Karte, dieselbe Formel wie dehner.cpp kopf()), also läuft nichts weg.
// Vorlage: hoerprobe.cpp (BungeeDeck::korn, Hörprobe 09.10., ~/messungen/2026-10-09-hoerprobe-bungee/werkzeug), dort mit
// std::vector::push_back; hier ein fester Zwischenpuffer (kein Allokieren nach dem Anlegen, gemessen: Bungee allokiert
// in reset, preroll, specifyGrain, analyseGrain, synthesiseGrain nie, test_dehner_bungee Test 3).
//
// ALLE Aufrufe kommen aus EINEM Faden, dem Callback: ansetzen() und vorbereiter_schritt() über StreckPost::takt, dann
// fuelle_synchron(), alle am Zyklusende (Kern::keylock_antrieb). Die Atome der Diagnose darf jeder Faden lesen.
//
// Ablauf eines Ansatzes (ansetzen() merkt ihn nur, fuelle_synchron() übernimmt ihn und quittiert):
//   Korn 0   reset = true, Position = kopf(s_h) − ein Hop (Bungee preroll): dessen Ausgabe ist ungültig, verworfen
//   Korn 1   Position kopf(s_h); Ausgabe liegt vor s_h, verworfen bzw. der Teil ab kopf(s_h)
//   Korn k   Position kopf(s_h + (k−1)·hop), Geschwindigkeit bpm_at/basis_bpm; Bungees Ausgabe eines Korns reicht von der
//            Position des Korns k−2 bis k−1 (Stretcher.cpp synthesiseGrain): die Ausgabe hinkt zwei Körnern nach, die Karte
//            wird also zwei Hops über das Blockende hinaus gelesen
// Der erste ausgegebene Frame gehört auf Sample s_h (Frame 0 des Rings), der Rest folgt lückenlos in Abschnitten zu 256.
#include <time.h>

#include <atomic>
#include <bungee/Bungee.h>
#include <cmath>
#include <cstdint>
#include <cstring>

#include "cypherdj/dehner.h"
#include "cypherdj/dreifach.h"
#include "cypherdj/fassung.h"

namespace cdj {
namespace {

int64_t jetzt_ns() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return static_cast<int64_t>(ts.tv_sec) * 1000000000LL + ts.tv_nsec;
}

using Stretcher = Bungee::Stretcher<Bungee::Basic>;

class DehnerBungee final : public DehnerBasis {
 public:
  DehnerBungee(int kennung, const DehnerOptionen& opt)
      : kennung_(kennung),
        vorlauf_(dehner_vorlauf(opt)),
        ring_(2 * dehner_vorlauf(opt)),
        hop_(opt.bungee_fein ? 256 : 512),
        st_(Bungee::SampleRates{48000, 48000}, 2, opt.bungee_fein ? -1 : 0) {
    stride_ = st_.maxInputFrameCount();
    in_.assign(2 * static_cast<std::size_t>(stride_), 0.0f);
    fl_.assign(FIFO, 0.0f);
    fr_.assign(FIFO, 0.0f);
    // Warm laufen: Speicher berühren (Seitenfehler gehören nicht in den Callback). Danach beginnt jeder Ansatz mit reset.
    Bungee::Request r{};
    r.position = 100000.0;
    r.speed = 1.05;
    r.pitch = 1.0;
    r.reset = true;
    r.resampleMode = resampleMode_autoOut;
    st_.preroll(r);
    for (int k = 0; k < 8; ++k) {
      const Bungee::InputChunk ch = st_.specifyGrain(r);
      std::memset(in_.data(), 0, in_.size() * sizeof(float));
      (void)ch;
      st_.analyseGrain(in_.data(), stride_, 0, 0);
      Bungee::OutputChunk oc{};
      st_.synthesiseGrain(oc);
      st_.next(r);
    }
  }

  // ---- Callback-Faden: der Ansatz wird nur gemerkt, übernommen wird in fuelle_synchron()
  uint32_t ansetzen(const AnsatzAuftrag& a) override {
    const int64_t t0 = jetzt_ns();
    const uint32_t e = naechste_epoche_++;
    if (naechste_epoche_ == EPOCHE_KEINE) naechste_epoche_ = 1;
    wartend_ = a;
    wartend_epoche_ = e;
    wartend_da_ = true;
    letzter_ = a;
    letzter_gueltig_ = true;
    epoche_.store(e, std::memory_order_release);
    kosten_ansatz_.rein(jetzt_ns() - t0);
    return e;
  }

  // Eine neue Karten-Generation vor s_h: mit Karte und Anker des Standes neu ansetzen (wie dehner.cpp). Danach, hinter s_h,
  // wirkt eine neue Karte über karte_veroeffentlichen() auf alle weiteren Körner; was im Ring schon liegt (höchstens der
  // Vorlauf), bleibt bei der alten Karte.
  void vorbereiter_schritt(const KartenStand& stand) override {
    if (!letzter_gueltig_ || letzter_.quelle == nullptr) return;
    if (stand.s_jetzt >= letzter_.s_h) return;
    if (static_cast<int32_t>(stand.generation - letzter_.generation) <= 0) return;
    AnsatzAuftrag neu = letzter_;
    neu.karte = stand.karte;
    neu.anker = stand.anker;
    neu.generation = stand.generation;
    naechster_intern_ = true;
    ansetzen(neu);
    naechster_intern_ = false;
    erneuert_.fetch_add(1, std::memory_order_relaxed);
  }

  void fuelle_synchron() override {
    uebernehmen();
    const KartenStand* neu = nullptr;
    const bool hat_neu = kb_.hole(neu);
    if (!aktiv_ || leer_) return;
    if (hat_neu && neu->generation >= akt_.generation) karte_ = neu->karte;
    const int64_t t0 = jetzt_ns();
    int geschrieben = 0;
    const std::size_t abschnitt = DEHNER_BLOCK + StreckRing::KOPF_WOERTER / 2;
    const std::size_t hoechstens = ring_.kapazitaet_frames() / abschnitt + 1;
    for (std::size_t n = 0; n < hoechstens && ring_.frames_belegt() < vorlauf_ &&
                            ring_.frames_belegt() + abschnitt <= ring_.kapazitaet_frames();
         ++n) {
      while (fifo_n_ < DEHNER_BLOCK) korn();
      if (!ring_.schreibe(akt_epoche_, akt_.s_h + abschnitte_ * DEHNER_BLOCK, DEHNER_BLOCK, fl_.data(), fr_.data()))
        ring_voll_.fetch_add(1, std::memory_order_relaxed);
      fifo_n_ -= DEHNER_BLOCK;
      std::memmove(fl_.data(), fl_.data() + DEHNER_BLOCK, static_cast<std::size_t>(fifo_n_) * sizeof(float));
      std::memmove(fr_.data(), fr_.data() + DEHNER_BLOCK, static_cast<std::size_t>(fifo_n_) * sizeof(float));
      ++abschnitte_;
      ++geschrieben;
    }
    if (geschrieben) kosten_render_.rein(jetzt_ns() - t0);
  }

  void karte_veroeffentlichen(const KartenStand& s) override { kb_.schreibe(s); }
  StreckRing& ring() override { return ring_; }
  uint32_t epoche() const override { return epoche_.load(std::memory_order_acquire); }

  // Im ersten Schritt immer „verfehlt“ (Plan Abschnitt 2): das Deck nimmt dann den sicheren Weg, einen neuen Ansatz.
  uint32_t wechsel(const WechselAuftrag&) override {
    const uint32_t nr = w_naechste_++;
    if (w_naechste_ == 0) w_naechste_ = 1;
    w_n_verf_.fetch_add(1, std::memory_order_relaxed);
    w_verfehlt_.store(nr, std::memory_order_release);
    return nr;
  }

  uint32_t quittiert_e() const override { return quittiert_.load(std::memory_order_acquire); }
  int ansatz_erneuert() const override { return erneuert_.load(std::memory_order_relaxed); }
  uint64_t auffuellen_kurz() const override { return 0; }
  uint64_t auffuellen_zwang() const override { return 0; }
  uint64_t ring_voll() const override { return ring_voll_.load(std::memory_order_relaxed); }
  bool ansatz_wartet() const override { return wartend_da_; }
  uint32_t wechsel_gelesen() const override { return 0; }
  uint32_t wechsel_verfehlt() const override { return w_verfehlt_.load(std::memory_order_acquire); }
  uint64_t wechsel_n_angenommen() const override { return 0; }
  uint64_t wechsel_n_verfehlt() const override { return w_n_verf_.load(std::memory_order_relaxed); }
  uint64_t wechsel_ueberschrieben() const override { return 0; }
  uint32_t wechsel_bestaetigt() const override { return 0; }
  uint32_t wechsel_zurueckgenommen() const override { return 0; }
  uint64_t wechsel_n_zurueckgenommen() const override { return 0; }

  // nur synchron
  double faktor_gesetzt() const override { return geschw_; }
  double faktor_kleinster_abstand() const override { return 1e9; }
  double regler_c() const override { return 0.0; }
  int64_t geschrieben_bis() const override { return (aktiv_ && !leer_) ? akt_.s_h + abschnitte_ * DEHNER_BLOCK : -1; }
  int64_t einspeisung_bis() const override { return -1; }
  const DehnerKosten& kosten_render() const override { return kosten_render_; }
  const DehnerKosten& kosten_ansatz() const override { return kosten_ansatz_; }

 private:
  static constexpr int FIFO = 4096;  // Zwischenpuffer: höchstens 255 Rest + ein Korn (Bungee: bis 2049 Frames)

  double kopf(double s) const { return akt_.anker.f + (karte_.beat_at(s) - akt_.anker.b) * fpb_; }
  double geschwindigkeit(double s) const { return karte_.bpm_at(s) / basis_bpm_; }

  // Den wartenden Ansatz übernehmen: Bungee auf reset, Fifo leer, quittieren (die abgelöste Quelle liest niemand mehr).
  void uebernehmen() {
    if (!wartend_da_) return;
    wartend_da_ = false;
    akt_ = wartend_;
    akt_epoche_ = wartend_epoche_;
    aktiv_ = true;
    leer_ = akt_.quelle == nullptr;
    abschnitte_ = 0;
    fifo_n_ = 0;
    if (!leer_) {
      karte_ = akt_.karte;
      basis_bpm_ = akt_.quelle->basis_bpm();
      fpb_ = FRAMES_JE_MINUTE / basis_bpm_;
      geschw_ = geschwindigkeit(static_cast<double>(akt_.s_h));
      gout_ = 0;
      korn_nr_ = 0;
      req_ = Bungee::Request{};
      req_.position = kopf(static_cast<double>(akt_.s_h));
      req_.speed = geschw_;
      req_.pitch = 1.0;
      req_.reset = true;
      req_.resampleMode = resampleMode_autoOut;
      st_.preroll(req_);
#ifdef CYPHERDJ_MUTATION_BUNGEE_OHNE_RESET
      req_.reset = false;  // Fehlerfall: Bungee erfährt den Sprung nicht und überblendet vom alten Stück
#endif
      erstes_ = true;
    }
    quittiert_.store(akt_epoche_, std::memory_order_release);
  }

  // Ein Korn rechnen, Ausgabe in die Fifo, nächste Anforderung vorbereiten.
  void korn() {
    const Bungee::InputChunk ch = st_.specifyGrain(req_);
    const int len = ch.end - ch.begin;
    akt_.quelle->band(ch.begin, len, in_.data(), in_.data() + stride_);
    st_.analyseGrain(in_.data(), stride_, 0, 0);
    Bungee::OutputChunk oc{};
    st_.synthesiseGrain(oc);
    // Die Ausgabe eines Korns reicht von der Position des Korns k−2 bis k−1. Nach dem Ansatz tragen die Körner 0 bis 2 noch
    // Positionen des alten Stücks (Bungees Pipeline kennt zwei Körner Vorlauf) oder liegen vor kopf(s_h): verworfen. Das Korn 3
    // trägt die Ausgabe von kopf(s_h) (Korn 1) bis Korn 2: ab hier lückenlos. (Nicht an den Positionen festgemacht: nach
    // einem Rückwärtssprung liegen die alten über kopf(s_h).)
    const int skip = korn_nr_ < 3 ? oc.frameCount : 0;
    ++korn_nr_;
    const int n = oc.frameCount - skip;
    if (n > 0) {
      if (fifo_n_ + n > FIFO) {  // kann nicht vorkommen (Fifo ≥ 255 + 2049); schützt vor dem Überlauf
        ring_voll_.fetch_add(1, std::memory_order_relaxed);
        return;
      }
      std::memcpy(fl_.data() + fifo_n_, oc.data + skip, static_cast<std::size_t>(n) * sizeof(float));
      std::memcpy(fr_.data() + fifo_n_, oc.data + oc.channelStride + skip, static_cast<std::size_t>(n) * sizeof(float));
      fifo_n_ += n;
    }
    // nächstes Korn: das erste (Preroll) wird vom zweiten bei kopf(s_h) abgelöst, danach im Takt des Hops
    req_.reset = false;
    if (erstes_) {
      erstes_ = false;
    } else {
      gout_ += hop_;
    }
#ifdef CYPHERDJ_MUTATION_BUNGEE_KORN_EINS_SPAET
    const double m = static_cast<double>(akt_.s_h + gout_ + hop_);  // Fehlerfall: die Karte am Korn k+1
#else
    const double m = static_cast<double>(akt_.s_h + gout_);
#endif
    req_.position = kopf(m);
    geschw_ = geschwindigkeit(m);
    req_.speed = geschw_;
  }

  int kennung_;
  std::size_t vorlauf_;
  StreckRing ring_;
  int hop_;
  Stretcher st_;
  int stride_ = 0;
  std::vector<float> in_, fl_, fr_;
  int fifo_n_ = 0;

  std::atomic<uint32_t> epoche_{EPOCHE_KEINE}, quittiert_{EPOCHE_KEINE};
  std::atomic<int> erneuert_{0};
  std::atomic<uint64_t> ring_voll_{0}, w_n_verf_{0};
  std::atomic<uint32_t> w_verfehlt_{0};
  uint32_t naechste_epoche_ = 1;
  uint32_t w_naechste_ = 1;
  bool naechster_intern_ = false;

  AnsatzAuftrag wartend_, letzter_, akt_;
  uint32_t wartend_epoche_ = EPOCHE_KEINE, akt_epoche_ = EPOCHE_KEINE;
  bool wartend_da_ = false, letzter_gueltig_ = false;
  bool aktiv_ = false, leer_ = true;
  Dreifach<KartenStand> kb_;
  Karte karte_;
  double basis_bpm_ = 128.0, fpb_ = 0.0, geschw_ = 1.0;
  int64_t gout_ = 0, abschnitte_ = 0;
  int korn_nr_ = 0;
  bool erstes_ = true;
  Bungee::Request req_{};
  DehnerKosten kosten_render_, kosten_ansatz_;
};

}  // namespace

std::unique_ptr<DehnerBasis> dehner_bungee_neu(int kennung, const DehnerOptionen& opt) {
  return std::unique_ptr<DehnerBasis>(new DehnerBungee(kennung, opt));
}

}  // namespace cdj
