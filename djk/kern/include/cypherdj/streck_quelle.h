// Die Quellen-Seite des Dehners (Plan 2026-10-06-keylock-echtzeit.md, Task 2; Übergabe-Vertrag 1, 3, 4, 5): was jede
// Quelle mit Keylock braucht, um einen Dehner zu fahren, ohne ihn im Callback anzufassen. Das Deck nutzt es in Task 2, die
// Loop-Boxen in Task 7 nach demselben Muster. Header-only, ohne Rubber Band: jede Quelle bindet nur diesen Kopf.
//
//   StreckPost   Briefkasten Callback -> Vorbereiter (Ansatz-Aufträge mit Nummer, neuester gewinnt) und Antwort zurück
//                (Auftragsnummer und Epoche, die der Dehner dafür vergab). Der Callback ruft nie ansetzen(): das tut der
//                Vorbereiter in takt() (reset der Reserve-Instanz allokiert, dehner.cpp Kopf).
//   StreckLeihe  welche Bänder der Dehner noch lesen kann (Vertrag 4): ein Band, das ab Auftrag nr nicht mehr benutzt
//                wird, ist frei, sobald die Antwort für nr (oder später) da ist UND der Arbeits-Thread deren Epoche
//                quittiert hat. Erst dann darf die Quelle ihr Material zurückgeben.
//   StreckLeser  der Automat der Leser-Seite (Task 2b, Prüfung m6): Aufträge aufgeben, Epoche übernehmen, Ring je Block
//                lesen, Brücke, Blenden (Brücke -> Ring, Ring -> Varispeed-Weg, Einfrieren beim Ereignis), Frist verpasst,
//                Unterlauf. Die Quelle liefert je Sample ihren Varispeed-Weg und ob sie den Ring hören will; was sie hört,
//                mischt der Leser. Das Deck nutzt ihn (Task 2), die Loop-Boxen nach demselben Muster (Task 7).
//
// Epochen vergibt nur der Dehner (Prüfung F4): die Quelle erfährt sie über die Antwort, nicht über epoche() allein, weil
// sie nach einem Ereignis die Epoche IHRES Auftrags braucht und nicht die eines älteren, noch laufenden.
#pragma once

#include <atomic>
#include <cstdint>
#include <cstring>

#include "cypherdj/blende.h"
#include "cypherdj/dehner.h"
#include "cypherdj/dreifach.h"

namespace cdj {

struct StreckAnfrage {
  AnsatzAuftrag a;
  uint32_t nr = 0;
};
struct StreckStand {
  KartenStand st;
  uint32_t nr = 0;  // Auftrag, zu dem Anker und Karte gehören: erneuert wird nur dieser (sonst Anker und Band gemischt)
};

class StreckPost {
 public:
  // ---- Callback (wartefrei, keine Allokation)
  // Neuer Auftrag; ersetzt einen noch nicht abgeholten. Rückgabe: seine Nummer (fortlaufend ab 1, nie 0).
  uint32_t anfordern(const AnsatzAuftrag& a) noexcept {
    if (++nr_ == 0) nr_ = 1;
    StreckAnfrage& p = an_.platz();
    p.a = a;
    p.nr = nr_;
    an_.veroeffentliche();
    return nr_;
  }
  // Antwort: obere 32 Bit Auftragsnummer, untere 32 Bit Epoche. 0: noch keine.
  uint64_t antwort() const noexcept { return antwort_.load(std::memory_order_acquire); }
  static uint32_t antwort_nr(uint64_t a) noexcept { return static_cast<uint32_t>(a >> 32); }
  static uint32_t antwort_e(uint64_t a) noexcept { return static_cast<uint32_t>(a & 0xffffffffu); }
  // Je Block: Karte und Anker zum Auftrag nr für die Erneuerung (vorbereiter_schritt).
  void stand(const KartenStand& s, uint32_t nr) noexcept {
    StreckStand& p = st_.platz();
    p.st = s;
    p.nr = nr;
    st_.veroeffentliche();
  }

  // ---- Vorbereiter (eigener Faden; in den Tests synchron)
  void takt(DehnerBasis& d) {
    const StreckAnfrage* a = nullptr;
    if (an_.hole(a)) {
      offen_ = *a;
      hat_offen_ = true;
    }
    if (hat_offen_) {
      const uint32_t e = d.ansetzen(offen_.a);
      if (e != EPOCHE_KEINE) {
        hat_offen_ = false;
        letzter_nr_ = offen_.nr;
        antwort_.store((static_cast<uint64_t>(offen_.nr) << 32) | e, std::memory_order_release);
      } else {
        besetzt_.fetch_add(1, std::memory_order_relaxed);  // keine Reserve frei: im nächsten Takt wieder
      }
    }
    const StreckStand* s = nullptr;
    if (st_.hole(s)) {
      stand_ = *s;
      hat_stand_ = true;
    }
    if (hat_stand_ && !hat_offen_ && letzter_nr_ != 0 && stand_.nr == letzter_nr_) {
      const uint32_t vor = d.epoche();
      d.vorbereiter_schritt(stand_.st);
      const uint32_t nach = d.epoche();
      if (nach != vor) antwort_.store((static_cast<uint64_t>(letzter_nr_) << 32) | nach, std::memory_order_release);
    }
  }
  uint64_t besetzt() const noexcept { return besetzt_.load(std::memory_order_relaxed); }

