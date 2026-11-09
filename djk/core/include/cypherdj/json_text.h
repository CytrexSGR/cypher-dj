// D1 K3 Fix L7: Text als JSON-Zeichenkette für die Ergebniszeilen der Export-Programme (cypherdj-render, -mitschnitt,
// -nulltest). Anführungszeichen und Backslash maskiert, Steuerzeichen als \u00XX, ungültiges UTF-8 (etwa ein Zeichen, das
// eine feste Feldlänge zerschnitten hat) je Byte als U+FFFD. Ergebnis samt der umschließenden Anführungszeichen.
#pragma once

#include <cstdio>
#include <string>
#include <string_view>

namespace cdj {

inline std::string json_text(std::string_view s) {
  std::string o = "\"";
  size_t i = 0;
  while (i < s.size()) {
    const auto c = static_cast<unsigned char>(s[i]);
    if (c == '"' || c == '\\') {
      o += '\\';
      o += static_cast<char>(c);
      ++i;
      continue;
    }
    if (c < 0x20) {
      char b[8];
      std::snprintf(b, sizeof b, "\\u%04x", c);
      o += b;
      ++i;
      continue;
    }
    if (c < 0x80) {
      o += static_cast<char>(c);
      ++i;
      continue;
    }
    const int n = (c >= 0xC2 && c <= 0xDF) ? 2 : (c >= 0xE0 && c <= 0xEF) ? 3 : (c >= 0xF0 && c <= 0xF4) ? 4 : 0;
    bool ok = n > 0 && i + static_cast<size_t>(n) <= s.size();
    for (int k = 1; ok && k < n; ++k) ok = (static_cast<unsigned char>(s[i + k]) & 0xC0) == 0x80;
    if (ok && n >= 3) {   // überlange Formen und UTF-16-Ersatzwerte sind kein UTF-8
      const auto d = static_cast<unsigned char>(s[i + 1]);
      ok = !((c == 0xE0 && d < 0xA0) || (c == 0xED && d >= 0xA0) || (c == 0xF0 && d < 0x90) || (c == 0xF4 && d >= 0x90));
    }
    if (ok) {
      o.append(s.substr(i, static_cast<size_t>(n)));
      i += static_cast<size_t>(n);
    } else {
      o += "\xEF\xBF\xBD";   // U+FFFD
      ++i;
    }
  }
  o += '"';
  return o;
}

}  // namespace cdj
