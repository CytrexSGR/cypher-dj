// Welle 2 F15 (/k/set/neu), F13 (Laden in eine laufende Box), F13 x Stopp Cypher am Kern: Befehle über den Ring wie aus dem
// Netz, Master aus dem Audio-Ring fortlaufend (Kern25 hängt an, auch über die neue Zeitachse). Loops: 1 Beat Sinus 96 Hz
// (45 ganze Perioden in 22 500 Frames, nahtlos) bzw. 192 Hz (90 Perioden), 0,5; pad/1 Fader 0 dB. Der Wechsel wird auf ein
// Blockende gelegt, an dem der alte Loop auf seiner Spitze steht (Position 124 mod 500), damit der Fehlerfall sicher
// sichtbar ist: hart ~0,5, mit Blende <= 0,05.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "cypherdj/loopbox.h"
#include "kern25.h"
#include "pruef.h"

namespace {
constexpr int64_t SPB = 22500;
cdj::Loop sinus(const char* name, double perioden) {
  cdj::Loop lp;
  lp.name = name;
  lp.beats = 1;
  lp.frames = SPB;
  lp.daten.resize((size_t)SPB * 2);
  for (int64_t i = 0; i < SPB; ++i)
    lp.daten[(size_t)(2 * i)] = lp.daten[(size_t)(2 * i + 1)] = (float)(0.5 * std::sin(2.0 * M_PI * perioden * (double)i / SPB));
  return lp;
}
void laden(Kern25& k, int64_t id, const char* quelle, const cdj::Loop* lp) {
  cdj::Befehl b = k.neu(cdj::Befehl::LOOP_LADEN, id, quelle);
  b.deck = 1;
  b.zeiger = lp;
  k.bef->schiebe(b);
}
void starte(Kern25& k, int64_t id) {
  cdj::Befehl b = k.neu(cdj::Befehl::LOOP_START, id, "andreas");
  b.deck = 1;
  k.bef->schiebe(b);
}
// Zyklus so kürzen, dass das letzte alte Sample im Master auf einer Spitze des 96-Hz-Loops liegt. Abweichung vom Plan
// (gemessen 06.10.): der Kanalzug von pad/1 verschiebt die Phase des 96-Hz-Sinus (Spitze im Master nicht bei Position
// 124 mod 500, sondern 182 Samples später), deshalb wird die Spitze am mitgeschriebenen Master gesucht: Periode 500, das
// erste Sample des nächsten Blocks erscheint im Master bei c + vh, also soll c + vh − 1 ≡ Spitze (mod 500) sein.
void auf_spitze(Kern25& k) {
  const int vh = k.kern->mixer().limiter_vorhalt();
  const int64_t s = k.kern->sample();
  int64_t p = (int64_t)k.master.size() - 500;
  for (int64_t i = p; i < (int64_t)k.master.size(); ++i)
    if (k.master[(size_t)i] > k.master[(size_t)p]) p = i;
  int64_t t = s + 1;
  while ((((t + vh - 1 - p) % 500) + 500) % 500 != 0) ++t;
  k.zyklus((int)(t - s));
}
double groesster_sprung(const std::vector<float>& y, size_t a, size_t b) {
  double m = 0.0;
  for (size_t i = std::max<size_t>(a, 1); i < b && i < y.size(); ++i) m = std::max(m, std::fabs((double)y[i] - y[i - 1]));
  return m;
}
}  // namespace

