// Scheibe 35, Task 2 (Plan 2026-09-26): Fader-Griff vom Softcontroller am Sample, ohne JACK. MIDI-Bytes gehen wie aus
// dem Eingang hand_in über Kern::hand_midi() in den Zyklus; übersetzt mit softcontroller.json (CC 1/7 = deck/1/fader,
// eigene Kurve fader_db); gemessen am Audio-Ring (Master rechts: 12-kHz-Träger der Klick-Träger-Fassung) und an /e/hand.
//   1) Ereignis bei Versatz 185 im Block ab 142 592 wirkt bei 142 777 (§7.3 Punkt 1), am Ring um den Vorhalt des
//      Master-Limiters dahinter; der erste Wert davor ändert nichts (§7.3 Punkt 2); dazu der Versatz des Deck-Starts am
//      Ring (Bezug der Latenz-Definition V am Ziel) gegen den des Fader-Griffs
//   2) Negativ-Kontrolle: 1 Beat ohne MIDI keine /e/hand; Nachricht ohne Eintrag, Pitch-Bend, zu kurze Nachricht ohne
//      Wirkung (gezählt); Neuverbindung: der nächste Wert ist wieder nur Stellung
//   3) Überlauf: 300 Ereignisse in einem Zyklus, 256 übersetzt, 44 gezählt; keine Allokation im Zyklus mit MIDI
//   4) /k/set/neu und MIDI im selben Zyklus: der Griff liegt auf der neuen Zeitachse (Versatz ab Sample 0, Plan 35 E1)
// Fehlerfall: derselbe Test gegen die Mutation „Folgeblock“ (test_kern_midi_mutation, WILL_FAIL): 142 848 statt 142 777.
#include <new>

#include "kern35.h"

