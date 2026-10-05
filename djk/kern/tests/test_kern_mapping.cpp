// Scheibe 35, Task 8 (Plan 2026-09-26): /k/mapping tauscht das Mapping im Kern, ohne JACK. Das Netz lädt und prüft die Datei
// (test_netz_mapping) und reicht das fertige hand::Mapping als Zeiger im Befehl MAPPING herein; der Kern tauscht am Anfang
// des Zyklus, in dem der Befehl ankommt, quittiert 1, 2, 3 und gibt das alte Mapping als Ereignis MAPPING_ALT zurück (das
// Netz gibt es frei). Gemessen an CC 1/24: in softcontroller.json ohne Eintrag (ohne Wirkung, gezählt), in mvp_voll.json
// deck/1/eq/mitte relativ (+1 Raste = +0,252 dB). MIDI im Zyklus des Tauschs gilt schon nach dem neuen Mapping.
// Fehlerfall: derselbe Test gegen die Mutation „Mapping nicht getauscht“ (test_kern_mapping_mutation, WILL_FAIL).
#include <cmath>

#include "kern35.h"

bool g_waechter = false;

using namespace k35;

int main() {
  Arbeitsbestand ab("test_kern_mapping");
  Lauf x(ab.pfad, "konfig/controller/softcontroller.json");
  const hand::Mapping* alt = x.mapping.get();
  x.zyklen(4 * N);
  // vorher: CC 1/24 hat keinen Eintrag
  x.midi_bei(6 * N + 20, 0xB0, 24, 1);
  x.zyklen(8 * N);
  PRUEF(x.alle(cdj::Ereignis::REGLER, "deck/1/eq/mitte").empty());
  const uint64_t ohne = x.kern->hand_ohne_wirkung();
  PRUEF(ohne == 1);
  // Tausch auf mvp_voll: MIDI im Zyklus des Befehls, ein zweites danach
  auto* neu = new hand::Mapping();
  hand::Fehler f{};
  PRUEF(hand::lade_datei((djk() + "/kern/tests/hand/mappings/mvp_voll.json").c_str(), x.kern->stellwerk().tabelle(), neu, &f));
  cdj::Befehl b = x.neu(cdj::Befehl::MAPPING);
  b.zeiger = neu;
  x.sende(b);
  x.midi_bei(8 * N + 40, 0xB0, 24, 1);   // Zyklus des Befehls: gilt nach dem neuen Mapping
  x.midi_bei(10 * N + 40, 0xB0, 24, 127);  // danach: −1 Raste
  x.zyklen(12 * N);
  PRUEF(x.quittung(b.id, 1) && x.quittung(b.id, 2) && x.quittung(b.id, 3));
  const Q* q3 = x.quittung(b.id, 3);
  PRUEF(q3 != nullptr && q3->sample == 8 * N);
  const auto r = x.alle(cdj::Ereignis::REGLER, "deck/1/eq/mitte");
  PRUEF(r.size() == 2);
  if (r.size() == 2) {
    PRUEF(std::fabs(r[0].wert - 32.0f / 127.0f) < 1e-3f);  // +1 Raste
    PRUEF(std::fabs(r[1].wert) < 1e-3f);                    // −1 Raste
    PRUEF(r[0].sample == 8 * N + 40);
  }
  // das alte Mapping kam zurück (der Aufrufer besitzt es hier über x.mapping, er löscht es nicht)
  const auto zur = x.alle(cdj::Ereignis::MAPPING_ALT);
  PRUEF(zur.size() == 1 && zur[0].zeiger == alt);
  PRUEF(x.kern->mapping() == neu);
  std::printf("mapping: Tausch am Zyklusanfang %lld, Quittung 1 2 3, CC 1/24 vorher ohne Wirkung, danach eq/mitte %+0.4f dB und "
              "%+0.4f dB, altes Mapping zurückgegeben\n", (long long)(q3 ? q3->sample : -1), r.empty() ? 0.0 : r[0].wert,
              r.size() < 2 ? 0.0 : r[1].wert);
  delete neu;
  PRUEF_ENDE();
}
