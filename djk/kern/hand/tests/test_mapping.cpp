// Scheibe 19: Mapping-Datei nach §7.2. Das Beispiel des Vertrags lädt; jede fehlerhafte Abwandlung wird mit Art und
// Zeile abgelehnt. Die Abwandlungen entstehen im Test durch Textersatz im Beispiel; die erwartete Zeile ist die Zeile,
// in der der Ersatz steht (unabhängig vom Leser gezählt).
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>

#include "hand/mapping.h"
#include "pruef.h"

using namespace hand;

namespace {

std::string datei(const char* name) {
  std::ifstream f(std::string(HAND_TESTDATEN) + "/" + name);
  std::stringstream s;
  s << f.rdbuf();
  return s.str();
}

const stellwerk::ReglerTabelle& tab() {
  static const stellwerk::ReglerTabelle t;
  return t;
}

int zeile_von(const std::string& text, size_t pos) {
  int z = 1;
  for (size_t i = 0; i < pos; i++) z += text[i] == '\n';
  return z;
}

struct Fall {
  const char* was;
  const char* alt;
  const char* neu;
  FehlerArt art;
};

// Ersetzt `alt` genau einmal; liefert die Zeile des Ersatzes
std::string ersetze(const std::string& t, const char* alt, const char* neu, int* zeile) {
  const size_t p = t.find(alt);
  if (p == std::string::npos || t.find(alt, p + 1) != std::string::npos) {
    std::printf("  Testfehler: \"%s\" nicht genau einmal im Beispiel\n", alt);
    pruef::fehler()++;
    *zeile = -1;
    return t;
  }
  *zeile = zeile_von(t, p);
  return t.substr(0, p) + neu + t.substr(p + std::strlen(alt));
}

}  // namespace

FALL(beispiel_aus_7_2_laedt_jeden_eintrag) {
  auto m = std::make_unique<Mapping>();
  Fehler f;
  const std::string t = datei("beispiel_7_2.json");
  PRUEFE(lade(t.c_str(), tab(), m.get(), &f));
  PRUEFE_GLEICH(m->n_eintraege, 4);
  PRUEFE_GLEICH(m->n_leds, 1);
  PRUEFE(std::strcmp(m->geraet, "beispiel") == 0);
  // Eintrag 0: EQ-Encoder
  const Eintrag& eq = m->eintrag[0];
  PRUEFE(eq.ziel_art == ZielArt::regler && eq.regler == tab().suche("deck/1/eq/tief"));
  PRUEFE(eq.art == Art::relativ && eq.kodierung == Kodierung::zweierkomplement);
  PRUEFE(eq.eigene_kurve && eq.kurve.typ == stellwerk::KurvenTyp::linear && eq.kurve.kill_unter_min);
  PRUEFE_NAH(eq.kurve.min, -26.0, 0);
  PRUEFE_NAH(eq.kurve.max, 6.0, 0);
  PRUEFE_GLEICH(eq.zeile, 3);
  // Eintrag 1: Fader
  const Eintrag& fa = m->eintrag[1];
  PRUEFE(fa.regler == tab().suche("deck/1/fader") && fa.art == Art::absolut);
  PRUEFE(fa.eigene_kurve && fa.kurve.typ == stellwerk::KurvenTyp::fader_db);
  PRUEFE_GLEICH(fa.zeile, 5);
  // Eintrag 2: Hotcue als Deck-Taste
  const Eintrag& hc = m->eintrag[2];
  PRUEFE(hc.ziel_art == ZielArt::deck && hc.deck == 1 && hc.aktion == DeckAktion::hotcue && hc.hotcue == 1);
  PRUEFE(hc.art == Art::taste && hc.quant == Quant::sofort);
  // Eintrag 3: Stopp-Taste
  const Eintrag& st = m->eintrag[3];
  PRUEFE(st.ziel_art == ZielArt::taste && st.taste == Taste::stopp && st.art == Art::taste);
  // Index: jede Nachricht findet ihren Eintrag, eine fremde keinen
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 1, 20), 0);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 1, 7), 1);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::note, 1, 36), 2);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::note, 16, 0), 3);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 16, 0), -1);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::note, 1, 20), -1);
  // LED
  PRUEFE(std::strcmp(m->led[0].name, "vorschlag") == 0);
  PRUEFE(m->led[0].an == 127 && m->led[0].blinkt == 64 && m->led[0].aus == 0);
}

