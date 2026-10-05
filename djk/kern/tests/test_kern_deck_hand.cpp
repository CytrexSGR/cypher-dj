// Scheibe 35, Task 5 (Plan 2026-09-26): Play und Cue am Sample, ohne JACK. MIDI-Bytes gehen wie aus hand_in über
// Kern::hand_midi() in den Zyklus (Mapping mvp_voll.json: quant beat auf play; softcontroller.json: play ohne quant,
// also sofort), /test/hand deck/<n>/play|cue über Befehl HAND (Bezugssample max(sample, Zyklusanfang), quant beat).
// Gemessen an den Klicks links am Ring (Klick-Träger-Fassung, ein Klick je Quell-Beat) und am Träger rechts.
// Bezug der Klicklage: ein Deck, das ein /k/deck/start auf einem ganzen Beat b startet, hat den ersten Klick bei
// b · 22 500 + K (K: Limiter-Vorhalt und Lage des Maximums in der Klickform); daran misst jeder Fall ±0 Samples.
//   1) Play, stehendes Deck, Master-Beat-Phase 0,3, quant beat: erster Klick des Decks genau auf dem nächsten Master-Beat
//   2) Play, quant sofort: phasentreu, die Klicks des Decks liegen deckungsgleich auf dem Master-Raster (Phase 0,3 und 0,7)
//   3) Play auf laufendem Deck: 10-ms-Rampe, nach 480 Samples Stille
//   4) Cue laufend: Stopp, nach der Rampe auf dem Cue-Punkt; stehend anderswo: neuer Cue-Punkt; stehend am Cue-Punkt:
//      Vorschau, Loslassen hält an und springt zurück (der Softcontroller sendet sofort Note-Off: Vorschau 0 lang)
//   5) /test/hand deck/1/play mit vergangenem Sample kurz vor einem Beat: Start auf dem nächsten erreichbaren Beat, ohne
//      phasentreue Verschiebung; Sample in der Zukunft: der Beat danach; deck/1/cue über /test/hand
//   6) Deck-Halter deck/1/transport: mensch am Sample der Taste, nach 32 Beats frei (§7.3 Punkt 5, /e/halter)
//   7) Negativ-Kontrolle: leeres Deck 2 ohne Wirkung (gezählt, kein Halter), Tempo ungleich Basis ohne Wirkung, zweiter
//      Druck vor dem wartenden Start nimmt ihn zurück
// Fehlerfall: derselbe Test gegen die Mutation „Start sofort ohne Phase“ (test_kern_deck_hand_mutation, WILL_FAIL): das
// Deck startet am Griff am Frame seiner Position, die Klicks liegen um die Phase neben dem Master.
#include <cmath>

#include "kern35.h"

bool g_waechter = false;

using namespace k35;

