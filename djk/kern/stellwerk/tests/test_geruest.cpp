// Scheibe 11, Task 1: das Gerüst baut, die Kopfdatei ist vollständig, ein Stellwerk entsteht und läuft einen Zyklus.
#include <memory>

#include "pruef.h"
#include "cypherdj/stellwerk/stellwerk.h"

using namespace cypherdj::stellwerk;

namespace {
struct KonstantUhr final : Uhr {
  double beat(int64_t s) const override { return static_cast<double>(s) * 128.0 / 60.0 / SR; }
  double sample_genau(double b) const override { return b * 60.0 / 128.0 * SR; }
  double bpm(int64_t) const override { return 128.0; }
};
}  // namespace

FALL(stellwerk_entsteht_und_laeuft_einen_zyklus) {
  KonstantUhr uhr;
  auto sw = std::make_unique<Stellwerk>(uhr);
  PRUEFE_GLEICH(sw->jetzt(), 0);
  sw->prozess(0, 256);
  PRUEFE_GLEICH(sw->jetzt(), 256);
  const Aenderung* a;
  PRUEFE_GLEICH(sw->aenderungen(&a), 0);
}

FALL(namen_der_codes_stehen_wie_im_vertrag) {
  PRUEFE(std::strcmp(name(Grund::ueberlappung), "ueberlappung") == 0);
  PRUEFE(std::strcmp(name(Grund::ki_gestoppt), "ki_gestoppt") == 0);
  PRUEFE_GLEICH(static_cast<int>(Status::abgebrochen), 7);
  Quelle q;
  PRUEFE(quelle_aus_text("cypher", &q) && q == Quelle::cypher);
  PRUEFE(!quelle_aus_text("niemand", &q));
  Halter h;
  h.art = HalterArt::plan;
  std::snprintf(h.plan, TEXT, "p17");
  char t[TEXT];
  halter_text(h, t, TEXT);
  PRUEFE(std::strcmp(t, "plan:p17") == 0);
}

PRUEF_MAIN
