// Kleinster JSON-Leser für die Golden-Folgen (eine Zeile je Schritt, SCHNITTSTELLEN §19.0). Nicht im Echtzeit-Pfad.
// Eigenbau statt nlohmann/json, damit das Stellwerk ohne djk/third_party baut; Zahlen ohne Punkt und Exponent
// bleiben als int64 erhalten (Befehls-IDs).
#pragma once
#include <cstdint>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace jm {

struct Wert {
  enum Art { nichts, wahr_falsch, zahl, text, liste, objekt } art = nichts;
  bool b = false;
  double d = 0;
  int64_t i = 0;
  bool ganz = false;
  std::string s;
  std::vector<Wert> l;
  std::vector<std::pair<std::string, Wert>> o;
  const Wert* feld(const char* name) const {
    for (const auto& [k, v] : o)
      if (k == name) return &v;
    return nullptr;
  }
};

class Leser {
 public:
  explicit Leser(const std::string& t) : t_(t) {}
  bool lies(Wert& aus, std::string& fehler) {
    if (!wert(aus)) {
      fehler = fehler_.empty() ? "unerwartetes Zeichen" : fehler_;
      fehler += " bei Zeichen " + std::to_string(p_);
      return false;
    }
    leer();
    if (p_ != t_.size()) {
      fehler = "Rest nach dem Wert bei Zeichen " + std::to_string(p_);
      return false;
    }
    return true;
  }

 private:
  const std::string& t_;
  size_t p_ = 0;
  std::string fehler_;
  void leer() {
    while (p_ < t_.size() && (t_[p_] == ' ' || t_[p_] == '\t' || t_[p_] == '\r' || t_[p_] == '\n')) p_++;
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
    if (p_ >= t_.size()) return false;
    const char c = t_[p_];
    if (c == '{') return objekt(v);
    if (c == '[') return liste(v);
    if (c == '"') { v.art = Wert::text; return text(v.s); }
    if (wort("true")) { v.art = Wert::wahr_falsch; v.b = true; return true; }
    if (wort("false")) { v.art = Wert::wahr_falsch; v.b = false; return true; }
    if (wort("null")) { v.art = Wert::nichts; return true; }
    return zahl(v);
  }
  bool zahl(Wert& v) {
    const size_t a = p_;
    if (p_ < t_.size() && (t_[p_] == '-' || t_[p_] == '+')) p_++;
    bool ganz = true;
    while (p_ < t_.size()) {
      const char c = t_[p_];
      if (c >= '0' && c <= '9') { p_++; continue; }
      if (c == '.' || c == 'e' || c == 'E' || ((c == '-' || c == '+') && (t_[p_ - 1] == 'e' || t_[p_ - 1] == 'E'))) {
        ganz = false;
        p_++;
        continue;
      }
      break;
    }
    if (p_ == a) return false;
    const std::string z = t_.substr(a, p_ - a);
    v.art = Wert::zahl;
    v.ganz = ganz;
    v.d = std::strtod(z.c_str(), nullptr);
    v.i = ganz ? std::strtoll(z.c_str(), nullptr, 10) : static_cast<int64_t>(v.d);
    return true;
  }
  static void utf8(std::string& s, unsigned cp) {
    if (cp < 0x80) s += static_cast<char>(cp);
    else if (cp < 0x800) { s += static_cast<char>(0xC0 | (cp >> 6)); s += static_cast<char>(0x80 | (cp & 0x3F)); }
    else {
      s += static_cast<char>(0xE0 | (cp >> 12));
      s += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      s += static_cast<char>(0x80 | (cp & 0x3F));
    }
  }
  bool text(std::string& s) {
    p_++;   // "
    while (p_ < t_.size() && t_[p_] != '"') {
      char c = t_[p_++];
      if (c != '\\') { s += c; continue; }
      if (p_ >= t_.size()) return false;
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
        case 'u': {
          if (p_ + 4 > t_.size()) return false;
          utf8(s, static_cast<unsigned>(std::strtoul(t_.substr(p_, 4).c_str(), nullptr, 16)));
          p_ += 4;
          break;
        }
        default: fehler_ = "unbekanntes Escape"; return false;
      }
    }
    if (p_ >= t_.size()) { fehler_ = "Text ohne Ende"; return false; }
    p_++;   // "
    return true;
  }
  bool liste(Wert& v) {
    v.art = Wert::liste;
    p_++;
    leer();
    if (p_ < t_.size() && t_[p_] == ']') { p_++; return true; }
    while (true) {
      Wert e;
      if (!wert(e)) return false;
      v.l.push_back(std::move(e));
      leer();
      if (p_ < t_.size() && t_[p_] == ',') { p_++; continue; }
      if (p_ < t_.size() && t_[p_] == ']') { p_++; return true; }
      fehler_ = "in Liste , oder ] erwartet";
      return false;
    }
  }
  bool objekt(Wert& v) {
    v.art = Wert::objekt;
    p_++;
    leer();
    if (p_ < t_.size() && t_[p_] == '}') { p_++; return true; }
    while (true) {
      leer();
      std::string k;
      if (p_ >= t_.size() || t_[p_] != '"' || !text(k)) { fehler_ = "Schlüssel erwartet"; return false; }
      leer();
      if (p_ >= t_.size() || t_[p_] != ':') { fehler_ = ": erwartet"; return false; }
      p_++;
      Wert e;
      if (!wert(e)) return false;
      v.o.emplace_back(std::move(k), std::move(e));
      leer();
      if (p_ < t_.size() && t_[p_] == ',') { p_++; continue; }
      if (p_ < t_.size() && t_[p_] == '}') { p_++; return true; }
      fehler_ = "in Objekt , oder } erwartet";
      return false;
    }
  }
};

}  // namespace jm
