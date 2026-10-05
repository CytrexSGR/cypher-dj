// stellwerk_folgen: fährt Golden-Folgen gegen die Stellwerk-Bibliothek an einer simulierten Uhr.
// Format: SCHNITTSTELLEN §19.0 mit den Regeln aus djk/vertrag/folgen/FORMAT.md (Scheibe 09), Punkte 1 bis 22.
// Gebaut sind die Bereiche zeitachse, regler und ki (FORMAT.md Punkt 14); Zeilen anderer Bereiche werden übersprungen
// und gezählt, eine unbekannte Schritt-Art in einem gebauten Bereich ist ein Formfehler (Punkt 16).
// Zustellung: `sende` wirkt am ersten Zyklusanfang >= seinem sample (Befehlsring, §16.1 „nächster Blockanfang“);
// `hand` wirkt an seinem Sample wie /test/hand (§19.0, §7.3 Punkt 1). Kennungen: Basis B auf `id` beim Senden und
// beim Vergleich der /q (Punkt 4). Vergleich: eine Nachricht erfüllt höchstens einen `erwarte`-Schritt (Punkt 6,
// Zuordnung als größtes Matching, damit die Reihenfolge der Zeilen nichts festlegt); `erwarte_nicht` sieht alle
// Nachrichten; `erlaube` nimmt Nachrichten aus Punkt 8 heraus. Grün nur, wenn mindestens eine Prüfung lief, alle
// hielten und keine unverbrauchte /q mit Status 4 bis 8, /e/invariante oder /e/protokollfehler übrig ist (Punkt 8).
// Aufruf: stellwerk_folgen [--block N] [--basis B] [--leise] <folge.jsonl>...   Rückgabe 0 grün, 1 rot, 2 Formfehler.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "json_mini.h"
#include "sim_uhr.h"
#include "cypherdj/stellwerk/stellwerk.h"

using namespace cypherdj::stellwerk;

namespace {

const char* const GEBAUT[] = {"zeitachse", "regler", "ki"};
// Schritt-Arten aus FORMAT.md, die dieser Läufer kennt, aber nicht ausführt (Bereiche deck, pruefstand, leitstand, …)
const char* const FREMDE_ARTEN[] = {"buendel", "deck_wert", "messung", "aktion", "ws_sende", "ws_erwarte",
                                    "rechner_frage", "rechner_antwort"};

struct Feld {
  char typ;   // h i f d s
  int64_t i = 0;
  double d = 0;
  std::string s;
};
struct Nachricht {
  std::string adresse, typen;
  std::vector<Feld> felder;
  int64_t sample;
  bool verbraucht = false;
  bool erlaubt = false;
};

struct Sende { int64_t sample; jm::Wert osc; int zeile; bool zugestellt = false; };
struct Hand { int64_t sample; std::string pfad; double x; int zeile; bool zugestellt = false; };
enum class Art { erwarte, erwarte_nicht, erlaube };
struct Erwarte { Art art; int64_t ab, bis; jm::Wert osc; double toleranz; int zeile; };
struct WertPruef { int64_t sample; std::string pfad; double wert, toleranz; int zeile; bool geprueft = false; bool ok = false; double ist = 0; };

std::string text_von(const jm::Wert& w) {
  switch (w.art) {
    case jm::Wert::nichts: return "null";
    case jm::Wert::wahr_falsch: return w.b ? "true" : "false";
    case jm::Wert::zahl: {
      char b[64];
      if (w.ganz) std::snprintf(b, sizeof b, "%lld", static_cast<long long>(w.i));
      else std::snprintf(b, sizeof b, "%.9g", w.d);
      return b;
    }
    case jm::Wert::text: return "\"" + w.s + "\"";
    case jm::Wert::liste: {
      std::string s = "[";
      for (size_t k = 0; k < w.l.size(); k++) s += (k ? "," : "") + text_von(w.l[k]);
      return s + "]";
    }
    case jm::Wert::objekt: return "{...}";
  }
  return "?";
}

std::string text_von(const Nachricht& n) {
  std::string s = "[\"" + n.adresse + "\",\"" + n.typen + "\"";
  char b[64];
  for (const Feld& f : n.felder) {
    if (f.typ == 's') s += ",\"" + f.s + "\"";
    else if (f.typ == 'h' || f.typ == 'i') { std::snprintf(b, sizeof b, ",%lld", static_cast<long long>(f.i)); s += b; }
    else { std::snprintf(b, sizeof b, ",%.9g", f.d); s += b; }
  }
  return s + "]";
}

class Folge {
 public:
  Folge(const char* pfad, int block, int64_t basis, bool leise) : pfad_(pfad), block_(block), basis_(basis), leise_(leise) {}

