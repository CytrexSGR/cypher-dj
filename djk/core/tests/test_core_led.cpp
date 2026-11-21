// Slice 35 part B3: LED feedback of the kern (hand_led), without JACK. Kern::hand_led_hole() is what main.cpp writes into the JACK MIDI
// buffer after zyklus(): only LEDs whose state changed (plus a full refresh after a (re)connection or a mapping swap), at most 16 per
// cycle, no allocation. Derived by the kern: deck<n>_loop (loop active on deck n) and ki_gestoppt; the rest comes through /k/led.
//   1) first cycles: every LED of the mapping goes out once as "off" (more than 16 LEDs: 16 + rest over two cycles), then silence
//   2) loop on deck 1 -> deck1_loop on exactly once (note 65 channel 1, value an), loop off -> off once; deck 2 stays silent
//   3) KI stop -> ki_gestoppt on once; /k/ki/frei -> off once
//   4) /k/led (Leitstand): vorschlag blinkt reaches the device once; a repetition sends nothing
//   5) led_neu_verbunden() (hand_led got a new connection): the whole state is sent again, blinking LEDs included
//   6) Akai APC20 mapping: deck<n>_loop is note 57 channel n, value 1 (an)
//   7) no allocation in hand_led_hole
// Failure case: the same test against the mutation "flood" (test_kern_led_mutation, WILL_FAIL): every LED goes out in every cycle.
#include <new>

#include "core35.h"

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

struct LedNachricht {
  int zyklus;
  uint8_t d[3];
};

// one cycle, then what main.cpp would send; returns the count of that cycle
static int zyklus(Lauf& x, std::vector<LedNachricht>& aus, int nr) {
  x.zyklen(x.kern->sample() + N);
  uint8_t puf[cdj::Kern::LED_MAX_JE_ZYKLUS][3];
  const int n = x.kern->hand_led_hole(puf, cdj::Kern::LED_MAX_JE_ZYKLUS);
  PRUEF(n >= 0 && n <= cdj::Kern::LED_MAX_JE_ZYKLUS);
  for (int i = 0; i < n; ++i) aus.push_back({nr, {puf[i][0], puf[i][1], puf[i][2]}});
  return n;
}
static void zyklen(Lauf& x, std::vector<LedNachricht>& aus, int& nr, int k) {
  for (int i = 0; i < k; ++i) zyklus(x, aus, nr++);
}
static int zaehle(const std::vector<LedNachricht>& v, uint8_t a, uint8_t b, int von = 0) {
  int c = 0;
  for (const auto& m : v)
    if (m.zyklus >= von && m.d[0] == a && m.d[1] == b) ++c;
  return c;
}
static int letzter(const std::vector<LedNachricht>& v, uint8_t a, uint8_t b) {
  int w = -1;
  for (const auto& m : v)
    if (m.d[0] == a && m.d[1] == b) w = m.d[2];
  return w;
}
static void loop(Lauf& x, int deck, double beats) {
  cdj::Befehl b = x.neu(cdj::Befehl::DECK_LOOP, "andreas");
  b.deck = deck;
  b.ab_beat = 0.0;
  b.politik = 1;
  b.wert_beats = beats;
  x.sende(b);
}

