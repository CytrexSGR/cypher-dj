// D1 K2b (Spec 2.2, 2.4, A4): Wirt-Slots des Arrangements im Kern. Der Kern legt je Slot eine Senke an; ihre MIDI-
// Ereignisse stehen nach jedem Zyklus in Kern::arr_midi_aus(s) (Versatz ab dem Zyklusanfang), der Rückweg kommt über
// Kern::arr_rueck(s, l, r) vor dem Zyklus.
//   1 Vorhalt 2n + 25 und Vorausblick über die Loop-Klammer: jedes Note-Ein (Kanal 1) geht 537 Samples vor seinem Ziel
//     hinaus, auch das erste des nächsten Durchlaufs (vor der Naht); Note-Aus ebenso.
//   2 Neustart während des Laufs: All Notes Off (CC 123) im Zyklus des Befehls bei Versatz 0 (geschrieben beim
//     Einsortieren, vor dem Leeren gerettet).
//   3 Rückweg in den Spur-Kanal: ein Impuls am Rückweg erscheint am Master auf seinem Sample + Limiter-Vorhalt; mit
//     spur/3/mute nicht (er läuft durch den Spur-Mixer). Negativ-Kontrolle: Slot 2 ohne Spur bleibt still. Zwei Spuren
//     auf Slot 1 bekommen den Rückweg nur einmal (gleiche Spitze wie mit einer Spur).
//   5 Fix F1 (Review K2b): ein nachgereichter Tausch (Ring voll, die Rückgabe wartet, das Laden dahinter auch) schickt das
//     Note-Aus der klingenden Wirt-Note an arr_midi_1; das MIDI der Wirt-Slots wird vor arr_nachreichen() geleert, nicht
//     danach. Negativ-Kontrolle: derselbe Ablauf bei freiem Ring (kein Nachreichen) hat genau ein Note-Aus.
//   6 Fix F2: eine klingende Wirt-Spur verlässt ihren Slot per Tausch. Wird sie leer oder wechselt sie den Slot, geht im
//     Zyklus des Tauschs neben dem Note-Aus All Notes Off (CC 123) an den alten Slot, und sein Rückweg (hier ein
//     gleichbleibender Wert) blendet über einen Block aus statt hart abzubrechen, danach Stille. Negativ-Kontrolle: spielt
//     eine zweite Spur denselben Slot weiter, kein CC 123 (er würde ihre Noten abschneiden), der Rückweg bleibt.
//   7 Fix F7: Messpunkt A4 über einen Sprung der Zeitachse (/k/set/neu, Kern-Sample wieder 0). Ein vor dem Sprung
//     gesendetes Note-Ein ohne Einsatz darf die Messung der ersten Note der neuen Achse nicht blockieren: gemeldet wird
//     genau (ziel, ziel + 7) der neuen Note, die alte fällt still weg. Negativ-Kontrolle: dieselbe Folge ohne Sprung (nur
//     Stopp und Neustart) meldet die alte Note mit einsatz −1 und die neue mit ihrem Einsatz.
//   8 K2b-Rest (Re-Review der Fix-Runde, Probe test_zz_rr2_wirt_doppel): eine Spur wechselt in einem Zyklus zweimal die
//     Senke (zwei /k/arr/laden vor demselben Block). Jede verlassene Senke blendet ihren Ausklang aus, nicht nur die
//     letzte. wirt -> intern -> leer: kein Schritt am Master (vorher 0,128951 statt 0,001091), danach Slot 1 zurück ohne
//     ausgeblendeten ersten Block (vorher min 0,000166 statt 0,1768). intern -> wirt -> leer: die RB-Stimme ruht danach
//     (8 statt 7), Zurückladen ohne Start klingt nicht (vorher Energie 0,000923 statt 0). Mutation ARR_WEG_EIN_PLATZ
//     (ein Platz je Spur, wie vorher) macht Fall 8 rot.
// Mutationen (rot im Fall): ARR_WIRT_OHNE_VORHALT 1, ARR_MIDI_LEER_SPAET 2, ARR_WIRT_OHNE_RUECKWEG 3, ARR_A4_BLOCKANFANG 4,
//   ARR_MIDI_LEER_NACH_NACHREICHEN 5, ARR_SPURWECHSEL_HART 6, ARR_A4_ACHSE_ALT 7.
#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstring>
#include <vector>

#include "arr_lauf.h"

bool g_waechter = false;

using k35::N;
using k35::SPB;