FALL(fehlerhafte_mappings_mit_art_und_zeile) {
  const std::string basis = datei("beispiel_7_2.json");
  const Fall faelle[] = {
      {"unbekannter Regler", "\"deck/1/fader\"", "\"deck/1/fadr\"", FehlerArt::unbekanntes_ziel},
      {"Deck 5", "\"deck/1/hotcue/1\"", "\"deck/5/hotcue/1\"", FehlerArt::unbekanntes_ziel},
      {"Hotcue 9", "\"deck/1/hotcue/1\"", "\"deck/1/hotcue/9\"", FehlerArt::unbekanntes_ziel},
      {"unbekannte Taste", "\"taste/stopp\"", "\"taste/stop\"", FehlerArt::unbekanntes_ziel},
      {"Halter ist kein Ziel", "\"deck/1/fader\"", "\"deck/1/transport\"", FehlerArt::unbekanntes_ziel},
      {"Kodierung unbekannt", "\"zweierkomplement\"", "\"zweier\"", FehlerArt::falsche_kodierung},
      {"Kodierung fehlt bei relativ", "\"kodierung\":\"zweierkomplement\",", "", FehlerArt::falsche_kodierung},
      {"Kodierung bei absolut", "\"art\":\"absolut\",", "\"art\":\"absolut\",\"kodierung\":\"versatz64\",",
       FehlerArt::falsche_kodierung},
      {"Art unbekannt", "\"absolut\"", "\"absolute\"", FehlerArt::falsche_art},
      {"Taste an einem Fader", "\"art\":\"absolut\"", "\"art\":\"taste\"", FehlerArt::falsche_art},
      {"Hotcue als Encoder", "\"art\":\"taste\",\"quant\"", "\"art\":\"relativ\",\"kodierung\":\"versatz64\",\"quant\"",
       FehlerArt::falsche_art},
      {"absolut an einer Note", "{\"typ\":\"cc\",\"kanal\":1,\"nr\":7}", "{\"typ\":\"note\",\"kanal\":1,\"nr\":7}",
       FehlerArt::falsche_art},
      {"fader_db an einem Filter", "\"deck/1/fader\"", "\"deck/1/filter\"", FehlerArt::kurve},
      {"Kurve über dem Bereich", "\"max\":6.0", "\"max\":12.0", FehlerArt::kurve},
      {"kill_unter_min ohne linear", "\"max\":0.0}}", "\"max\":0.0},\"kill_unter_min\":true}", FehlerArt::kurve},
      {"Nachricht doppelt", "\"nr\":7}", "\"nr\":20}", FehlerArt::doppelt},
      {"Kanal 17", "\"kanal\":16,\"nr\":0}", "\"kanal\":17,\"nr\":0}", FehlerArt::nachricht},
      {"Typ pitch", "\"typ\":\"note\",\"kanal\":16,\"nr\":0", "\"typ\":\"pitch\",\"kanal\":16,\"nr\":0", FehlerArt::nachricht},
      {"unbekanntes Feld", "\"quant\"", "\"quantt\"", FehlerArt::feld_unbekannt},
      {"quant falsch", "\"sofort\"", "\"bald\"", FehlerArt::quant},
      {"quant an einer Taste", "\"ziel\":\"taste/stopp\",\"art\":\"taste\"",
       "\"ziel\":\"taste/stopp\",\"art\":\"taste\",\"quant\":\"beat\"", FehlerArt::quant},
      {"LED-Name", "\"vorschlag\"", "\"vorschlagg\"", FehlerArt::led_name},
      {"LED-Wert 128", "\"an\":127", "\"an\":128", FehlerArt::feld_typ},
      {"Version 2", "\"version\":1", "\"version\":2", FehlerArt::version},
      {"JSON kaputt", "\"art\":\"taste\"}],", "\"art\":\"taste\"],", FehlerArt::json},
  };
  auto m = std::make_unique<Mapping>();
  for (const Fall& fa : faelle) {
    int zeile = 0;
    const std::string t = ersetze(basis, fa.alt, fa.neu, &zeile);
    Fehler f;
    const bool ok = lade(t.c_str(), tab(), m.get(), &f);
    if (ok || f.art != fa.art || f.zeile != zeile) {
      std::printf("  verfehlt: %s: geladen=%d art=%s zeile=%d, erwartet art=%s zeile=%d (%s)\n", fa.was, ok,
                  name(f.art), f.zeile, name(fa.art), zeile, f.text);
      pruef::fehler()++;
    }
  }
}