 private:
  Dreifach<StreckAnfrage> an_;
  Dreifach<StreckStand> st_;
  std::atomic<uint64_t> antwort_{0};
  std::atomic<uint64_t> besetzt_{0};
  uint32_t nr_ = 0;  // nur der Callback
  // nur der Vorbereiter
  StreckAnfrage offen_;
  bool hat_offen_ = false;
  StreckStand stand_;
  bool hat_stand_ = false;
  uint32_t letzter_nr_ = 0;
};

// N Plätze für Bänder (Q: eine DehnerQuelle der Quelle, z. B. DeckBand). Nur der Callback benutzt die Leihe.
template <class Q, int N>
class StreckLeihe {
 public:
  // Einen freien Platz nehmen (nullptr: alle verliehen).
  Q* nimm() noexcept {
#if defined(CYPHERDJ_PRUEF_GEN) && defined(CYPHERDJ_PRUEF_REIHUM)
    // Prüfbau-Variante (Plan 3.6): reihum ab dem zuletzt genommenen Platz, damit ein freigegebener Platz möglichst lange frei bleibt (eine
    // Lesung danach trifft ihn dann frei und wird gezählt). Der Prüfbau ohne REIHUM vergibt wie der Betrieb (erster freier Platz; Fix-Runde
    // W3 S4: reihum allein machte manche Abläufe selten, die der Betrieb sofort hat)
    for (int j = 1; j <= N; ++j) {
      Platz& p = p_[(letzt_ + j) % N];
      if (p.belegt) continue;
      letzt_ = (letzt_ + j) % N;
#else
    for (Platz& p : p_)
      if (!p.belegt) {
#endif
        p.belegt = true;
        p.nr_ab = 0;
        p.e_ab = EPOCHE_KEINE;
        p.w_ab = false;
        p.w_nr = 0;
        gen_schritt(p);
        return &p.q;
      }
    return nullptr;
  }
  // Das Band q wird von Aufträgen ab nr_ab nicht mehr benutzt (nr_ab ist der Auftrag, der es ablöst).
  void abgeben(const Q* q, uint32_t nr_ab) noexcept {
    for (Platz& p : p_)
      if (p.belegt && &p.q == q && p.nr_ab == 0) p.nr_ab = nr_ab;
  }
  // Keylock 6b (Plan Task 6, 3.6), zweiter Freigabeweg, nur für den glücklichen Pfad des Wechsels in der Quelle: das Band q wird
  // in seiner Epoche vom Wechsel wnr abgelöst. Frei, sobald der Vorbereiter wnr bestätigt hat (pflege: bestaetigt >= wnr; Entscheid
  // der Hauptinstanz 09.10. statt wechsel_gelesen, dehner.h: vorher kann eine laufende Erneuerung q noch lesen). Der Aufrufer
  // verbürgt die anderen beiden Seiten der Drei-Seiten-Regel: wnr ist ANGENOMMEN (nicht nur gelesen, nicht verfehlt), der Leser
  // hält q nicht mehr, und kein Auftrag in Flug nennt q. Der Epochenweg (abgeben) bleibt daneben gültig: wer zuerst trägt, gibt frei.
  void abgeben_wechsel(const Q* q, uint32_t wnr) noexcept {
#ifdef CYPHERDJ_MUTATION_PLAN_LEIHE_ALT_BLEIBT
    (void)q, (void)wnr;  // Fehlerfall: das abgelöste Band wird erst mit der nächsten Epoche frei (P13 rot)
#else
    for (Platz& p : p_)
      if (p.belegt && &p.q == q && !p.w_ab) {
        p.w_ab = true;
        p.w_nr = wnr;
      }
#endif
  }
  // Je Block: Antwort und Quittung des Threads auswerten, freie Plätze zurücknehmen. bestaetigt: wechsel_bestaetigt() des Dehners
  // (0: keiner; die Box und die alten Aufrufer übergeben nichts, für sie gilt nur der Epochenweg).
  void pflege(uint64_t antwort, uint32_t quittiert, uint32_t bestaetigt = 0) noexcept {
    const uint32_t a_nr = StreckPost::antwort_nr(antwort), a_e = StreckPost::antwort_e(antwort);
    for (Platz& p : p_) {
      if (!p.belegt) continue;
      if (p.w_ab && bestaetigt != 0 && static_cast<int32_t>(bestaetigt - p.w_nr) >= 0) {
        frei(p);
        continue;
      }
      if (p.nr_ab == 0) continue;
      if (p.e_ab == EPOCHE_KEINE && a_e != EPOCHE_KEINE && a_nr != 0 && static_cast<int32_t>(a_nr - p.nr_ab) >= 0)
        p.e_ab = a_e;  // erste Epoche, die nach der Ablösung vergeben wurde
      if (p.e_ab != EPOCHE_KEINE && quittiert != EPOCHE_KEINE && static_cast<int32_t>(quittiert - p.e_ab) >= 0) frei(p);
    }
  }
  // Liest der Dehner womöglich noch ein Band, für das f(q) gilt?
  template <class F>
  bool verliehen(F&& f) const noexcept {
    for (const Platz& p : p_)
      if (p.belegt && f(p.q)) return true;
    return false;
  }
  // Diagnose: f(band, nr_ab, e_ab) für jeden belegten Platz
  template <class F>
  void jeder(F&& f) const {
    for (const Platz& p : p_)
      if (p.belegt) f(p.q, p.nr_ab, p.e_ab);
  }
  int belegt() const noexcept {
    int n = 0;
    for (const Platz& p : p_) n += p.belegt ? 1 : 0;
    return n;
  }

 private:
  struct Platz {
    Q q;
    bool belegt = false;
    uint32_t nr_ab = 0;              // 0: noch in Gebrauch
    uint32_t e_ab = EPOCHE_KEINE;    // Epoche, deren Quittung den Platz frei macht
    bool w_ab = false;               // 6b: vom Wechsel w_nr abgelöst (zweiter Freigabeweg)
    uint32_t w_nr = 0;
  };
  void frei(Platz& p) noexcept {
    p.belegt = false;
    gen_schritt(p);
  }
  // Prüfbau: Generation des Platzes (ungerade verliehen, gerade frei), wenn das Band eine hat (DeckBand::pruef_gen)
  static void gen_schritt(Platz& p) noexcept {
#ifdef CYPHERDJ_PRUEF_GEN
    if constexpr (requires { p.q.pruef_gen; }) p.q.pruef_gen.fetch_add(1, std::memory_order_acq_rel);
#else
    (void)p;
#endif
  }
  Platz p_[N];
#if defined(CYPHERDJ_PRUEF_GEN) && defined(CYPHERDJ_PRUEF_REIHUM)
  int letzt_ = N - 1;
#endif
};

// ------------------------------------------------------------------------------------------------ StreckLeser
constexpr int STRECK_BLENDE = 960;  // Brücke <-> Ring, Ring <-> Varispeed-Weg, eingefrorenes Altes (Architektur 3, 7; Vertrag 8)
// Einschwingen des Rings nach s_h: der Dehner (Task 1) liefert ab s_h noch nicht den eingeschwungenen R3-Ton; die Blende
// Brücke -> Ring beginnt darum erst bei s_h + STRECK_EINSCHWING (die Frames davor werden gelesen und verworfen).
// Herkunft:
//  - Sinus 1000 Hz, 8 Tempi 96 bis 170 BPM (07.10.2026, task-02/r3_einschwingen.txt, probe_start.cpp): über 0,01 vom
//    eingepassten Sinus bis höchstens Frame 703 nach s_h; daraus zuerst 768.
//  - Klick-Material, 110, 132 und 170 BPM (Task 2b, test_deck_keylock Test 14, task-02-fix/einschwingen_klick_probe.txt):
//    Klickform gegen einen eingeschwungenen Bezug (Korrelation) unter 0,95 bis d = 1024 bei allen drei Tempi, bei 110 BPM
//    noch bei d = 1280 (0,72); ab d = 1408 überall >= 0,985. 768 reichte am Klick also nicht.
// Entscheid der Hauptinstanz 07.10. (Task 2c): 1408, 13 ms mehr Brücke sind unhörbar gegen einen gestörten ersten Klick.
// Test 14 wird rot, wenn die Konstante unter dem gemessenen Wert liegt.
#ifdef CYPHERDJ_MUTATION_KEYLOCK_EINSCHWING_768
constexpr int STRECK_EINSCHWING = 768;  // Fehlerfall: der Wert vor der Messung am Klick (Test 14 rot)
#else
constexpr int STRECK_EINSCHWING = 1408;
#endif
constexpr int STRECK_VERPASST = 8;          // Vertrag 5: so oft wandert s_h, dann aufgegeben
constexpr int64_t STRECK_RASTER = 1024;     // Vertrag 5: s_h wandert auf das nächste Vielfache davon
constexpr int STRECK_MAX_BLOCK = 1024;      // größter Block (MIX_BLOCK)
constexpr int STRECK_KNAPP = 128;           // Prüfung m2: liegen nach dem Block weniger Frames voraus, blendet der Ring aus
constexpr int STRECK_ALT_MIN = 128;         // Vertrag 8: weniger Frames zum Einfrieren -> die Quelle blendet aus dem Material

class StreckLeser {
 public:
  enum class Q : uint8_t { VARI, RING, ALT };  // Quellen des Blendenplatzes: Varispeed-Weg der Quelle, Ring, Eingefrorenes

