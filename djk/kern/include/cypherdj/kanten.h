// Kanten-Abgleich (Audit F05, Paket 2 Slice 1): reine Logik ohne JACK. Soll-Liste von (quelle, ziel)-Portnamen gegen
// die Ist-Abfrage (existiert / verbunden); geliefert werden die fehlenden Kanten, deren beide Ports existieren.
// Fehlt ein Port, wartet die Kante (Senke noch nicht wieder da): sie erscheint erst, wenn beide da sind.
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace cdj {

struct Kante {
  std::string quelle, ziel;
  bool operator==(const Kante& o) const { return quelle == o.quelle && ziel == o.ziel; }
};

struct KantenIst {
  bool (*existiert)(void* ctx, const char* port);
  bool (*verbunden)(void* ctx, const char* quelle, const char* ziel);
  void* ctx;
};

std::vector<Kante> fehlende_kanten(const std::vector<Kante>& soll, const KantenIst& ist);

// Slice 2 (F03): Kanten-Datei von djk-start, je Zeile QUELLE<TAB>ZIEL. Zeilen ohne TAB, leere Zeilen und Zeilen mit leerer
// Hälfte werden verworfen.
std::vector<Kante> lies_kanten(const std::string& text);
// B9: aus der Datei nur `<kern>midi_aus_N -> *` und `* -> <kern>rueck_erz_N_{L,R}` (kern_praefix = Client-Name plus ":").
// Audio-Ausgänge des Kerns sind über die Datei nie verbindbar (Riegel), fremde Kanten ohne Kern-Port fallen weg.
std::vector<Kante> filtere_kanten(const std::vector<Kante>& kanten, const std::string& kern_praefix);

// MINOR-5: Obergrenzen der Kanten-Datei; Duplikate (Quelle und Ziel gleich) entfallen, der Überschuss wird verworfen und
// gezählt (verworfen darf nullptr sein).
constexpr size_t KANTEN_DATEI_MAX = 64 * 1024;
constexpr size_t KANTEN_MAX = 64;
std::vector<Kante> entdoppeln_begrenzen(const std::vector<Kante>& kanten, size_t max, size_t* verworfen);

// MINOR-2/6: Buchführung der Journal-Zeilen je Kante. "Verlust" wird einmal je Verlust gemeldet, ein Scheitern höchstens alle
// 10 s; ist die Kante verbunden (auch von jemand anderem geheilt), beginnt beides von vorn.
class VerlustBuch {
 public:
  bool verlust_melden(const Kante& k) { return offen_.insert(schluessel(k)).second; }
  bool scheitern_melden(const Kante& k, int64_t jetzt_ns);
  void verbunden(const Kante& k);
  void geheilte_abgleichen(const std::vector<Kante>& soll, const KantenIst& ist);

 private:
  static std::string schluessel(const Kante& k) { return k.quelle + ">" + k.ziel; }
  std::set<std::string> offen_;
  std::map<std::string, int64_t> fehl_;
};

// Übergänge der Zielports (Fixup m2): je Ziel einmal "weg" beim Übergang da -> fehlt, einmal "wieder" beim Rückweg.
// Ein Ziel gilt anfangs als da (der Start hat es verbunden); wer von Anfang an fehlt, meldet "weg" beim ersten Blick.
struct ZielEreignis {
  std::string ziel;
  bool wieder;  // false = verschwunden, true = wieder da
};
class ZielUebergaenge {
 public:
  std::vector<ZielEreignis> pruefe(const std::vector<Kante>& soll, const KantenIst& ist);

 private:
  std::map<std::string, bool> da_;
};

// Karenz des Selbst-Wächters (Paket 2 Slice 1, B1 und Fixups m1/M1): *ab ist WaechterSeite::scharf_ab (mono_ns).
struct KarenzMarke {
  int64_t alt, gesetzt;
};
// Vor einem eigenen jack_connect: Karenz bis `bis`; die Marke merkt den Wert davor.
inline KarenzMarke karenz_beginnen(int64_t* ab, int64_t bis) {
  return {__atomic_exchange_n(ab, bis, __ATOMIC_ACQ_REL), bis};
}
// Scheitert der Connect: Wert vor der Karenz zurück, aber nur, wenn niemand inzwischen eine neuere gesetzt hat.
// Sonst verlängerte jeder gescheiterte Versuch alle 500 ms die Karenz und der Wächter tötete nie mehr.
inline void karenz_zuruecknehmen(int64_t* ab, KarenzMarke m) {
  int64_t erwartet = m.gesetzt;
  __atomic_compare_exchange_n(ab, &erwartet, m.alt, false, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
}
// Aus dem JACK-Benachrichtigungsfaden (kein RT, aber kein I/O): Karenz nur verlängern, nie verkürzen, und nur nach dem
// ersten Setzen durch main (0 = Ausgänge noch nicht verbunden).
// Rückgabe: true nur, wenn wirklich verlängert wurde (MINOR-3).
inline bool karenz_verlaengern(int64_t* ab, int64_t bis) {
  int64_t alt = __atomic_load_n(ab, __ATOMIC_ACQUIRE);
  while (alt > 0 && alt < bis) {
    if (__atomic_compare_exchange_n(ab, &alt, bis, false, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return true;
  }
  return false;
}

// Slice 3 (F06): All-Off nach Neuverbindung eines MIDI-Ausgangs. Je Kanal 0..15 {0xB0|ch, 123, 0} (All Notes Off) und
// {0xB0|ch, 120, 0} (All Sound Off): 32 Ereignisse. Zu kleiner Puffer (max < 32): 0 und nichts geschrieben.
constexpr int ALLE_AUS_N = 32;
int alle_aus_ereignisse(uint8_t out[][3], int max);

// Plan der All-Offs eines Ports (Slice 3, B10, Review Q1/Q2). setze() kommt aus dem Hauptfaden (Neuverbindung: 150 ms und
// 500 ms später), zyklus() nur aus dem JACK-Callback (keine Allokation, keine Sperre). Je Aufruf wird höchstens ein Slot
// bedient, und zwar der früheste fällige: sind beide im selben Zyklus fällig, folgen zwei All-Offs in zwei Zyklen (Q2).
// schreibe(i) schreibt das i-te der 32 Ereignisse und liefert true, wenn es im Puffer Platz fand; bei false geht es im
// nächsten Zyklus beim selben Ereignis weiter.
class AllAusPlan {
 public:
  static constexpr int64_t VERZUG1_NS = 150'000'000LL, VERZUG2_NS = 500'000'000LL;
  void setze(int64_t jetzt_ns) {
    f_[0].store(jetzt_ns + VERZUG1_NS, std::memory_order_release);
    f_[1].store(jetzt_ns + VERZUG2_NS, std::memory_order_release);
  }
  enum Ergebnis { NICHTS = 0, GESENDET = 1, PUFFER_VOLL = -1 };
  template <class Schreibe>
  Ergebnis zyklus(int64_t jetzt_ns, Schreibe&& schreibe) {
    if (slot_ < 0) {
      int64_t frueh = 0;
      for (int s = 0; s < 2; ++s) {
        const int64_t f = f_[s].load(std::memory_order_acquire);
        if (f != 0 && jetzt_ns >= f && (frueh == 0 || f < frueh)) { frueh = f; slot_ = s; }
      }
      if (slot_ < 0) return NICHTS;
    }
    while (pos_ < ALLE_AUS_N) {
      if (!schreibe(pos_)) return PUFFER_VOLL;
      ++pos_;
    }
    // nur löschen, was nicht inzwischen neu gesetzt wurde (neue Werte liegen in der Zukunft, also > jetzt)
    int64_t erw = f_[slot_].load(std::memory_order_acquire);
    if (erw != 0 && jetzt_ns >= erw) f_[slot_].compare_exchange_strong(erw, 0, std::memory_order_acq_rel);
    slot_ = -1;
    pos_ = 0;
    return GESENDET;
  }

 private:
  std::atomic<int64_t> f_[2] = {};
  int slot_ = -1, pos_ = 0;  // nur im Callback
};

}  // namespace cdj
