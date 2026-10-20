// Paket K3 (Spec D1 A7): Null-Test (nulltest.h).
#include "cypherdj/nulltest.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>

namespace cdj {

namespace sw = cypherdj::stellwerk;

namespace {

double db(double x) { return x > 0.0 ? 20.0 * std::log10(x) : -200.0; }

}  // namespace

int null_phase(int64_t einsatz, int64_t grenze, int quantum) {
  const int64_t p = (einsatz - grenze) % quantum;
  return static_cast<int>(p < 0 ? p + quantum : p);
}

const char* null_urteil_text(NullUrteil u) {
  return u == NullUrteil::bestanden ? "bestanden" : u == NullUrteil::rot ? "rot" : "ungueltig";
}

NullErgebnis null_vergleich(const float* live_l, const float* live_r, int64_t n_live, const float* ren_l,
                            const float* ren_r, int64_t n_ren, int64_t frames) {
  NullErgebnis e;
#ifdef CYPHERDJ_MUTATION_NULL_OHNE_NAHTRAND
  e.fenster = frames;   // Fehlerfall: bis an die Naht gemessen, wo live die Kurzblende liegt
#else
  e.fenster = frames - NULL_NAHT_RAND;
#endif
  if (e.fenster <= 0 || n_ren < e.fenster) {
    e.ursache = "fenster";
    return e;
  }
  if (n_live < e.fenster + 1) {   // die Selbstprüfung liest ein Sample weiter
    e.ursache = "mitschnitt_zu_kurz";
    return e;
  }
  double sig = 0.0, rest = 0.0, versch = 0.0;
  for (int64_t i = 0; i < e.fenster; ++i) {
    sig = std::max({sig, (double)std::fabs(live_l[i]), (double)std::fabs(live_r[i]), (double)std::fabs(ren_l[i]),
                    (double)std::fabs(ren_r[i])});
    const double d = std::max(std::fabs((double)live_l[i] - ren_l[i]), std::fabs((double)live_r[i] - ren_r[i]));
    if (d > rest) {
      rest = d;
      e.schlimmstes = i;
    }
    versch = std::max({versch, std::fabs((double)live_l[i + 1] - ren_l[i]), std::fabs((double)live_r[i + 1] - ren_r[i])});
  }
  e.signal_db = db(sig);
  e.rest_db = db(rest);
  e.verschoben_db = db(versch);
  if (e.signal_db < NULL_STILLE_DB) {
    e.ursache = "stille";
    return e;
  }
  if (e.verschoben_db < NULL_SCHWELLE_DB) {
    e.ursache = "selbstpruefung_gruen";
    return e;
  }
  if (e.rest_db < NULL_SCHWELLE_DB) {
    e.urteil = NullUrteil::bestanden;
    return e;
  }
  e.urteil = NullUrteil::rot;
  e.ursache = "rest";
  return e;
}

std::vector<std::string> null_vorbedingungen(const cdj_z_echtzeit& f, const sw::ReglerTabelle& tab, double bpm,
                                             bool metronom_an, bool fx_master) {
  std::vector<std::string> v;
  char t[160];
  std::map<std::string, float> wert;
  for (int i = 0; i < f.n_regler && i < CDJ_Z_REGLER; ++i) {
    char pfad[49] = {0};
    std::memcpy(pfad, f.regler[i].pfad, sizeof f.regler[i].pfad);
    wert[pfad] = f.regler[i].wert;
  }
  auto ist = [&](int r) {
    const auto it = wert.find(tab.def(r).pfad);
    return it == wert.end() ? tab.def(r).vorgabe : it->second;
  };
  for (int d = 0; d < f.n_decks && d < CDJ_Z_DECKS; ++d)
    if (f.decks[d].material_id[0]) {
      std::snprintf(t, sizeof t, "deck/%d geladen (%.23s)", d + 1, f.decks[d].material_id);
      v.push_back(t);
    }
  for (const char* p : {"erz/1/fader", "erz/2/fader", "erz/3/fader", "pad/1/fader", "pad/2/fader"}) {
    const int r = tab.suche(p);
    if (r >= 0 && ist(r) > -200.0f) {
      std::snprintf(t, sizeof t, "%s = %.2f dB statt -200", p, ist(r));
      v.push_back(t);
    }
  }
  for (int r = 0; r < tab.anzahl(); ++r) {
    const char* p = tab.def(r).pfad;
    if (std::strncmp(p, "erz/4/", 6) != 0 || !std::strcmp(p, "erz/4/pfl")) continue;
    const float soll = !std::strcmp(p, "erz/4/fader") ? 0.0f : tab.def(r).vorgabe;
    if (std::fabs(ist(r) - soll) > 1e-6f) {
      std::snprintf(t, sizeof t, "%s = %.4g statt %.4g (erz/4 nicht neutral)", p, ist(r), soll);
      v.push_back(t);
    }
  }
  for (int i = 0; i < f.n_befehle && i < CDJ_Z_BEFEHLE; ++i) {
    if (f.befehle[i].art == CDJ_Z_ART_KLICK) v.push_back("Prüfklick an");
    if (f.befehle[i].art == CDJ_Z_ART_RAMPE) v.push_back("Tempo-Rampe offen");
  }
  if (f.n_segmente < 1 || f.n_segmente > CDJ_Z_SEGMENTE) {
    v.push_back("Tempo-Karte leer");
  } else {
    const cdj_z_segment& s = f.segmente[f.n_segmente - 1];
    if (std::fabs(s.bpm0 - bpm) > 1e-9 || s.k != 0.0) {
      std::snprintf(t, sizeof t, "Tempo %.6f BPM (k %.3g) statt %.6f", s.bpm0, s.k, bpm);
      v.push_back(t);
    }
  }
  if (metronom_an) v.push_back("Metronom an");
  if (fx_master) v.push_back("FX-Einheit an master (an oder noch nicht 5 s aus): der Render nimmt FX nicht mit");
  return v;
}

}  // namespace cdj