  // Vor dem Start, nicht im Callback. k und gen: Karte und ihr Zähler (Vertrag 10), Adressen fest.
  void verbinde(DehnerBasis* d, StreckPost* p, const Karte* k, const uint32_t* gen) noexcept {
    d_ = d;
    p_ = p;
    k_ = k;
    gen_ = gen;
  }
  bool bereit() const noexcept { return d_ && p_ && k_; }

  // ---- Aufträge (Callback). Ein Ereignis bei s: Ansatz mit Band q ab Anker a auf s_h = s + ANSATZ_FRIST, oder Leer.
  uint32_t ansetzen(int64_t s, const DehnerQuelle* q, DehnerAnker a) noexcept {
    anker_ = a;
    quelle_ = q;
    return auftrag(s, q, s + ANSATZ_FRIST, true);
  }
  uint32_t leer(int64_t s) noexcept { return auftrag(s, nullptr, s, true); }
  // Task 7 (7a 3.5 Punkt 1): Ansatz mit fernem Ziel-Sample. Die Loop-Box kennt ihren Einsatz E Sekunden vorher und setzt
  // s_h = E − STRECK_EINSCHWING − BOX_VORLAGE (768, seit 7b.2; mindestens s + ANSATZ_FRIST, das prüft der Aufrufer): der Ring bleibt bis dahin
  // liegen (streck_ring.h, Vertrag 1), der Füll-Faden hört beim Vorlauf auf, der R3 steht beim Einsatz eingeschwungen.
  uint32_t ansetzen_ab(int64_t s, int64_t s_h, const DehnerQuelle* q, DehnerAnker a) noexcept {
    anker_ = a;
    quelle_ = q;
    return auftrag(s, q, s_h, true);
  }
  // Task 7 (7a 3.5 Punkt 2): Start aus Stille. Wird der Ring zum ersten Mal nach diesem Aufruf gewollt und ist er dann
  // bereit (Epoche bestätigt, Frames da), klingt er sofort, ohne die Blende aus der Brücke (vor dem Einsatz ist nichts
  // hörbar, aus dem geblendet werden könnte). Ist er dann nicht bereit, gilt der gewöhnliche Weg (Brücke, Frist).
  // Gilt einmal; jedes neue Ereignis (ansetzen, leer) nimmt es zurück, ansetzen_ab nicht (der Aufrufer setzt es danach).
  // an = false nimmt ihn zurück (die Quelle setzte ein, ohne den Ring zu wollen, z. B. im Direktweg bei 128 BPM: ein späterer
  // Wunsch kommt dann aus einem hörbaren Weg und braucht die Blende).
  void aus_stille(bool an = true) noexcept { still_ = an; }
  // Keylock 7b.2: der Start aus Stille ist gewünscht und der Ring bereit (Epoche bestätigt), aber noch nicht hörbar. Die Box
  // ruft dann mische schon vor dem Einsatz (BOX_VORLAGE); vor s_h + STRECK_EINSCHWING bleibt es still.
  bool still_bereit() const noexcept { return still_ && ok_ && !ring_ && rest_ == 0 && !leer_ && !aufgegeben_; }