FALL(fehlertext_nennt_zeile_und_ziel) {
  int zeile = 0;
  const std::string t = ersetze(datei("beispiel_7_2.json"), "\"deck/1/fader\"", "\"deck/1/fadr\"", &zeile);
  auto m = std::make_unique<Mapping>();
  Fehler f;
  PRUEFE(!lade(t.c_str(), tab(), m.get(), &f));
  PRUEFE(std::strcmp(f.text, "Zeile 5: unbekanntes_ziel: \"deck/1/fadr\"") == 0);
}

FALL(pflichtfelder_und_leere_datei) {
  auto m = std::make_unique<Mapping>();
  Fehler f;
  PRUEFE(!lade("", tab(), m.get(), &f));
  PRUEFE(f.art == FehlerArt::json);
  PRUEFE(!lade("{\"version\":1,\n\"geraet\":\"x\",\n\"eintraege\":[]}", tab(), m.get(), &f));
  PRUEFE(f.art == FehlerArt::feld_fehlt && f.zeile == 1);   // quelle_port fehlt
  PRUEFE(!lade("{\"version\":1,\"geraet\":\"x\",\"quelle_port\":\"q\",\"eintraege\":[],\n\"leds\":[{}]}", tab(), m.get(), &f));
  PRUEFE(f.art == FehlerArt::feld_fehlt && f.zeile == 2);   // leds ohne ziel_port
  PRUEFE(!lade_datei("/nicht/da.json", tab(), m.get(), &f));
  PRUEFE(f.art == FehlerArt::datei && f.zeile == 0);
}

FALL(negativ_kontrolle_harmlose_abwandlungen_laden) {
  // Leerzeichen, andere Reihenfolge, zusätzliche gültige Einträge: alles lädt
  const std::string basis = datei("beispiel_7_2.json");
  int z = 0;
  const std::string a = ersetze(basis, "\"art\":\"taste\"}],",
                                "\"art\":\"taste\"},\n  {\"ziel\":\"deck/2/pfl\",\"art\":\"taste\",\"nachricht\":{\"nr\":37,\"kanal\":2,\"typ\":\"note\"}},\n"
                                "  {\"nachricht\":{\"typ\":\"cc\",\"kanal\":16,\"nr\":9},\"ziel\":\"tempo\",\"art\":\"relativ\",\"kodierung\":\"versatz64\"},\n"
                                "  {\"nachricht\":{\"typ\":\"cc\",\"kanal\":16,\"nr\":10},\"ziel\":\"taste/autonomie\",\"art\":\"absolut\"},\n"
                                "  {\"nachricht\":{\"typ\":\"note\",\"kanal\":2,\"nr\":50},\"ziel\":\"deck/2/roll/0.25\",\"art\":\"taste\",\"quant\":\"beat\"},\n"
                                "  {\"nachricht\":{\"typ\":\"note\",\"kanal\":2,\"nr\":51},\"ziel\":\"deck/2/fader\",\"art\":\"beruehrung\"}],",
                                &z);
  auto m = std::make_unique<Mapping>();
  Fehler f;
  PRUEFE(lade(a.c_str(), tab(), m.get(), &f));
  if (f.text[0]) std::printf("  %s\n", f.text);
  PRUEFE_GLEICH(m->n_eintraege, 9);
  PRUEFE(m->eintrag[4].schalter && m->eintrag[4].regler == tab().suche("deck/2/pfl"));
  PRUEFE(m->eintrag[5].ziel_art == ZielArt::tempo);
  PRUEFE(m->eintrag[6].ziel_art == ZielArt::taste && m->eintrag[6].taste == Taste::autonomie);
  PRUEFE(m->eintrag[7].aktion == DeckAktion::roll && m->eintrag[7].quant == Quant::beat);
  PRUEFE_NAH(m->eintrag[7].roll_beats, 0.25, 0);
  PRUEFE(m->eintrag[8].art == Art::beruehrung && !m->eintrag[8].eigene_kurve);
}

PRUEF_MAIN
