// D1 K2b: Wirt-Slot des Arrangements (arr_wirt_senke.h).
#include "cypherdj/arr_wirt_senke.h"

#include <algorithm>
#include <cmath>

namespace cdj {

int64_t ArrWirtSenke::vorhalt() const noexcept {
#ifdef CYPHERDJ_MUTATION_ARR_WIRT_OHNE_VORHALT
  return 0;   // Fehlerfall: Noten am Ziel-Sample hinaus, sie klingen um den Rundweg zu spät
#else
  return static_cast<int64_t>(ERZ_MIDI_RUNDWEG_ZYKLEN) * *n_ + ERZ_MIDI_VORHALT_REST;
#endif
}

// Sende-Sample = Ziel − Vorhalt, nie vor dem Zyklusanfang (ein Off aus Stopp oder Tausch kann schon fällig sein)
void ArrWirtSenke::schreibe(int64_t ziel, uint8_t st, uint8_t d1, uint8_t d2) noexcept {
  const int64_t t = std::max<int64_t>(ziel - vorhalt() - *s0_, 0);
  midi_.schreibe(t, st, d1, d2);
}

// Fix F7: der Zyklusanfang des Kerns läuft nur vorwärts, außer bei /k/set/neu (sample_ = 0). Dann gehören offene
// Messungen zur alten Achse: verwerfen, sonst blockiert ihr Ziel (weit hinter der neuen Zeit) die Messung der neuen Noten.
void ArrWirtSenke::achse() noexcept {
#ifndef CYPHERDJ_MUTATION_ARR_A4_ACHSE_ALT
  if (*s0_ < zeit_) {
    n_offen_ = 0;
    still_ = ARR_A4_STILLE;
    letzter_s0_ = -1;
  }
#endif
  zeit_ = *s0_;
}

void ArrWirtSenke::note(int, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept {
  achse();
  if (an) {
    schreibe(ziel, 0x90, ton & 0x7f, std::clamp<uint8_t>(vel, 1, 127));
    if (n_offen_ == ARR_A4_OFFEN) {   // Messpunkt A4: die älteste offene Messung fällt weg
      std::copy(offen_ + 1, offen_ + n_offen_, offen_);
      --n_offen_;
    }
    offen_[n_offen_++] = ziel;
  } else {
    schreibe(ziel, 0x80, ton & 0x7f, 0);
  }
}

void ArrWirtSenke::alle_aus(int, int64_t ziel) noexcept { schreibe(ziel, 0xB0, 123, 0); }   // All Notes Off, Kanal 1

bool ArrWirtSenke::spur_weg(int spur, int64_t s, bool andere_spur) noexcept {
  if (andere_spur) return false;   // eine weitere Spur spielt den Slot: kein CC 123, ihr Rückweg bleibt
  alle_aus(spur, s);
  ausblenden_ = true;
  return true;
}

void ArrWirtSenke::messen(const float* x, int64_t s0, int m) noexcept {
  for (int i = 0; i < m; ++i) {
#ifdef CYPHERDJ_MUTATION_ARR_A4_BLOCKANFANG
    const int64_t s = s0;   // Fehlerfall: der Einsatz zählt am Blockanfang statt an seinem Sample
#else
    const int64_t s = s0 + i;
#endif
    if (x[i] > ARR_A4_SCHWELLE) {
      if (still_ >= ARR_A4_STILLE && n_offen_ > 0 && s >= offen_[0] - vorhalt()) {
        mess_.schiebe(ArrWirtMessung{slot_, offen_[0], s, vorhalt()});
        std::copy(offen_ + 1, offen_ + n_offen_, offen_);
        --n_offen_;
      }
      still_ = 0;
    } else if (still_ < ARR_A4_STILLE) {
      ++still_;
    }
    while (n_offen_ > 0 && s >= offen_[0] + ARR_A4_FENSTER) {
      mess_.schiebe(ArrWirtMessung{slot_, offen_[0], -1, vorhalt()});
      std::copy(offen_ + 1, offen_ + n_offen_, offen_);
      --n_offen_;
    }
  }
}

void ArrWirtSenke::block(int, int64_t s0, int m, float* l, float* r) noexcept {
  achse();
  if (s0 == letzter_s0_) return;   // derselbe Slot auf einer weiteren Spur: der Rückweg ging schon in die erste
  letzter_s0_ = s0;
  if (m <= 0 || m > ARR_BLOCK) return;
  const int64_t o = s0 - *s0_;
  const bool da = rl_ && rr_ && o >= 0 && o + m <= *n_;
  const bool aus = ausblenden_;
  ausblenden_ = false;
  for (int i = 0; i < m; ++i) {
    float a = 0.0f, c = 0.0f;
    if (da) {
      a = rl_[o + i];
      c = rr_[o + i];
      if (!std::isfinite(a) || !std::isfinite(c)) {   // wie der Rückweg der DJ-Wirte (Audit F01)
        a = c = 0.0f;
        ++unendlich_;
      }
      a = std::clamp(a, -8.0f, 8.0f);
      c = std::clamp(c, -8.0f, 8.0f);
      if (aus) {   // Fix F2: letzter Block des Slots auf dieser Spur, linear auf 0
        const float g = static_cast<float>(m - 1 - i) / static_cast<float>(m);
        a *= g;
        c *= g;
      }
    }
#ifndef CYPHERDJ_MUTATION_ARR_WIRT_OHNE_RUECKWEG
    l[i] += a;
    r[i] += c;
#endif
    mess_puf_[i] = std::max(std::fabs(a), std::fabs(c));
  }
  messen(mess_puf_, s0, m);
}

}  // namespace cdj