namespace {

const char* MID = "c1c0000000000035";
constexpr const char* MVP = "kern/tests/hand/mappings/mvp_voll.json";
constexpr const char* SOFT = "konfig/controller/softcontroller.json";

void bereit(Lauf& x) {  // Deck 1 laden, Fader auf −10 dB (ab Beat 1), Ruhe bis Beat 3
  x.laden(1, MID);
  x.zyklen(10 * N);
  PRUEF(!x.alle(cdj::Ereignis::GELADEN).empty());
  x.teil("deck/1/fader", -10.0f, 1.0, 0.0);
  x.zyklen(3 * SPB);
}

void druck(Lauf& x, int64_t s, int kanal, int nr) { x.midi_bei(s, static_cast<uint8_t>(0x90 | (kanal - 1)), static_cast<uint8_t>(nr), 127); }
void loslassen(Lauf& x, int64_t s, int kanal, int nr) { x.midi_bei(s, static_cast<uint8_t>(0x80 | (kanal - 1)), static_cast<uint8_t>(nr), 0); }

// Klicklage K eines Starts auf einem ganzen Beat (Leitstand-Weg /k/deck/start, Bezug für alle Fälle)
int64_t referenz_k(const std::string& ab) {
  Lauf x(ab, SOFT);
  bereit(x);
  x.start(1, 4.0);
  x.zyklen(9 * SPB);
  const auto k = x.klicks(3 * SPB, 9 * SPB);
  PRUEF(k.size() >= 4);
  if (k.size() < 4) return 0;
  PRUEF(k[1] - k[0] == SPB && k[2] - k[1] == SPB);
  const int64_t K = k[0] - 4 * SPB;
  PRUEF(K > 0 && K < 400);
  std::printf("referenz: Klick des Starts auf Beat 4 bei Ring %lld = 4 Beats + K, K = %lld (Vorhalt Limiter %d)\n",
              (long long)k[0], (long long)K, x.vh);
  return K;
}

// Klicks des Decks nach dem Druck: erster Klick und Abstand zum zweiten
struct Klicks {
  int64_t erster = -1, zweiter = -1;
  size_t n = 0;
};
Klicks nach(const Lauf& x, int64_t von, int64_t bis) {
  const auto k = x.klicks(von, bis);
  Klicks r;
  r.n = k.size();
  if (k.size() > 0) r.erster = k[0];
  if (k.size() > 1) r.zweiter = k[1];
  return r;
}

void fall_play_beat(const std::string& ab, int64_t K) {
  Lauf x(ab, MVP);
  bereit(x);
  const int64_t s = 10 * SPB + 6750;  // Master-Beat-Phase 0,3
  druck(x, s, 1, 44);
  loslassen(x, s + 40, 1, 44);
  x.zyklen(16 * SPB);
  const Klicks k = nach(x, 10 * SPB - 100, 16 * SPB);
  std::printf("play beat: Druck bei %lld (Phase 0,3), erster Klick %lld, Soll %lld (11 Beats + K), zweiter %lld\n",
              (long long)s, (long long)k.erster, (long long)(11 * SPB + K), (long long)k.zweiter);
  PRUEF(k.erster == 11 * SPB + K);
  PRUEF(k.zweiter == 12 * SPB + K);
  // Deck-Halter am Sample der Taste (§7.3 Punkt 5)
  const auto h = x.alle(cdj::Ereignis::HALTER, "deck/1/transport");
  PRUEF(!h.empty() && h.front().sample == s && std::string(h.front().text) == "mensch");
  // Loslassen von play ohne Wirkung, gezählt; ein Druck wirkte
  PRUEF(x.kern->hand_ereignisse() == 1 && x.kern->hand_ohne_wirkung() == 1);
  // nach 32 Beats ohne Taste wieder frei (§7.3 Punkt 5, /e/halter)
  x.zyklen(s + 34 * SPB);
  const auto h2 = x.alle(cdj::Ereignis::HALTER, "deck/1/transport");
  PRUEF(h2.size() == 2 && std::string(h2.back().text) == "frei");
  if (h2.size() == 2) {
    const double beats = static_cast<double>(h2.back().sample - s) / SPB;
    std::printf("halter: mensch bei %lld, frei bei %lld = %.3f Beats später\n", (long long)h.front().sample,
                (long long)h2.back().sample, beats);
    PRUEF(beats > 31.9 && beats < 32.1);
  }
}

void fall_play_sofort(const std::string& ab, int64_t K, int64_t phase) {
  Lauf x(ab, SOFT);
  bereit(x);
  const int64_t s = 10 * SPB + phase;
  druck(x, s, 1, 44);
  loslassen(x, s + 40, 1, 44);
  x.zyklen(16 * SPB);
  const Klicks k = nach(x, 10 * SPB - 100, 16 * SPB);
  std::printf("play sofort: Druck bei %lld (Phase %.3f), erster Klick %lld, Soll %lld, zweiter %lld\n", (long long)s,
              (double)phase / SPB, (long long)k.erster, (long long)(11 * SPB + K), (long long)k.zweiter);
  PRUEF(k.erster == 11 * SPB + K);  // das Deck läuft ab dem Griff, seine Beats liegen auf dem Master-Raster
  PRUEF(k.zweiter == 12 * SPB + K);
}

void fall_play_laufend(const std::string& ab) {
  Lauf x(ab, SOFT);
  bereit(x);
  x.start(1, 4.0);
  const int64_t s = 10 * SPB + 1000;
  druck(x, s, 1, 44);
  x.zyklen(12 * SPB);
  PRUEF(x.huelle(s + x.vh - 200) > 0.1);          // vor der Taste läuft der Träger
  PRUEF(x.huelle(s + x.vh + 100) > 0.05);         // in der Rampe klingt er noch, leiser
  PRUEF(x.huelle(s + x.vh + 100) < x.huelle(s + x.vh - 200));
  PRUEF(x.huelle(s + x.vh + 481) < 1e-3);         // nach 480 Samples Stille (unter −44 dB: Ausschwingen der Filter)
  PRUEF(x.huelle(s + x.vh + 3000) < 1e-6);
  PRUEF(!x.kern->deck(1).laeuft());
  std::printf("play laufend: Träger vor der Taste %.4f, nach 100 Samples %.4f, nach 481 Samples %.6f\n",
              x.huelle(s + x.vh - 200), x.huelle(s + x.vh + 100), x.huelle(s + x.vh + 481));
}

// Befund 2026-09-27 (Andreas am Digital-Out: „nicht mehr sync“): Deck mitten im Beat angehalten, dann Play. Ohne
// Quantize startete die angehaltene Stelle auf dem Master-Beat und lief um den Bruchteil versetzt. Jetzt rastet der
// Start auf den nächsten Beat des Tracks: jeder Klick liegt wieder auf b · SPB + K.
void fall_play_nach_stopp(const std::string& ab, int64_t K) {
  Lauf x(ab, MVP);  // MVP-Mapping: Play mit Quantisierung beat, wie die Oberfläche (/test/hand)
  bereit(x);
  x.start(1, 4.0);
  const int64_t s1 = 10 * SPB + 7777;  // anhalten mitten im Beat
  druck(x, s1, 1, 44);
  loslassen(x, s1 + 40, 1, 44);
  x.zyklen(s1 + 3000);
  PRUEF(!x.kern->deck(1).laeuft());
  const int64_t stand = x.kern->deck(1).position();
  const int64_t s2 = 14 * SPB + 5000;  // Play: Start auf Master-Beat 15
  druck(x, s2, 1, 44);
  loslassen(x, s2 + 40, 1, 44);
  x.zyklen(19 * SPB);
  const Klicks k = nach(x, s2, 19 * SPB);
  PRUEF(k.n >= 3);
  PRUEF(k.erster >= 0 && (k.erster - K) % SPB == 0);
  PRUEF(k.zweiter - k.erster == SPB);
  std::printf("play nach stopp: Deck stand bei %lld (Beat-Rest %lld), erster Klick %lld, Rest zum Raster %lld\n",
              (long long)stand, (long long)(stand % SPB), (long long)k.erster, (long long)((k.erster - K) % SPB));
}

void fall_cue(const std::string& ab, int64_t K) {
  Lauf x(ab, SOFT);
  bereit(x);
  PRUEF(x.kern->cue_punkt(1) == 0 && x.kern->deck(1).position() == 0);  // nach dem Laden: Cue-Punkt = erste Takt-Eins
  // Cue laufend: anhalten, nach der Rampe auf dem Cue-Punkt
  x.start(1, 4.0);
  const int64_t c1 = 8 * SPB + 300;
  druck(x, c1, 1, 45);
  loslassen(x, c1 + 30, 1, 45);
  x.zyklen(c1 + 2000);
  PRUEF(!x.kern->deck(1).laeuft());
  PRUEF(x.kern->deck(1).position() == x.kern->cue_punkt(1) && x.kern->deck(1).position() == 0);
  PRUEF(x.huelle(c1 + x.vh + 481) < 1e-3);
  // Play (sofort), später Play: anhalten mitten im Stück; dort steht das Deck anderswo als am Cue-Punkt
  const int64_t p1 = 10 * SPB + 1234;
  druck(x, p1, 1, 44);
  x.zyklen(p1 + 3 * SPB);
  const int64_t p2 = 14 * SPB + 77;
  druck(x, p2, 1, 44);
  x.zyklen(p2 + 4000);
  const int64_t stand = x.kern->deck(1).position();
  PRUEF(!x.kern->deck(1).laeuft() && stand > 0);
  // Cue stehend anderswo: neuer Cue-Punkt, das Deck bleibt stehen
  const int64_t c2 = 15 * SPB;
  druck(x, c2, 1, 45);
  loslassen(x, c2 + 30, 1, 45);
  x.zyklen(c2 + 2000);
  // Quantize (2026-09-27): der Cue-Punkt rastet auf den nächsten Beat des Tracks ein, das Deck selbst bleibt stehen
  const int64_t cue = x.kern->cue_punkt(1);
  PRUEF(cue % SPB == 0 && std::llabs(cue - stand) <= SPB / 2 && cue != stand && x.kern->deck(1).position() == stand);
  PRUEF(!x.kern->deck(1).laeuft());
  // Cue am Cue-Punkt: Vorschau, der Softcontroller lässt sofort los: 0 lang, Halt mit Rampe, zurück auf den Cue-Punkt
  const int64_t c3 = 16 * SPB + 100;
  druck(x, c3, 1, 45);
  loslassen(x, c3 + 200, 1, 45);
  x.zyklen(c3 + 120);
  PRUEF(x.kern->deck(1).laeuft());  // Vorschau läuft, solange gedrückt
  x.zyklen(c3 + 1500);
  PRUEF(!x.kern->deck(1).laeuft() && x.kern->deck(1).position() == cue);
  PRUEF(x.huelle(c3 + x.vh + 200 + 481) < 1e-3);
  // Cue am Cue-Punkt, gehalten: Vorschau läuft, Loslassen hält an und springt zurück
  const int64_t c4 = 17 * SPB;
  druck(x, c4, 1, 45);
  x.zyklen(c4 + 6000);
  PRUEF(x.kern->deck(1).laeuft());
  const int64_t c5 = c4 + 6500;
  loslassen(x, c5, 1, 45);
  x.zyklen(c5 + 3000);
  PRUEF(!x.kern->deck(1).laeuft() && x.kern->deck(1).position() == cue);
  // Play in der Vorschau: das Deck bleibt an
  const int64_t c6 = 19 * SPB;
  druck(x, c6, 1, 45);
  druck(x, c6 + 2000, 1, 44);
  loslassen(x, c6 + 2500, 1, 45);
  x.zyklen(c6 + 8000);
  PRUEF(x.kern->deck(1).laeuft());
  // Cue laufend: zurück auf den (nicht verschobenen) Cue-Punkt
  const int64_t c7 = 20 * SPB;
  druck(x, c7, 1, 45);
  x.zyklen(c7 + 3000);
  PRUEF(!x.kern->deck(1).laeuft() && x.kern->deck(1).position() == cue);
  std::printf("cue: erster Cue-Punkt 0, neuer Cue-Punkt %lld (Deck stand bei %lld, auf den Beat gerastet), Vorschau 0 lang und gehalten kehren dorthin zurück (K %lld)\n",
              (long long)cue, (long long)stand, (long long)K);
}

void fall_test_hand(const std::string& ab, int64_t K) {
  Lauf x(ab, SOFT);
  bereit(x);
  // vergangenes Sample kurz vor Beat 12: der Zyklus mit Beat 12 beginnt bei 269 824
  x.zyklen(269'824);
  PRUEF(x.kern->sample() == 269'824);
  x.test_hand("deck/1/play", 1.0f, 269'000);  // schon vergangen: Bezug ist der Zyklusanfang, nächster Beat 12
  x.zyklen(16 * SPB);
  Klicks k = nach(x, 269'000, 16 * SPB);
  std::printf("/test/hand play, Sample 269000 vor dem Zyklus 269824: erster Klick %lld, Soll %lld\n", (long long)k.erster,
              (long long)(12 * SPB + K));
  PRUEF(k.erster == 12 * SPB + K);  // nächster erreichbarer Beat, keine phasentreue Verschiebung, kein Start am Blockanfang
  PRUEF(k.zweiter == 13 * SPB + K);
  PRUEF(x.kern->hand_ereignisse() == 1);
  // Cue laufend über /test/hand (Druck), Loslassen (0) ohne Vorschau ohne Wirkung
  x.test_hand("deck/1/cue", 1.0f, 17 * SPB);
  x.test_hand("deck/1/cue", 0.0f, 17 * SPB + 50);
  x.zyklen(18 * SPB);
  PRUEF(!x.kern->deck(1).laeuft() && x.kern->deck(1).position() == x.kern->cue_punkt(1));
  // Sample in der Zukunft: Start auf dem Beat nach diesem Sample
  x.zyklen(18 * SPB + 4 * N);
  const int64_t vor = 21 * SPB - 50;
  x.test_hand("deck/1/play", 1.0f, vor);
  x.zyklen(24 * SPB);
  const auto kk = x.klicks(20 * SPB, 24 * SPB);
  PRUEF(!kk.empty() && kk[0] == 21 * SPB + K);
  PRUEF(x.kern->hand_ereignisse() == 3);  // play, cue-Druck, play; das Loslassen ohne Vorschau zählt nicht
}

void fall_negativ(const std::string& ab, int64_t K) {
  (void)K;
  // leeres Deck 2: ohne Wirkung, gezählt, kein Halter
  {
    Lauf x(ab, MVP);
    bereit(x);
    const uint64_t ohne = x.kern->hand_ohne_wirkung();
    druck(x, 8 * SPB + 5, 2, 44);
    x.zyklen(9 * SPB);
    PRUEF(x.kern->hand_ohne_wirkung() == ohne + 1);
    PRUEF(x.alle(cdj::Ereignis::HALTER, "deck/2/transport").empty());
    PRUEF(!x.kern->deck(2).laeuft());
  }
  // Tempo ungleich Basis: kein Stretcher im MVP (Plan 31 F8), Play ohne Wirkung
  {
    Lauf x(ab, MVP);
    bereit(x);
    cdj::Befehl b = x.neu(cdj::Befehl::SET_NEU);
    b.bpm = 130.0;
    x.sende(b);
    x.zyklen(4 * SPB);
    const uint64_t ohne = x.kern->hand_ohne_wirkung();
    druck(x, x.kern->sample() + 2 * SPB + 9, 1, 44);
    x.zyklen(x.kern->sample() + 6 * SPB);
    PRUEF(x.kern->hand_ohne_wirkung() == ohne + 1);
    PRUEF(!x.kern->deck(1).laeuft());
  }
  // zweiter Druck vor dem wartenden Start nimmt ihn zurück (quant beat: Start erst am Beat 11)
  {
    Lauf x(ab, MVP);
    bereit(x);
    druck(x, 10 * SPB + 6750, 1, 44);
    druck(x, 10 * SPB + 6750 + 4000, 1, 44);
    x.zyklen(14 * SPB);
    PRUEF(!x.kern->deck(1).laeuft());
    PRUEF(x.klicks(10 * SPB, 14 * SPB).empty());
  }
  std::printf("negativ: leeres Deck, Tempo 130 gegen Basis 128 und zurückgenommener Start ohne Klick\n");
}

}  // namespace

int main() {
  Arbeitsbestand ab("test_kern_deck_hand");
  traeger(ab.pfad, MID);
  const int64_t K = referenz_k(ab.pfad);
  fall_play_beat(ab.pfad, K);
  fall_play_sofort(ab.pfad, K, 6750);
  fall_play_sofort(ab.pfad, K, 15750);
  fall_play_laufend(ab.pfad);
  fall_play_nach_stopp(ab.pfad, K);
  fall_cue(ab.pfad, K);
  fall_test_hand(ab.pfad, K);
  fall_negativ(ab.pfad, K);
  PRUEF_ENDE();
}