namespace {

constexpr int64_t V = 2 * N + 25;   // 537

struct Ev {
  int64_t sample;
  uint8_t b[3];
};

struct Wirt {
  arr35::Lauf& x;
  std::vector<Ev> midi;
  std::vector<float> rl = std::vector<float>(N, 0.0f), rr = std::vector<float>(N, 0.0f);
  std::vector<int64_t> impulse;   // Kern-Samples mit 0,5 am Rückweg von Slot slot
  float konstant = 0.0f;          // Fall 6: gleichbleibender Wert am Rückweg (ein Wirt, der klingt)
  int slot = 1;
  explicit Wirt(arr35::Lauf& l) : x(l) {}
  void bis(int64_t ende) {
    while (x.kern->sample() < ende) {
      const int64_t n0 = x.kern->sample();
      std::fill(rl.begin(), rl.end(), konstant);
      std::fill(rr.begin(), rr.end(), konstant);
      for (int64_t s : impulse)
        if (s >= n0 && s < n0 + N) rl[s - n0] = rr[s - n0] = 0.5f;
      x.kern->arr_rueck(slot, rl.data(), rr.data());
      x.lauf(n0 + N);
      const cdj::MidiAus& m = x.kern->arr_midi_aus(1);
      for (int i = 0; i < m.n; ++i) midi.push_back({n0 + m.ev[i].t, {m.ev[i].b[0], m.ev[i].b[1], m.ev[i].b[2]}});
    }
  }
  std::vector<int64_t> wo(uint8_t st, uint8_t d1) const {
    std::vector<int64_t> v;
    for (const Ev& e : midi)
      if (e.b[0] == st && e.b[1] == d1) v.push_back(e.sample);
    return v;
  }
};

std::string zahl(double v) {   // ohne Locale (der Prüfprozess kann LC_NUMERIC mit Komma haben)
  char b[32];
  const auto r = std::to_chars(b, b + sizeof b, v);
  return std::string(b, r.ptr);
}

std::string noten(const char* clip, std::initializer_list<std::pair<double, int>> n, double laenge = 0.5) {
  std::string s;
  int i = 0;
  for (const auto& [beat, ton] : n) {
    if (i) s += ",";
    s += "{\"id\":\"" + std::string(clip) + "/n" + std::to_string(i) + "\",\"beat\":" + zahl(beat) + ",\"laenge\":" +
         zahl(laenge) + ",\"ton\":" + std::to_string(ton) + ",\"vel\":90}";
    ++i;
  }
  return s;
}

float spitze(const std::vector<float>& x, int64_t von, int64_t bis) {
  float m = 0.0f;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, std::fabs(x[i]));
  return m;
}

