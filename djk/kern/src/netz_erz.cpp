// Plan 2026-09-27 (Strudel im Kern, Stufe 1; SCHNITTSTELLEN §4.8, ADR 024): Erzeuger-OSC im Netz-Faden. /erz/strom mit
// Ziel kit:<name> lädt das Kit aus <kit_ordner>/<name>/ und reicht es als Zeiger an den Kern; Fenster-Bundles
// (/erz/fenster + n × /erz/ev) werden hier vollständig geprüft und als ein ErzFenster übergeben. Freigaben (abgelöstes
// Kit, verbrauchtes Fenster) kommen als Ereignis zurück und passieren nur hier, nie im Callback.
#include <arpa/inet.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>

#include "cypherdj/erzeuger.h"
#include "cypherdj/kit.h"
#include "cypherdj/mixer.h"
#include "cypherdj/netz.h"

namespace cdj {

namespace v = cypherdj::osc;

namespace {

void kopiere(char* ziel, const char* quelle, size_t n) {
  std::strncpy(ziel, quelle, n - 1);
  ziel[n - 1] = '\0';
}

bool quelle_ok(const char* q) {
  for (const auto& n : v::werte::quelle)
    if (n == q) return true;
  return false;
}

bool kit_name_ok(const char* s) {  // [a-z0-9_-]{1,32}
  const size_t n = std::strlen(s);
  if (n == 0 || n > 32) return false;
  for (size_t i = 0; i < n; ++i) {
    const char c = s[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  return true;
}

int32_t be32(const char* p) {
  uint32_t x;
  std::memcpy(&x, p, 4);
  return static_cast<int32_t>(ntohl(x));
}

}  // namespace

bool Netz::erz_paket(const v::Adresse* a, const osc::Nachricht& m) {
  if (a->pfad == v::erz_fenster.pfad || a->pfad == v::erz_ev.pfad) {  // §4.8: nur im Bundle
    protokollfehler(m.adresse, "protokoll", 0);
    return true;
  }
  if (a->pfad != v::erz_strom.pfad) return false;
  namespace f = v::feld::erz_strom;
  Befehl b{};
  b.art = Befehl::ERZ_STROM;
  b.id = m.werte[f::id].h;
  kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
  b.nr = m.werte[f::strom].i;
  kopiere(b.pfad, m.werte[f::kanal].s, sizeof b.pfad);
  const char* ziel = m.werte[f::ziel].s;
  const int k = Mixer::kanal_index(b.pfad);
  const bool kanal_ok = k >= 4 && k <= 13;  // erz/1..8, pad/1..2 (§1.5)
  if (std::strncmp(ziel, "midi:", 5) == 0) {  // Studio S5: midi:<port 1..4>:<kanal 1..16>, kein Kit
    int port = 0, mk = 0;
    char rest = 0;
    const bool form_ok = std::sscanf(ziel + 5, "%d:%d%c", &port, &mk, &rest) == 2 && port >= 1 &&
                         port <= ERZ_MIDI_PORTS && mk >= 1 && mk <= 16;
    if (!quelle_ok(b.quelle) || b.nr < 1 || b.nr > ERZ_STROEME || !kanal_ok || !form_ok) {
      quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
      return true;
    }
    b.form = port;
    b.politik = mk;
    b.zeiger = nullptr;
    einreihen(b);
    return true;
  }
  // kit:<a> oder kit:<a>+<b> (MVP 2 Scheibe 3, E2: ein Muster spielt battery und die Mitschnitte zusammen)
  std::string kit_a, kit_b;
  bool kit = std::strncmp(ziel, "kit:", 4) == 0;
  if (kit) {
    const std::string rest(ziel + 4);
    const size_t plus = rest.find('+');
    kit_a = rest.substr(0, plus);
    if (plus != std::string::npos) kit_b = rest.substr(plus + 1);
    kit = kit_name_ok(kit_a.c_str()) && (plus == std::string::npos || kit_name_ok(kit_b.c_str()));
  }
  if (!quelle_ok(b.quelle) || b.nr < 1 || b.nr > ERZ_STROEME || !kanal_ok || !kit) {
    if (std::strncmp(ziel, "pad:", 4) == 0)
      std::fprintf(stderr, "/erz/strom: Ziel %s ist noch nicht gebaut (Scheibe 54); gebaut ist kit:<name>\n", ziel);
    quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "ausserhalb_bereich");
    return true;
  }
  std::string fehler;
  std::unique_ptr<Kit> geladen = kit_b.empty() ? lade_kit(kit_ordner_ + "/" + kit_a, &fehler)
                                               : lade_kits(kit_ordner_ + "/" + kit_a, kit_ordner_ + "/" + kit_b, &fehler);
  if (!geladen) {
    std::fprintf(stderr, "/erz/strom: %s\n", fehler.c_str());
    quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, "pruefung");
    return true;
  }
  b.zeiger = geladen.get();
  if (einreihen(b)) geladen.release();  // der Kern besitzt es jetzt; zurück kommt es als ERZ_ALT
  return true;
}

// Feste Typen gleich; bei /erz/ev danach 0 bis n Wiederholungen des Schwanzes (§4.8, Scheibe 3).
static bool typen_passen(const char* t, const v::Adresse& a, bool mit_schwanz) {
  const std::string_view fest = a.typen.substr(1);
  if (std::strncmp(t, fest.data(), fest.size()) != 0) return false;
  const char* rest = t + fest.size();
  if (!mit_schwanz) return *rest == '\0';
  const std::string_view sw = v::schwanz::erz_ev;
  while (*rest) {
    if (std::strncmp(rest, sw.data(), sw.size()) != 0) return false;
    rest += sw.size();
  }
  return true;
}

void Netz::erz_bundle(const char* p, size_t n) {
  // "#bundle\0", Zeitmarke (8 Bytes), dann Elemente: Länge (int32, Netzreihenfolge) und eine Nachricht (OSC 1.0)
  if (n < 16 || n % 4 != 0) {
    protokollfehler("#bundle", "protokoll", 0);
    return;
  }
  auto fe = std::make_unique<ErzFenster>();
  size_t o = 16;
  int i = 0;
  while (o < n) {
    if (o + 4 > n) { protokollfehler("#bundle", "protokoll", 0); return; }
    const int32_t len = be32(p + o);
    o += 4;
    if (len <= 0 || len % 4 != 0 || o + (size_t)len > n) { protokollfehler("#bundle", "protokoll", 0); return; }
    osc::Nachricht m;
    if (!osc::lesen(p + o, (size_t)len, m)) { protokollfehler("#bundle", "falsche_typen", 0); return; }
    o += (size_t)len;
    const v::Adresse* a = v::finde(m.adresse);
    const bool ist_fenster = i == 0 && a && a->pfad == v::erz_fenster.pfad;
    const bool ist_ev = i > 0 && a && a->pfad == v::erz_ev.pfad;
    if (!ist_fenster && !ist_ev) { protokollfehler(m.adresse, "unbekannte_adresse", 0); return; }
    if (!typen_passen(m.typen, *a, ist_ev)) { protokollfehler(m.adresse, "falsche_typen", 0); return; }
    if (ist_fenster) {
      namespace f = v::feld::erz_fenster;
      fe->strom = m.werte[f::strom].i;
      fe->sendung = m.werte[f::sendung].i;
      fe->ab_beat = m.werte[f::ab_beat].d;
      fe->bis_beat = m.werte[f::bis_beat].d;
      if (fe->strom < 1 || fe->strom > ERZ_STROEME || m.werte[f::modus].i != 66 || !std::isfinite(fe->ab_beat) ||
          !std::isfinite(fe->bis_beat) || !(fe->ab_beat < fe->bis_beat)) {
        protokollfehler(m.adresse, "protokoll", 0);
        return;
      }
    } else {
      namespace f = v::feld::erz_ev;
      if (fe->n >= ERZ_FENSTER_EV) { protokollfehler(m.adresse, "protokoll", 0); return; }
      ErzEv& e = fe->ev[fe->n];
      e.beat = m.werte[f::beat].d;
      e.note = m.werte[f::note].i;
      e.muster = m.werte[f::muster].i;
      e.velocity = m.werte[f::velocity].f;
      e.dauer = m.werte[f::dauer_beats].d;
      e.begin = 0.0f;
      e.end = 1.0f;
      bool param_ok = true;
      for (int k = (int)v::erz_ev.felder; k + 1 < m.anzahl; k += 2) {  // Scheibe 3: Schwanz (nr, wert), §4.8
        const float w = m.werte[k + 1].f;
        // NaN nur bei einem bekannten Parameter ist ein Formfehler; ±Inf klemmt die Wiedergabe auf [0, 1]; eine
        // unbekannte nr wird samt Wert überlesen (Abschluss-Review Scheibe 3 Fund 7).
        switch (m.werte[k].i) {
          case (int32_t)v::werte::ErzParameter::begin: e.begin = w; param_ok = param_ok && !std::isnan(w); break;
          case (int32_t)v::werte::ErzParameter::end: e.end = w; param_ok = param_ok && !std::isnan(w); break;
          default: break;  // unbekannte nr: überlesen (ein neuerer Erzeuger bleibt spielbar)
        }
      }
      const bool ok = param_ok && std::isfinite(e.dauer) && e.dauer >= 0.0 && m.werte[f::strom].i == fe->strom && e.note >= 0 && e.note <= 127 && e.velocity >= 0.0f &&
                      e.velocity <= 1.0f && e.beat >= fe->ab_beat && e.beat < fe->bis_beat &&
                      (fe->n == 0 || e.beat >= fe->ev[fe->n - 1].beat);
      if (!ok) { protokollfehler(m.adresse, "protokoll", 0); return; }
      ++fe->n;
    }
    ++i;
  }
  if (i == 0) {
    protokollfehler("#bundle", "protokoll", 0);
    return;
  }
  Befehl b{};
  b.art = Befehl::ERZ_FENSTER;
  kopiere(b.quelle, "erzeuger", sizeof b.quelle);
  b.nr = fe->strom;
  b.zeiger = fe.get();
  if (einreihen(b)) fe.release();  // zurück kommt es mit ERZ_QUITTUNG
}

bool Netz::erz_ereignis(const Ereignis& e) {
  if (e.art == Ereignis::ERZ_ALT) {
    delete static_cast<const Kit*>(e.zeiger);
    return true;
  }
  if (e.art != Ereignis::ERZ_QUITTUNG) return false;
  osc::Schreiber s(v::erz_quittung);
  s.i(e.deck).i(e.fassung);
  for (int k = 0; k < 5; ++k) s.i(e.erz_zahl[k]);
  an_alle(s);
  delete static_cast<const ErzFenster*>(e.zeiger);
  return true;
}

}  // namespace cdj