int main() {
  Arbeitsbestand ab("test_kern_led");
  traeger(ab.pfad, "c1c0000000000035");
  {
    Lauf x(ab.pfad, "config/controller/softcontroller.json");
    std::vector<LedNachricht> aus;
    int nr = 0;
    const int nl = x.mapping->n_leds;
    PRUEF(nl > 16);
    // 1) full state once, spread over two cycles
    const int n1 = zyklus(x, aus, nr++);
    const int n2 = zyklus(x, aus, nr++);
    PRUEF(n1 == 16);
    PRUEF(n2 == nl - 16);
    zyklen(x, aus, nr, 20);
    PRUEF((int)aus.size() == nl);  // 20 quiet cycles added nothing
    for (const auto& m : aus) PRUEF(m.d[2] == 0);   // all off
    const size_t nach_start = aus.size();

    // 2) loop on deck 1
    x.laden(1, "c1c0000000000035");
    zyklen(x, aus, nr, 10);
    PRUEF(!x.alle(cdj::Ereignis::GELADEN).empty());
    x.start(1, 2.0);
    zyklen(x, aus, nr, 200);
    PRUEF(aus.size() == nach_start);  // loading and playing is no LED event
    loop(x, 1, 4.0);
    zyklen(x, aus, nr, 200);
    PRUEF(zaehle(aus, 0x90, 65) == 2);                // initial off + on
    PRUEF(letzter(aus, 0x90, 65) == 127);
    PRUEF(zaehle(aus, 0x91, 65) == 1);                // deck 2: only the initial off
    loop(x, 1, 0.0);
    zyklen(x, aus, nr, 200);
    PRUEF(zaehle(aus, 0x90, 65) == 3 && letzter(aus, 0x90, 65) == 0);

    // 3) KI stop
    const size_t vor3 = aus.size();
    x.sende(x.neu(cdj::Befehl::KI_STOPP, "andreas"));
    zyklen(x, aus, nr, 5);
    PRUEF(aus.size() == vor3 + 1 && zaehle(aus, 0x9F, 14) == 2 && letzter(aus, 0x9F, 14) == 127);
    x.sende(x.neu(cdj::Befehl::KI_FREI, "andreas"));
    zyklen(x, aus, nr, 5);
    PRUEF(aus.size() == vor3 + 2 && zaehle(aus, 0x9F, 14) == 3 && letzter(aus, 0x9F, 14) == 0);

    // 4) /k/led: the Leitstand's LED; an unchanged repetition sends nothing
    cdj::Befehl l1 = x.neu(cdj::Befehl::LED);
    std::snprintf(l1.pfad, sizeof l1.pfad, "vorschlag");
    l1.an = 2;
    x.sende(l1);
    zyklen(x, aus, nr, 5);
    PRUEF(zaehle(aus, 0x9F, 10) == 2 && letzter(aus, 0x9F, 10) == 64);  // blinkt = value 64 of this mapping
    PRUEF(x.quittung(l1.id, 1) && x.quittung(l1.id, 3));
    cdj::Befehl l2 = x.neu(cdj::Befehl::LED);
    std::snprintf(l2.pfad, sizeof l2.pfad, "vorschlag");
    l2.an = 2;
    x.sende(l2);
    zyklen(x, aus, nr, 5);
    PRUEF(zaehle(aus, 0x9F, 10) == 2);

    // 5) new connection of hand_led: everything again (vorschlag still blinking)
    const size_t vor5 = aus.size();
    const int nr5 = nr;
    x.kern->led_neu_verbunden();
    zyklen(x, aus, nr, 5);
    PRUEF((int)(aus.size() - vor5) == nl);
    PRUEF(zaehle(aus, 0x9F, 10, nr5) == 1);
    int vk = -1;
    for (size_t i = vor5; i < aus.size(); ++i)
      if (aus[i].d[0] == 0x9F && aus[i].d[1] == 10) vk = aus[i].d[2];
    PRUEF(vk == 64);
    zyklen(x, aus, nr, 20);
    PRUEF(aus.size() - vor5 == (size_t)nl);

    // 7) no allocation
    g_allokationen = 0;
    g_waechter = true;
    {
      uint8_t puf[16][3];
      x.kern->led_neu_verbunden();
      for (int i = 0; i < 4; ++i) x.kern->hand_led_hole(puf, 16);
    }
    g_waechter = false;
    PRUEF(g_allokationen == 0);
    std::printf("led: %d LEDs in %d+%d messages, loop deck 1 on/off once, ki_gestoppt on/off once, /k/led once, resend after reconnect\n",
                nl, n1, n2);
  }

  // 6) Akai APC20 (apc20_kern.json = config/controller/apc20.json without its erz alias rows: those targets live in the page server, the core refuses them)
  {
    Lauf x(ab.pfad, "core/tests/hand/mappings/apc20_kern.json");
    std::vector<LedNachricht> aus;
    int nr = 0;
    zyklen(x, aus, nr, 3);
    PRUEF(aus.size() == 4 && zaehle(aus, 0x90, 57) == 1 && zaehle(aus, 0x93, 57) == 1);
    for (const auto& m : aus) PRUEF(m.d[2] == 0);
    x.laden(2, "c1c0000000000035");
    zyklen(x, aus, nr, 10);
    x.start(2, 2.0);
    zyklen(x, aus, nr, 200);
    loop(x, 2, 4.0);
    zyklen(x, aus, nr, 200);
    PRUEF(letzter(aus, 0x91, 57) == 1);  // note 57 channel 2, value an = 1
    PRUEF(zaehle(aus, 0x91, 57) == 2);
  }
  PRUEF_ENDE();
}