// Fall 3: Spitze am Master nach einem Rückweg-Impuls bei Sample 40 000 + 10; spuren = Wiedergabe, slot = Rückweg-Slot
float rueckweg(const std::string& ab, const std::string& spuren, int slot, bool mute, int64_t* erster = nullptr) {
  arr35::Lauf x(ab, "test_kern_arr_wirt_r");
  x.laden(1, spuren);
  if (mute) x.teil("spur/3/mute", 1.0f, 0.0, 0.0);
  Wirt w(x);
  w.slot = slot;
  w.impulse = {40000 + 10};
  w.bis(42000);
  if (erster) *erster = arr35::Lauf::erster(x.l, 39000, 42000);
  return spitze(x.l, 39000, 42000);
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_wirt");
  {  // 1: Vorhalt und Vorausblick über die Klammer 0..4, drei Durchläufe
    arr35::Lauf x(ab.pfad, "test_kern_arr_wirt_1");
    x.laden(1, "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten("c", {{0.0, 60}, {2.0, 64}}) + "]}");
    x.loop(true, 0.0, 4.0);
    const int64_t st = x.start(0.0, 0);
    Wirt w(x);
    w.bis(10 * N);
    PRUEF(x.quittung(st, 1) != nullptr);
    w.bis(10 * N + 3 * 4 * SPB);
    const k35::Q* q2 = x.quittung(st, 2);
    PRUEF(q2 != nullptr);
    const int64_t S = q2 ? q2->sample : 0;
    const auto on60 = w.wo(0x90, 60), on64 = w.wo(0x90, 64), off60 = w.wo(0x80, 60);
    PRUEF(on60.size() >= 3 && on64.size() >= 3 && off60.size() >= 3);
    for (size_t p = 0; p < 3 && p < on60.size() && p < on64.size() && p < off60.size(); ++p) {
      PRUEF(on60[p] == S + static_cast<int64_t>(p) * 4 * SPB - V);   // p ≥ 1: vor der Naht des Durchlaufs p
      PRUEF(on64[p] == S + static_cast<int64_t>(p) * 4 * SPB + 2 * SPB - V);
      PRUEF(off60[p] == S + static_cast<int64_t>(p) * 4 * SPB + SPB / 2 - V);
    }
    if (on60.size() >= 2) std::printf("wirt: Einsatz %lld, Note-Ein Durchlauf 2 bei %lld (Naht %lld)\n", (long long)S,
                                      (long long)on60[1], (long long)(S + 4 * SPB));
    bool kanal1 = true;
    for (const Ev& e : w.midi) kanal1 = kanal1 && (e.b[0] & 0x0f) == 0;
    PRUEF(kanal1);
  }
  {  // 2: Neustart während des Laufs schickt All Notes Off im Zyklus des Befehls
    arr35::Lauf x(ab.pfad, "test_kern_arr_wirt_2");
    x.laden(1, "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten("c", {{0.0, 60}}, 4.0) + "]}");
    x.start(0.0, 0);
    Wirt w(x);
    w.bis(40 * N);
    PRUEF(w.wo(0xB0, 123).empty());
    x.start(0.0, 0);   // Neustart: der laufende endet beim Einsortieren
    w.bis(41 * N);
    const auto cc = w.wo(0xB0, 123);
    PRUEF(cc.size() == 1 && cc[0] == 40 * N);
    const auto off = w.wo(0x80, 60);
    PRUEF(off.size() == 1 && off[0] == 40 * N);   // die offene Note geht im selben Zyklus aus
  }
  {  // 3: Rückweg durch den Spur-Mixer, einmal je Slot
    const std::string spur3 = "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}";
    const std::string spur5 = "{\"nr\":5,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}";
    arr35::Lauf vh_lauf(ab.pfad, "test_kern_arr_wirt_vh");
    int64_t erster = -2;
    const float eine = rueckweg(ab.pfad, spur3, 1, false, &erster);
    PRUEF(eine > 0.1f);
    PRUEF(erster == 40000 + 10 + vh_lauf.vh);
    PRUEF(rueckweg(ab.pfad, spur3, 1, true) == 0.0f);    // spur/3/mute: der Rückweg läuft durch den Spur-Mixer
    PRUEF(rueckweg(ab.pfad, spur3, 2, false) == 0.0f);   // Negativ-Kontrolle: Slot 2 spielt keine Spur
    const float zwei = rueckweg(ab.pfad, spur3 + "," + spur5, 1, false);
    PRUEF_NAH(zwei, eine, 1e-6);   // zwei Spuren auf Slot 1: der Rückweg geht nur in die erste
    std::printf("wirt: Rückweg-Spitze %.4f (eine Spur), %.4f (zwei Spuren), erster Wert bei %lld\n", eine, zwei,
                (long long)erster);
  }
  {  // 4: Messpunkt A4: Rückweg-Einsatz 7 Samples nach dem Ziel ergibt die Messung (ziel, ziel + 7); eine Note ohne
     //    Einsatz meldet nach 200 ms einsatz −1
    arr35::Lauf x(ab.pfad, "test_kern_arr_wirt_4");
    x.laden(1, "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten("c", {{1.0, 60}, {3.0, 62}}, 0.25) + "]}");
    const int64_t st = x.start(0.0, 0);
    Wirt w(x);
    w.bis(10 * N);
    const k35::Q* q2 = x.quittung(st, 2);
    PRUEF(q2 != nullptr);
    const int64_t S = q2 ? q2->sample : 0;
    w.impulse = {S + SPB + 7};   // Einsatz 7 Samples nach dem Ziel der ersten Note; die zweite bleibt ohne
    w.bis(S + 3 * SPB + 9600 + 2 * N);
    std::vector<cdj::ArrWirtMessung> m;
    cdj::ArrWirtMessung e{};
    while (x.kern->arr_wirt_messung(1, e)) m.push_back(e);
    PRUEF(m.size() == 2);
    if (m.size() == 2) {
      PRUEF(m[0].slot == 1 && m[0].ziel == S + SPB && m[0].einsatz == S + SPB + 7 && m[0].vorhalt == V);
      PRUEF(m[1].ziel == S + 3 * SPB && m[1].einsatz == -1);
    }
  }
  for (int ring_voll = 0; ring_voll < 2; ++ring_voll) {   // 5: Note-Aus aus einem nachgereichten Tausch (Fix F1)
    arr35::Lauf x(ab.pfad, ring_voll ? "test_kern_arr_wirt_5v" : "test_kern_arr_wirt_5f");
    const std::string mit = "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten("c", {{0.5, 60}}, 200.0) + "]}";
    const std::string ohne = "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}";
    x.laden(1, mit);
    x.start(0.0, 0);
    Wirt w(x);
    w.bis(200 * N);   // Note 60 klingt (200 Beats lang)
    PRUEF(w.wo(0x90, 60).size() == 1 && w.wo(0x80, 60).empty());
    if (ring_voll) {
      x.abholen = false;   // der Netz-Faden steht: niemand leert den Ereignisring
      while (x.kern->ereignisse_verloren() == 0) w.bis(x.kern->sample() + N);
    }
    x.laden(2, mit);   // dieselbe Note: bleibt; bei vollem Ring wartet die Rückgabe von 1 auf ihren Platz
    w.bis(x.kern->sample() + 2 * N);
    const int64_t l3 = x.laden(3, ohne);   // ohne die Note: ihr Note-Aus geht beim Tausch hinaus (bei vollem Ring: nachgereicht)
    w.bis(x.kern->sample() + 2 * N);
    const cdj::ArrSnapshot* sn = x.kern->arrangement().snapshot();
    PRUEF(sn && sn->nr == (ring_voll ? 2 : 3));   // bei vollem Ring wartet das Laden wirklich
    x.abholen = true;
    w.bis(x.kern->sample() + 8 * N);
    sn = x.kern->arrangement().snapshot();
    PRUEF(sn && sn->nr == 3);
    PRUEF(x.quittung(l3, 3) != nullptr);
    const auto on = w.wo(0x90, 60), off = w.wo(0x80, 60);
    std::printf("wirt Fall 5 (Ring %s): Note-Ein 60: %zu, Note-Aus 60: %zu, Wirt-MIDI verloren %d\n", ring_voll ? "voll" : "frei",
                on.size(), off.size(), x.kern->arr_midi_aus(1).verloren);
    PRUEF(on.size() == 1);
    PRUEF(off.size() == 1);
  }
  for (int variante = 0; variante < 3; ++variante) {   // 6: Spurwechsel weg von wirt (Fix F2); 2: Negativ-Kontrolle
    static const char* name[] = {"wirt -> leer", "wirt Slot 1 -> Slot 2", "zwei Spuren auf Slot 1, eine geht"};
    arr35::Lauf x(ab.pfad, "test_kern_arr_wirt_6");
    const std::string sp3 = "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten("c", {{0.5, 60}}, 200.0) + "]}";
    const std::string sp5 = "{\"nr\":5,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}";
    x.laden(1, variante == 2 ? sp3 + "," + sp5 : sp3);
    x.start(0.0, 0);
    Wirt w(x);
    w.konstant = 0.25f;
    w.bis(100 * N);
    PRUEF(w.wo(0x90, 60).size() == 1 && w.wo(0x80, 60).empty() && w.wo(0xB0, 123).empty());
    const int64_t T = x.kern->sample();   // der Tausch wirkt am Anfang dieses Zyklus
    if (variante == 0) x.laden(2, "");
    else if (variante == 1) x.laden(2, "{\"nr\":3,\"art\":\"wirt\",\"slot\":2,\"noten\":[]}");
    else x.laden(2, sp5);
    w.bis(T + 8 * N);
    const auto off = w.wo(0x80, 60), cc = w.wo(0xB0, 123);
    const int64_t a = T + x.vh;   // der Rückweg des Tausch-Zyklus am Master
    float dmax = 0.0f;
    for (int64_t i = a - N; i < a + 2 * N; ++i) dmax = std::max(dmax, std::fabs(x.l[i] - x.l[i - 1]));
    // danach ab a + 3N: die Kette des Masters glättet die Blende um einige hundert Samples (gemessen: 0,127 bei a + 255)
    const float vorher = spitze(x.l, a - 2 * N, a), danach = spitze(x.l, a + 3 * N, a + 6 * N);
    std::printf("wirt Fall 6 (%s): Note-Aus 60 %zu (bei %lld), CC123 %zu (bei %lld), Tausch %lld | Master vorher %.4f, größter"
                " Schritt am Tausch %.6f, danach %.6f\n", name[variante], off.size(), off.empty() ? -1LL : (long long)off[0],
                cc.size(), cc.empty() ? -1LL : (long long)cc[0], (long long)T, vorher, dmax, danach);
    PRUEF(off.size() == 1 && off[0] == T);
    PRUEF(vorher > 0.05f);   // der Rückweg klingt vor dem Tausch
    if (variante < 2) {
      PRUEF(cc.size() == 1 && cc[0] == T);
      PRUEF(dmax < vorher / 50.0f);   // Blende über einen Block statt Abbruch (ohne: 0,129 bei 0,177 vorher)
      PRUEF(danach < 1e-3f);           // der Rückweg ist nicht mehr im Spur-Kanal
    } else {
      PRUEF(cc.empty());
      PRUEF(dmax < 1e-6f);   // Spur 5 spielt den Rückweg weiter, ohne Blende
      PRUEF_NAH(danach, vorher, 1e-6);
    }
  }
  for (int sprung = 0; sprung < 2; ++sprung) {   // 7: A4 über /k/set/neu (Fix F7); sprung 0: Negativ-Kontrolle
    arr35::Lauf x(ab.pfad, "test_kern_arr_wirt_7");
    x.laden(1, "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten("c", {{1.0, 60}}, 0.25) + "]}");
    Wirt w(x);
    w.bis(100 * N);   // die alte Achse ist weit fortgeschritten: das Ziel der ersten Note liegt hinter dem der neuen
    const int64_t st1 = x.start(0.0, 0);
    w.bis(x.kern->sample() + 6 * N);   // Einsatz nach 537 + 256 Samples
    const k35::Q* q1 = x.quittung(st1, 2);
    PRUEF(q1 != nullptr);
    const int64_t Z1 = q1 ? q1->sample + SPB : 0;   // Ziel der alten Note
    w.bis(Z1 - V + 2 * N);   // ihr Note-Ein ist hinaus (offen, ohne Einsatz am Rückweg)
    PRUEF(w.wo(0x90, 60).size() == 1);
    x.stopp(0);
    if (sprung) {
      cdj::Befehl b = x.neu(cdj::Befehl::SET_NEU);
      b.bpm = 128.0;
      x.sende(b);
    }
    // ein Zyklus direkt am Kern: mit /k/set/neu springt das Kern-Sample auf 0, die Schleifen der Prüfhilfen liefen sonst
    // auf der neuen Achse bis zum alten Sample weiter
    x.kern->zyklus(N, x.kern->sample() * 20833);
    w.bis(x.kern->sample() + N);
    if (sprung) PRUEF(x.kern->sample() < Z1 - V);   // die Zeitachse ist wirklich zurückgesprungen
    const int64_t st2 = x.start(0.0, 0);
    w.bis(x.kern->sample() + 6 * N);
    const k35::Q* q2 = x.quittung(st2, 2);
    PRUEF(q2 != nullptr);
    const int64_t Z2 = q2 ? q2->sample + SPB : 0;   // Ziel der neuen Note
    w.impulse = {Z2 + 7};
    w.bis(std::max(Z1, Z2) + 9600 + 4 * N);
    std::vector<cdj::ArrWirtMessung> m;
    cdj::ArrWirtMessung e{};
    while (x.kern->arr_wirt_messung(1, e)) m.push_back(e);
    std::printf("wirt Fall 7 (%s): Ziel alt %lld, Ziel neu %lld, Messungen:", sprung ? "mit /k/set/neu" : "ohne Sprung",
                (long long)Z1, (long long)Z2);
    for (const auto& a : m) std::printf(" (%lld, %lld)", (long long)a.ziel, (long long)a.einsatz);
    std::printf("\n");
    if (sprung) {
      PRUEF(Z2 < Z1);
      PRUEF(m.size() == 1 && m[0].ziel == Z2 && m[0].einsatz == Z2 + 7);
    } else {
      PRUEF(m.size() == 2 && m[0].ziel == Z1 && m[0].einsatz == -1 && m[1].ziel == Z2 && m[1].einsatz == Z2 + 7);
    }
  }
  for (int v = 0; v < 2; ++v) {   // 8: zwei Senkenwechsel einer Spur im selben Zyklus (K2b-Rest a)
    static const char* name[] = {"wirt -> intern -> leer", "intern -> wirt -> leer"};
    arr35::Lauf x(ab.pfad, "test_kern_arr_wirt_8");
    const std::string sp3w = "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten("c", {{0.5, 60}}, 200.0) + "]}";
    const std::string sp3i =
        "{\"nr\":3,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[" + noten("d", {{0.5, 36}}, 200.0) + "]}";
    x.laden(1, v == 0 ? sp3w : sp3i);
    x.start(0.0, 0);
    Wirt w(x);
    w.konstant = v == 0 ? 0.25f : 0.0f;   // v 1: Slot 1 spielte nie, sein Rückweg ist still (Probe v5)
    w.bis(100 * N);
    const int ruhend_vor = x.kern->arr_rb().ruhend();
    const int64_t T = x.kern->sample();
    x.laden(2, v == 0 ? "{\"nr\":3,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[]}"
                      : "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}");
    x.laden(3, "");   // beide vor demselben Block
    w.bis(T + 8 * N);
    const cdj::ArrSnapshot* sn = x.kern->arrangement().snapshot();
    PRUEF(sn && sn->nr == 3);
    const int64_t a = T + x.vh;
    float dmax = 0.0f;
    for (int64_t i = a - N; i < a + 2 * N; ++i) dmax = std::max(dmax, std::fabs(x.l[i] - x.l[i - 1]));
    const float vorher = spitze(x.l, a - 2 * N, a);
    const size_t cc = w.wo(0xB0, 123).size();
    const int ruhend = x.kern->arr_rb().ruhend();
    std::printf("wirt Fall 8 (%s): CC123 %zu | Master vorher %.4f, größter Schritt am Tausch %.6f | ruhend vor %d nach %d\n",
                name[v], cc, vorher, dmax, ruhend_vor, ruhend);
    PRUEF(cc == 1);
    if (v == 0) {
      PRUEF(vorher > 0.05f && dmax < vorher / 50.0f);   // der Wirt-Rückweg blendet aus (ein Platz je Spur: 0,129)
      // Slot 1 zurück: der Master muss derselbe sein wie nach nur einem Tausch wirt -> leer (dort blendet die Wirt-Senke
      // genau einen Block aus); ein hängendes ausblenden_ blendet den ersten Block nach dem Wiederladen aus
      auto zurueck = [&](arr35::Lauf& y, Wirt& u) {
        u.bis(y.kern->sample() + 20 * N);
        const int64_t R = y.kern->sample();
        y.laden(4, "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}");
        u.bis(R + 12 * N);
        return std::vector<float>(y.l.begin() + R + y.vh, y.l.begin() + R + y.vh + 8 * N);
      };
      const std::vector<float> doppelt = zurueck(x, w);
      arr35::Lauf y(ab.pfad, "test_kern_arr_wirt_8r");
      y.laden(1, sp3w);
      y.start(0.0, 0);
      Wirt u(y);
      u.konstant = 0.25f;
      u.bis(100 * N);
      y.laden(2, "");   // Referenz: ein Tausch
      u.bis(T + 8 * N);
      const std::vector<float> einfach = zurueck(y, u);
      float abw = 0.0f;
      for (size_t k = 0; k < doppelt.size(); ++k) abw = std::max(abw, std::fabs(doppelt[k] - einfach[k]));
      std::printf("wirt Fall 8: Slot 1 zurück, größte Abweichung zur Referenz (ein Tausch) in 8 Blöcken %.6g, Spitze %.6f\n",
                  abw, spitze(einfach, 0, static_cast<int64_t>(einfach.size())));
      PRUEF(spitze(einfach, 0, static_cast<int64_t>(einfach.size())) > 0.1f && abw < 1e-6f);
    } else {
      PRUEF(ruhend_vor == 7 && ruhend == 8);   // die RB-Stimme von Spur 3 ist zurückgesetzt
      x.stopp(0);
      w.bis(x.kern->sample() + 3 * 48000);
      const int64_t Z = x.kern->sample();
      x.laden(5, sp3i);   // dieselbe interne Spur zurück, ohne Start
      w.bis(Z + 48000);
      double e = 0.0;
      for (int64_t i = Z; i < Z + 48000; ++i) e += static_cast<double>(x.l[i]) * x.l[i];
      std::printf("wirt Fall 8: intern zurück ohne Start bei %lld, Energie am Master %.6g\n", (long long)Z, e);
      PRUEF(e == 0.0);   // kein eingefrorener Ausklang (ein Platz je Spur: 0,000923)
    }
  }
  PRUEF_ENDE();
}