  // ---- Ereignis im hörbaren Weg bei s (Prüfung M1, Vertrag 8): friert ein, was gerade klingt, solange der Ring daran
  // beteiligt ist (Ring hörbar oder eine Keylock-Blende läuft), und blendet es über bis zu 960 Frames gegen den neuen
  // Varispeed-Weg aus: vom aktuellen Gewicht weiter, ohne Sprung. vl/vr: die nächsten nv Samples des ALTEN Varispeed-Wegs
  // ohne Gain (nur nötig, wenn braucht_vari()); e: Gain der Quelle beim Ereignis (Einblende × Stopp-Rampe, wie blende_von,
  // Nachprüfung N1); gs0: der Stopp-Gain darin (1 ohne Rampe). Läuft die Rampe danach weiter, folgt das Eingefrorene ihr
  // (gs / gs0, Prüfung m3); endet sie mit dem Ereignis (Laden, Entladen, Start), bleibt es bei e. false: der Ring war nicht
  // beteiligt oder es liegen weniger als STRECK_ALT_MIN Frames vor (Vertrag 8); dann blendet die Quelle aus dem Material.
  bool ring_beteiligt() const noexcept { return ring_ || (rest_ > 0 && (a_ == Q::RING || b_ == Q::RING)); }
  bool braucht_vari() const noexcept { return rest_ > 0 && (a_ == Q::VARI || b_ == Q::VARI); }
  // Keylock 7b.1 (Entscheidung der Hauptinstanz 08.10., Vertrag 7 eingeschränkt): kommt die Karte auf die Basis, während der
  // Ring klingt (oder die Blende in den Ring läuft), will die Quelle ihn weiter, bis zum nächsten Ereignis (das friert ein
  // und setzt neu an; danach gilt auf der Basis wieder der Direktweg). Grund: R3 hält die Phase eines stehenden Tons nicht,
  // die lineare 960er-Blende Ring -> Direktweg löschte teilweise aus (Sinus 416 Hz kleinste Spitze 0,27 statt 0,5, Deck
  // 213 Hz −12,6 dB; task-07-pruefung/qualitaet). Wer auf der Basis einsetzt, ohne dass der Ring klang, bleibt im
  // Direktweg (bitgleich). Die Quelle ruft das für ihr will: will = ... && (!basis || basis_halten()).
  // Keylock 7c.4 (b, Entscheidung der Hauptinstanz 08.10.): spielt die Quelle gerade den Direktweg (Basis), blendet jedes
  // Einfrieren (Ring bzw. Blendenplatz -> Direktweg) gleich laut (sin/cos) statt linear: Ring und Direktweg sind bei Faktor 1
  // in der Phase nicht verbunden (Rauschen |rho| <= 0,16, Nachprüfung 7b C), linear brach breitbandiges Material um bis
  // −3,8 dB ein. Ein stehender Sinus in Gegenphase bleibt eine Grenze (ADR 029). Je Block von der Quelle gesetzt.
  void basis(bool b) noexcept { basis_ = b; }
  bool basis_halten() const noexcept {
#ifdef CYPHERDJ_MUTATION_KEYLOCK_BASIS_WECHSEL
    return false;  // Fehlerfall (Stand Task 7): auf der Basis blendet der Ring linear in den Direktweg
#else
    return ring_beteiligt();
#endif
  }
  // leistung (Task 7, 7a 3.5 Punkt 3): die Blende ALT -> neuer Varispeed-Weg gleich laut (blende.h gleich_laut) statt
  // linear; für zwei verschiedene Quellen (Loop-Wechsel in einer klingenden Box, F13). Vorgabe linear wie bisher.
  // max_n (Keylock 6a, Fix-Runde 1 Q2): höchstens so viele Frames einfrieren (die Ausblende wird so kurz); Vorgabe STRECK_BLENDE.
  bool einfrieren(int64_t s, float e, float gs0, const float* vl, const float* vr, int nv, bool leistung = false,
                  int max_n = STRECK_BLENDE) noexcept {
    if (!bereit() || !ring_beteiligt()) return false;
    leistung_neu_ = leistung;
#ifdef CYPHERDJ_MUTATION_KEYLOCK_BLENDE_HART
    if (rest_ > 0) {  // Fehlerfall (Task 2 vor der Prüfung): Ereignis in der Blende bricht sie hart ab
      rest_ = 0;
      ring_ = false;
      return false;
    }
#endif
    const bool ok = frieren(s, e, gs0, vl, vr, nv, -1, max_n);
    leistung_neu_ = false;
    return ok;
  }

