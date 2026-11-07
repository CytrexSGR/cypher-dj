// /k/hand/frei (INTERFACES 4.3): a project switch releases the human hand holder, so the new project's mixer values are not refused with
// regler_beim_menschen. Offline over Kern::zyklus (as test_kern_ki).
//  1. Control: while the human holds deck/3/fader, a /k/teil on it is refused at its start (regler_beim_menschen).
//  2. /k/hand/frei from cypher is refused (nur_andreas); the holder stays.
//  3. /k/hand/frei from andreas for deck/3/: the next /k/teil on deck/3/fader runs; deck/1/fader (grip on a DIFFERENT path, not in the list)
//     is still held and its /k/teil is refused (negative control).
//  4. Without any grip, the command acknowledges and changes nothing.
#include <cstdio>

#include "cypherdj/zustand.h"
#include "kern25.h"
#include "pruef.h"

using B = cdj::Befehl;

int main() {
  Kern25 k;
  k.hand("deck/3/fader", 0.0f, 45'000);
  k.hand("deck/3/fader", 1.0f, 67'500);   // holder mensch, back after 32 beats (787 500)
  k.hand("deck/1/fader", 0.0f, 45'000);
  k.hand("deck/1/fader", 1.0f, 67'500);
  k.bis(90'000);
  k.teil(3, "andreas", "", 0, "deck/3/fader", 8.0, 0.0, -6.0f, 0, 1, "", "");   // beat 8 = sample 180 000: the hand still holds
  k.bis(200'000);
  k.einfach(B::HAND_FREI, 4, "cypher", "deck/3/");
  k.bis(220'000);
  k.einfach(B::HAND_FREI, 5, "andreas", "deck/3/");
  k.bis(250'000);
  k.teil(6, "andreas", "", 0, "deck/3/fader", 14.0, 0.0, -9.0f, 0, 1, "", "");   // beat 14 = 315 000, inside the old hold time
  k.teil(7, "andreas", "", 0, "deck/1/fader", 14.0, 0.0, -9.0f, 0, 1, "", "");
  k.bis(400'000);

  const cdj::Ereignis* q;
  PRUEF((q = k.q(3, 6)) && !std::strcmp(q->grund, "regler_beim_menschen"));   // 1. control: refused while held
  PRUEF((q = k.q(4, 6)) && !std::strcmp(q->grund, "nur_andreas"));            // 2.
  PRUEF(k.q(4, 1) == nullptr && k.q(4, 3) == nullptr);
  PRUEF(k.q(5, 1) && k.q(5, 3));                                              // 3.
  PRUEF(k.q(6, 6) == nullptr);
  PRUEF(k.q(6, 2) || k.q(6, 3));                                              // the project value runs
  PRUEF_NAH(k.wert_bei("deck/3/fader", 399'000), -9.0, 0.02);
  PRUEF((q = k.q(7, 6)) && !std::strcmp(q->grund, "regler_beim_menschen"));   // other path: still held
  bool frei_beim_befehl = false;   // /e/halter frei at the command (cycle of sample 220 000), not only later when part 6 ends
  for (const auto& e : k.ev)
    if (e.art == cdj::Ereignis::HALTER && !std::strcmp(e.pfad, "deck/3/fader") && !std::strcmp(e.text, "frei") && e.sample >= 220'000 && e.sample < 221'100)
      frei_beim_befehl = true;
  PRUEF(frei_beim_befehl);

  // 4. negative control: no grip on deck/2/fader, the command is a no-op
  k.einfach(B::HAND_FREI, 8, "andreas", "deck/2/");
  k.teil(9, "andreas", "", 0, "deck/2/fader", 20.0, 0.0, -3.0f, 0, 1, "", "");
  k.bis(600'000);
  PRUEF(k.q(8, 1) && k.q(8, 3));
  PRUEF(k.q(9, 6) == nullptr && (k.q(9, 2) || k.q(9, 3)));
  // 5. restart: the core restores the holder in the SECOND cycle after fortsetzen (kern.cpp nachreichen_in_, kern_stellwerk.cpp teile_nachreichen).
  //    A /k/hand/frei that arrives before that cycle must still win: the holder must not come back after it.
  {
    Kern25 a;
    a.hand("deck/1/eq/hoch", 0.2f, 1'500'000);
    a.hand("deck/1/eq/hoch", 0.4f, 1'510'000);   // holder mensch for 32 beats
    a.bis(1'620'000);
    auto f = std::make_unique<cdj_z_echtzeit>();
    std::memset(f.get(), 0, sizeof *f);
    a.kern->abbild(*f);
    f->anker_sample = a.kern->sample() - 256;
    f->quantum = 256;
    for (const char* pfade : {"deck/1/", "deck/2/"}) {   // second round: the control, a list that does not name the regulator
      Kern25 b;
      b.mitschreiben = true;
      PRUEF(b.kern->wiederherstellen(*f));
      b.kern->fortsetzen(1'624'096);
      b.einfach(B::HAND_FREI, 30, "andreas", pfade);   // queued before the first cycle of the new generation
      b.bis(1'700'000);
      const int r = b.kern->stellwerk().tabelle().suche("deck/1/eq/hoch");
      const bool mensch = b.kern->stellwerk().halter(r).art == cypherdj::stellwerk::HalterArt::mensch;
      PRUEF(mensch == (pfade[5] == '2'));   // released for deck/1/, still held (restored) for deck/2/
    }
  }
  std::puts("ok test_kern_hand_frei");
  return 0;
}
