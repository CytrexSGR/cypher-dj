// S19 (MIDI learn for graph knobs): the learn table is a second Mapping-v1 slot that translates only the raw generic input
// midi_ein_1 (hand_in keeps slot 0 alone). No JACK: bytes reach the kern through Kern::midi_ein() / Kern::hand_midi() and
// are translated in the cycle that contains them, with the same Hand semantics as slot 0 (first value primes, scaled
// takeover). Cases:
//   1) bk_ziel_laedt: a Mapping-v1 file with a bk target loads (closes the "no test loads a bk target" gap); an unknown bk
//      index fails with unbekanntes_ziel on line 2
//   2) lern_cc_bewegt_bk: CC 74 on midi_ein_1 moves erz/5/bk/3 with the scaled takeover of the Hand
//   3) hand_in_nicht: the same CC on hand_in does not reach slot 1
//   4) ohne_eintrag: negative control, a CC and a note without entry change no knob; without a table nothing is counted
//   5) tausch_slot1: Befehl MAPPING nr 1 swaps slot 1 only, the old pointer comes back as MAPPING_ALT
//   6) slot0_unberuehrt: Befehl MAPPING nr 0 swaps slot 0 only
//   8..15) capture: /k/lernen arms the kern, the first CC on midi_ein_1 is consumed and reported as GELERNT (id, quelle, kanal,
//      nr, wert, belegt); notes do not capture, the 20 s countdown survives /k/set/neu, disarm, re-arm, hand_in is reported
//      but not consumed, midi_ein_1 wins when both ports deliver in one cycle
// Failure case: the mutation tests (test_kern_lernen_*_mutation) must fail.
#include <cmath>

#include "kern35.h"

bool g_waechter = false;

using namespace k35;

static const char* LERN_BK = "kern/tests/hand/mappings/lernen_bk.json";
static const char* LERN_KAPUTT = "kern/tests/hand/mappings/lernen_kaputt.json";

// 1) the bk target resolves; an unknown bk index is refused with its line
static void fall_bk_ziel_laedt() {
  Arbeitsbestand ab("test_kern_lernen_1");
  Lauf x(ab.pfad);
  const auto& t = x.kern->stellwerk().tabelle();
  hand::Mapping m{};
  hand::Fehler f{};
  PRUEF(hand::lade_datei((djk() + "/" + LERN_BK).c_str(), t, &m, &f));
  PRUEF(m.n_eintraege == 1);
  if (m.n_eintraege == 1) {
    PRUEF(m.eintrag[0].regler == t.suche("erz/5/bk/3"));
    PRUEF(m.eintrag[0].regler >= 0);
    PRUEF(!m.eintrag[0].eigene_kurve);
  }
  PRUEF(!std::strcmp(m.geraet, "lernen"));
  hand::Mapping k{};
  PRUEF(!hand::lade_datei((djk() + "/" + LERN_KAPUTT).c_str(), t, &k, &f));
  PRUEF(f.art == hand::FehlerArt::unbekanntes_ziel);
  PRUEF(f.zeile == 2);
  std::printf("bk_ziel_laedt: erz/5/bk/3 -> regler %d, without own curve; erz/5/bk/9 refused: %s\n",
              m.n_eintraege == 1 ? m.eintrag[0].regler : -1, f.text);
}

// 2) CC 74 on midi_ein_1 moves erz/5/bk/3: the first value primes, the second takes over scaled (stellwerk/src/hand.cpp)
static void fall_lern_cc_bewegt_bk() {
  Arbeitsbestand ab("test_kern_lernen_2");
  Lauf x(ab.pfad);
  PRUEF(x.lern_laden(LERN_BK));
  x.zyklen(2 * N);
  x.midi_ein_bei(4 * N + 10, 0xB0, 74, 64);
  x.zyklen(6 * N);
  PRUEF(x.alle(cdj::Ereignis::REGLER, "erz/5/bk/3").empty());  // first value only primes
  x.midi_ein_bei(8 * N + 20, 0xB0, 74, 100);
  x.zyklen(10 * N);
  const auto r = x.alle(cdj::Ereignis::REGLER, "erz/5/bk/3");
  PRUEF(r.size() == 1);
  const double basis = 64.0 / 127.0, p = 100.0 / 127.0;
  const double soll = 0.5 + (p - basis) * (1.0 - 0.5) / (1.0 - basis);
  if (r.size() == 1) {
    PRUEF_NAH(r[0].wert, soll, 1e-4);
    PRUEF(r[0].sample == 8 * N + 20);
  }
  PRUEF(x.kern->lern_ereignisse() == 2);
  std::printf("lern_cc_bewegt_bk: erz/5/bk/3 = %.6f at sample %lld (expected %.6f), lern_ereignisse %llu\n",
              r.empty() ? -1.0 : r[0].wert, r.empty() ? -1LL : (long long)r[0].sample, soll,
              (unsigned long long)x.kern->lern_ereignisse());
}