  // ---- Blockanfang (Callback): Antwort übernehmen, Stand veröffentlichen, Ring für [s, s + n) lesen (verbraucht in
  // JEDEM Block, Vertrag 1). true: Unterlauf droht (Ring beteiligt, nach dem Block weniger als STRECK_KNAPP Frames bereit):
  // die Quelle friert dann ein (einfrieren) und meldet unterlauf(s).
  bool block_anfang(int64_t s, int n) noexcept {
    q_ab_ = q_bis_ = 0;
    q_s0_ = s;
    if (!bereit()) return false;
    if (n > STRECK_MAX_BLOCK) {  // Nachprüfung N5: größer als der Puffer: gelesen wird nur der Anfang, gezählt; die Quelle
      ++zu_gross_n_;             // muss teilen (Deck::block tut es), sonst fehlt der Ring dahinter (Unterlauf, hart)
      n = STRECK_MAX_BLOCK;
    }
    const uint64_t ant = p_->antwort();
    StreckRing& ring = d_->ring();
    if (StreckPost::antwort_nr(ant) == nr_ && StreckPost::antwort_e(ant) != EPOCHE_KEINE) {
      const uint32_t e = StreckPost::antwort_e(ant);
      // während eine Blende den Ring liest, bleibt die Epoche (eine Erneuerung kommt nur vor s_h, Dehner)
      if (e != e_ && !(rest_ > 0 && (a_ == Q::RING || b_ == Q::RING))) {
        e_ = e;
        ring.setze_epoche(e);
      }
      if (e == e_) ok_ = true;
    }
    if (!leer_) {
      KartenStand ks;
      ks.karte = *k_;
      ks.anker = anker_;
      ks.generation = gen_ ? *gen_ : 0;
      ks.s_jetzt = s;
      d_->karte_veroeffentlichen(ks);
      p_->stand(ks, nr_);
    }
    if (e_ == EPOCHE_KEINE) return false;
    const int64_t ab = ring.bereit_ab(s);
    if (ab >= 0 && ab < s + n) {
      const int o = static_cast<int>(ab - s);
      const int k = ring.lies_bis(ab, n - o, ql_ + o, qr_ + o);
      gelesen_ += static_cast<uint64_t>(k);
      q_ab_ = o;
      q_bis_ = o + k;
    }
    if (!ring_beteiligt()) return false;
#ifdef CYPHERDJ_MUTATION_KEYLOCK_UNTERLAUF_HART
    return false;  // Fehlerfall (Task 2 vor der Prüfung): kein Blick voraus, der Ring reißt hart
#else
    const int64_t voraus = q_bis_ == n ? ring.verfuegbar(s + n) : 0;
    return q_ab_ > 0 || q_bis_ < n || voraus < STRECK_KNAPP;
#endif
  }
  // Nach dem Einfrieren bei drohendem Unterlauf (Vertrag 2): zählen, neuer Ansatz mit demselben Anker.
  void unterlauf(int64_t s) noexcept {
    ++unterlauf_n_;
    if (!leer_) auftrag(s, quelle_, s + ANSATZ_FRIST, false);
  }

