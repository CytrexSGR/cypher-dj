// Plan 2026-09-27 (Strudel im Kern, Stufe 1; INTERFACES §4.8, ADR 024): Erzeuger-Schlange je Strom und Stimmen
// eines Kits. Ereignisse tragen den Beat der Kern-Karte; block() setzt jedes am Sample llround(sample_at(beat)) ein und
// addiert die Stimmen in den Eingang ihres Mixer-Kanals (vor Trim). Außer dem Konstruktor läuft alles im Callback:
// keine Allokation, feste Größen.
#pragma once

#include <cmath>
#include <cstdint>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/graph_factory.h"
#include "cypherdj/kit.h"
#include "cypherdj/mixer.h"
#include "cypherdj/clock.h"

namespace cdj {

constexpr int ERZ_STROEME = 16;     // §4.8 strom 1 bis 16
constexpr int ERZ_FENSTER_EV = 64;  // /erz/ev je Bundle (der Erzeuger schickt höchstens 20, §2)
constexpr int ERZ_SCHLANGE = 1024;  // offene Ereignisse je Strom (zwei Takte Vorlauf mit großer Reserve)
constexpr int ERZ_STIMMEN = 32;     // gleichzeitig klingende Einsätze aller Ströme
constexpr int ERZ_MIDI_PORTS = 4;   // Studio S5: §7.1 midi_aus_1 bis _4
constexpr int ERZ_MIDI_EV = 256;    // MIDI-Ereignisse je Port und Zyklus
constexpr int ERZ_OFFEN = 64;       // klingende MIDI-Noten je Strom (Note-Off ausstehend)
// Glanz 2.5/2.4 (Erhebung Klickfrei 2026-10-01, Längen UNGEHÖRT, Ohr-Termin mit Andreas steht aus):
constexpr int ERZ_EIN = 32;         // F46: Einblende bei begin > 0 (0,67 ms), höchstens 1/4 des Ausschnitts
constexpr int ERZ_AUS = 96;         // F46/F50: Ausblende am Ende des gespielten Bereichs (2 ms), höchstens 1/4
constexpr int ERZ_AUSKLANG = 240;   // F16/F11: Ausklang einer abgelösten Stimme (5 ms, wie kit_build.py AUSBLENDE)
// Plätze für Ausklänge. Ein Ausklang (240 Frames) endet im Block nach seiner Entstehung, aber ein Raub im Block B und ein
// Kit-Tausch vor Block B+1 belegen zusammen bis zu 2 · ERZ_STIMMEN Plätze (Prüfung 06.10.: bei nur ERZ_STIMMEN harter Abbruch).
#ifdef CYPHERDJ_MUTATION_ERZ_AUSKLANG_PLAETZE
constexpr int ERZ_AUSKLAENGE = ERZ_STIMMEN;  // Fehlerfall der Abnahme: zu wenige Plätze
#else
constexpr int ERZ_AUSKLAENGE = 2 * ERZ_STIMMEN;
#endif
constexpr float ERZ_KANTE = 0.001f; // -60 dBFS: leiser ist keine Kante, keine Rampe, Ausgabe bitgleich
// Baukasten S3a: Graphen, die nach einem Wechsel ausklingen oder auf Freigabe warten (je Strom einer im Ausklang, einer
// sofort frei, wenn er während eines Ausklangs abgelöst wird).
constexpr int ERZ_BK_FREI = 2 * ERZ_STROEME;

// Glanz 2.7 (F19), corrected 2026-11-10 (wirt-timing): MIDI streams sound only after the round trip core -> host -> core: two cycles
// (the JACK graph loop closes one cycle after each of the two hops, the offset inside the cycle is kept). The core sends Note-On/Off
// that much earlier; kit streams are untouched. The lead is exactly the round trip, nothing is added: until 2026-11-10 it was
// 2 * n + 25, taken from 545 samples measured on 2026-09-30 (rundweg.md, 50 % of the band peak of a bass patch, a method with a
// bias of +14 on a synthetic test and the envelope of the patch on top), and every note of the host path started 24 samples (0.5 ms)
// before its grid point. With 2 * n the onset on the real host is the grid point plus the attack of the synth (Surge +2/+1,
// reasonablesynth +3/+2, RB-338 0/0, Vital +3/+3 at the -80 dBFS threshold; `test_kern_arr_wirt` case 9 pins the arithmetic,
// part 3 of `acceptance_p1.mjs` measures the real hosts; docs/architecture/stand/plugins-1-11.md "note timing"). A host with a
// declared plugin latency would add that latency to the lead; the four instruments measured here sit on the grid without it, other plugins are not measured.
constexpr int ERZ_MIDI_RUNDWEG_ZYKLEN = 2;
constexpr int64_t erz_midi_vorhalt(int64_t n) { return static_cast<int64_t>(ERZ_MIDI_RUNDWEG_ZYKLEN) * n; }

// Studio S5: MIDI eines Zyklus je Port, im Callback gefüllt, in main.cpp nach zyklus() auf JACK ausgegeben.
// t = Versatz im Zyklus (Samples). Reihenfolge ist NICHT garantiert aufsteigend; main.cpp sortiert vor der Ausgabe.
struct MidiAus {
  struct Ev { uint32_t t; uint8_t b[3]; };
  Ev ev[ERZ_MIDI_EV];
  int n = 0;
  int verloren = 0;  // voll oder t < 0: gezählt, nicht geschrieben
  void leer() { n = 0; }
  void schreibe(int64_t t, uint8_t s, uint8_t d1, uint8_t d2) {
    if (n >= ERZ_MIDI_EV || t < 0) { ++verloren; return; }
    ev[n++] = Ev{static_cast<uint32_t>(t), {s, d1, d2}};
  }
};

struct ErzEv {
  double beat;
  int32_t note;
  int32_t muster;
  float velocity;
  float begin = 0.0f, end = 1.0f;  // Scheibe 3: Anteil der Klanglänge (§4.8 Parameter-Schwanz, nr 0 und 1)
  double dauer = 0.0;  // Studio S5: Länge in Beats (§4.8 dauer_beats), für das Note-Off eines MIDI-Stroms
};

// Ein Fenster-Bundle, im Netz-Faden gebaut und geprüft: ev nach beat aufsteigend, jedes in [ab_beat, bis_beat).
struct ErzFenster {
  int32_t strom = 0, sendung = 0;
  double ab_beat = 0.0, bis_beat = 0.0;
  int32_t kappe = 0;  // Bug t_bffc3708 (stille): 1 = Noten des Stroms, die bei max(ab_beat, jetzt) noch klingen, enden dort (/erz/fenster, §4.8)
  int32_t n = 0;
  ErzEv ev[ERZ_FENSTER_EV];
};

struct ErzZaehler {  // Felder von /erz/quittung (§4.8) außer strom und sendung
  int32_t verworfen = 0, verworfen_anderes_muster = 0, eingefuegt = 0, zu_spaet = 0, ungehoert = 0;
};

// K2 Task 1.2: Kick-Auslöser eines block(): absolute Samples der gespielten Kit-Klänge mit duck = true
struct ErzAusloeser {
  static constexpr int MAX = 16;
  int64_t sample[MAX];
  int n = 0;
};

class Erzeuger {
 public:
  // Strom (1..16) auf ein Kit und einen Mixer-Kanal legen. Gibt das vorige Kit zurück (nullptr, wenn keins oder
  // dasselbe), bei ungültigem Strom das übergebene: der Aufrufer gibt es außerhalb des Callbacks frei. Stimmen des
  // abgelösten Kits klingen ERZ_AUSKLANG Frames aus einer Kopie aus (F11); das alte Kit liest der Callback danach nicht mehr.
  const Kit* setze_strom(int strom, const Kit* kit, int kanal);
  // Studio S5: Strom als MIDI-Strom (port 1..ERZ_MIDI_PORTS, midi_kanal 1..16); port 0 = kein MIDI (Kit wie bisher).
  // Offene Noten gehen im nächsten block() auf dem ALTEN Port/Kanal aus. Solange MIDI gilt, spielt das Kit nicht.
  void setze_midi(int strom, int port, int midi_kanal);
  // Glanz 2.7 (F19): Note-On/Off der MIDI-Ströme gehen um samples früher hinaus. Der Kern setzt das je Zyklus auf
  // erz_midi_vorhalt(n) = ERZ_MIDI_RUNDWEG_ZYKLEN · n; 0 (Vorgabe) = am Sample des Beats.
  void setze_midi_vorhalt(int64_t samples) { midi_vorhalt_ = samples > 0 ? samples : 0; }
  // Baukasten S3a: Strom als Baukasten-Graph (bk aus cypher_bk_neu, nullptr = keiner) auf Mixer-Kanal kanal. Der Erzeuger
  // besitzt ihn bis bk_frei(). Solange ein Graph gilt, spielen Kit und MIDI dieses Stroms nicht; Noten gehen am Sample
  // des Beats ohne Vorhalt an den Graphen, das Off nach dauer. Ein abgelöster Graph klingt mit seinen gehaltenen Noten
  // ERZ_AUSKLANG Frames linear aus und kommt danach über bk_frei() zurück. Vor setze_strom aufrufen (Kanal des abgelösten
  // Graphen). Allokiert nicht.
  void setze_bk(int strom, CypherBk* bk, int kanal);
  // Baukasten S3b: Graphen im Graph-Werk mit einem Block Vorlauf (nullptr = S3a im Callback). Vor dem ersten block().
  // Mit Werk wartet ein neuer Graph (setze_bk) in Strom::bk_neu, bis die Plätze des Stroms frei sind; der alte spielt im
  // Wechselblock seinen vorgerechneten Block mit der Ausklang-Rampe ab 0, der neue klingt ab dem Folgeblock.
  void setze_graph_werk(GraphWerk* w) { werk_ = w; }
  // S5r: die Werte der Graph-Regler <kanal>/bk/1..8 (Zeile = Mixer-Kanal), vom Kern geführt. nullptr (Tests ohne Kern): keine
  // Meldung, der Graph bleibt auf seinen Werten (K10). Der Erzeuger meldet sie je Block an den Graphen des Stroms, nie an einen
  // Platz, an dem ein Faden rechnet.
  void setze_bk_wert(const float (*w)[8]) { bk_wert_ = w; }
  // Abgelöste und ausgeklungene Graphen zur Freigabe außerhalb des Callbacks (höchstens max), nach block() aufrufen.
  int bk_frei(CypherBk** aus, int max);
  // voll: Freigabeliste voll, Graph nicht freigegeben. verspaetet (S3b): Blöcke, in denen ein Faden den Graphen noch rechnete (Stille)
  struct BkStand { uint32_t verloren = 0, panik = 0, voll = 0, verspaetet = 0; };
  BkStand bk_stand() const { return bk_stand_; }
  int64_t midi_vorhalt() const { return midi_vorhalt_; }
  // §4.8 „Fenster ersetzen“. jetzt_beat: Beat des ersten noch nicht gespielten Samples. Für MIDI-Ströme (Glanz 2.7) gilt als
  // "jetzt" das tatsächlich schon Gesendete (Strom::gesendet_bis, Sample + Vorhalt des letzten block()), nicht Sample + Vorhalt
  // des neuen Quantums (Re-Prüfung N2: das wäre bei wachsendem Quantum zu weit vorn, ein Ersatz noch nicht gesendeter Noten fiele aus).
  ErzZaehler fenster(const ErzFenster& f, double jetzt_beat);
  // Samples [n0, n0 + n), n <= MIX_BLOCK. ein_l[k], ein_r[k]: Eingang des Mixer-Kanals k (addiert). midi (ERZ_MIDI_PORTS
  // Puffer oder nullptr): Note-On/Off der MIDI-Ströme mit t = Sample − zyklus_n0. ausl (oder nullptr): K2, meldet die
  // Einsatz-Samples der gespielten Klänge mit duck (höchstens ErzAusloeser::MAX, der Rest verfällt still).
  void block(const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r, MidiAus* midi = nullptr,
             int64_t zyklus_n0 = 0, ErzAusloeser* ausl = nullptr);
  void leeren();  // neue Zeitachse (§4.2): offene Ereignisse fallen weg, Kits und Stimmen bleiben
  int offen(int strom) const { return (strom >= 1 && strom <= ERZ_STROEME) ? st_[strom - 1].n : 0; }
  int stimmen() const;
  int ausklaenge() const;  // F16/F11: belegte Ausklang-Plätze

