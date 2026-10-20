// D1 K1 Slice 10: Hand-Zielart arr/start_stopp (SCHNITTSTELLEN §7.2, Spec D1 3.1, L4). Aus dem Mapping (MIDI am
// Versatz) und über /test/hand: erster Druck startet an der letzten Startposition nach der Start-Regel (ohne laufendes
// Deck sofort: Druck-Sample + Vorhalt 537 + 256), zweiter Druck stoppt am Sample des Drucks; /e/hand meldet jeden Druck;
// läuft ein Deck, setzt der Start auf den Takt (Quant 2); ohne Wiedergabe ohne Wirkung.
// Mutation: ARR_HAND_IMMER_SOFORT (Quant ohne Rücksicht auf das Deck) macht Fall 3 rot.
#include <unistd.h>

#include <cstdio>
#include <fstream>

#include "arr_lauf.h"

bool g_waechter = false;

using k35::N;
using cdj::ArrStatus;

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_hand");
  const std::string mapping = "/dev/shm/test_kern_arr_hand_" + std::to_string(getpid()) + ".json";   // nicht im
  // Arbeitsbestand: traeger_fassung.py legt den neu an
  std::ofstream(mapping) << R"({"version":1,"geraet":"arrhand","quelle_port":"q","ziel_port":"z","eintraege":[
    {"nachricht":{"typ":"note","kanal":1,"nr":60},"ziel":"arr/start_stopp","art":"taste"}],"leds":[]})";
  const std::string spur = "{\"nr\":1,\"art\":\"audio\",\"clips\":[]}";
  {  // 1: Mapping: Druck bei 5 000 startet (sofort: 5 000 + 537 + 256), Druck bei 20 000 stoppt dort
    arr35::Lauf x(ab.pfad, "test_kern_arr_hand", mapping.c_str());
    x.lauf(2 * N);
    x.laden(1, spur);
    x.midi_bei(5000, 0x90, 60, 100);
    x.midi_bei(5100, 0x80, 60, 0);   // Loslassen: ohne Wirkung
    x.lauf(10000);
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
    PRUEF(x.kern->arrangement().zustand(x.kern->karte(), 10000).ursprung_sample == 5000 + 2 * N + 25 + N);
    x.midi_bei(20000, 0x90, 60, 100);
    x.lauf(21000);
    PRUEF(x.kern->arrangement().status() == ArrStatus::steht);
    const auto hand = x.alle(cdj::Ereignis::HAND, "arr/start_stopp");
    PRUEF(hand.size() == 2 && hand[0].sample == 5000 && hand[1].sample == 20000);
  }
  {  // 2: /test/hand arr/start_stopp wirkt gleich; ohne Wiedergabe ohne Wirkung
    arr35::Lauf x(ab.pfad, "test_kern_arr_hand");
    x.test_hand("arr/start_stopp", 1.0f, 3000);
    x.lauf(8000);
    PRUEF(x.kern->arrangement().status() == ArrStatus::steht);
    x.laden(1, spur);
    x.lauf(9000);
    x.test_hand("arr/start_stopp", 1.0f, 9300);
    x.lauf(12000);
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
    PRUEF(x.kern->arrangement().zustand(x.kern->karte(), 12000).ursprung_sample == 9300 + 2 * N + 25 + N);
  }
  {  // 3: ein Deck läuft: Start auf den Takt (Kern-Beat ≡ start_beat mod 4)
    k35::traeger(ab.pfad, "a2a0000000000e01", "--ohne-klick --traeger 0.1");
    arr35::Lauf x(ab.pfad, "test_kern_arr_hand", mapping.c_str());
    x.k35::Lauf::laden(1, "a2a0000000000e01");
    x.laden(1, spur);
    x.lauf(4 * N);
    x.k35::Lauf::start(1, 2.0);   // Deck 1 spielt ab Kern-Beat 2 (45 000)
    x.lauf(50000);
    PRUEF(x.kern->deck(1).laeuft());
    x.midi_bei(50500, 0x90, 60, 100);
    x.lauf(100000);
    const int64_t u = x.kern->arrangement().zustand(x.kern->karte(), 100000).ursprung_sample;
    PRUEF(u == 90000);   // nächster Takt nach 50 500 + 537 + 256 mit start_beat 0: Kern-Beat 4
  }
  std::remove(mapping.c_str());
  PRUEF_ENDE();
}