  // ---- je Sample (Callback). i: Index im Block, si: Sample; will: die Quelle will den Ring (läuft, kein Direktweg,
  // Keylock an, kein Loop). (a, b): ihr Varispeed-Weg samt Gains und eigener Blenden, wird überschrieben mit dem, was zu
  // hören ist. ge/gs: Einblende und Stopp-Rampe der Quelle, die auch auf den Ring wirken (*_an: angewandt).
  void mische(int i, int64_t si, bool will, float ge, bool ge_an, float gs, bool gs_an, float& a, float& b) noexcept {
    if (!bereit()) return;
    const bool q_da = i >= q_ab_ && i < q_bis_;
    float qa = 0.0f, qb = 0.0f;
    if (q_da) {
      qa = ql_[i];
      qb = qr_[i];
      if (ge_an) {
        qa *= ge;
        qb *= ge;
      }
      if (gs_an) {
        qa *= gs;
        qb *= gs;
      }
    }
    if (rest_ == 0) {
      const bool w_ring = will && !leer_ && !aufgegeben_ && si >= sh_ + STRECK_EINSCHWING;
      const bool still = still_ && !ring_ && w_ring;
      if (still) still_ = false;  // Task 7: nur das erste Mal
      if (still && ok_ && q_da) {
        ring_ = true;  // Start aus Stille: der Ring klingt ab diesem Sample, ohne Blende
      } else if (!ring_ && w_ring) {
        if (ok_ && q_da) {
#ifdef CYPHERDJ_MUTATION_KEYLOCK_OHNE_BRUECKE
          ring_ = true;  // Fehlerfall: der Ring klingt sofort, ohne Blende aus der Brücke
#else
          a_ = Q::VARI;
          b_ = Q::RING;
          rest_ = len_ = STRECK_BLENDE;
#endif
        } else if (verpasst_ < STRECK_VERPASST) {  // Vertrag 5: Frist verpasst, s_h wandert
          ++verpasst_;
          ++verpasst_n_;
          auftrag(si, quelle_, (si / STRECK_RASTER + 1) * STRECK_RASTER, false);
        } else {
          aufgegeben_ = true;
          ++aufgegeben_n_;
        }
      } else if (ring_ && !w_ring) {  // Basis (Direktweg) oder Ende: was klingt, einfrieren und gegen den Varispeed-Weg aus
        if (!frieren(si, (ge_an ? ge : 1.0f) * (gs_an ? gs : 1.0f), gs_an ? gs : 1.0f, nullptr, nullptr, 0, i)) ring_ = false;
      } else if (ring_ && !q_da) {  // Unterlauf ohne Vorwarnung (sollte block_anfang erkannt haben): hart
        ring_ = false;
        ++unterlauf_n_;
        ++hart_n_;
        auftrag(si, quelle_, si + ANSATZ_FRIST, false);
      }
    }
    if (rest_ > 0) {
      if ((a_ == Q::RING || b_ == Q::RING) && !q_da) {  // Ring reißt in der Blende (sollte nicht vorkommen): hart
        if (b_ == Q::RING) {
          ++unterlauf_n_;
          auftrag(si, quelle_, si + ANSATZ_FRIST, false);
        }
        ++hart_n_;
        rest_ = 0;
        ring_ = false;
      } else {
        float xa, ya, xb, yb;
        wert(a_, a, b, qa, qb, gs, gs_an, xa, ya);
        wert(b_, a, b, qa, qb, gs, gs_an, xb, yb);
        if (a_ == Q::ALT) ++alt_i_;
        const float w = static_cast<float>(len_ - rest_ + 1) / static_cast<float>(len_);
        float ga = 1.0f - w, gb = w;
        if (leistung_ && a_ == Q::ALT) gleich_laut(w, ga, gb);  // Task 7: zwei verschiedene Quellen gleich laut
        a = xb * gb + xa * ga;
        b = yb * gb + ya * ga;
        if (--rest_ == 0) ring_ = b_ == Q::RING;
      }
    } else if (ring_) {
      a = qa;
      b = qb;
    }
  }
  // Keylock 6b (Plan Task 6, 3.5): das geplante Ereignis ist ausgeführt, der Dehner speist schon aus dem PlanBand q (Wechsel in
  // der Quelle, angenommen). Der Leser nimmt q als Band der Epoche; der Anker bleibt (er liegt in Quellkoordinaten des Dehners und
  // gilt über den Wechsel hinweg, 3.1). Ein späteres Wandern oder ein Unterlauf setzt mit q und demselben Anker neu an und liest
  // vor p_sw das Alte, ab p_sw das Neue. Kein Auftrag, keine Blende, nichts an Ring und Epoche.
  // zaehlen = false: ein „gespielter“ Abbruch (3.7), er zählt nur beim Deck als gespielt (Fix-Runde W3 S3)
  void plan_uebernehmen(const DehnerQuelle* q, bool zaehlen = true) noexcept {
    quelle_ = q;
#ifdef CYPHERDJ_MUTATION_PLAN_ANKER_ALT
    anker_.f += 1920.0;  // Fehlerfall: ein anderer Anker als der der Epoche (ein Neuansatz nach dem Plan landet 40 ms daneben)
#endif
    if (zaehlen) ++geplant_ok_n_;
  }
  void plan_verworfen() noexcept { ++geplant_verworfen_n_; }  // Zähler: ein Plan trug am Ziel nicht oder fiel
  const DehnerQuelle* quelle() const noexcept { return quelle_; }  // Band des letzten Ansatzes bzw. des übernommenen Plans
  uint64_t geplant_ok_n() const noexcept { return geplant_ok_n_; }
  uint64_t geplant_verworfen_n() const noexcept { return geplant_verworfen_n_; }
  // Die Quelle steht (Ende der Stopp-Rampe, Ende des Materials): der Ring ist mit ihr aus, keine Blende mehr.
  void stumm() noexcept {
    ring_ = false;
    rest_ = 0;
  }