// 3) the same CC on hand_in does not reach slot 1 (A3)
static void fall_hand_in_nicht() {
  Arbeitsbestand ab("test_kern_lernen_3");
  Lauf x(ab.pfad);
  PRUEF(x.lern_laden(LERN_BK));
  x.zyklen(2 * N);
  const uint64_t ohne = x.kern->hand_ohne_wirkung();
  x.midi_bei(4 * N + 10, 0xB0, 74, 64);
  x.midi_bei(6 * N + 20, 0xB0, 74, 100);
  x.zyklen(8 * N);
  PRUEF(x.alle(cdj::Ereignis::REGLER, "erz/5/bk/3").empty());
  PRUEF(x.kern->hand_ohne_wirkung() == ohne + 2);  // softcontroller.json has no CC 74
  PRUEF(x.kern->lern_ereignisse() == 0);
  std::printf("hand_in_nicht: hand_ohne_wirkung +%llu, lern_ereignisse %llu, no REGLER on erz/5/bk/3\n",
              (unsigned long long)(x.kern->hand_ohne_wirkung() - ohne), (unsigned long long)x.kern->lern_ereignisse());
}

// 4) negative control: events without an entry change nothing; without a table nothing of slot 1 is counted (A4), the
// raw ring still sees them
static void fall_ohne_eintrag() {
  Arbeitsbestand ab("test_kern_lernen_4");
  {
    Lauf x(ab.pfad);
    PRUEF(x.lern_laden(LERN_BK));
    x.zyklen(2 * N);
    x.midi_ein_bei(4 * N + 10, 0xB0, 75, 64);
    x.midi_ein_bei(4 * N + 20, 0x90, 60, 100);
    x.zyklen(8 * N);
    for (int d = 1; d <= 4; ++d) {
      char pfad[32];
      std::snprintf(pfad, sizeof pfad, "deck/%d/bk/3", d);
      PRUEF(x.alle(cdj::Ereignis::REGLER, pfad).empty());
    }
    PRUEF(x.alle(cdj::Ereignis::REGLER, "erz/5/bk/3").empty());
    PRUEF(x.kern->lern_ohne_wirkung() == 2);
    PRUEF(x.kern->lern_ereignisse() == 0);
    std::printf("ohne_eintrag: lern_ohne_wirkung %llu (CC 75 and a note), no REGLER\n",
                (unsigned long long)x.kern->lern_ohne_wirkung());
  }
  {
    Lauf x(ab.pfad);  // no table
    x.zyklen(2 * N);
    x.midi_ein_bei(4 * N + 10, 0xB0, 74, 64);
    x.midi_ein_bei(4 * N + 20, 0x90, 60, 100);
    x.zyklen(8 * N);
    PRUEF(x.kern->lern_ohne_wirkung() == 0);
    PRUEF(x.kern->lern_ereignisse() == 0);
    PRUEF(x.kern->midi_ein_ring().gesehen() == 2);  // the raw input stays raw
    PRUEF(x.kern->lern_mapping() == nullptr);
  }
}

