#include "cypherdj/neustart.h"

#include <unistd.h>

#include <cstdio>
#include <fstream>

#include "cypherdj/bremse.h"

namespace cdj {

namespace {

// Audit F20: Datei `neustarts` neben der Zustandsdatei, eine Zeile "zaehler stand". Fehlt sie oder ist sie unlesbar: (0, 0).
std::string neustarts_pfad(const std::string& pfad) {
  const auto k = pfad.rfind('/');
  return (k == std::string::npos ? std::string() : pfad.substr(0, k + 1)) + "neustarts";
}

void lies_neustarts(const std::string& datei, int& zaehler, uint64_t& stand) {
  zaehler = 0;
  stand = 0;
  std::ifstream f(datei);
  long long z = 0;
  unsigned long long s = 0;
  if (f >> z >> s && z >= 0) {
    zaehler = static_cast<int>(z > BREMSE_MAX ? BREMSE_MAX : z);
    stand = s;
  }
}

// atomar: tmp + rename; ein Fehler hier darf den Start nicht verhindern
bool schreibe_neustarts(const std::string& datei, int zaehler, uint64_t stand) {
  const std::string tmp = datei + ".tmp";
  {
    std::ofstream f(tmp, std::ios::trunc);
    f << zaehler << ' ' << stand << '\n';
    if (!f) {
      unlink(tmp.c_str());
      return false;
    }
  }
  if (std::rename(tmp.c_str(), datei.c_str()) != 0) {
    unlink(tmp.c_str());
    return false;
  }
  return true;
}

}  // namespace

Betrieb::Betrieb() : puffer_(std::make_unique<cdj_z_echtzeit>()) {}

Wiederaufnahme Betrieb::starte(const std::string& pfad, Kern& kern, bool ohne_zustand) {
  Wiederaufnahme w;
  if (ohne_zustand) {
    w.meldung = "ohne Zustand (Prüfschalter --ohne-zustand)";
    return w;
  }
  w.datei_ok = datei_.oeffne(pfad);
  w.meldung = datei_.meldung();
  if (!w.datei_ok) return w;  // der Kern läuft ohne Zustand weiter, wie in Scheibe 08
  cdj_z_datei* d = datei_.daten();
  const int i = z_neuestes(d->echtzeit, *puffer_, 3);  // der alte Kern ist tot: 3 Versuche reichen
  const cdj_z_echtzeit& f = *puffer_;
  // Bremse (F20): Starts ohne Fortschritt zählen; ab dem dritten setzt der Kern nicht mehr aus dem Zustand fort.
  const std::string nd = neustarts_pfad(pfad);
  int zaehler_alt = 0;
  uint64_t stand_alt = 0;
  lies_neustarts(nd, zaehler_alt, stand_alt);
  const BremsUrteil urteil = bremse(zaehler_alt, stand_alt, i >= 0 ? f.stand : 0);
  if (!schreibe_neustarts(nd, urteil.zaehler, i >= 0 ? f.stand : 0))
    w.meldung += ", Bremse aus: neustarts nicht schreibbar (" + nd + ")";
  if (i >= 0) {
    w.stand = f.stand;
    if (urteil.ohne_zustand) {
      w.meldung += ", Absturzschleife: " + std::to_string(urteil.zaehler) + " Starts ohne Fortschritt, starte ohne Zustand";
      kern.nur_ki_stopp_wiederherstellen(f);
    } else if (kern.wiederherstellen(f)) {
      anker_ = Anker{f.anker_sample, f.anker_mono_ns, f.anker_frames};
      fortsetzen_ = true;
      w.fortgesetzt = true;
      w.n_segmente = f.n_segmente;
      w.n_befehle = f.n_befehle;
    } else {
      w.meldung += ", Fach mit Stand " + std::to_string(f.stand) + " unbrauchbar: neue Zeitachse";
    }
  }
  w.generation = kern.generation();
  schreiber_.verbinde(d->echtzeit, w.stand);
  if (z_neuestes(d->abos, abos_, 3) >= 0 && abos_.n >= 0 && abos_.n <= CDJ_Z_ABONNENTEN) {
    n_abos_ = abos_.n;
    abo_stand_ = abos_.stand;
  }
  w.n_abonnenten = n_abos_;
  return w;
}

void Betrieb::netz_anschliessen(Netz& netz, int64_t jetzt_ns) {
  if (!datei_.daten()) return;  // ohne Zustand: das Netz arbeitet wie in Scheibe 08
  netz.verbinde_zustand(datei_.daten(), abo_stand_);
  netz.setze_abonnenten(abos_.a, n_abos_, jetzt_ns);
}

void Betrieb::zyklus_anfang(uint32_t frames, int64_t mono_ns, Kern& kern) noexcept {
  if (erster_vorbei_rt_) return;
  erster_vorbei_rt_ = true;
  if (fortsetzen_) {
    fort_ = setze_fort(anker_, frames, mono_ns);
    kern.fortsetzen(fort_.sample);
  }
  erster_vorbei_.store(true, std::memory_order_release);
}

void Betrieb::zyklus_ende(uint32_t frames, int64_t mono_ns, uint32_t n, const Kern& kern) noexcept {
  zyklen_.fetch_add(1, std::memory_order_relaxed);
  if (!schreiber_.verbunden()) return;
  cdj_z_echtzeit* f = schreiber_.beginne();
  f->anker_sample = kern.sample() - static_cast<int64_t>(n);  // Blockanfang dieses Zyklus, nach den Befehlen
  f->anker_mono_ns = mono_ns;
  f->anker_frames = frames;
  f->quantum = n;
  kern.abbild(*f);
  schreiber_.beende();
}

bool Betrieb::warte_erster_zyklus(int max_ms) const {
  for (int t = 0; t < max_ms; ++t) {
    if (erster_vorbei_.load(std::memory_order_acquire)) return true;
    usleep(1000);
  }
  return erster_vorbei_.load(std::memory_order_acquire);
}

}  // namespace cdj