  // ---- Zustand und Zähler
  bool ring_hoerbar() const noexcept { return ring_; }
  bool blendet() const noexcept { return rest_ > 0; }
  bool ist_leer() const noexcept { return leer_; }
  int64_t s_h() const noexcept { return sh_; }
  // Task 7 (7a 3.5 Punkt 4): Ring-Frames ab Sample si nach l, r (erst was dieser Block schon gelesen hat, dann weiter aus
  // dem Ring); Rückgabe: so viele lückenlos ab si. Für den Ausklang der Loop-Box (/k/set/neu). Verbraucht den Ring.
  int ring_lesen(int64_t si, int n, float* l, float* r) noexcept { return bereit() ? ring_ab(si, n, l, r) : 0; }
  uint32_t anfrage() const noexcept { return nr_; }
  uint32_t epoche() const noexcept { return ok_ ? e_ : EPOCHE_KEINE; }
  const DehnerAnker& anker() const noexcept { return anker_; }
  uint64_t unterlauf_n() const noexcept { return unterlauf_n_; }
  uint64_t hart_n() const noexcept { return hart_n_; }  // Rückfälle ohne Blende (Ring fehlte ohne Vorwarnung)
  uint64_t verpasst_n() const noexcept { return verpasst_n_; }
  uint64_t aufgegeben_n() const noexcept { return aufgegeben_n_; }
  uint64_t gelesen() const noexcept { return gelesen_; }
  uint64_t kurz_n() const noexcept { return kurz_n_; }          // Einfrieren mit < STRECK_ALT_MIN Frames abgelehnt
  uint64_t zu_gross_n() const noexcept { return zu_gross_n_; }  // Blöcke über STRECK_MAX_BLOCK

