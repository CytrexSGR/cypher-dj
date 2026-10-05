// Leere Schnittstelle (Scheibe 11, Fehlerfall vorher): Zustand ohne Regel.
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

Stellwerk::Stellwerk(const Uhr& uhr, Pruefer* pruefer) : uhr_(uhr), pruefer_(pruefer ? pruefer : &leer_pruefer_) {
  for (ReglerZustand& z : reg_) z = ReglerZustand{};
  for (Teil& t : teil_) t.belegt = false;
}
void Stellwerk::setze_direkt(int, float) {}
void Stellwerk::stems_geladen(int, bool) {}
void Stellwerk::stellung_vergessen() {}
Ereignis* Stellwerk::neues_ereignis(EreignisArt, int64_t) { return nullptr; }
void Stellwerk::quittung(const Teil&, Status, int64_t, Grund) {}
void Stellwerk::quittung_befehl(int64_t, Quelle, Status, int64_t, Grund) {}
void Stellwerk::melde_regler(int, int64_t) {}
bool Stellwerk::setze_halter(int, const Halter&, int64_t) { return false; }
Halter Stellwerk::halter_fuer(const Teil&) const { return Halter{}; }
bool Stellwerk::haelt(const Halter&, const Teil&) const { return false; }
int Stellwerk::neuer_teil() { return -1; }
void Stellwerk::laufend_rein(int) {}
void Stellwerk::laufend_raus(int) {}
void Stellwerk::beenden(int, Status, Grund, int64_t, HalterArt) {}
void Stellwerk::beenden_mit_gruppe(int, Status, Grund, int64_t, HalterArt) {}
void Stellwerk::start_parameter(Teil&, float, double, int64_t) const {}
float Stellwerk::wert_von(const Teil&, int64_t, double, bool*) const { return 0.0f; }
double Stellwerk::beat_bei(int64_t) const { return 0.0; }
int Stellwerk::slot_fuer(int, int) { return -1; }
void Stellwerk::setze_wert(int, int, float) {}

}  // namespace cypherdj::stellwerk
