// Scheibe 35, Task 3 (Plan 2026-09-26): Mixer-Griffe des MVP über das Mapping, ohne JACK. MIDI-Bytes gehen wie aus
// hand_in über Kern::hand_midi() in den Zyklus; gemessen wird an /e/regler (Wert, Halter) und /e/halter des Kerns.
//   A) softcontroller.json (die Datei, die der Betrieb lädt): deck/1/fader absolut (erster Wert nur Stellung),
//      deck/1/eq/tief relativ zweierkomplement, deck/2/eq/tief relativ versatz64 (je +1 und −1 Raste, Kurve −26 bis
//      +6 dB), deck/1/filter absolut (Übernahme skaliert), deck/1/kill/tief und deck/1/pfl (Taste schaltet um, Loslassen
//      ohne Wirkung), xfader (eigene Kurve −1 bis 1), Berührung deck/1/fader (Halter, kein Wert); Negativ-Kontrolle
//      Nachricht ohne Eintrag
//   B) mvp_voll.json (tests/hand/mappings): dieselben Wege für die Pfade, die der Softcontroller nicht hat (eq/mitte,
//      eq/hoch, trim, kill/mitte, kill/hoch, deck/2/filter), und je Deck alle 12 Pfade plus xfader im Mapping; play und
//      cue tragen quant beat bzw. Vorgabe und werden vom Übersetzer als Deck-Aktion erkannt (die Wirkung ist Task 5)
// Fehlerfall: derselbe Test gegen die Mutation „Kodierung vertauscht“ (test_kern_mixer_mutation, WILL_FAIL): der Encoder
// läuft in die falsche Richtung.
#include <cmath>

#include "kern35.h"

bool g_waechter = false;

using namespace k35;