 private:
  uint32_t auftrag(int64_t s, const DehnerQuelle* q, int64_t s_h, bool neues_ereignis) noexcept {
    AnsatzAuftrag a;
    a.karte = *k_;
    a.generation = gen_ ? *gen_ : 0;
    a.quelle = q;
    a.anker = anker_;
    a.s_h = q ? s_h : s;
    nr_ = p_->anfordern(a);
    leer_ = q == nullptr;
    ok_ = false;
    sh_ = q ? s_h : INT64_MAX;
    if (neues_ereignis) {
      verpasst_ = 0;
      aufgegeben_ = false;
      still_ = false;  // Task 7: ein neues Ereignis nimmt den Start aus Stille zurück (ansetzen_ab setzt ihn danach neu)
    }
    return nr_;
  }
  // Ring-Frames ab Sample si nach l, r: erst was dieser Block schon gelesen hat, dann weiter aus dem Ring.
  int ring_ab(int64_t si, int n, float* l, float* r) noexcept {
    int k = 0;
    const int i0 = static_cast<int>(si - q_s0_);
    if (i0 >= q_ab_ && i0 < q_bis_) {
      k = q_bis_ - i0 < n ? q_bis_ - i0 : n;
      std::memcpy(l, ql_ + i0, sizeof(float) * static_cast<std::size_t>(k));
      std::memcpy(r, qr_ + i0, sizeof(float) * static_cast<std::size_t>(k));
      if (i0 + k < q_bis_ || k == n) return k;
      si = q_s0_ + q_bis_;
    } else if (q_bis_ > q_ab_ && si != q_s0_ + q_bis_) {
      return 0;  // der Block las den Ring, si liegt nicht an seinem Ende: nichts lückenlos ab si
    }
    const int m = d_->ring().lies_bis(si, n - k, l + k, r + k);
    gelesen_ += static_cast<uint64_t>(m);
    return k + m;
  }
  // Was ab si klingen würde (Blendenplatz bzw. Ring) als ALT einfrieren, Blende ALT -> VARI ab dem nächsten Sample.
  // i_im_block >= 0: Aufruf mitten im Block (das Sample si wird gleich gemischt).
  bool frieren(int64_t si, float e, float gs0, const float* vl, const float* vr, int nv, int i_im_block = -1,
               int max_n = STRECK_BLENDE) noexcept {
    (void)i_im_block;
    float rl[STRECK_BLENDE], rr[STRECK_BLENDE];
    int n = max_n > 0 && max_n < STRECK_BLENDE ? max_n : STRECK_BLENDE;
    const bool vari = braucht_vari();
    if (vari) n = nv < n ? nv : n;
    const int nr = ring_beteiligt() ? ring_ab(si, n, rl, rr) : 0;
    if (ring_beteiligt()) n = nr < n ? nr : n;
    if (n <= 0 || (vari && !vl)) {
      rest_ = 0;
      ring_ = false;
      ++hart_n_;
      return false;
    }
#ifndef CYPHERDJ_MUTATION_KEYLOCK_ALT_OHNE_MIN
    if (n < STRECK_ALT_MIN) {  // Vertrag 8: zu wenig für eine Blende, die Quelle blendet aus dem Material (Spec MINOR C)
      rest_ = 0;
      ring_ = false;
      ++kurz_n_;
      return false;
    }
#endif
    const float e_neu = e > 0.0f ? e : 1.0f;
    auto komp = [&](Q q, int j, int c) -> float {
      if (q == Q::VARI) return (c ? vr : vl)[j];
      if (q == Q::RING) return (c ? rr : rl)[j];
      const int k = alt_i_ + j < alt_n_ ? alt_i_ + j : alt_n_ - 1;
      return alt_[c][k] * (alt_e_ / e_neu);
    };
    for (int j = 0; j < n; ++j)
      for (int c = 0; c < 2; ++c) {
        float x;
        if (rest_ > 0) {
          if (j < rest_) {
            const float w = static_cast<float>(len_ - rest_ + 1 + j) / static_cast<float>(len_);
            x = komp(b_, j, c) * w + komp(a_, j, c) * (1.0f - w);
          } else {
            x = komp(b_, j, c);
          }
        } else {
          x = (c ? rr : rl)[j];  // Ring allein hörbar
        }
        neu_[c][j] = x;
      }
    std::memcpy(alt_, neu_, sizeof alt_);
    alt_n_ = n;
    alt_i_ = 0;
    alt_e_ = e_neu;
    alt_gs0_ = gs0 > 0.0f ? gs0 : 1.0f;
#ifdef CYPHERDJ_MUTATION_KEYLOCK_BASIS_LINEAR
    leistung_ = leistung_neu_;  // Fehlerfall (Stand 7b): auch auf der Basis linear
#else
    leistung_ = leistung_neu_ || basis_;
#endif
    leistung_neu_ = false;
    a_ = Q::ALT;
    b_ = Q::VARI;
    rest_ = len_ = n;
    ring_ = false;
    return true;
  }
  void wert(Q q, float va, float vb, float qa, float qb, float gs, bool gs_an, float& x, float& y) const noexcept {
    if (q == Q::VARI) {
      x = va;
      y = vb;
    } else if (q == Q::RING) {
      x = qa;
      y = qb;
    } else {
      const int j = alt_i_ < alt_n_ ? alt_i_ : alt_n_ - 1;
#ifdef CYPHERDJ_MUTATION_KEYLOCK_ALT_OHNE_STOPP
      (void)gs;
      (void)gs_an;
      const float g = alt_e_;  // Fehlerfall (Task 2 vor der Prüfung): das Eingefrorene ohne Stopp-Rampe
#else
      // Prüfung m3, Nachprüfung N1: die Stopp-Rampe wirkt weiter auf das Eingefrorene, vom Stand beim Ereignis aus
      const float g = alt_e_ * (gs_an ? gs / alt_gs0_ : 1.0f);
#endif
      x = alt_[0][j] * g;
      y = alt_[1][j] * g;
    }
  }

  DehnerBasis* d_ = nullptr;
  StreckPost* p_ = nullptr;
  const Karte* k_ = nullptr;
  const uint32_t* gen_ = nullptr;
  const DehnerQuelle* quelle_ = nullptr;  // Band des letzten Ansatzes (für Wandern und Unterlauf)
  DehnerAnker anker_;
  uint32_t nr_ = 0, e_ = EPOCHE_KEINE;
  bool leer_ = true, ok_ = false, ring_ = false, aufgegeben_ = false;
  bool still_ = false;                               // Task 7: Start aus Stille gewünscht (aus_stille)
  bool leistung_ = false, leistung_neu_ = false;     // Task 7: laufende ALT-Blende gleich laut
  bool basis_ = false;                               // Keylock 7c.4: die Quelle spielt den Direktweg
  int64_t sh_ = INT64_MAX;
  int verpasst_ = 0;
  Q a_ = Q::VARI, b_ = Q::VARI;
  int rest_ = 0, len_ = STRECK_BLENDE;
  float alt_[2][STRECK_BLENDE] = {}, neu_[2][STRECK_BLENDE] = {};
  int alt_n_ = 0, alt_i_ = 0;
  float alt_e_ = 1.0f, alt_gs0_ = 1.0f;
  float ql_[STRECK_MAX_BLOCK] = {}, qr_[STRECK_MAX_BLOCK] = {};
  int q_ab_ = 0, q_bis_ = 0;
  int64_t q_s0_ = 0;
  uint64_t unterlauf_n_ = 0, hart_n_ = 0, verpasst_n_ = 0, aufgegeben_n_ = 0, gelesen_ = 0, kurz_n_ = 0, zu_gross_n_ = 0;
  uint64_t geplant_ok_n_ = 0, geplant_verworfen_n_ = 0;  // 6b
};

}  // namespace cdj