  int lauf() {   // 0 grün, 1 rot, 2 Formfehler
    if (!lies()) return 2;
    uhr_ = std::make_unique<SimUhr>(128.0);   // §2.1 start_bpm; /k/set/neu setzt es
    sw_ = std::make_unique<Stellwerk>(*uhr_);
    int64_t ende = 0;
    for (auto& x : sende_) ende = std::max(ende, x.sample);
    for (auto& x : hand_) ende = std::max(ende, x.sample);
    for (auto& x : erwarte_) ende = std::max(ende, x.bis);
    for (auto& x : werte_) ende = std::max(ende, x.sample);
    ende += block_;
    for (int64_t s0 = 0; s0 < ende; s0 += block_) {
      for (auto& x : sende_) {
        if (!x.zugestellt && x.sample <= s0) {
          x.zugestellt = true;
          if (!zustellen(x, s0)) return 2;
        }
      }
      for (auto& x : hand_) {
        if (!x.zugestellt && x.sample < s0 + block_) {
          x.zugestellt = true;
          const int r = sw_->tabelle().suche(x.pfad.c_str());
          if (r < 0) laufzeit_.push_back("  Zeile " + std::to_string(x.zeile) + ": Griff an unbekanntem Pfad " + x.pfad);
          else sw_->hand(Griff{x.sample, static_cast<int16_t>(r), GriffArt::absolut, static_cast<float>(x.x), nullptr});
        }
      }
      sw_->prozess(s0, block_);
      begonnen_ = true;
      sammeln();
      pruefe_werte(s0);
    }
    return urteil();
  }

 private:
  const char* pfad_;
  int block_;
  int64_t basis_;
  bool leise_;
  bool begonnen_ = false;
  std::unique_ptr<SimUhr> uhr_;
  std::unique_ptr<Stellwerk> sw_;
  std::vector<Sende> sende_;
  std::vector<Hand> hand_;
  std::vector<Erwarte> erwarte_;
  std::vector<WertPruef> werte_;
  std::vector<Nachricht> gesehen_;
  std::vector<std::string> laufzeit_;           // Befunde beim Zustellen (zählen als verfehlt, kein Formfehler)
  std::map<std::string, int> uebersprungen_;    // Bereich -> Zahl der Zeilen

  int formfehler(int zeile, const std::string& was) {
    std::printf("FORM %s Zeile %d: %s\n", pfad_, zeile, was.c_str());
    return 2;
  }

  static int64_t ganz(const jm::Wert* w) { return w ? (w->ganz ? w->i : static_cast<int64_t>(std::llround(w->d))) : 0; }

  static bool gebaut(const std::string& bereich) {
    for (const char* b : GEBAUT)
      if (bereich == b) return true;
    return false;
  }
  static bool fremde_art(const std::string& t) {
    for (const char* a : FREMDE_ARTEN)
      if (t == a) return true;
    return false;
  }
  static bool osc_ok(const jm::Wert* osc) {
    return osc && osc->art == jm::Wert::liste && osc->l.size() >= 2 && osc->l[0].art == jm::Wert::text &&
           osc->l[1].art == jm::Wert::text;
  }

