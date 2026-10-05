// Hand-Weg: Mapping-Datei lesen und prüfen (SCHNITTSTELLEN §7.2). Nicht-Echtzeit.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

#include "hand/led.h"
#include "hand/mapping.h"
#include "json_zeilen.h"

namespace hand {

namespace {

using json::Wert;

// Ein Fehler wird genau einmal gesetzt; Rückgabe immer false, damit `return fehl(...)` passt.
struct Pruefung {
  Fehler* f;
  bool fehl(FehlerArt art, int zeile, const std::string& text) {
    f->art = art;
    f->zeile = zeile;
    std::snprintf(f->text, sizeof f->text, "Zeile %d: %s: %s", zeile, name(art), text.c_str());
    return false;
  }
  bool nur_felder(const Wert& o, const char* const* erlaubt, int n) {
    for (const Wert::Feld& fe : o.o) {
      bool ok = false;
      for (int i = 0; i < n; i++) ok = ok || fe.name == erlaubt[i];
      if (!ok) return fehl(FehlerArt::feld_unbekannt, fe.zeile, "\"" + fe.name + "\"");
    }
    return true;
  }
  const Wert* pflicht(const Wert& o, const char* feld, Wert::Art art) {
    const Wert::Feld* fe = o.feld(feld);
    if (!fe) {
      fehl(FehlerArt::feld_fehlt, o.zeile, std::string("\"") + feld + "\"");
      return nullptr;
    }
    if (fe->wert.art != art) {
      fehl(FehlerArt::feld_typ, fe->wert.zeile, std::string("\"") + feld + "\" hat den falschen Typ");
      return nullptr;
    }
    return &fe->wert;
  }
  bool ganzzahl(const Wert& v, const char* feld, int min, int max, int* aus, FehlerArt art) {
    if (v.art != Wert::zahl || !v.ganz || v.d < min || v.d > max)
      return fehl(art, v.zeile, std::string("\"") + feld + "\" muss eine ganze Zahl von " + std::to_string(min) +
                                    " bis " + std::to_string(max) + " sein");
    *aus = static_cast<int>(v.d);
    return true;
  }
  bool text_feld(const Wert& o, const char* feld, char* aus, size_t max, bool noetig) {
    const Wert::Feld* fe = o.feld(feld);
    if (!fe) {
      if (noetig) return fehl(FehlerArt::feld_fehlt, o.zeile, std::string("\"") + feld + "\"");
      aus[0] = 0;
      return true;
    }
    if (fe->wert.art != Wert::text || fe->wert.s.size() >= max)
      return fehl(FehlerArt::feld_typ, fe->wert.zeile,
                  std::string("\"") + feld + "\" muss Text mit höchstens " + std::to_string(max - 1) + " Bytes sein");
    std::memcpy(aus, fe->wert.s.c_str(), fe->wert.s.size() + 1);
    return true;
  }
  bool nachricht(const Wert& v, Nachricht* n) {
    if (v.art != Wert::objekt) return fehl(FehlerArt::nachricht, v.zeile, "\"nachricht\" muss ein Objekt sein");
    static const char* const F[] = {"typ", "kanal", "nr"};
    if (!nur_felder(v, F, 3)) return false;
    const Wert* typ = pflicht(v, "typ", Wert::text);
    if (!typ) return false;
    if (typ->s == "cc") n->typ = NachrichtTyp::cc;
    else if (typ->s == "note") n->typ = NachrichtTyp::note;
    else return fehl(FehlerArt::nachricht, typ->zeile, "typ \"" + typ->s + "\" (erlaubt: cc, note)");
    const Wert* k = pflicht(v, "kanal", Wert::zahl);
    const Wert* nr = k ? pflicht(v, "nr", Wert::zahl) : nullptr;
    if (!k || !nr) return false;
    int kanal = 0, num = 0;
    if (!ganzzahl(*k, "kanal", 1, 16, &kanal, FehlerArt::nachricht)) return false;
    if (!ganzzahl(*nr, "nr", 0, 127, &num, FehlerArt::nachricht)) return false;
    n->kanal = static_cast<uint8_t>(kanal);
    n->nr = static_cast<uint8_t>(num);
    return true;
  }
};

// ziel -> Eintrag-Felder; false: unbekanntes Ziel
bool ziel_aufloesen(const char* z, const stellwerk::ReglerTabelle& tab, Eintrag* e) {
  e->regler = -1;
  e->schalter = false;
  const int r = tab.suche(z);
  if (r >= 0) {
    const stellwerk::ReglerDef& d = tab.def(r);
    if (d.transport) return false;   // deck/<n>/transport ist ein Halter, kein Ziel der Hand
    e->ziel_art = ZielArt::regler;
    e->regler = static_cast<int16_t>(r);
    e->schalter = d.kurve.typ == stellwerk::KurvenTyp::schalter;
    return true;
  }
  if (std::strcmp(z, "tempo") == 0) {
    e->ziel_art = ZielArt::tempo;
    return true;
  }
  if (std::strncmp(z, "taste/", 6) == 0) {
    e->ziel_art = ZielArt::taste;
    return taste_aus_text(z + 6, &e->taste);
  }
  // deck/<n>/<aktion>
  if (std::strncmp(z, "deck/", 5) != 0 || z[5] < '1' || z[5] > '4' || z[6] != '/') return false;
  e->ziel_art = ZielArt::deck;
  e->deck = static_cast<uint8_t>(z[5] - '0');
  const char* a = z + 7;
  if (deck_aktion_aus_text(a, &e->aktion)) return true;
  auto nummer = [](const char* s, int* aus) {
    if (s[0] < '1' || s[0] > '8' || s[1] != 0) return false;
    *aus = s[0] - '0';
    return true;
  };
  int k = 0;
  if (std::strncmp(a, "hotcue/", 7) == 0 && nummer(a + 7, &k)) {
    e->aktion = DeckAktion::hotcue;
    e->hotcue = static_cast<uint8_t>(k);
    return true;
  }
  if (std::strncmp(a, "hotcue_setzen/", 14) == 0 && nummer(a + 14, &k)) {
    e->aktion = DeckAktion::hotcue_setzen;
    e->hotcue = static_cast<uint8_t>(k);
    return true;
  }
  if (std::strncmp(a, "roll/", 5) == 0 && a[5]) {
    char* ende = nullptr;
    const double b = std::strtod(a + 5, &ende);
    if (*ende != 0 || !(b >= 1.0 / 32 && b <= 128.0)) return false;
    e->aktion = DeckAktion::roll;
    e->roll_beats = static_cast<float>(b);
    return true;
  }
  return false;
}

// Welche Arten ein Ziel verträgt (Festlegung dieser Scheibe, siehe Plan F2)
bool art_passt(const Eintrag& e, const stellwerk::ReglerTabelle& tab, std::string* warum) {
  switch (e.ziel_art) {
    case ZielArt::regler: {
      const stellwerk::KurvenTyp k = tab.def(e.regler).kurve.typ;
      if (e.art == Art::taste && !e.schalter) {
        *warum = "taste nur an Schalter-Reglern (kill, pfl, split)";
        return false;
      }
      if (e.art == Art::relativ && k == stellwerk::KurvenTyp::schalter) {
        *warum = "relativ nicht an Schalter-Reglern";
        return false;
      }
      return true;
    }
    case ZielArt::tempo:
      if (e.art != Art::relativ) *warum = "tempo nur relativ (Encoder, §7.3 Punkt 7)";
      return e.art == Art::relativ;
    case ZielArt::deck: {
      const bool rel = e.aktion == DeckAktion::loop_laenge || e.aktion == DeckAktion::nudge;
      const Art soll = rel ? Art::relativ : Art::taste;
      if (e.art != soll) *warum = std::string(name(e.aktion)) + " nur " + name(soll);
      return e.art == soll;
    }
    case ZielArt::taste: {
      Art soll = Art::taste;
      if (e.taste == Taste::autonomie) soll = Art::absolut;
      if (e.taste == Taste::spielart || e.taste == Taste::laenge || e.taste == Taste::kiste_wahl) soll = Art::relativ;
      if (e.art != soll) *warum = std::string("taste/") + name(e.taste) + " nur " + name(soll);
      return e.art == soll;
    }
  }
  return false;
}

bool eintrag_lesen(Pruefung& p, const Wert& v, const stellwerk::ReglerTabelle& tab, Eintrag* e) {
  std::memset(e, 0, sizeof *e);
  e->regler = -1;
  e->zeile = v.zeile;
  if (v.art != Wert::objekt) return p.fehl(FehlerArt::feld_typ, v.zeile, "Eintrag muss ein Objekt sein");
  static const char* const F[] = {"nachricht", "ziel", "art", "kodierung", "kurve", "kill_unter_min", "quant"};
  if (!p.nur_felder(v, F, 7)) return false;
  const Wert* n = p.pflicht(v, "nachricht", Wert::objekt);
  if (!n || !p.nachricht(*n, &e->nachricht)) return false;
  const Wert* ziel = p.pflicht(v, "ziel", Wert::text);
  if (!ziel) return false;
  if (ziel->s.size() >= TEXT || !ziel_aufloesen(ziel->s.c_str(), tab, e))
    return p.fehl(FehlerArt::unbekanntes_ziel, ziel->zeile, "\"" + ziel->s + "\"");
  std::memcpy(e->ziel, ziel->s.c_str(), ziel->s.size() + 1);
  const Wert* art = p.pflicht(v, "art", Wert::text);
  if (!art) return false;
  if (art->s == "absolut") e->art = Art::absolut;
  else if (art->s == "relativ") e->art = Art::relativ;
  else if (art->s == "beruehrung") e->art = Art::beruehrung;
  else if (art->s == "taste") e->art = Art::taste;
  else return p.fehl(FehlerArt::falsche_art, art->zeile, "\"" + art->s + "\" (erlaubt: absolut, relativ, beruehrung, taste)");

  // kodierung: Pflicht bei relativ, sonst verboten
  const Wert::Feld* kod = v.feld("kodierung");
  if (e->art == Art::relativ) {
    if (!kod) return p.fehl(FehlerArt::falsche_kodierung, v.zeile, "relativ braucht \"kodierung\"");
    if (kod->wert.art == Wert::text && kod->wert.s == "zweierkomplement") e->kodierung = Kodierung::zweierkomplement;
    else if (kod->wert.art == Wert::text && kod->wert.s == "versatz64") e->kodierung = Kodierung::versatz64;
    else
      return p.fehl(FehlerArt::falsche_kodierung, kod->wert.zeile,
                    "\"" + kod->wert.s + "\" (erlaubt: zweierkomplement, versatz64)");
  } else if (kod) {
    return p.fehl(FehlerArt::falsche_kodierung, kod->zeile, "\"kodierung\" nur bei art relativ");
  }

  if ((e->art == Art::absolut || e->art == Art::relativ) && e->nachricht.typ != NachrichtTyp::cc)
    return p.fehl(FehlerArt::falsche_art, art->zeile, std::string(name(e->art)) + " braucht eine cc-Nachricht");
  std::string warum;
  if (!art_passt(*e, tab, &warum)) return p.fehl(FehlerArt::falsche_art, art->zeile, warum + " (Ziel " + e->ziel + ")");

  // kurve und kill_unter_min
  const Wert::Feld* ku = v.feld("kurve");
  const Wert::Feld* kill = v.feld("kill_unter_min");
  if (ku) {
    if (e->ziel_art != ZielArt::regler || (e->art != Art::absolut && e->art != Art::relativ))
      return p.fehl(FehlerArt::kurve, ku->zeile, "\"kurve\" nur an Reglern mit art absolut oder relativ");
    const stellwerk::ReglerDef& d = tab.def(e->regler);
    if (d.kurve.typ != stellwerk::KurvenTyp::fader_db && d.kurve.typ != stellwerk::KurvenTyp::linear)
      return p.fehl(FehlerArt::kurve, ku->zeile, std::string("keine eigene Kurve für ") + e->ziel);
    const Wert& k = ku->wert;
    if (k.art != Wert::objekt) return p.fehl(FehlerArt::kurve, k.zeile, "\"kurve\" muss ein Objekt sein");
    static const char* const K[] = {"typ", "min", "max"};
    if (!p.nur_felder(k, K, 3)) return false;
    const Wert* typ = p.pflicht(k, "typ", Wert::text);
    const Wert* mn = typ ? p.pflicht(k, "min", Wert::zahl) : nullptr;
    const Wert* mx = mn ? p.pflicht(k, "max", Wert::zahl) : nullptr;
    if (!mx) return false;
    if (typ->s == "linear") e->kurve.typ = stellwerk::KurvenTyp::linear;
    else if (typ->s == "fader_db") e->kurve.typ = stellwerk::KurvenTyp::fader_db;
    else return p.fehl(FehlerArt::kurve, typ->zeile, "typ \"" + typ->s + "\" (erlaubt: linear, fader_db)");
    if (e->kurve.typ == stellwerk::KurvenTyp::fader_db && !d.db)
      return p.fehl(FehlerArt::kurve, typ->zeile, std::string("fader_db nur an dB-Reglern, nicht an ") + e->ziel);
    if (!(mn->d < mx->d) || mn->d < d.min || mx->d > d.max)
      return p.fehl(FehlerArt::kurve, mn->zeile,
                    "min < max im Bereich " + std::to_string(d.min) + " bis " + std::to_string(d.max) + " verlangt");
    e->kurve.min = static_cast<float>(mn->d);
    e->kurve.max = static_cast<float>(mx->d);
    e->eigene_kurve = true;
  }
  if (kill) {
    if (!ku || e->kurve.typ != stellwerk::KurvenTyp::linear)
      return p.fehl(FehlerArt::kurve, kill->zeile, "\"kill_unter_min\" nur mit kurve linear");
    if (kill->wert.art != Wert::wahr_falsch)
      return p.fehl(FehlerArt::feld_typ, kill->wert.zeile, "\"kill_unter_min\" muss true oder false sein");
    e->kurve.kill_unter_min = kill->wert.b;
  }

  // quant: nur Deck-Tasten
  e->quant = Quant::sofort;
  if (const Wert::Feld* q = v.feld("quant")) {
    if (e->ziel_art != ZielArt::deck || e->art != Art::taste)
      return p.fehl(FehlerArt::quant, q->zeile, "\"quant\" nur für Deck-Tasten");
    if (q->wert.art == Wert::text && q->wert.s == "sofort") e->quant = Quant::sofort;
    else if (q->wert.art == Wert::text && q->wert.s == "beat") e->quant = Quant::beat;
    else if (q->wert.art == Wert::text && q->wert.s == "takt") e->quant = Quant::takt;
    else return p.fehl(FehlerArt::quant, q->wert.zeile, "\"" + q->wert.s + "\" (erlaubt: sofort, beat, takt)");
  }
  return true;
}

bool led_lesen(Pruefung& p, const Wert& v, Led* l) {
  std::memset(l, 0, sizeof *l);
  l->zeile = v.zeile;
  if (v.art != Wert::objekt) return p.fehl(FehlerArt::feld_typ, v.zeile, "LED muss ein Objekt sein");
  static const char* const F[] = {"name", "nachricht", "werte"};
  if (!p.nur_felder(v, F, 3)) return false;
  const Wert* nm = p.pflicht(v, "name", Wert::text);
  if (!nm) return false;
  if (nm->s.size() >= TEXT || !led_name_gueltig(nm->s.c_str()))
    return p.fehl(FehlerArt::led_name, nm->zeile, "\"" + nm->s + "\" (§7.4)");
  std::memcpy(l->name, nm->s.c_str(), nm->s.size() + 1);
  const Wert* n = p.pflicht(v, "nachricht", Wert::objekt);
  if (!n || !p.nachricht(*n, &l->nachricht)) return false;
  const Wert* w = p.pflicht(v, "werte", Wert::objekt);
  if (!w) return false;
  static const char* const W[] = {"aus", "an", "blinkt"};
  if (!p.nur_felder(*w, W, 3)) return false;
  int zahl[3];
  for (int i = 0; i < 3; i++) {
    const Wert* x = p.pflicht(*w, W[i], Wert::zahl);
    if (!x || !p.ganzzahl(*x, W[i], 0, 127, &zahl[i], FehlerArt::feld_typ)) return false;
  }
  l->aus = static_cast<uint8_t>(zahl[0]);
  l->an = static_cast<uint8_t>(zahl[1]);
  l->blinkt = static_cast<uint8_t>(zahl[2]);
  return true;
}

}  // namespace

bool lade(const char* text, const stellwerk::ReglerTabelle& tab, Mapping* m, Fehler* fehler) {
  Pruefung p{fehler};
  std::memset(m, 0, sizeof *m);
  std::memset(m->index, 0xff, sizeof m->index);   // -1
  const std::string t(text);
  Wert w;
  std::string jf;
  int jz = 0;
  if (!json::Leser(t).lies(w, jf, jz)) return p.fehl(FehlerArt::json, jz, jf);
  if (w.art != Wert::objekt) return p.fehl(FehlerArt::feld_typ, w.zeile, "Datei muss ein Objekt sein");
  static const char* const F[] = {"version", "geraet", "quelle_port", "ziel_port", "eintraege", "leds"};
  if (!p.nur_felder(w, F, 6)) return false;
  const Wert* ver = p.pflicht(w, "version", Wert::zahl);
  if (!ver) return false;
  if (!ver->ganz || ver->d != 1) return p.fehl(FehlerArt::version, ver->zeile, "nur version 1 wird gelesen");
  m->version = 1;
  if (!p.text_feld(w, "geraet", m->geraet, sizeof m->geraet, true)) return false;
  if (!p.text_feld(w, "quelle_port", m->quelle_port, sizeof m->quelle_port, true)) return false;
  if (!p.text_feld(w, "ziel_port", m->ziel_port, sizeof m->ziel_port, false)) return false;

  const Wert* ein = p.pflicht(w, "eintraege", Wert::liste);
  if (!ein) return false;
  for (const Wert& v : ein->l) {
    if (m->n_eintraege >= MAX_EINTRAEGE)
      return p.fehl(FehlerArt::zu_viele, v.zeile, "höchstens " + std::to_string(MAX_EINTRAEGE) + " Einträge");
    Eintrag& e = m->eintrag[m->n_eintraege];
    if (!eintrag_lesen(p, v, tab, &e)) return false;
    int16_t& idx = m->index[static_cast<int>(e.nachricht.typ)][e.nachricht.kanal - 1][e.nachricht.nr];
    if (idx >= 0)
      return p.fehl(FehlerArt::doppelt, v.zeile,
                    "Nachricht schon in Zeile " + std::to_string(m->eintrag[idx].zeile) + " belegt");
    idx = static_cast<int16_t>(m->n_eintraege++);
  }

  if (const Wert::Feld* leds = w.feld("leds")) {
    if (leds->wert.art != Wert::liste) return p.fehl(FehlerArt::feld_typ, leds->wert.zeile, "\"leds\" muss eine Liste sein");
    if (!leds->wert.l.empty() && !m->ziel_port[0]) return p.fehl(FehlerArt::feld_fehlt, leds->zeile, "leds brauchen \"ziel_port\"");
    for (const Wert& v : leds->wert.l) {
      if (m->n_leds >= MAX_LEDS) return p.fehl(FehlerArt::zu_viele, v.zeile, "höchstens " + std::to_string(MAX_LEDS) + " LEDs");
      Led& l = m->led[m->n_leds];
      if (!led_lesen(p, v, &l)) return false;
      for (int i = 0; i < m->n_leds; i++)
        if (std::strcmp(m->led[i].name, l.name) == 0)
          return p.fehl(FehlerArt::doppelt, v.zeile, std::string("LED ") + l.name + " schon in Zeile " + std::to_string(m->led[i].zeile));
      m->n_leds++;
    }
  }
  fehler->art = FehlerArt::datei;
  fehler->zeile = 0;
  fehler->text[0] = 0;
  return true;
}

bool lade_datei(const char* pfad, const stellwerk::ReglerTabelle& tab, Mapping* m, Fehler* fehler) {
  std::ifstream f(pfad);
  if (!f) {
    fehler->art = FehlerArt::datei;
    fehler->zeile = 0;
    std::snprintf(fehler->text, sizeof fehler->text, "Zeile 0: datei: %s nicht lesbar", pfad);
    return false;
  }
  std::stringstream s;
  s << f.rdbuf();
  return lade(s.str().c_str(), tab, m, fehler);
}

}  // namespace hand
