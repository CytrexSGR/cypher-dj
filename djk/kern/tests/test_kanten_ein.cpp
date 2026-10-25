// I08 Task 3: Eingangs-Kanten-Datei. Nur ein_<k>_{L,R} (k 1..4) und midi_ein_1 sind Ziele; Kern-Quellen fallen weg (Riegel);
// Hotplug: erst wenn die Gerätequelle existiert, fehlt eine Kante.
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "cypherdj/kanten.h"
#include "pruef.h"

struct Welt {
  std::set<std::string> ports;
  std::set<std::pair<std::string, std::string>> kanten;
};
static bool ex(void* c, const char* p) { return ((Welt*)c)->ports.count(p) > 0; }
static bool vb(void* c, const char* a, const char* b) { return ((Welt*)c)->kanten.count({a, b}) > 0; }

int main() {
  const std::string pre = "cypherdj-kern:";
  const std::string fl = "alsa_input.pci-0000_16_00.6.analog-stereo:capture_FL";
  const std::string fr = "alsa_input.pci-0000_16_00.6.analog-stereo:capture_FR";
  const std::string text =
      fl + "\tein_1_L\n" + fr + "\tein_1_R\n" +
      "Midi-Bridge:XDJ-XZ (1):capture\tmidi_ein_1\n" +
      "x:out\tmaster_L\n" +             // kein Eingang des Kerns
      "x:out\tein_5_L\n" + "x:out\tein_0_R\n" + "x:out\tein_1_X\n" + "x:out\thand_in\n" +   // ungültige Namen
      "cypherdj-kern:master_L\tein_2_L\n" +                                                  // Riegel: Kern -> Kern
      "cypherdj-kern-c:master_L\tein_3_L\n" +                                                // Riegel: auch der Kern einer anderen Instanz (Nachbesserung 1, m6)
      "cypherdj-latenz:out_L\tein_4_L\n" +                                                   // Negativ-Kontrolle: ein Messclient ist kein Kern, seine Kante gilt
      "\n";
  const std::vector<cdj::Kante> k = cdj::lies_eingangs_kanten(text, pre);
  PRUEF(k.size() == 4);
  PRUEF(k.size() == 4 && k[0] == cdj::Kante({fl, pre + "ein_1_L"}));
  PRUEF(k.size() == 4 && k[1] == cdj::Kante({fr, pre + "ein_1_R"}));
  PRUEF(k.size() == 4 && k[2] == cdj::Kante({"Midi-Bridge:XDJ-XZ (1):capture", pre + "midi_ein_1"}));
  PRUEF(k.size() == 4 && k[3] == cdj::Kante({"cypherdj-latenz:out_L", pre + "ein_4_L"}));   // m6: der Kern einer anderen Instanz ist weg, der Messclient bleibt
  {  // Hotplug: Gerät fehlt: nichts zu verbinden; Gerät erscheint: zwei Audio-Kanten fehlen; verbunden: nichts mehr
    Welt w{{pre + "ein_1_L", pre + "ein_1_R", pre + "midi_ein_1"}, {}};
    PRUEF(cdj::fehlende_kanten(k, {ex, vb, &w}).empty());
    w.ports.insert(fl);
    w.ports.insert(fr);
    PRUEF(cdj::fehlende_kanten(k, {ex, vb, &w}).size() == 2);
    w.kanten.insert({fl, pre + "ein_1_L"});
    w.kanten.insert({fr, pre + "ein_1_R"});
    PRUEF(cdj::fehlende_kanten(k, {ex, vb, &w}).empty());
  }
  {  // Gesamtreview B1: unter pipewire-jack heißt der Client eines ALSA-Geräts node.description, nicht node.name. Die Welt kennt nur die JACK-Form;
     // eine Datei in node.name-Form bleibt stumm (nichts fehlt, nichts wird je verbunden), die in node.description-Form (Leerzeichen, Schrägstrich, Klammern) wird verbunden.
    const std::string jl = "Family 17h/19h HD Audio Controller Analoges Stereo:capture_FL";
    const std::string jr = "Family 17h/19h HD Audio Controller Analoges Stereo:capture_FR";
    const std::vector<cdj::Kante> nur_name = cdj::lies_eingangs_kanten(fl + "\tein_1_L\n" + fr + "\tein_1_R\n", pre);
    const std::vector<cdj::Kante> beschr = cdj::lies_eingangs_kanten(jl + "\tein_1_L\n" + jr + "\tein_1_R\n", pre);
    PRUEF(beschr.size() == 2 && beschr[0] == cdj::Kante({jl, pre + "ein_1_L"}) && beschr[1] == cdj::Kante({jr, pre + "ein_1_R"}));   // Name bleibt heil
    Welt w{{pre + "ein_1_L", pre + "ein_1_R", jl, jr}, {}};
    PRUEF(nur_name.size() == 2 && cdj::fehlende_kanten(nur_name, {ex, vb, &w}).empty());   // die alte Namensform findet unter pw-jack nichts
    PRUEF(cdj::fehlende_kanten(beschr, {ex, vb, &w}).size() == 2);                        // Positiv-Kontrolle: die Beschreibungsform wird verbunden
  }
  {  // Review-Nachzug (MAJOR 2): fällt eine Zuordnung weg oder wechselt die Quelle, muss die alte Kante getrennt werden
    const std::string neu_l = "alsa_input.usb-XDJ.analog-stereo:capture_FL";
    const std::vector<cdj::Kante> alt = k;
    std::vector<cdj::Kante> soll = {{neu_l, pre + "ein_1_L"}, k[1], k[2], k[3]};   // ein_1_L: Quelle fl -> neu_l; der Rest bleibt
    const std::vector<cdj::Kante> weg = cdj::wegfallende_kanten(alt, soll);
    PRUEF(weg.size() == 1 && weg[0] == cdj::Kante({fl, pre + "ein_1_L"}));
    PRUEF(cdj::wegfallende_kanten(alt, alt).empty());                              // Negativ-Kontrolle: nichts geändert, nichts getrennt
    PRUEF(cdj::wegfallende_kanten(alt, {}).size() == alt.size());                  // Datei weg: alle vier
    PRUEF(cdj::wegfallende_kanten({}, soll).empty());                              // vorher nichts: nichts zu trennen
    // wer in einer anderen Quelle des Solls weiter gewünscht ist (soll_alle), wird nicht getrennt
    std::vector<cdj::Kante> soll_alle = {k[0], {"x", "y"}};
    PRUEF(cdj::wegfallende_kanten({k[0], k[1]}, soll_alle).size() == 1);
  }
  PRUEF_ENDE();
}