  bool lies() {
    std::ifstream f(pfad_);
    if (!f) { std::printf("FORM %s: Datei nicht lesbar\n", pfad_); return false; }
    std::string zeile;
    int nr = 0;
    while (std::getline(f, zeile)) {
      nr++;
      if (zeile.find_first_not_of(" \t\r") == std::string::npos) continue;
      jm::Wert w;
      std::string fehler;
      jm::Leser leser(zeile);
      if (!leser.lies(w, fehler) || w.art != jm::Wert::objekt) { formfehler(nr, "kein JSON-Objekt: " + fehler); return false; }
      const jm::Wert* t = w.feld("t");
      if (!t || t->art != jm::Wert::text) { formfehler(nr, "Feld t fehlt"); return false; }
      const jm::Wert* b = w.feld("bereich");
      if (b && b->art == jm::Wert::text && !gebaut(b->s)) {   // Punkt 14: Bereich nicht gebaut, Zeile überspringen
        uebersprungen_[b->s]++;
        continue;
      }
      const jm::Wert* tol = w.feld("toleranz");
      const double toleranz = tol ? tol->d : 0.0;   // Punkt 6: Vorgabe 0
      if (t->s == "sende") {
        const jm::Wert* osc = w.feld("osc");
        if (!w.feld("sample") || !osc_ok(osc)) { formfehler(nr, "sende braucht sample und osc (eine Nachricht)"); return false; }
        sende_.push_back(Sende{ganz(w.feld("sample")), *osc, nr});
      } else if (t->s == "hand") {
        const jm::Wert* p = w.feld("pfad");
        const jm::Wert* x = w.feld("midi_roh");
        if (!w.feld("sample") || !p || !x) { formfehler(nr, "hand braucht sample, pfad, midi_roh"); return false; }
        hand_.push_back(Hand{ganz(w.feld("sample")), p->s, x->d, nr});
      } else if (t->s == "erwarte" || t->s == "erwarte_nicht" || t->s == "erlaube") {
        const jm::Wert* osc = w.feld("osc");
        const jm::Wert* ab = w.feld("ab_sample");
        const Art art = t->s == "erwarte" ? Art::erwarte : t->s == "erwarte_nicht" ? Art::erwarte_nicht : Art::erlaube;
        if (!w.feld("bis_sample") || !osc_ok(osc) || (art != Art::erwarte && !ab)) {
          formfehler(nr, t->s + " braucht bis_sample und osc" + (art != Art::erwarte ? " und ab_sample" : ""));
          return false;
        }
        erwarte_.push_back(Erwarte{art, ab ? ganz(ab) : 0, ganz(w.feld("bis_sample")), *osc, toleranz, nr});
      } else if (t->s == "wert") {
        const jm::Wert* p = w.feld("pfad");
        const jm::Wert* x = w.feld("wert");
        if (!w.feld("sample") || !p || !x) { formfehler(nr, "wert braucht sample, pfad, wert"); return false; }
        werte_.push_back(WertPruef{ganz(w.feld("sample")), p->s, x->d, toleranz, nr});
      } else if (fremde_art(t->s)) {
        formfehler(nr, "Schritt-Art " + t->s + " im gebauten Bereich: baut die Stellwerk-Bibliothek nicht");
        return false;
      } else {
        formfehler(nr, "unbekannte Schritt-Art " + t->s + " (FORMAT.md Punkt 16)");
        return false;
      }
    }
    return true;
  }

  bool quelle(const jm::Wert& w, Quelle* q, int zeile) {
    if (w.art != jm::Wert::text || !quelle_aus_text(w.s.c_str(), q)) { formfehler(zeile, "unbekannte Quelle " + text_von(w)); return false; }
    return true;
  }

