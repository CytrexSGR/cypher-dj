// Buchführung des Kerns neben dem Stellwerk (teile.h). Scheibe 25.
#include "cypherdj/teile.h"

#include <cstring>

namespace cdj {

SchattenTeil* TeilSchatten::neu() {
  for (auto& t : t_)
    if (!t.belegt) {
      t = SchattenTeil{};
      t.belegt = true;
      return &t;
    }
  return nullptr;
}

SchattenTeil* TeilSchatten::finde(int64_t id, const char* quelle) {
  for (auto& t : t_)
    if (t.belegt && t.id == id && !std::strcmp(t.quelle, quelle)) return &t;
  return nullptr;
}

bool TeilSchatten::quittung(int64_t id, const char* quelle, int status, int64_t sample, double beat) {
  SchattenTeil* t = finde(id, quelle);
  if (!t) return false;
  if (t->wieder == 2 && (status == 1 || status == 2 || status == 5)) {   // lief schon: Start ist gemeldet
    if (status != 1) t->wieder = 0;
    return true;
  }
  if (t->wieder == 1 && status == 1) {   // wartete schon: angenommen ist gemeldet
    t->wieder = 0;
    t->stand = 1;
    return true;
  }
  switch (status) {
    case 1:
      t->stand = 1;
      break;
    case 5: {   // §16.1 Politik 1: Start jetzt, Ende-Beat unverändert; die Kurve beginnt am späten Start
      const double ende = t->ab_beat + t->dauer_beats;
      t->ab_beat = beat;
      t->dauer_beats = ende > beat ? ende - beat : 0.0;
    }
      [[fallthrough]];
    case 2:
      t->stand = 2;
      t->ist_sample = sample;
      t->ist_beat = beat;
      break;
    default:   // 3 fertig, 4 verworfen, 6 abgelehnt, 7 abgebrochen, 8 storniert
      entferne(t);
      break;
  }
  return false;
}

int TeilSchatten::wartend() const {
  int n = 0;
  for (const auto& t : t_) n += (t.belegt && t.stand == 1) ? 1 : 0;
  return n;
}

void TeilSchatten::leeren() {
  for (auto& t : t_) t.belegt = false;
}

bool HandSchlange::rein(const HandGriff& g) {
  if (n_ >= MAX) return false;
  int k = n_++;
  while (k > 0 && g_[k - 1].sample > g.sample) {   // stabil nach Sample sortiert
    g_[k] = g_[k - 1];
    --k;
  }
  g_[k] = g;
  return true;
}

bool HandSchlange::raus_vor(int64_t bis, HandGriff& g) {
  if (n_ == 0 || g_[0].sample >= bis) return false;
  g = g_[0];
  for (int k = 1; k < n_; ++k) g_[k - 1] = g_[k];
  --n_;
  return true;
}

double fortsetzwert(const SchattenTeil& t, bool db, double b) {
  const double ende = t.ab_beat + t.dauer_beats;
  const double ws = t.w_s;
  if (b >= ende) return (db && t.nach <= -120.0f) ? -200.0 : t.nach;
  double zi = t.nach;
  if (db && t.nach <= -120.0f) {   // nach stumm: bis −60 dB, am Ende stumm (§1.2); unter −60 hält die Kurve
    if (ws <= -60.0) return ws;
    zi = -60.0;
  }
  if (t.form == 0) {   // Gerade durch den Schnappschuss und das Ende
    if (ende - t.b_s <= 0.0) return zi;
    return ws + (zi - ws) * (b - t.b_s) / (ende - t.b_s);
  }
  // S-Kurve w(u) = wA + (zi − wA)·(3u² − 2u³), u = (beat − ab_beat)/(ende − ab_beat): wA aus dem Schnappschuss
  const double spanne = ende - t.ab_beat;
  if (spanne <= 0.0) return zi;
  auto s = [](double u) {
    u = u < 0.0 ? 0.0 : (u > 1.0 ? 1.0 : u);
    return u * u * (3.0 - 2.0 * u);
  };
  const double gs = s((t.b_s - t.ab_beat) / spanne);
  if (gs >= 1.0 - 1e-9) return zi;
  const double wa = (ws - zi * gs) / (1.0 - gs);
  return wa + (zi - wa) * s((b - t.ab_beat) / spanne);
}

}  // namespace cdj