namespace {

constexpr double EQ_RASTE = 32.0 / 127.0;  // eine Raste am EQ: (max − min) / 127 dB, Kurve linear −26 bis +6

struct Spiel {
  Lauf x;
  int64_t t = 5 * N;  // nächster Zeitpunkt; jedes Ereignis in einem eigenen Zyklus, zwei Zyklen Abstand
  Spiel(const std::string& ab, const char* mapping) : x(ab, mapping) { x.zyklen(4 * N); }
  void byte3(uint8_t a, uint8_t b, uint8_t c) {
    x.midi_bei(t + 17, a, b, c);
    t += 2 * N;
    x.zyklen(t);
  }
  void cc(int kanal, int nr, int wert) { byte3(static_cast<uint8_t>(0xB0 | (kanal - 1)), static_cast<uint8_t>(nr), static_cast<uint8_t>(wert)); }
  void note_an(int kanal, int nr) { byte3(static_cast<uint8_t>(0x90 | (kanal - 1)), static_cast<uint8_t>(nr), 127); }
  void note_aus(int kanal, int nr) { byte3(static_cast<uint8_t>(0x80 | (kanal - 1)), static_cast<uint8_t>(nr), 0); }
  // Werte der /e/regler eines Pfads in der Reihenfolge des Eintreffens
  std::vector<float> regler(const char* pfad) const {
    std::vector<float> v;
    for (const auto& e : x.alle(cdj::Ereignis::REGLER, pfad))
      if (std::string(e.text) == "mensch") v.push_back(e.wert);
    return v;
  }
};

void nah(const char* was, double ist, double soll, double tol) {
  const bool ok = std::fabs(ist - soll) <= tol;
  if (!ok) std::printf("ROT %s: %.5f, erwartet %.5f (± %.5f)\n", was, ist, soll, tol);
  PRUEF(ok);
}

// Ein Regler-Pfad mit relativem Encoder: +1 Raste, dann −1 Raste (Kodierung der Datei), Wert vorher 0 dB
void encoder(Spiel& s, const char* pfad, int kanal, int nr, int plus, int minus) {
  const size_t n0 = s.regler(pfad).size();
  s.cc(kanal, nr, plus);
  s.cc(kanal, nr, minus);
  const auto v = s.regler(pfad);
  PRUEF(v.size() == n0 + 2);
  if (v.size() == n0 + 2) {
    nah((std::string(pfad) + " +1 Raste").c_str(), v[n0], EQ_RASTE, 1e-3);
    nah((std::string(pfad) + " −1 Raste").c_str(), v[n0 + 1], 0.0, 1e-3);
  }
}

// Schalter (kill/*, pfl): Note-an schaltet um, Note-aus ändert nichts
void schalter(Spiel& s, const char* pfad, int kanal, int nr) {
  const size_t n0 = s.regler(pfad).size();
  s.note_an(kanal, nr);
  s.note_aus(kanal, nr);
  s.note_an(kanal, nr);
  const auto v = s.regler(pfad);
  PRUEF(v.size() == n0 + 2);
  if (v.size() == n0 + 2) {
    nah((std::string(pfad) + " an").c_str(), v[n0], 1.0, 1e-6);
    nah((std::string(pfad) + " aus").c_str(), v[n0 + 1], 0.0, 1e-6);
  }
}

// Absoluter Regler mit Vorgabe u0 (Stellung 0..1): erster Wert 127 (nur Stellung, basis 1,0), zweiter Wert 64: die
// Übernahme skaliert, der Wert folgt in Drehrichtung: u = u0 · p / basis mit basis 1, p = 64/127
double folgt(double u0) { return u0 * 64.0 / 127.0; }

void absolut_skaliert(Spiel& s, const char* pfad, int kanal, int nr, double min, double max, double u0) {
  const size_t n0 = s.regler(pfad).size();
  s.cc(kanal, nr, 127);
  PRUEF(s.regler(pfad).size() == n0);  // erster Wert: nur Stellung, keine /e/regler
  s.cc(kanal, nr, 64);
  const auto v = s.regler(pfad);
  PRUEF(v.size() == n0 + 1);
  if (v.size() == n0 + 1) nah((std::string(pfad) + " absolut").c_str(), v[n0], min + (max - min) * folgt(u0), 1e-3);
}

void fall_softcontroller(const std::string& ab) {
  Spiel s(ab, "konfig/controller/softcontroller.json");
  // Berührung (vor jedem Griff, sonst hält die Hand den Fader schon): Halter mensch, kein Wert
  const size_t hn = s.x.alle(cdj::Ereignis::HALTER, "deck/1/fader").size();
  const size_t rn = s.regler("deck/1/fader").size();
  s.note_an(1, 38);
  const auto h = s.x.alle(cdj::Ereignis::HALTER, "deck/1/fader");
  // §5.7: bei jedem Halterwechsel kommt /e/regler mit dem unveränderten Wert (Vorgabe −200 dB), sonst nichts
  PRUEF(s.regler("deck/1/fader").size() == rn + 1);
  PRUEF(!s.regler("deck/1/fader").empty() && s.regler("deck/1/fader").back() == -200.0f);
  PRUEF(h.size() == hn + 1 && !h.empty() && std::string(h.back().text) == "mensch");
  // deck/1/fader absolut, Kurve fader_db: erster Wert 0 nur Stellung, zweiter Wert 64 von Vorgabe −200 dB (Stellung 0)
  s.cc(1, 7, 0);
  PRUEF(s.regler("deck/1/fader").size() == rn + 1);
  s.cc(1, 7, 64);
  auto f = s.regler("deck/1/fader");
  PRUEF(f.size() == rn + 2);
  if (f.size() == rn + 2) nah("deck/1/fader 64", f[rn + 1], 20.0 * std::log10(64.0 / 127.0), 1e-3);
  // EQ: relativ, beide Kodierungen, vorher 0 dB
  encoder(s, "deck/1/eq/tief", 1, 20, 1, 127);   // zweierkomplement: 1 = +1, 127 = −1
  encoder(s, "deck/2/eq/tief", 2, 20, 65, 63);   // versatz64: 65 = +1, 63 = −1
  // Kill unter Minimum (§7.2 kill_unter_min): 3 · 64 (= −64 Rasten) drehen den EQ ganz herunter, er wird stumm
  for (int i = 0; i < 3; ++i) s.cc(1, 20, 64);
  PRUEF(!s.regler("deck/1/eq/tief").empty() && s.regler("deck/1/eq/tief").back() <= -100.0f);
  // Filter: Vorgabe 0 (Stellung 0,5)
  absolut_skaliert(s, "deck/1/filter", 1, 21, -1.0, 1.0, 0.5);
  // Schalter
  schalter(s, "deck/1/kill/tief", 1, 36);
  schalter(s, "deck/1/pfl", 1, 37);
  // Crossfader, eigene Kurve linear −1..1, Vorgabe 0 (Stellung 0,5): erster Wert 0 nur Stellung, zweiter 32: Stellung
  // 0,5 + p · 0,5 (Basis 0), Wert = p = 32/127
  s.cc(16, 8, 0);
  PRUEF(s.regler("xfader").empty());
  s.cc(16, 8, 32);
  const auto xf = s.regler("xfader");
  PRUEF(xf.size() == 1);
  if (!xf.empty()) nah("xfader 32", xf[0], 32.0 / 127.0, 1e-3);
  // Negativ-Kontrolle: CC ohne Eintrag ändert nichts und meldet nichts
  const size_t alle_regler = s.x.alle(cdj::Ereignis::REGLER).size();
  const uint64_t ohne = s.x.kern->hand_ohne_wirkung();
  s.cc(1, 99, 77);
  PRUEF(s.x.alle(cdj::Ereignis::REGLER).size() == alle_regler);
  PRUEF(s.x.kern->hand_ohne_wirkung() == ohne + 1);
  std::printf("softcontroller: fader %.4f dB, eq/tief +1 Raste %.4f dB, xfader %.4f, kill/tief 1 -> 0, pfl 1 -> 0\n",
              f.empty() ? 0.0 : f.back(), s.regler("deck/1/eq/tief").empty() ? 0.0 : s.regler("deck/1/eq/tief")[0],
              xf.empty() ? 0.0 : xf[0]);
}

void fall_mvp_voll(const std::string& ab) {
  Spiel s(ab, "kern/tests/hand/mappings/mvp_voll.json");
  // je Deck 12 Pfade plus xfader stehen im Mapping
  static const char* PFADE[12] = {"fader",    "trim",      "eq/tief",   "eq/mitte", "eq/hoch", "kill/tief",
                                  "kill/mitte", "kill/hoch", "filter", "pfl",       "play",    "cue"};
  const hand::Mapping& m = *s.x.mapping;
  int gefunden = 0;
  for (int d = 1; d <= 2; ++d)
    for (const char* p : PFADE) {
      char z[48];
      std::snprintf(z, sizeof z, "deck/%d/%s", d, p);
      bool da = false;
      for (int i = 0; i < m.n_eintraege; ++i) da |= std::strcmp(m.eintrag[i].ziel, z) == 0;
      PRUEF(da);
      gefunden += da;
    }
  bool xf = false;
  for (int i = 0; i < m.n_eintraege; ++i) xf |= std::strcmp(m.eintrag[i].ziel, "xfader") == 0;
  PRUEF(xf);
  PRUEF(gefunden == 24);
  // play und cue: Deck-Aktion mit quant beat auf play, Vorgabe sofort auf cue
  hand::Uebersetzer u(s.x.mapping.get());
  hand::Ausgabe a;
  const uint8_t play1[3] = {0x90, 44, 127}, cue2[3] = {0x91, 45, 127};
  PRUEF(u.ereignis(play1, 3, 0, 0, N, &a) == 1);
  PRUEF(a.art == hand::AusgabeArt::deck);
  PRUEF(m.eintrag[a.eintrag].aktion == hand::DeckAktion::play && m.eintrag[a.eintrag].deck == 1);
  PRUEF(m.eintrag[a.eintrag].quant == hand::Quant::beat);
  PRUEF(u.ereignis(cue2, 3, 0, 0, N, &a) == 1);
  PRUEF(m.eintrag[a.eintrag].aktion == hand::DeckAktion::cue && m.eintrag[a.eintrag].deck == 2);
  PRUEF(m.eintrag[a.eintrag].quant == hand::Quant::sofort);
  // Wirkung der Pfade, die der Softcontroller nicht hat
  encoder(s, "deck/1/eq/mitte", 1, 24, 1, 127);
  encoder(s, "deck/2/eq/hoch", 2, 25, 65, 63);
  encoder(s, "deck/1/eq/hoch", 1, 25, 1, 127);
  encoder(s, "deck/2/eq/mitte", 2, 24, 65, 63);
  absolut_skaliert(s, "deck/1/trim", 1, 19, -24.0, 24.0, 0.5);
  absolut_skaliert(s, "deck/2/trim", 2, 19, -24.0, 24.0, 0.5);
  absolut_skaliert(s, "deck/2/filter", 2, 21, -1.0, 1.0, 0.5);
  schalter(s, "deck/1/kill/mitte", 1, 34);
  schalter(s, "deck/1/kill/hoch", 1, 35);
  schalter(s, "deck/2/kill/tief", 2, 36);
  schalter(s, "deck/2/kill/mitte", 2, 34);
  schalter(s, "deck/2/kill/hoch", 2, 35);
  schalter(s, "deck/2/pfl", 2, 37);
  std::printf("mvp_voll: 24 Deck-Pfade und xfader im Mapping, eq/mitte, eq/hoch, trim, kill/mitte, kill/hoch, deck/2/filter wirken\n");
}

}  // namespace

int main() {
  Arbeitsbestand ab("test_kern_mixer");
  fall_softcontroller(ab.pfad);
  fall_mvp_voll(ab.pfad);
  PRUEF_ENDE();
}