  bool zustellen(const Sende& x, int64_t s0) {
    const auto& l = x.osc.l;
    const std::string& a = l[0].s;
    const std::string& typen = l[1].s;
    auto pruefe_typen = [&](const char* soll) {
      if (typen != soll) { formfehler(x.zeile, a + " braucht Typen " + soll + ", hat " + typen); return false; }
      if (l.size() != std::strlen(soll) + 1) { formfehler(x.zeile, a + ": Zahl der Werte passt nicht zu den Typen"); return false; }
      return true;
    };
    const int64_t id = l.size() > 2 ? ganz(&l[2]) + basis_ : 0;   // Punkt 4: jeder /k/-Befehl beginnt mit h id
    Quelle q = Quelle::andreas;
    if (a == "/k/set/neu") {   // §4.2, FORMAT.md Punkt 2: nur als erster Schritt bei Sample 0
      if (!pruefe_typen(",hsd")) return false;
      if (begonnen_ || s0 != 0) { formfehler(x.zeile, "/k/set/neu mitten in der Folge baut das Stellwerk nicht"); return false; }
      uhr_->setze(l[4].d);
      return true;
    }
    if (a == "/k/teil") {
      if (!pruefe_typen(",hssisddfiiss") || !quelle(l[3], &q, x.zeile)) return false;
      sw_->teil(TeilBefehl{id, q, l[4].s.c_str(), static_cast<int32_t>(ganz(&l[5])), l[6].s.c_str(), l[7].d, l[8].d,
                           static_cast<float>(l[9].d), static_cast<int32_t>(ganz(&l[10])), static_cast<int32_t>(ganz(&l[11])),
                           l[12].s.c_str(), l[13].s.c_str()});
      return true;
    }
    if (a == "/k/abbruch") {
      if (!pruefe_typen(",hsss") || !quelle(l[3], &q, x.zeile)) return false;
      int32_t nrs[64];
      int n = 0;
      if (l[5].s == "*") n = -1;
      else {
        const char* p = l[5].s.c_str();
        while (*p && n < 64) {
          char* weiter = nullptr;
          nrs[n++] = static_cast<int32_t>(std::strtol(p, &weiter, 10));
          if (weiter == p) { formfehler(x.zeile, "teile ist keine Liste von Nummern: " + l[5].s); return false; }
          p = weiter;
          while (*p == ',' || *p == ' ') p++;
        }
      }
      sw_->abbruch(id, q, l[4].s.c_str(), nrs, n);
      return true;
    }
    if (a == "/k/ki/stopp") {
      if (!pruefe_typen(",hs") || !quelle(l[3], &q, x.zeile)) return false;
      sw_->ki_stopp(id, q);
      return true;
    }
    if (a == "/k/ki/frei") {
      if (!pruefe_typen(",hs") || !quelle(l[3], &q, x.zeile)) return false;
      sw_->ki_frei(id, q);
      return true;
    }
    if (a == "/k/ki/spur") {
      if (!pruefe_typen(",hss") || !quelle(l[3], &q, x.zeile)) return false;
      sw_->ki_spur(id, q, l[4].s.c_str());
      return true;
    }
    if (a == "/test/hand") {   // §19.0: wirkt wie ein MIDI-Ereignis, samt erstem Wert und Totzone
      if (!pruefe_typen(",sfh")) return false;
      const int r = sw_->tabelle().suche(l[2].s.c_str());
      if (r < 0) { laufzeit_.push_back("  Zeile " + std::to_string(x.zeile) + ": /test/hand an unbekanntem Pfad " + l[2].s); return true; }
      sw_->hand(Griff{ganz(&l[4]), static_cast<int16_t>(r), GriffArt::absolut, static_cast<float>(l[3].d), nullptr});
      return true;
    }
    formfehler(x.zeile, "Adresse außerhalb des Stellwerks: " + a + " (Befund an Strang B, ROADMAP §8.10)");
    return false;
  }

