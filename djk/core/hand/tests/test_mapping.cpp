// Scheibe 19: Mapping-Datei nach §7.2. Das Beispiel des Vertrags lädt; jede fehlerhafte Abwandlung wird mit Art und
// Zeile abgelehnt. Die Abwandlungen entstehen im Test durch Textersatz im Beispiel; die erwartete Zeile ist die Zeile,
// in der der Ersatz steht (unabhängig vom Leser gezählt).
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>

#include "hand/mapping.h"
#include "check.h"

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

FALL(arr_ziel_nur_als_taste) {
  // D1 K1 (§7.2): arr/start_stopp lädt als Taste; als absolut falsche_art; arr/start ist kein Ziel
  auto m = std::make_unique<Mapping>();
  Fehler f;
  const std::string kopf = R"({"version":1,"geraet":"arr","quelle_port":"q","ziel_port":"z","eintraege":[)";
  PRUEFE(lade((kopf + R"({"nachricht":{"typ":"note","kanal":1,"nr":60},"ziel":"arr/start_stopp","art":"taste"}]})").c_str(),
              tab(), m.get(), &f));
  PRUEFE(m->eintrag[0].ziel_art == ZielArt::arr);
  PRUEFE(!lade((kopf + R"({"nachricht":{"typ":"cc","kanal":1,"nr":60},"ziel":"arr/start_stopp","art":"absolut"}]})").c_str(),
               tab(), m.get(), &f) && f.art == FehlerArt::falsche_art);
  PRUEFE(!lade((kopf + R"({"nachricht":{"typ":"note","kanal":1,"nr":60},"ziel":"arr/start","art":"taste"}]})").c_str(),
               tab(), m.get(), &f) && f.art == FehlerArt::unbekanntes_ziel);
}