// 5) Befehl MAPPING nr 1 swaps slot 1 only; the swapped-out table returns as MAPPING_ALT; MIDI of the swap cycle already
// follows the new table
static void fall_tausch_slot1() {
  Arbeitsbestand ab("test_kern_lernen_5");
  Lauf x(ab.pfad);
  const hand::Mapping* slot0 = x.kern->mapping();
  x.zyklen(2 * N);
  PRUEF(x.kern->lern_mapping() == nullptr);
  auto* a = new hand::Mapping();
  auto* b = new hand::Mapping();
  hand::Fehler f{};
  PRUEF(hand::lade_datei((djk() + "/" + LERN_BK).c_str(), x.kern->stellwerk().tabelle(), a, &f));
  PRUEF(hand::lade_datei((djk() + "/" + LERN_BK).c_str(), x.kern->stellwerk().tabelle(), b, &f));
  // first swap: no table before, so nothing comes back
  cdj::Befehl c1 = x.neu(cdj::Befehl::MAPPING);
  c1.nr = 1;
  c1.zeiger = a;
  x.sende(c1);
  x.midi_ein_bei(4 * N + 10, 0xB0, 74, 64);   // the swap cycle: primes
  x.midi_ein_bei(4 * N + 20, 0xB0, 74, 100);  // and moves, because the new table is already in force
  x.zyklen(6 * N);
  PRUEF(x.quittung(c1.id, 1) && x.quittung(c1.id, 2) && x.quittung(c1.id, 3));
  PRUEF(x.kern->lern_mapping() == a);
  PRUEF(x.kern->mapping() == slot0);
  PRUEF(x.alle(cdj::Ereignis::MAPPING_ALT).empty());
  const auto r = x.alle(cdj::Ereignis::REGLER, "erz/5/bk/3");
  PRUEF(r.size() == 1 && r[0].sample == 4 * N + 20);
  // second swap: the first table comes back
  cdj::Befehl c2 = x.neu(cdj::Befehl::MAPPING);
  c2.nr = 1;
  c2.zeiger = b;
  x.sende(c2);
  x.zyklen(8 * N);
  PRUEF(x.quittung(c2.id, 3) != nullptr);
  PRUEF(x.kern->lern_mapping() == b);
  PRUEF(x.kern->mapping() == slot0);
  const auto alt = x.alle(cdj::Ereignis::MAPPING_ALT);
  PRUEF(alt.size() == 1 && alt[0].zeiger == a);
  std::printf("tausch_slot1: slot 1 swapped twice, slot 0 untouched, MAPPING_ALT returned the first table, REGLER in swap cycle at %lld\n",
              r.empty() ? -1LL : (long long)r[0].sample);
  delete a;
  delete b;
}

// 6) regression of the existing path: nr 0 (default) swaps slot 0 only
static void fall_slot0_unberuehrt() {
  Arbeitsbestand ab("test_kern_lernen_6");
  Lauf x(ab.pfad);
  PRUEF(x.lern_laden(LERN_BK));
  x.zyklen(2 * N);
  auto* neu = new hand::Mapping();
  hand::Fehler f{};
  PRUEF(hand::lade_datei((djk() + "/kern/tests/hand/mappings/mvp_voll.json").c_str(), x.kern->stellwerk().tabelle(), neu, &f));
  const hand::Mapping* alt0 = x.kern->mapping();
  cdj::Befehl c = x.neu(cdj::Befehl::MAPPING);
  c.zeiger = neu;  // nr stays 0
  x.sende(c);
  x.zyklen(4 * N);
  PRUEF(x.quittung(c.id, 3) != nullptr);
  PRUEF(x.kern->mapping() == neu);
  PRUEF(x.kern->lern_mapping() == x.lern.get());
  const auto alt = x.alle(cdj::Ereignis::MAPPING_ALT);
  PRUEF(alt.size() == 1 && alt[0].zeiger == alt0);
  std::printf("slot0_unberuehrt: nr 0 swapped slot 0, the learn table stayed\n");
  delete neu;
}

// ---- capture (/k/lernen, /e/gelernt) ----

static int64_t scharf(Lauf& x, int64_t id_fest = 0, int an = 1, const char* quelle = "andreas") {
  cdj::Befehl b = x.neu(cdj::Befehl::LERNEN, quelle);
  if (id_fest) b.id = id_fest;
  b.an = an;
  x.sende(b);
  return b.id;
}

// 8) the first CC after arming is consumed and reported; the next one is translated again
static void fall_faengt_erstes_cc() {
  Arbeitsbestand ab("test_kern_lernen_8");
  Lauf x(ab.pfad);
  PRUEF(x.lern_laden(LERN_BK));
  x.zyklen(2 * N);
  x.midi_ein_bei(3 * N + 5, 0xB0, 74, 10);  // negative control: disarmed, so no capture (and it primes the knob)
  x.zyklen(4 * N);
  PRUEF(x.alle(cdj::Ereignis::GELERNT).empty());
  const uint64_t l0 = x.kern->lern_ereignisse();
  const int64_t id = scharf(x, 501);
  x.midi_ein_bei(6 * N + 7, 0xB0, 74, 64);
  x.zyklen(8 * N);
  PRUEF(x.quittung(id, 1) && x.quittung(id, 3));
  const auto g = x.alle(cdj::Ereignis::GELERNT);
  PRUEF(g.size() == 1);
  if (g.size() == 1) {
    PRUEF(g[0].id == 501 && g[0].deck == 1 && g[0].fassung == 1 && g[0].teil == 74 && g[0].neu == 64 && g[0].status == 0);
  }
  PRUEF(x.kern->lern_ereignisse() == l0);  // consumed: not translated
  x.midi_ein_bei(10 * N + 9, 0xB0, 74, 90);
  x.zyklen(12 * N);
  PRUEF(x.alle(cdj::Ereignis::GELERNT).size() == 1);  // disarmed by the capture
  PRUEF(x.kern->lern_ereignisse() == l0 + 1);          // translated again
  std::printf("faengt_erstes_cc: GELERNT id %lld quelle %d kanal %d nr %d wert %d belegt %d; consumed (lern_ereignisse %llu -> %llu), next CC translated\n",
              g.empty() ? -1LL : (long long)g[0].id, g.empty() ? -1 : g[0].deck, g.empty() ? -1 : g[0].fassung,
              g.empty() ? -1 : g[0].teil, g.empty() ? -1 : g[0].neu, g.empty() ? -1 : g[0].status, (unsigned long long)l0,
              (unsigned long long)x.kern->lern_ereignisse());
}