  void sammeln() {
    const Ereignis* e;
    const int n = sw_->ereignisse(&e);
    for (int k = 0; k < n; k++) {
      const Ereignis& x = e[k];
      Nachricht m;
      m.sample = x.sample;
      const double beat = uhr_->beat(x.sample);
      auto h = [&](int64_t v) { Feld f; f.typ = 'h'; f.i = v; return f; };
      auto i = [&](int64_t v) { Feld f; f.typ = 'i'; f.i = v; return f; };
      auto fl = [&](double v) { Feld f; f.typ = 'f'; f.d = v; return f; };
      auto d = [&](double v) { Feld f; f.typ = 'd'; f.d = v; return f; };
      auto s = [&](const char* v) { Feld f; f.typ = 's'; f.s = v; return f; };
      const char* pfad = x.regler >= 0 ? sw_->tabelle().def(x.regler).pfad : "";
      switch (x.art) {
        case EreignisArt::quittung:
          m.adresse = "/q"; m.typen = ",hsihds";
          m.felder = {h(x.id), s(name(x.quelle)), i(static_cast<int>(x.status)), h(x.sample), d(beat), s(name(x.grund))};
          break;
        case EreignisArt::regler:
          m.adresse = "/e/regler"; m.typen = ",sfshd";
          m.felder = {s(pfad), fl(x.wert), s(x.halter), h(x.sample), d(beat)};
          break;
        case EreignisArt::hand:
          m.adresse = "/e/hand"; m.typen = ",sfhd";
          m.felder = {s(pfad), fl(x.wert), h(x.sample), d(beat)};
          break;
        case EreignisArt::halter:
          m.adresse = "/e/halter"; m.typen = ",sshd";
          m.felder = {s(pfad), s(x.halter), h(x.sample), d(beat)};
          break;
        case EreignisArt::ki:
          m.adresse = "/e/ki"; m.typen = ",ish";
          m.felder = {i(x.gestoppt ? 1 : 0), s(name(x.grund)), h(x.sample)};
          break;
        case EreignisArt::invariante:
          m.adresse = "/e/invariante"; m.typen = ",ssihd";
          m.felder = {s(name(x.inv)), s(x.plan), i(x.teil), h(x.sample), d(beat)};
          break;
      }
      gesehen_.push_back(std::move(m));
    }
    sw_->ereignisse_leeren();
  }

  void pruefe_werte(int64_t s0) {
    const Aenderung* a;
    const int n = sw_->aenderungen(&a);
    for (auto& w : werte_) {
      if (w.geprueft || w.sample < s0 || w.sample >= s0 + block_) continue;
      w.geprueft = true;
      const int r = sw_->tabelle().suche(w.pfad.c_str());
      if (r < 0) { w.ist = NAN; continue; }
      double v = sw_->wert(r);
      for (int k = 0; k < n; k++)
        if (a[k].regler == r) v = a[k].verlauf[w.sample - s0];
      w.ist = v;
      w.ok = std::fabs(v - w.wert) <= w.toleranz;
    }
  }

  // Punkt 6: null passt auf alles; i, h, s genau; f, d mit |ist - soll| <= toleranz; "NaN", "inf", "-inf" als Text
  static bool passt(const Feld& f, const jm::Wert& soll, double tol) {
    if (soll.art == jm::Wert::nichts) return true;
    switch (f.typ) {
      case 's': return soll.art == jm::Wert::text && soll.s == f.s;
      case 'h':
      case 'i': return soll.art == jm::Wert::zahl && soll.ganz && soll.i == f.i;
      case 'f':
      case 'd':
        if (soll.art == jm::Wert::text) {
          if (soll.s == "NaN") return std::isnan(f.d);
          if (soll.s == "inf") return std::isinf(f.d) && f.d > 0;
          if (soll.s == "-inf") return std::isinf(f.d) && f.d < 0;
          return false;
        }
        return soll.art == jm::Wert::zahl && std::fabs(soll.d - f.d) <= tol;
    }
    return false;
  }