FALL(stufen_nur_taste_an_stetigem_regler_2_bis_16) {
  // "stufen": a button cycles a continuous control (range 0..1) through N positions
  auto m = std::make_unique<Mapping>();
  Fehler f;
  const std::string kopf = R"({"version":1,"geraet":"s","quelle_port":"q","ziel_port":"z","eintraege":[)";
  auto e = [&](const char* ziel, const char* art, const char* stufen, const char* typ = "cc") {
    return kopf + R"({"nachricht":{"typ":")" + typ + R"(","kanal":1,"nr":60},"ziel":")" + ziel + R"(","art":")" + art + "\"" +
           stufen + "}]}";
  };
  PRUEFE(lade(e("strom/5/bk/3", "taste", ",\"stufen\":3").c_str(), tab(), m.get(), &f));
  PRUEFE_GLEICH(m->eintrag[0].stufen, 3);
  PRUEFE(lade(e("spur/1/bk/14", "taste", ",\"stufen\":16", "note").c_str(), tab(), m.get(), &f));
  PRUEFE_GLEICH(m->eintrag[0].stufen, 16);
  PRUEFE(lade(e("strom/5/bk/3", "taste", ",\"stufen\":2").c_str(), tab(), m.get(), &f));
  // without stufen the old rule holds: taste at a continuous control is refused, the field defaults to 0
  PRUEFE(!lade(e("strom/5/bk/3", "taste", "").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::falsche_art);
  PRUEFE(lade(e("deck/1/kill/tief", "taste", "", "note").c_str(), tab(), m.get(), &f));
  PRUEFE_GLEICH(m->eintrag[0].stufen, 0);
  // refused: out of range, not an integer, wrong art, switch control, non-control target, range not 0..1
  PRUEFE(!lade(e("strom/5/bk/3", "taste", ",\"stufen\":1").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::feld_typ);
  PRUEFE(!lade(e("strom/5/bk/3", "taste", ",\"stufen\":17").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::feld_typ);
  PRUEFE(!lade(e("strom/5/bk/3", "taste", ",\"stufen\":2.5").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::feld_typ);
  PRUEFE(!lade(e("strom/5/bk/3", "taste", ",\"stufen\":\"3\"").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::feld_typ);
  PRUEFE(!lade(e("strom/5/bk/3", "absolut", ",\"stufen\":3").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::falsche_art);
  PRUEFE(!lade(e("deck/1/kill/tief", "taste", ",\"stufen\":3", "note").c_str(), tab(), m.get(), &f) &&
         f.art == FehlerArt::falsche_art);
  PRUEFE(!lade(e("taste/stopp", "taste", ",\"stufen\":3", "note").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::falsche_art);
  PRUEFE(!lade(e("deck/1/play", "taste", ",\"stufen\":3", "note").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::falsche_art);
  PRUEFE(!lade(e("deck/1/fader", "taste", ",\"stufen\":3").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::falsche_art);
  PRUEFE(std::strstr(f.text, "0..1") != nullptr);
}

FALL(kanal_0_ist_jeder_kanal) {
  // channel 0 = every channel; the exact channel wins; two wildcards with one typ/nr are a duplicate
  auto m = std::make_unique<Mapping>();
  Fehler f;
  const std::string kopf = R"({"version":1,"geraet":"k","quelle_port":"q","ziel_port":"z","eintraege":[)";
  auto e = [](int kanal, int nr, const char* ziel, const char* typ = "cc") {
    return std::string(R"({"nachricht":{"typ":")") + typ + R"(","kanal":)" + std::to_string(kanal) + R"(,"nr":)" +
           std::to_string(nr) + R"(},"ziel":")" + ziel + R"(","art":"absolut"})";
  };
  PRUEFE(lade((kopf + e(0, 7, "deck/1/fader") + "]}").c_str(), tab(), m.get(), &f));
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 4, 7), 0);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 1, 7), 0);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 16, 7), 0);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 4, 8), -1);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::note, 4, 7), -1);   // typ still counts
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 0, 7), -1);     // a message never has channel 0
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 17, 7), -1);
  // exact beats wildcard, in either file order
  PRUEFE(lade((kopf + e(0, 7, "deck/1/fader") + "," + e(4, 7, "deck/2/fader") + "]}").c_str(), tab(), m.get(), &f));
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 4, 7), 1);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 5, 7), 0);
  PRUEFE(lade((kopf + e(4, 7, "deck/2/fader") + "," + e(0, 7, "deck/1/fader") + "]}").c_str(), tab(), m.get(), &f));
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 4, 7), 0);
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::cc, 5, 7), 1);
  // duplicate wildcard refused, bounds -1 and 17 refused, note works too
  PRUEFE(!lade((kopf + e(0, 7, "deck/1/fader") + "," + e(0, 7, "deck/2/fader") + "]}").c_str(), tab(), m.get(), &f) &&
         f.art == FehlerArt::doppelt);
  PRUEFE(!lade((kopf + e(-1, 7, "deck/1/fader") + "]}").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::nachricht);
  PRUEFE(!lade((kopf + e(17, 7, "deck/1/fader") + "]}").c_str(), tab(), m.get(), &f) && f.art == FehlerArt::nachricht);
  PRUEFE(lade((std::string(kopf) + R"({"nachricht":{"typ":"note","kanal":0,"nr":36},"ziel":"deck/1/kill/tief","art":"taste"}]})").c_str(),
              tab(), m.get(), &f));
  PRUEFE_GLEICH(suche(*m, NachrichtTyp::note, 9, 36), 0);
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

FALL(alias_eintraege_erz_werden_uebersprungen_nicht_abgelehnt) {
  // ADR 043 point 6: erz/<n>/<suffix> is an alias the page server resolves, not a core address. The kern skips such an
  // entry and counts it, and loads the rest of the map; before this a single alias left the kern without any controller.
  auto m = std::make_unique<Mapping>();
  Fehler f;
  const std::string kopf = R"({"version":1,"geraet":"s","quelle_port":"q","eintraege":[)";
  const std::string t = kopf + R"({"nachricht":{"typ":"cc","kanal":1,"nr":7},"ziel":"deck/1/fader","art":"absolut"},
{"nachricht":{"typ":"cc","kanal":5,"nr":7},"ziel":"erz/1/fader","art":"absolut"},
{"nachricht":{"typ":"note","kanal":5,"nr":48},"ziel":"erz/16/pfl","art":"taste"},
{"nachricht":{"typ":"cc","kanal":6,"nr":7},"ziel":"erz/2/bk/3","art":"absolut"}]})";
  PRUEFE(lade(t.c_str(), tab(), m.get(), &f));
  PRUEFE(m->n_eintraege == 1);
  PRUEFE(m->n_alias == 3);
  PRUEFE(std::strcmp(m->eintrag[0].ziel, "deck/1/fader") == 0);
  PRUEFE(m->index[0][4][7] == -1);   // the skipped alias leaves its message free
  // still strict: no stream 0 or 17, no empty suffix, nothing else under erz/
  for (const char* z : {"erz/0/fader", "erz/17/fader", "erz/1/", "erz/1", "erz/x/fader"}) {
    const std::string k = kopf + R"({"nachricht":{"typ":"cc","kanal":1,"nr":7},"ziel":")" + z + R"(","art":"absolut"}]})";
    PRUEFE(!lade(k.c_str(), tab(), m.get(), &f) && f.art == FehlerArt::unbekanntes_ziel);
  }
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