// 9) belegt: the base mapping already owns CC ch1 nr7 (softcontroller.json)
static void fall_belegt() {
  Arbeitsbestand ab("test_kern_lernen_9");
  Lauf x(ab.pfad);
  x.zyklen(2 * N);
  scharf(x, 502);
  x.midi_ein_bei(4 * N + 3, 0xB0, 7, 100);
  x.zyklen(6 * N);
  const auto g = x.alle(cdj::Ereignis::GELERNT);
  PRUEF(g.size() == 1 && g[0].status == 1 && g[0].teil == 7);
  std::printf("belegt: GELERNT belegt %d for CC 1/7 (also works without a learn table)\n", g.empty() ? -1 : g[0].status);
}

// 10) notes and pitch bend do not capture and do not disarm
static void fall_nur_cc() {
  Arbeitsbestand ab("test_kern_lernen_10");
  Lauf x(ab.pfad);
  x.zyklen(2 * N);
  scharf(x, 503);
  x.midi_ein_bei(4 * N + 3, 0x90, 60, 100);
  x.midi_ein_bei(4 * N + 6, 0xE0, 0, 64);
  x.zyklen(6 * N);
  PRUEF(x.alle(cdj::Ereignis::GELERNT).empty());
  x.midi_ein_bei(8 * N + 3, 0xB0, 74, 33);
  x.zyklen(10 * N);
  const auto g = x.alle(cdj::Ereignis::GELERNT);
  PRUEF(g.size() == 1 && g[0].teil == 74 && g[0].neu == 33);
}

// 11) the 20 s countdown: a CC just before it is captured, one after it is not; /k/set/neu does not restart it
static void fall_frist() {
  constexpr int64_t FRIST = 20 * 48000;
  {
    Arbeitsbestand ab("test_kern_lernen_11a");
    Lauf x(ab.pfad);
    x.zyklen(2 * N);
    scharf(x, 504);
    x.zyklen(FRIST - 8 * N);
    x.midi_ein_bei(x.kern->sample() + 3 * N + 4, 0xB0, 74, 20);  // before the deadline: must capture
    x.zyklen(x.kern->sample() + 6 * N);
    PRUEF(x.alle(cdj::Ereignis::GELERNT).size() == 1);
  }
  {
    Arbeitsbestand ab("test_kern_lernen_11b");
    Lauf x(ab.pfad);
    x.zyklen(2 * N);
    scharf(x, 505);
    x.zyklen(FRIST + 2 * N);
    x.midi_ein_bei(x.kern->sample() + 2 * N + 4, 0xB0, 74, 20);  // after the deadline
    x.zyklen(x.kern->sample() + 6 * N);
    PRUEF(x.alle(cdj::Ereignis::GELERNT).empty());
  }
  {
    Arbeitsbestand ab("test_kern_lernen_11c");
    Lauf x(ab.pfad);
    x.zyklen(2 * N);
    scharf(x, 506);
    x.zyklen(FRIST / 2);
    cdj::Befehl b = x.neu(cdj::Befehl::SET_NEU);  // the time axis starts again at 0
    b.bpm = 128.0;
    x.sende(b);
    x.zyklen(x.kern->sample() + 2 * N);  // the cycle with SET_NEU
    x.zyklen(FRIST / 2 + 2 * N);
    PRUEF(x.kern->sample() >= FRIST / 2);
    x.midi_ein_bei(x.kern->sample() + 2 * N + 4, 0xB0, 74, 20);
    x.zyklen(x.kern->sample() + 6 * N);
    PRUEF(x.alle(cdj::Ereignis::GELERNT).empty());  // 10 s + 10 s + : expired although the axis restarted
  }
  {  // control for 11c: the same /k/set/neu well inside the 20 s keeps the kern armed, the CC is captured
    Arbeitsbestand ab("test_kern_lernen_11d");
    Lauf x(ab.pfad);
    x.zyklen(2 * N);
    scharf(x, 512);
    x.zyklen(100 * N);
    cdj::Befehl b = x.neu(cdj::Befehl::SET_NEU);
    b.bpm = 128.0;
    x.sende(b);
    x.zyklen(x.kern->sample() + 2 * N);
    x.zyklen(100 * N);
    x.midi_ein_bei(x.kern->sample() + 2 * N + 4, 0xB0, 74, 20);
    x.zyklen(x.kern->sample() + 6 * N);
    PRUEF(x.alle(cdj::Ereignis::GELERNT).size() == 1);
  }
}