  bool passt(const Nachricht& m, const Erwarte& e) const {
    const auto& l = e.osc.l;
    if (l[0].s != m.adresse || l[1].s != m.typen) return false;
    if (m.sample < e.ab || m.sample > e.bis) return false;
    if (l.size() != m.felder.size() + 2) return false;
    for (size_t k = 2; k < l.size(); k++) {
      jm::Wert soll = l[k];
      if (k == 2 && m.adresse == "/q" && soll.art == jm::Wert::zahl && soll.ganz) soll.i += basis_;   // Punkt 4
      if (!passt(m.felder[k - 2], soll, e.toleranz)) return false;
    }
    return true;
  }

  int urteil() {
    int fehl = static_cast<int>(laufzeit_.size());
    std::vector<std::string> meldungen = laufzeit_;
    char b[512];
    // Punkt 6: jede Nachricht erfüllt höchstens einen erwarte-Schritt; größtes Matching (Kuhn), unabhängig von der
    // Zeilenfolge
    std::vector<std::vector<int>> kandidaten(erwarte_.size());
    for (size_t k = 0; k < erwarte_.size(); k++) {
      if (erwarte_[k].art != Art::erwarte) continue;
      for (size_t m = 0; m < gesehen_.size(); m++)
        if (passt(gesehen_[m], erwarte_[k])) kandidaten[k].push_back(static_cast<int>(m));
    }
    std::vector<int> nachricht_an(gesehen_.size(), -1);
    std::vector<int> besucht(gesehen_.size(), -1);
    std::function<bool(int, int)> ordne = [&](int k, int runde) {
      for (int m : kandidaten[k]) {
        if (besucht[m] == runde) continue;
        besucht[m] = runde;
        if (nachricht_an[m] < 0 || ordne(nachricht_an[m], runde)) {
          nachricht_an[m] = k;
          return true;
        }
      }
      return false;
    };
    std::vector<bool> erfuellt(erwarte_.size(), false);
    for (size_t k = 0; k < erwarte_.size(); k++)
      if (erwarte_[k].art == Art::erwarte) ordne(static_cast<int>(k), static_cast<int>(k));
    for (size_t m = 0; m < gesehen_.size(); m++) {
      if (nachricht_an[m] < 0) continue;
      gesehen_[m].verbraucht = true;
      erfuellt[nachricht_an[m]] = true;
    }
    for (size_t k = 0; k < erwarte_.size(); k++) {
      const Erwarte& e = erwarte_[k];
      if (e.art == Art::erlaube) {
        for (Nachricht& m : gesehen_)
          if (passt(m, e)) m.erlaubt = true;
        continue;
      }
      if (e.art == Art::erwarte_nicht) {
        for (const Nachricht& m : gesehen_) {
          if (!passt(m, e)) continue;
          fehl++;
          std::snprintf(b, sizeof b, "  Zeile %d: in [%lld, %lld] durfte nicht kommen %s, kam: %s", e.zeile,
                        static_cast<long long>(e.ab), static_cast<long long>(e.bis), text_von(e.osc).c_str(), text_von(m).c_str());
          meldungen.push_back(b);
          break;
        }
        continue;
      }
      if (erfuellt[k]) continue;
      fehl++;
      std::snprintf(b, sizeof b, "  Zeile %d: in [%lld, %lld] erwartet %s, nicht gesehen%s", e.zeile, static_cast<long long>(e.ab),
                    static_cast<long long>(e.bis), text_von(e.osc).c_str(), kandidaten[k].empty() ? "" : " (passende schon verbraucht)");
      meldungen.push_back(b);
      int n = 0;
      for (const Nachricht& m : gesehen_) {
        if (m.adresse != e.osc.l[0].s || n >= 6) continue;
        meldungen.push_back("      gesehen: " + text_von(m) + " bei " + std::to_string(m.sample));
        n++;
      }
    }
    // Punkt 8: unverbrauchte Ablehnung, Verspätung, Abbruch, Storno, Invariante oder Protokollfehler macht rot
    int unerwartet = 0;
    for (const Nachricht& m : gesehen_) {
      if (m.verbraucht || m.erlaubt) continue;
      const bool q48 = m.adresse == "/q" && m.felder.size() > 2 && m.felder[2].i >= 4 && m.felder[2].i <= 8;
      if (!q48 && m.adresse != "/e/invariante" && m.adresse != "/e/protokollfehler") continue;
      unerwartet++;
      meldungen.push_back("  unerwartet (Punkt 8): " + text_von(m) + " bei " + std::to_string(m.sample));
    }
    fehl += unerwartet;
    int n_erlaube = 0;
    for (const Erwarte& e : erwarte_) n_erlaube += e.art == Art::erlaube;
    const int gesamt = static_cast<int>(erwarte_.size() + werte_.size() + laufzeit_.size()) - n_erlaube;   // erlaube prüft nichts
    for (const WertPruef& w : werte_) {
      if (w.geprueft && w.ok) continue;
      fehl++;
      std::snprintf(b, sizeof b, "  Zeile %d: %s bei Sample %lld = %.9g, erwartet %.9g (+-%g)%s", w.zeile, w.pfad.c_str(),
                    static_cast<long long>(w.sample), w.ist, w.wert, w.toleranz, w.geprueft ? "" : " (nie erreicht)");
      meldungen.push_back(b);
    }
    if (gesamt == 0) meldungen.push_back("  keine Pruefung in den Bereichen zeitachse, regler, ki: kein Beleg");
    const bool rot = fehl > 0 || gesamt == 0;
    std::string ueber;
    int n_ueber = 0;
    for (const auto& [k, v] : uebersprungen_) {
      ueber += (ueber.empty() ? "" : ", ") + k + " " + std::to_string(v);
      n_ueber += v;
    }
    std::printf("%s %s: %d Befehle, %d Griffe, %d von %d Pruefungen erfuellt, %d unerwartet, %d Zeilen uebersprungen%s%s%s\n",
                rot ? "ROT " : "OK  ", pfad_, static_cast<int>(sende_.size()), static_cast<int>(hand_.size()),
                gesamt - (fehl - unerwartet), gesamt, unerwartet, n_ueber, ueber.empty() ? "" : " (", ueber.c_str(),
                ueber.empty() ? "" : ")");
    if (!leise_ || rot)
      for (const std::string& m : meldungen) std::printf("%s\n", m.c_str());
    if (!leise_)
      for (const WertPruef& w : werte_)
        std::printf("  wert Zeile %d: %s bei Sample %lld = %.6f (soll %.6f +-%g) %s\n", w.zeile, w.pfad.c_str(),
                    static_cast<long long>(w.sample), w.ist, w.wert, w.toleranz, w.geprueft && w.ok ? "ok" : "VERFEHLT");
    return rot ? 1 : 0;
  }
};

}  // namespace

int main(int argc, char** argv) {
  int block = 256;
  int64_t basis = 1000000000000000LL;   // Punkt 4: Basis B; fest statt mono_ns, damit Läufe gleich ausgehen
  bool leise = false;
  int erg = 0, gruen = 0, gesamt = 0;
  for (int k = 1; k < argc; k++) {
    if (!std::strcmp(argv[k], "--block") && k + 1 < argc) {
      block = std::atoi(argv[++k]);
      if (block < 1 || block > BLOCK_MAX) { std::printf("--block 1 bis %d\n", BLOCK_MAX); return 2; }
      continue;
    }
    if (!std::strcmp(argv[k], "--basis") && k + 1 < argc) { basis = std::atoll(argv[++k]); continue; }
    if (!std::strcmp(argv[k], "--leise")) { leise = true; continue; }
    Folge f(argv[k], block, basis, leise);
    const int r = f.lauf();
    gesamt++;
    if (r == 0) gruen++;
    erg = std::max(erg, r);
  }
  std::printf("%d von %d Folgen gruen\n", gruen, gesamt);
  return gesamt == 0 ? 2 : erg;
}
