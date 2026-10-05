// JSON-Leser mit Zeilennummern für die Mapping-Datei (SCHNITTSTELLEN §7.2). Nicht im Echtzeit-Pfad: der Kern liest
// das Mapping im Nicht-Echtzeit-Faden (§4.7 /k/mapping). Eigenbau, weil nlohmann/json keine Zeile je Wert liefert und
// die Abnahme von Scheibe 19 fehlerhafte Mappings "mit Zeilenangabe" ablehnt. Doppelte Schlüssel sind ein Fehler.
#pragma once
#include <cstdint>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace hand::json {

struct Wert {
  enum Art { nichts, wahr_falsch, zahl, text, liste, objekt } art = nichts;
  int zeile = 0;          // Zeile, in der der Wert beginnt (1-basiert)
  bool b = false;
  double d = 0;
  bool ganz = false;      // Zahl ohne Punkt und Exponent
  std::string s;
  std::vector<Wert> l;
  struct Feld;                // unten definiert (enthält selbst einen Wert)
  std::vector<Feld> o;
  const Feld* feld(const char* name) const;
};

struct Wert::Feld {
  std::string name;
  int zeile;                  // Zeile des Schlüssels
  Wert wert;
};

inline const Wert::Feld* Wert::feld(const char* name) const {
  for (const Feld& f : o)
    if (f.name == name) return &f;
  return nullptr;
}

class Leser {
 public:
  explicit Leser(const std::string& t) : t_(t) {}
  // false: fehler und fehler_zeile gesetzt
  bool lies(Wert& aus, std::string& fehler, int& fehler_zeile) {
    aus = Wert();   // ein wiederverwendeter Wert darf keine alten Schlüssel mitbringen
    if (!wert(aus)) {
      fehler = fehler_.empty() ? "unerwartetes Zeichen" : fehler_;
      fehler_zeile = zeile_;
      return false;
    }
    leer();
    if (p_ != t_.size()) {
      fehler = "Rest nach dem Wert";
      fehler_zeile = zeile_;
      return false;
    }
    return true;
  }

 private:
  const std::string& t_;
  size_t p_ = 0;
  int zeile_ = 1;
  std::string fehler_;

