// Hand SYNC (quant takt) aligns the BAR phase of the deck to the deck that is playing, not to the clock bar.
// Repro of the J1 tour finding: deck 1 started by hand PLAY on a non-bar beat (quant beat), four bars later deck 2 SYNC:
// the kicks sat on one grid, but the downbeats were one beat apart. Decided semantics (CDJ phase meter): the track beat of
// the SYNC deck at its start point is congruent mod 4 to the reference deck's track beat at the same clock point, both
// counted from the first downbeat (erste_eins_quell_beat). With no other deck playing, SYNC keeps the clock-bar start.
// Measured on Deck::quell_beat_bei of both decks at one sample (offset in beats, mod 4; 0 = the downbeats meet).
#include <cmath>

#include "core35.h"

bool g_waechter = false;

using namespace k35;

namespace {

constexpr const char* SYNC_MAPPING = "core/tests/hand/mappings/sync_takt.json";
const char* MIDS[4] = {"d0c0000000000035", "d1c0000000000035", "d2c0000000000035", "d3c0000000000035"};  // erste_eins 0..3
const char* MID1 = MIDS[0];
const char* MID2 = MIDS[2];

void druck(Lauf& x, int64_t s, int kanal, int nr) {
  x.midi_bei(s, static_cast<uint8_t>(0x90 | (kanal - 1)), static_cast<uint8_t>(nr), 127);
}

double bar_phase(const Lauf& x, int deck, int64_t s) {
  const cdj::Deck& d = x.kern->deck(deck);
  const double p = std::fmod(d.quell_beat_bei(s) - d.material()->erste_eins_quell_beat, 4.0);
  return p < 0 ? p + 4.0 : p;
}

// Bar offset of deck 2 against deck 1 in [-2, 2) beats at the current kernel sample (0: downbeats meet)
double versatz(const Lauf& x) {
  const int64_t s = x.kern->sample();
  double v = std::fmod(bar_phase(x, 2, s) - bar_phase(x, 1, s), 4.0);
  if (v < -2.0) v += 4.0;
  if (v >= 2.0) v -= 4.0;
  return v;
}

// Clock beat at which deck 2 started (anchor sample / SPB)
double start_beat(const Lauf& x, int deck) { return static_cast<double>(x.kern->deck(deck).anker_s()) / SPB; }

void bereit(Lauf& x, const char* m1 = MID1, const char* m2 = MID2) {
  x.laden(1, m1);
  x.laden(2, m2);
  x.zyklen(10 * N);
  PRUEF(x.kern->deck(1).geladen() && x.kern->deck(2).geladen());
  x.teil("deck/1/fader", -10.0f, 1.0, 0.0);
  x.teil("deck/2/fader", -10.0f, 1.0, 0.0);
  x.zyklen(3 * SPB);
}

// /k/deck/start as the page sends it: ab_beat = the bar it computed, quell_beat = the first downbeat of the track; takt 1 = politik 3
int64_t seite_start(Lauf& x, int deck, double ab_beat, double quell, bool takt) {
  cdj::Befehl b = x.neu(cdj::Befehl::DECK_START, "andreas");
  b.deck = deck;
  b.ab_beat = ab_beat;
  b.quell_beat = quell;
  b.politik = 0;
  b.takt = takt ? 1 : 0;
  return x.sende(b);
}

}  // namespace