int main() {
  {  // (a) F15: /k/set/neu bei klingender Box
    const cdj::Loop lp = sinus("s96", 45.0);
    Kern25 k;
    k.mitschreiben = true;
    laden(k, 1, "andreas", &lp);
    k.teil(2, "andreas", "", 0, "pad/1/fader", 0.0, 0.0, 0.0f, 0, 0, "", "");
    starte(k, 3);
    k.bis(4 * SPB);
    auf_spitze(k);
    const int vh = k.kern->mixer().limiter_vorhalt();
    cdj::Befehl sn = k.neu(cdj::Befehl::SET_NEU, 4, "andreas");
    sn.bpm = 128.0;
    k.bef->schiebe(sn);
    const size_t c = k.master.size();
    for (int i = 0; i < 12; ++i) k.zyklus(256);
    const size_t g = c + (size_t)vh;  // erstes Sample der neuen Zeitachse im Master
    const double sp = groesster_sprung(k.master, g - 300, g + 600);
    std::printf("kern_set_neu: letztes altes Sample %.4f, größter Sprung um /k/set/neu %.5f (hart wäre ~0,5)\n",
                k.master[g - 1], sp);
    PRUEF(std::fabs(k.master[g - 1]) > 0.4f);  // Positiv-Kontrolle: der Schnitt liegt auf der Spitze
    PRUEF(sp <= 0.05);
  }
  {  // (b) F13: Laden in die laufende Box über den Ring. LOOP_ALT kommt nicht im Ladezyklus, sondern genau einmal nach der
     // Blende; am Master kein Sprung (96 Hz auf der Spitze -> 192 Hz im Nulldurchgang: hart ~0,5).
    const cdj::Loop a = sinus("s96", 45.0), b = sinus("s192", 90.0);
    Kern25 k;
    k.mitschreiben = true;
    laden(k, 1, "andreas", &a);
    k.teil(2, "andreas", "", 0, "pad/1/fader", 0.0, 0.0, 0.0f, 0, 0, "", "");
    starte(k, 3);
    k.bis(4 * SPB);
    auf_spitze(k);
    const int vh = k.kern->mixer().limiter_vorhalt();
    const size_t ev0 = k.ev.size();
    laden(k, 4, "andreas", &b);
    const size_t c = k.master.size();
    k.zyklus(256);
    int alt_sofort = 0, alt_gesamt = 0;
    for (size_t i = ev0; i < k.ev.size(); ++i) alt_sofort += k.ev[i].art == cdj::Ereignis::LOOP_ALT;
    for (int i = 0; i < 12; ++i) k.zyklus(256);
    for (size_t i = ev0; i < k.ev.size(); ++i)
      if (k.ev[i].art == cdj::Ereignis::LOOP_ALT) alt_gesamt += k.ev[i].zeiger == &a ? 1 : 100;
    const size_t g = c + (size_t)vh;
    const double sp = groesster_sprung(k.master, g - 300, g + 1300);
    std::printf("kern_laden: LOOP_ALT im Ladezyklus %d, danach %d (Soll 0 und 1), größter Sprung %.5f\n", alt_sofort, alt_gesamt, sp);
    PRUEF(alt_sofort == 0 && alt_gesamt == 1);
    PRUEF(sp <= 0.05);
  }
  // (c) F13 x Stopp Cypher am Kern: 130 BPM, Box spielt; cypher lädt einen anderen Loop und im selben Zyklus kommt der
  // Stopp Cypher: der cypher-Loop kommt über LOOP_ALT zurück, die Box behält den alten. Beide Wege des Stopps (Prüfung 2.3
  // Befund 1): weg 0 = Befehl KI_STOPP über den Ring (der Loop wartete schon, verworfen vor dem Block), weg 1 = Stopp-Taste
  // der Hand (Kern::hand_taste, kern_hand.cpp:92; das Laden wird danach abgewiesen). weg 2 = Negativ-Kontrolle: andreas
  // lädt, Stopp-Taste: sein Loop wird nicht verworfen und übernimmt. Task 7: ohne Keylock-Varianten wartet ein Laden nicht
  // mehr auf eine Variante (vorher bis zu 4 s), es übernimmt im nächsten Block; darum Laden und Stopp zusammen.
  for (int weg = 0; weg < 3; ++weg) {
    cdj::Loop a = sinus("s96", 45.0), b = sinus("s192", 90.0);
    Kern25 k;
    cdj::Befehl sn = k.neu(cdj::Befehl::SET_NEU, 1, "andreas");
    sn.bpm = 130.0;
    k.bef->schiebe(sn);
    k.bis(4 * 256);
    laden(k, 2, "andreas", &a);
    starte(k, 3);
    // die Box setzt auf der nächsten Takt-Eins ein (Beat 4 bei 130 BPM, Sample ~88 615); danach klingt sie und ein Laden wartet
    k.bis(k.kern->sample() + 6 * SPB);
    laden(k, 4, weg == 2 ? "andreas" : "cypher", &b);
    if (weg == 0) k.bef->schiebe(k.neu(cdj::Befehl::KI_STOPP, 5, "andreas"));
    else k.kern->hand_taste(hand::Taste::stopp, 127, k.kern->sample());
    k.zyklus(256);
    PRUEF(k.kern->ki_gestoppt());
    k.bis(k.kern->sample() + cdj::LOOPBOX_LADEN_BLENDE + 8 * 256);
    int b_zurueck = 0;
    for (const auto& e : k.ev) b_zurueck += e.art == cdj::Ereignis::LOOP_ALT && e.zeiger == &b;
    // k.kern->loops() ist nicht öffentlich: der Name der Box kommt aus der letzten /e/loop-Meldung (Plan-Hinweis)
    std::string zuletzt;
    for (const auto& e : k.ev)
      if (e.art == cdj::Ereignis::LOOP && e.deck == 1) zuletzt = e.pfad;
    std::printf("kern_stopp_cypher %s: geladener Loop b zurück %d, letzte /e/loop Box 1: %s\n",
                weg == 0 ? "KI_STOPP, cypher lädt (Soll 1, s96)" : weg == 1 ? "Hand-Taste, cypher lädt (Soll 1, s96)" : "Hand-Taste, andreas lädt (Soll 0, s192)", b_zurueck, zuletzt.c_str());
    if (weg < 2) PRUEF(b_zurueck == 1 && zuletzt == "s96");
    else PRUEF(b_zurueck == 0 && zuletzt == "s192");
  }
  {  // (d) F13, Prüfung 2.3 Befund 3: 130 BPM, Box spielt a; andreas lädt b, dann Stopp der Box. /e/loop muss danach b
     // nennen (vorher blieb 'a' mit Status bereit stehen, obwohl a schon per LOOP_ALT zurück war). Task 7: b übernimmt im
     // nächsten Block mit Ladeblende (kein Warten auf eine Variante mehr), der Fall bleibt als Meldungs-Probe.
    cdj::Loop a = sinus("a", 45.0), b = sinus("b", 90.0);
    Kern25 k;
    cdj::Befehl sn = k.neu(cdj::Befehl::SET_NEU, 1, "andreas");
    sn.bpm = 130.0;
    k.bef->schiebe(sn);
    k.bis(4 * 256);
    laden(k, 2, "andreas", &a);
    starte(k, 3);
    k.bis(k.kern->sample() + 6 * SPB);
    laden(k, 4, "andreas", &b);
    k.bis(k.kern->sample() + 4 * 256);
    cdj::Befehl st = k.neu(cdj::Befehl::LOOP_STOPP, 5, "andreas");
    st.deck = 1;
    k.bef->schiebe(st);
    k.bis(k.kern->sample() + 8 * SPB);  // Stopp an der nächsten Eins
    std::string zuletzt;
    int status = -1, a_zurueck = 0;
    for (const auto& e : k.ev) {
      if (e.art == cdj::Ereignis::LOOP && e.deck == 1) zuletzt = e.pfad, status = e.status;
      a_zurueck += e.art == cdj::Ereignis::LOOP_ALT && e.zeiger == &a;
    }
    std::printf("kern_meldung_stopp: letzte /e/loop Box 1 '%s' Status %d (Soll 'b' 1), a zurück %d (Soll 1)\n", zuletzt.c_str(),
                status, a_zurueck);
    PRUEF(zuletzt == "b" && status == 1 && a_zurueck == 1);
  }
  PRUEF_ENDE();
}