// 12) disarm
static void fall_abbrechen() {
  Arbeitsbestand ab("test_kern_lernen_12");
  Lauf x(ab.pfad);
  x.zyklen(2 * N);
  scharf(x, 507);
  x.zyklen(4 * N);
  const int64_t id = scharf(x, 508, 0);
  x.zyklen(6 * N);
  PRUEF(x.quittung(id, 1) && x.quittung(id, 3));
  x.midi_ein_bei(8 * N + 1, 0xB0, 74, 20);
  x.zyklen(10 * N);
  PRUEF(x.alle(cdj::Ereignis::GELERNT).empty());
}

// 13) re-arming replaces the id
static void fall_neu_scharf() {
  Arbeitsbestand ab("test_kern_lernen_13");
  Lauf x(ab.pfad);
  x.zyklen(2 * N);
  scharf(x, 601);
  x.zyklen(4 * N);
  scharf(x, 602);
  x.zyklen(6 * N);
  x.midi_ein_bei(8 * N + 1, 0xB0, 74, 20);
  x.zyklen(10 * N);
  const auto g = x.alle(cdj::Ereignis::GELERNT);
  PRUEF(g.size() == 1 && g[0].id == 602);
}

// 14) a CC on hand_in is reported with quelle 0 and still goes through the base mapping
static void fall_hand_in_gemeldet() {
  Arbeitsbestand ab("test_kern_lernen_14");
  Lauf x(ab.pfad);
  x.zyklen(2 * N);
  const uint64_t ohne = x.kern->hand_ohne_wirkung();
  scharf(x, 509);
  x.midi_bei(4 * N + 11, 0xB2, 50, 77);
  x.zyklen(6 * N);
  const auto g = x.alle(cdj::Ereignis::GELERNT);
  PRUEF(g.size() == 1 && g[0].deck == 0 && g[0].fassung == 3 && g[0].teil == 50 && g[0].neu == 77);
  PRUEF(x.kern->hand_ohne_wirkung() == ohne + 1);  // not consumed: the base mapping saw it (no entry for ch3 nr50)
  x.midi_ein_bei(8 * N + 1, 0xB0, 74, 20);
  x.zyklen(10 * N);
  PRUEF(x.alle(cdj::Ereignis::GELERNT).size() == 1);  // the report disarmed
  // a CC the base mapping owns still moves its knob while armed
  scharf(x, 510);
  x.midi_bei(12 * N + 1, 0xB0, 20, 64);
  x.zyklen(14 * N);
  PRUEF(x.alle(cdj::Ereignis::GELERNT).size() == 2);
  PRUEF(x.kern->hand_ereignisse() >= 1);
}

// 15) both ports in one cycle: midi_ein_1 wins
static void fall_beide_ports_ein_zyklus() {
  Arbeitsbestand ab("test_kern_lernen_15");
  Lauf x(ab.pfad);
  x.zyklen(2 * N);
  scharf(x, 511);
  x.midi_ein_bei(4 * N + 20, 0xB0, 74, 20);
  x.midi_bei(4 * N + 10, 0xB2, 50, 77);
  x.zyklen(6 * N);
  const auto g = x.alle(cdj::Ereignis::GELERNT);
  PRUEF(g.size() == 1 && g[0].deck == 1 && g[0].teil == 74);
}

int main() {
  fall_bk_ziel_laedt();
  fall_lern_cc_bewegt_bk();
  fall_hand_in_nicht();
  fall_ohne_eintrag();
  fall_tausch_slot1();
  fall_slot0_unberuehrt();
  fall_faengt_erstes_cc();
  fall_belegt();
  fall_nur_cc();
  fall_frist();
  fall_abbrechen();
  fall_neu_scharf();
  fall_hand_in_gemeldet();
  fall_beide_ports_ein_zyklus();
  PRUEF_ENDE();
}
