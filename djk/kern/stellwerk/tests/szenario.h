// Prüfgerüst für die Stellwerk-Tests: simulierte Uhr, Zyklen zu 256 Samples, Spuren je Sample, gesammelte Ausgaben.
#pragma once
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <memory>
#include <vector>

#include "sim_uhr.h"
#include "cypherdj/stellwerk/stellwerk.h"

namespace probe {

using namespace cypherdj::stellwerk;

constexpr int BLOCK = 256;
inline int64_t T(int takt) { return static_cast<int64_t>(takt - 1) * 90000; }   // Taktanfang bei 128 BPM
inline double B(int takt) { return (takt - 1) * 4.0; }                           // Taktanfang in Beats
inline float dB(double gain) { return static_cast<float>(20.0 * std::log10(gain)); }
inline double amp(double db) { return db <= STUMM_GRENZE ? 0.0 : std::pow(10.0, db / 20.0); }
// Rampe linear in dB (§4.3 Form 0) mit Stumm-Regel (§1.2), bei 128 BPM ab Sample s_start
inline double rampe_db(double w0, double nach, double ab_beat, double dauer, int64_t s) {
  const double b = static_cast<double>(s) * 128.0 / 60.0 / SR;
  const double ziel = nach <= STUMM_GRENZE ? STUMM_RAMPE : nach;
  const double u = std::min(1.0, std::max(0.0, (b - ab_beat) / dauer));
  if (u >= 1.0) return nach;
  return w0 + (ziel - w0) * u;
}

struct Quittung {
  int64_t id;
  Status status;
  int64_t sample;
  Grund grund;
};

class Lauf {
 public:
  explicit Lauf(double bpm = 128.0, Pruefer* p = nullptr) : uhr(bpm), sw(std::make_unique<Stellwerk>(uhr, p)) {}

  SimUhr uhr;
  std::unique_ptr<Stellwerk> sw;
  int block = BLOCK;
  std::vector<Ereignis> ereignisse;
  int64_t naechste_id = 1000;

  int r(const char* pfad) const {
    const int i = sw->tabelle().suche(pfad);
    if (i < 0) {
      std::printf("unbekannter Pfad %s\n", pfad);
      std::abort();
    }
    return i;
  }
  void beobachte(const char* pfad) { spur_[r(pfad)] = Spur{sw->jetzt(), {}}; }
  void zyklus() {
    const int64_t s0 = sw->jetzt();
    sw->prozess(s0, block);
    nachlese();
  }
  void bis(int64_t s) {
    while (sw->jetzt() < s) zyklus();
  }
  float wert_bei(const char* pfad, int64_t s) const {
    const Spur& sp = spur_.at(r(pfad));
    return sp.w.at(static_cast<size_t>(s - sp.ab));
  }
  // größter Schritt von Sample zu Sample; dB-Regler in Amplitude
  double max_schritt(const char* pfad, int64_t* wo = nullptr) const {
    const int reg = r(pfad);
    const Spur& sp = spur_.at(reg);
    const bool db = sw->tabelle().def(reg).db;
    double m = 0;
    for (size_t i = 1; i < sp.w.size(); i++) {
      const double d = db ? std::fabs(amp(sp.w[i]) - amp(sp.w[i - 1])) : std::fabs(sp.w[i] - sp.w[i - 1]);
      if (d > m) {
        m = d;
        if (wo) *wo = sp.ab + static_cast<int64_t>(i);
      }
    }
    return m;
  }
  int64_t teil(const char* pfad, double ab, double dauer, float nach, const char* plan = "", int nr = 0,
               const char* gruppe = "", Quelle q = Quelle::cypher, int politik = 0, int form = 0) {
    const int64_t id = naechste_id++;
    sw->teil(TeilBefehl{id, q, plan, nr, pfad, ab, dauer, nach, form, politik, gruppe, ""});
    nachlese_ereignisse();
    return id;
  }
  void griff(int64_t s, const char* pfad, float x, GriffArt art = GriffArt::absolut) {
    sw->hand(Griff{s, static_cast<int16_t>(r(pfad)), art, x, nullptr});
  }
  std::vector<Quittung> quittungen(int64_t id) const {
    std::vector<Quittung> q;
    for (const Ereignis& e : ereignisse)
      if (e.art == EreignisArt::quittung && e.id == id) q.push_back(Quittung{e.id, e.status, e.sample, e.grund});
    return q;
  }
  // Sample der Quittung mit diesem Status, -1 wenn keine
  int64_t bei(int64_t id, Status st) const {
    for (const Quittung& q : quittungen(id))
      if (q.status == st) return q.sample;
    return -1;
  }
  Grund grund(int64_t id, Status st) const {
    for (const Quittung& q : quittungen(id))
      if (q.status == st) return q.grund;
    return Grund::kein;
  }
  int zahl(EreignisArt art, const char* pfad = nullptr) const {
    int n = 0;
    for (const Ereignis& e : ereignisse)
      if (e.art == art && (!pfad || e.regler == r(pfad))) n++;
    return n;
  }
  void nachlese_ereignisse() {
    const Ereignis* e;
    const int m = sw->ereignisse(&e);
    ereignisse.insert(ereignisse.end(), e, e + m);
    sw->ereignisse_leeren();
  }

 private:
  struct Spur {
    int64_t ab;
    std::vector<float> w;
  };
  std::map<int, Spur> spur_;
  void nachlese() {
    const Aenderung* a;
    const int n = sw->aenderungen(&a);
    for (auto& [reg, sp] : spur_) {
      const float* vl = nullptr;
      for (int k = 0; k < n; k++)
        if (a[k].regler == reg) vl = a[k].verlauf;
      for (int i = 0; i < block; i++) sp.w.push_back(vl ? vl[i] : sw->wert(reg));
    }
    nachlese_ereignisse();
  }
};

}  // namespace probe