int main() {
  Arbeitsbestand ab("test_kern_hand_sync_takt");
  for (int e = 0; e < 4; ++e) traeger(ab.pfad, MIDS[e], ("--erste-eins " + std::to_string(e)).c_str());

  {  // 1) repro: deck 1 PLAY on clock beat 11 (track beat 0), deck 2 SYNC after four bars. Old: deck 2 at clock beat 20, offset 1
    Lauf x(ab.pfad, SYNC_MAPPING);
    bereit(x);
    druck(x, 10 * SPB + 6750, 1, 44);
    druck(x, 16 * SPB + 100, 2, 46);
    x.zyklen(26 * SPB);
    const double v = versatz(x);
    std::printf("repro: deck 1 started at clock beat %.3f, deck 2 SYNC at %.3f, bar offset %.4f beats\n", start_beat(x, 1),
                start_beat(x, 2), v);
    PRUEF(x.kern->deck(1).laeuft() && x.kern->deck(2).laeuft());
    PRUEF_NAH(start_beat(x, 1), 11.0, 0.001);
    PRUEF_NAH(v, 0.0, 0.01);
    PRUEF(start_beat(x, 2) >= 16.0);  // never before the press
  }
  {  // 2) deck 1 started mid-bar from track beat 2 (clock beat 8), deck 2 SYNC at 14: deck 2 beat 1 meets deck 1 beat 1
    Lauf x(ab.pfad, SYNC_MAPPING);
    bereit(x);
    x.start(1, 8.0, 2.0);
    druck(x, 14 * SPB + 100, 2, 46);
    x.zyklen(26 * SPB);
    const double v = versatz(x);
    std::printf("mid-bar: deck 1 from track beat 2, deck 2 started at clock beat %.3f, bar offset %.4f beats\n",
                start_beat(x, 2), v);
    PRUEF(x.kern->deck(2).laeuft());
    PRUEF_NAH(v, 0.0, 0.01);
  }
  {  // 3) no other deck playing: SYNC keeps the clock-bar start (clock beat 16, track beat 0 there)
    Lauf x(ab.pfad, SYNC_MAPPING);
    bereit(x);
    druck(x, 14 * SPB + 100, 2, 46);
    x.zyklen(24 * SPB);
    std::printf("alone: deck 2 started at clock beat %.3f\n", start_beat(x, 2));
    PRUEF(x.kern->deck(2).laeuft());
    PRUEF_NAH(start_beat(x, 2), 16.0, 0.001);
  }
  {  // 4) every erste_eins of both decks (0..3): the bars meet whatever the downbeat offset of either track
    for (int er = 0; er < 4; ++er)
      for (int ed = 0; ed < 4; ++ed) {
        Lauf x(ab.pfad, SYNC_MAPPING);
        bereit(x, MIDS[er], MIDS[ed]);
        druck(x, 10 * SPB + 6750, 1, 44);
        druck(x, 16 * SPB + 100, 2, 46);
        x.zyklen(26 * SPB);
        const double v = versatz(x);
        std::printf("eins ref %d, sync %d: deck 2 at clock beat %.3f, bar offset %.4f\n", er, ed, start_beat(x, 2), v);
        PRUEF(x.kern->deck(2).laeuft());
        PRUEF_NAH(v, 0.0, 0.01);
      }
    // a decks stands at its first downbeat, so the cases above start every track on its own downbeat. Deck 1 from track beat 2
    // at clock beat 8 makes the reference bar depend on erste_eins: the first beat >= 14 with (B - 6) = eins_ref (mod 4)
    const double erwartet[4] = {18.0, 15.0, 16.0, 17.0};
    for (int er = 0; er < 4; ++er)
      for (int ed = 0; ed < 4; ++ed) {
        Lauf x(ab.pfad, SYNC_MAPPING);
        bereit(x, MIDS[er], MIDS[ed]);
        x.start(1, 8.0, 2.0);
        druck(x, 14 * SPB + 100, 2, 46);
        x.zyklen(26 * SPB);
        const double v = versatz(x);
        std::printf("mid-bar eins ref %d, sync %d: deck 2 at clock beat %.3f, bar offset %.4f\n", er, ed, start_beat(x, 2), v);
        PRUEF_NAH(v, 0.0, 0.01);
        PRUEF_NAH(start_beat(x, 2), erwartet[er], 0.002);
      }
  }
  {  // 5) /k/deck/start with takt (the page SYNC): same alignment, start never before ab_beat
    Lauf x(ab.pfad, SYNC_MAPPING);
    bereit(x);
    druck(x, 10 * SPB + 6750, 1, 44);
    x.zyklen(15 * SPB);
    seite_start(x, 2, 20.0, 2.0, true);  // page: next bar 20, quell_beat = first downbeat of deck 2's track (eins 2)
    x.zyklen(30 * SPB);
    const double v = versatz(x);
    std::printf("page start: deck 2 at clock beat %.3f, bar offset %.4f\n", start_beat(x, 2), v);
    PRUEF(x.kern->deck(2).laeuft());
    PRUEF_NAH(v, 0.0, 0.01);
    PRUEF(start_beat(x, 2) >= 20.0 && start_beat(x, 2) < 24.0);
    PRUEF_NAH(start_beat(x, 2), 23.0, 0.001);  // deck 1 beat 1 at 11, 15, 19, 23
  }
  {  // 6) the same start without takt (ab beat/jetzt, the conductor): untouched, exactly ab_beat
    Lauf x(ab.pfad, SYNC_MAPPING);
    bereit(x);
    druck(x, 10 * SPB + 6750, 1, 44);
    x.zyklen(15 * SPB);
    seite_start(x, 2, 20.0, 2.0, false);
    x.zyklen(30 * SPB);
    std::printf("page start without takt: deck 2 at clock beat %.3f\n", start_beat(x, 2));
    PRUEF_NAH(start_beat(x, 2), 20.0, 0.001);
  }
  {  // 7) page start with takt and no other deck: exactly ab_beat as today
    Lauf x(ab.pfad, SYNC_MAPPING);
    bereit(x);
    x.zyklen(15 * SPB);
    seite_start(x, 2, 20.0, 2.0, true);
    x.zyklen(30 * SPB);
    PRUEF_NAH(start_beat(x, 2), 20.0, 0.001);
  }
  {  // 8) a reference deck with a waiting stop is no reference (deck 1 stops at beat 18): clock bar 16
    Lauf x(ab.pfad, SYNC_MAPPING);
    bereit(x);
    druck(x, 10 * SPB + 6750, 1, 44);
    x.zyklen(13 * SPB);
    x.stopp(1, 18.0);
    x.zyklen(13 * SPB + N);
    druck(x, 14 * SPB + 100, 2, 46);
    x.zyklen(20 * SPB);
    std::printf("stopping reference: deck 2 at clock beat %.3f\n", start_beat(x, 2));
    PRUEF_NAH(start_beat(x, 2), 16.0, 0.001);
  }
  {  // 9) a reference deck in cue preview (cue held) is no reference: clock bar 16
    Lauf x(ab.pfad, SYNC_MAPPING);
    bereit(x);
    druck(x, 8 * SPB + 100, 1, 45);  // deck 1 stands at its cue point: preview while held
    x.zyklen(12 * SPB);
    PRUEF(x.kern->deck(1).laeuft());
    druck(x, 14 * SPB + 100, 2, 46);
    x.zyklen(20 * SPB);
    std::printf("preview reference: deck 2 at clock beat %.3f\n", start_beat(x, 2));
    PRUEF_NAH(start_beat(x, 2), 16.0, 0.001);
  }
  PRUEF_ENDE();
}