 private:
  struct Strom {
    const Kit* kit = nullptr;
    int kanal = -1;
    int n = 0;
    int midi_port = 0, midi_kanal = 1;  // Studio S5: 0 = Kit-Strom
    CypherBk* bk = nullptr;  // Baukasten S3a: Graph, Vorrang vor Kit und MIDI
    // Baukasten S3b (mit Werk): Kanal des Graphen, fest ab dem Wechsel (setze_strom ändert nur kanal, D7); ein neuer
    // Graph wartet in bk_neu (auch nullptr: Graph ab), bis aktiver und Ausklang-Platz frei sind (D6).
    int bk_kanal = -1;
    CypherBk* bk_neu = nullptr;
    int bk_neu_kanal = -1;
    bool bk_neu_gesetzt = false;
    // Glanz 2.7 Prüfung R3: Beat, bis zu dem MIDI dieses Stroms schon hinaus ist (alles mit beat < gesendet_bis). Wächst mit
    // jedem block() um n + Vorhalt; schrumpft das Quantum, liegt es weiter vorn als Sample + neuer Vorhalt.
    double gesendet_bis = -HUGE_VAL;
    struct Offen { int64_t aus; uint8_t note, port, kanal; int64_t an = 0; };   // an: Sample des On (die Kappe setzt aus nie davor)
    Offen offen[ERZ_OFFEN];
    int n_offen = 0;
    // Bug t_bffc3708 (stille): ein Fenster mit kappe = 1 merkt den Beat, an dem noch klingende Noten enden; angewendet im block(), sobald dieser
    // Beat im bearbeiteten Block liegt (nach allen Ereignissen davor, vor den neuen ab dort)
    bool kappe = false;
    double kappe_beat = 0.0;
    ErzEv ev[ERZ_SCHLANGE];  // nach beat aufsteigend
  };
  struct Stimme {
    const KitKlang* klang = nullptr;
    int kanal = -1;
    int64_t pos = 0;
    int64_t ende = 0;  // Scheibe 3: floor(end · frames), die Stimme endet dort
    float g = 0.0f;
    int64_t start = 0;  // F46: erster Frame des Ausschnitts
    int ein = 0, aus = 0;  // F46/F50: Rampenlängen dieser Stimme, 0 = keine (bitgleich)
    uint64_t nr = 0;  // F16: Einsatzfolge, die kleinste wird geraubt
  };
  // Baukasten S3b (D8): welche fälligen Offs noten_aus hinausgibt. ALLE ohne Werk; mit Werk NUR_GRAPH (nur bei freiem Platz)
  // und OHNE_GRAPH (Kit/MIDI-Weg). MIDI-Offs (port != 0) bleiben stehen, solange kein midi-Puffer da ist (B1).
  enum class OffsWahl { ALLE, NUR_GRAPH, OHNE_GRAPH };
  void noten_aus(Strom& s, int64_t bis, MidiAus* midi, int64_t n0, int64_t zyklus_n0, OffsWahl wahl);
  // Bug t_bffc3708: die offenen Noten enden spätestens am Kappe-Beat (ihr Off nie vor ihrem On); Graph-Noten am Sample, MIDI-Noten um den Vorhalt früher
  void kappe_anwenden(Strom& s, const Karte& k, int64_t vor);
  static void spiele(Stimme& v, int von, int bis, float* const* ein_l, float* const* ein_r);
  static float huelle(const Stimme& v, int64_t p);
  void ausklingen(Stimme& v);
  Strom st_[ERZ_STROEME];
  Stimme sti_[ERZ_STIMMEN];
  // F16/F11 (Glanz 2.5.2): Kopie der nächsten ERZ_AUSKLANG Frames einer abgelösten Stimme, Hüllkurve und Ausblende
  // eingerechnet. Liest nach dem Kopieren kein Kit mehr: das alte Kit darf sofort zur Freigabe (ERZ_ALT).
  struct Ausklang {
    int kanal = -1, n = 0, pos = 0;
    float d[2 * ERZ_AUSKLANG];
  };
  Ausklang ak_[ERZ_AUSKLAENGE];  // 64 · 240 · 2 · 4 B = 123 KB (Erhebung nannte 32 Slots, die Prüfung 06.10. zeigte: 64), im Kern-Konstruktor angelegt
  struct BkAus { CypherBk* bk = nullptr; int kanal = -1, pos = 0; };  // Baukasten S3a: Ausklang eines abgelösten Graphen
  BkAus bk_aus_[ERZ_STROEME];
  CypherBk* bk_frei_[ERZ_BK_FREI] = {};
  int n_bk_frei_ = 0;
  BkStand bk_stand_;
  float bk_l_[MIX_BLOCK], bk_r_[MIX_BLOCK];  // Baukasten S3a: Ausgabe eines Graphen vor dem Addieren
  void bk_zur_freigabe(CypherBk* bk);
  void bk_addiere(const float* q_l, const float* q_r, int kanal, int n, float* const* ein_l, float* const* ein_r, int ausblende_ab,
                  int ausblende_n);
  // Baukasten S3b
  GraphWerk* werk_ = nullptr;
  const float (*bk_wert_)[8] = nullptr;
  void bk_regler_melden(CypherBk* bk, int kanal);
  void bk_wechsel(Strom& s, CypherBk* bk, int kanal);
  // Graph-Ereignisse mit Sample < bis an den Graphen (Versatz relativ zu von, frühere am Fensteranfang), dann die Offs bis bis.
  void bk_noten(Strom& s, const Karte& k, int64_t von, int64_t bis);
  void bk_ausklang_werk(int a, int64_t n0, int n, float* const* ein_l, float* const* ein_r);
  void bk_vorlauf(Strom& s, int a, const Karte& k, int64_t n0, int n, float* const* ein_l, float* const* ein_r);
  uint64_t gezaehlt_ = 0;
  int64_t midi_vorhalt_ = 0;  // Glanz 2.7 (F19), im Callback gesetzt
};

}  // namespace cdj