bool g_waechter = false;
static long g_allokationen = 0;
void* operator new(std::size_t n) {
  if (g_waechter) ++g_allokationen;
  void* p = std::malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

using namespace k35;

static void bereit(Lauf& x, const char* mid, float fader_db) {  // Deck 1: laden, Fader bei Beat 1, Start bei Beat 2
  x.laden(1, mid);
  x.zyklen(10 * N);
  PRUEF(!x.alle(cdj::Ereignis::GELADEN).empty());
  x.teil("deck/1/fader", fader_db, 1.0, 0.0);
  x.start(1, 2.0);
  x.zyklen(4 * SPB);
}

static void fall_versatz(const std::string& ab) {
  Lauf x(ab);
  bereit(x, "c1c0000000000035", -10.0f);
  const double alt = 0.5 * gain(-10.0);
  PRUEF_NAH(x.huelle(3 * SPB), alt, alt * 0.02);  // Kanalzug bei 12 kHz flach (±0,1 dB, Abnahme 04)
  // Versatz des Deck-Starts am Ring (Stille -> Träger bei Beat 2 = Sample 45 000)
  const int64_t start_ring = x.sprung(2 * SPB - 400, 2 * SPB + 1000, 0.0, alt);
  // Negativ-Kontrolle: 1 Beat ohne MIDI
  x.zyklen(5 * SPB);
  PRUEF(x.alle(cdj::Ereignis::HAND).empty());
  // erster Wert (20): nur Stellung (0 Änderung am Ring, keine /e/hand)
  x.midi_bei(120'037, 0xB0, 7, 20);
  x.zyklen(142'592);
  PRUEF(x.alle(cdj::Ereignis::HAND).empty());
  for (int64_t n = 4 * SPB; n < 142'592 - 2 * N; n += 97) PRUEF_NAH(x.huelle(n), alt, alt * 0.02);
  // zweiter Wert (30): Versatz 185 im Block ab 142 592 -> wirkt bei 142 777
  x.midi_bei(142'777, 0xB0, 7, 30);
  PRUEF(x.midi.back().s0 == 142'592 && x.midi.back().versatz == 185);  // vor dem Zyklus: Block und Versatz
  x.zyklen(7 * SPB);
  const auto h = x.alle(cdj::Ereignis::HAND);
  PRUEF(h.size() == 1);
  const int64_t s_hand = h.empty() ? -1 : h[0].sample;
  PRUEF(s_hand == 142'777);
  const double neu = x.huelle(142'777 + x.vh + 200);
  PRUEF(neu > alt * 1.1);  // die Hand zieht den Fader auf (Übernahme skaliert, aufwärts)
  const int64_t sp = x.sprung(142'777 + x.vh - 300, 142'777 + x.vh + 300, alt, neu);
  PRUEF(sp == 142'777 + x.vh || sp == 142'777 + x.vh - 1);  // Hülle über zwei Samples: s oder s − 1
  std::printf("versatz: /e/hand bei %lld (Soll 142777), Sprung am Ring %lld = Griff + %lld; Deck-Start am Ring %lld = "
              "Beat 2 + %lld; Vorhalt Limiter %d; Hülle %.5f -> %.5f\n",
              (long long)s_hand, (long long)sp, (long long)(sp - 142'777), (long long)start_ring,
              (long long)(start_ring - 2 * SPB), x.vh, alt, neu);
  // Deck-Start und Griff: derselbe Pfad. F10 (Welle 2): der Start aus dem Stand blendet über DECK_START_EIN Frames linear
  // ein, die Hülle kreuzt die halbe Höhe DECK_START_EIN / 2 Samples nach dem Startsample.
  PRUEF(start_ring >= 2 * SPB + x.vh + cdj::DECK_START_EIN / 2 - 1 && start_ring <= 2 * SPB + x.vh + cdj::DECK_START_EIN / 2 + 1);

  // 2) Negativ-Kontrolle: Nachricht ohne Eintrag (CC 4/99), Pitch-Bend, zu kurz: ohne Wirkung und ohne Meldung
  const uint64_t ohne = x.kern->hand_ohne_wirkung();
  const size_t n_hand = x.alle(cdj::Ereignis::HAND).size();
  x.midi_bei(8 * SPB + 5, 0xB3, 99, 1);
  x.midi_bei(8 * SPB + 9, 0xE0, 0, 64);
  x.zyklen(9 * SPB);
  const uint8_t kurz[2] = {0xB0, 7};
  x.kern->hand_midi(kurz, 2, 3);
  x.zyklen(9 * SPB + N);
  PRUEF(x.alle(cdj::Ereignis::HAND).size() == n_hand);
  PRUEF(x.kern->hand_ohne_wirkung() == ohne + 3);
  // Neuverbindung (§7.3 Punkt 2): der nächste Wert ist wieder nur Stellung, der übernächste wirkt
  x.kern->hand_neu_verbunden();
  x.midi_bei(10 * SPB + 17, 0xB0, 7, 90);
  x.vor(11 * SPB);
  PRUEF(x.alle(cdj::Ereignis::HAND).size() == n_hand);
  x.midi_bei(11 * SPB + 33, 0xB0, 7, 100);
  x.zyklen(12 * SPB);
  const auto h2 = x.alle(cdj::Ereignis::HAND);
  PRUEF(h2.size() == n_hand + 1 && h2.back().sample == 11 * SPB + 33);

  // 3) Überlauf und keine Allokation: 300 Ereignisse in einem Zyklus
  const uint64_t ueber = x.kern->hand_ueberlauf();
  const uint64_t ereignisse = x.kern->hand_ereignisse();
  for (int i = 0; i < 300; ++i) x.midi_bei(13 * SPB - 13 * SPB % N + (i % N), 0xB0, 7, static_cast<uint8_t>(i % 128));
  x.bewachen = true;
  x.zyklen(14 * SPB);
  x.bewachen = false;
  PRUEF(x.kern->hand_ueberlauf() == ueber + 44);
  PRUEF(x.kern->hand_ereignisse() == ereignisse + 256);
  PRUEF(g_allokationen == 0);
  std::printf("ueberlauf: %llu verworfen, %llu uebersetzt, Allokationen im Zyklus %ld\n",
              (unsigned long long)(x.kern->hand_ueberlauf() - ueber),
              (unsigned long long)(x.kern->hand_ereignisse() - ereignisse), g_allokationen);
}

// 4) /k/set/neu und MIDI im selben Zyklus: der Griff wirkt am Versatz der neuen Zeitachse
static void fall_set_neu(const std::string& ab) {
  Lauf x(ab);
  x.zyklen(20 * N);
  x.midi_bei(20 * N + 10, 0xB0, 7, 40);  // Stellung
  x.zyklen(40 * N);
  cdj::Befehl b = x.neu(cdj::Befehl::SET_NEU);
  b.bpm = 128.0;
  x.sende(b);
  x.midi_bei(40 * N + 100, 0xB0, 7, 50);  // kommt im Zyklus des /k/set/neu an
  x.zyklen(42 * N);
  const auto h = x.alle(cdj::Ereignis::HAND);
  for (const auto& e : h) std::printf("set_neu: /e/hand %s %.3f bei %lld\n", e.pfad, e.wert, (long long)e.sample);
  PRUEF(h.size() == 1 && h[0].sample == 100);
  std::printf("set_neu: /e/hand bei %lld (Soll 100 auf der neuen Zeitachse)\n", h.empty() ? -1LL : (long long)h[0].sample);
}

int main() {
  Arbeitsbestand ab("test_kern_midi");
  traeger(ab.pfad, "c1c0000000000035");
  fall_versatz(ab.pfad);
  fall_set_neu(ab.pfad);
  PRUEF_ENDE();
}