  void leer() {
    while (p_ < t_.size() && (t_[p_] == ' ' || t_[p_] == '\t' || t_[p_] == '\r' || t_[p_] == '\n')) {
      if (t_[p_] == '\n') zeile_++;
      p_++;
    }
  }
  bool wort(const char* w) {
    size_t n = 0;
    while (w[n]) n++;
    if (t_.compare(p_, n, w) != 0) return false;
    p_ += n;
    return true;
  }
  bool wert(Wert& v) {
    leer();
    v.zeile = zeile_;
    if (p_ >= t_.size()) {
      fehler_ = "Wert erwartet, Dateiende";
      return false;
    }
    const char c = t_[p_];
    if (c == '{') return objekt(v);
    if (c == '[') return liste(v);
    if (c == '"') {
      v.art = Wert::text;
      return text(v.s);
    }
    if (wort("true")) {
      v.art = Wert::wahr_falsch;
      v.b = true;
      return true;
    }
    if (wort("false")) {
      v.art = Wert::wahr_falsch;
      v.b = false;
      return true;
    }
    if (wort("null")) {
      v.art = Wert::nichts;
      return true;
    }
    return zahl(v);
  }
  bool zahl(Wert& v) {
    const size_t a = p_;
    if (p_ < t_.size() && t_[p_] == '-') p_++;
    bool ganz = true;
    size_t ziffern = 0;
    while (p_ < t_.size()) {
      const char c = t_[p_];
      if (c >= '0' && c <= '9') {
        p_++;
        ziffern++;
        continue;
      }
      if (c == '.' || c == 'e' || c == 'E' || ((c == '-' || c == '+') && (t_[p_ - 1] == 'e' || t_[p_ - 1] == 'E'))) {
        ganz = false;
        p_++;
        continue;
      }
      break;
    }
    if (ziffern == 0) {
      p_ = a;
      fehler_ = "unerwartetes Zeichen";
      return false;
    }
    const std::string z = t_.substr(a, p_ - a);
    char* ende = nullptr;
    v.art = Wert::zahl;
    v.ganz = ganz;
    v.d = std::strtod(z.c_str(), &ende);
    if (ende != z.c_str() + z.size()) {
      fehler_ = "Zahl nicht lesbar";
      return false;
    }
    return true;
  }
  static void utf8(std::string& s, unsigned cp) {
    if (cp < 0x80) {
      s += static_cast<char>(cp);
    } else if (cp < 0x800) {
      s += static_cast<char>(0xC0 | (cp >> 6));
      s += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
      s += static_cast<char>(0xE0 | (cp >> 12));
      s += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      s += static_cast<char>(0x80 | (cp & 0x3F));
    }
  }
  bool text(std::string& s) {
    p_++;   // "
    while (p_ < t_.size() && t_[p_] != '"') {
      char c = t_[p_++];
      if (c == '\n') {
        fehler_ = "Zeilenumbruch im Text";
        return false;
      }
      if (c != '\\') {
        s += c;
        continue;
      }
      if (p_ >= t_.size()) break;
      c = t_[p_++];
      switch (c) {
        case '"': s += '"'; break;
        case '\\': s += '\\'; break;
        case '/': s += '/'; break;
        case 'b': s += '\b'; break;
        case 'f': s += '\f'; break;
        case 'n': s += '\n'; break;
        case 'r': s += '\r'; break;
        case 't': s += '\t'; break;
        case 'u':
          if (p_ + 4 > t_.size()) {
            fehler_ = "\\u ohne vier Ziffern";
            return false;
          }
          utf8(s, static_cast<unsigned>(std::strtoul(t_.substr(p_, 4).c_str(), nullptr, 16)));
          p_ += 4;
          break;
        default:
          fehler_ = "unbekanntes Escape";
          return false;
      }
    }
    if (p_ >= t_.size()) {
      fehler_ = "Text ohne Ende";
      return false;
    }
    p_++;   // "
    return true;
  }
  bool liste(Wert& v) {
    v.art = Wert::liste;
    p_++;
    leer();
    if (p_ < t_.size() && t_[p_] == ']') {
      p_++;
      return true;
    }
    while (true) {
      Wert e;
      if (!wert(e)) return false;
      v.l.push_back(std::move(e));
      leer();
      if (p_ < t_.size() && t_[p_] == ',') {
        p_++;
        continue;
      }
      if (p_ < t_.size() && t_[p_] == ']') {
        p_++;
        return true;
      }
      fehler_ = "in Liste , oder ] erwartet";
      return false;
    }
  }
  bool objekt(Wert& v) {
    v.art = Wert::objekt;
    p_++;
    leer();
    if (p_ < t_.size() && t_[p_] == '}') {
      p_++;
      return true;
    }
    while (true) {
      leer();
      if (p_ >= t_.size() || t_[p_] != '"') {
        fehler_ = "Schlüssel in \" erwartet";
        return false;
      }
      Wert::Feld f;
      f.zeile = zeile_;
      if (!text(f.name)) return false;
      if (v.feld(f.name.c_str())) {
        fehler_ = "Schlüssel doppelt: " + f.name;
        return false;
      }
      leer();
      if (p_ >= t_.size() || t_[p_] != ':') {
        fehler_ = ": erwartet";
        return false;
      }
      p_++;
      if (!wert(f.wert)) return false;
      v.o.push_back(std::move(f));
      leer();
      if (p_ < t_.size() && t_[p_] == ',') {
        p_++;
        continue;
      }
      if (p_ < t_.size() && t_[p_] == '}') {
        p_++;
        return true;
      }
      fehler_ = "im Objekt , oder } erwartet";
      return false;
    }
  }
};

}  // namespace hand::json
