// Paket 1.13 Warp, Slice 1 (AK3): der Lader liest cypherdj-arr/1 und /2. Ein Warp (modus 0, Marker [Clip-Beat, Quell-Frame]) lädt nur
// in /2, mit 2 bis 4096 Markern, beide Spalten streng steigend, endlich, Frame 0 bis 1,1e12, Beat höchstens ±1e6; alle Marker einer
// Wiedergabe zusammen höchstens 262 144 (zu_gross). Jeder Fehlerfall hat seine Positivkontrolle (derselbe Clip mit gültigem Warp lädt).
// Nichts bleibt gesperrt oder gebucht, auch nach Fehlern (Konto 0). Mutationen: keine eigene (der Lader ist eine Funktion; jede
// Ablehnung ist ihr eigener Fall).
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/arr_wiedergabe.h"
#include "pruef.h"

using Marker = std::vector<std::pair<double, double>>;
static const int64_t F = 48000;

int main() {
  arrdatei::Ordner o("test_arr_warp_lader");
  const std::string a = o.audio('a', F);
  cdj::SpeicherKonto konto(200LL << 20);
  cdj::ArrAudioCache cache(&konto, 100LL << 20, false);
  int64_t nr = 100;
  const auto spur = [&](const std::string& clip) { return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + clip + "]}"; };
  // lädt die Datei und gibt den Grund zurück ("" = geladen); ein geladener Schnappschuss wird gleich freigegeben
  const auto grund = [&](bool v2, const std::string& spuren) {
    ++nr;
    if (v2) o.wiedergabe2_warp(nr, spuren); else o.wiedergabe(nr, spuren);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    const std::string g = e.snap ? "" : e.grund;
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    return g;
  };
  const Marker gut = {{0.0, 0.0}, {4.0, 92160.0}};
  const auto mit = [&](const Marker& m) { return spur(o.clip_warp("c1", 0.0, 4.0, a, F, m)); };
  {  // 1: Felder und Zeiger, Speicher des Schnappschusses
    ++nr;
    o.wiedergabe2_warp(nr, spur(o.clip_warp("c1", 0.0, 4.0, a, F, {{-1.0, 0.0}, {1.0, 48000.0}, {3.0, 96000.0}})) + "," +
                          "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + o.clip("c2", 0.0, 1.0, a, F) + "]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrClip& c = e.snap->spur[0].clips[0];
      PRUEF(c.warp != nullptr && c.warp->n == 3 && c.warp->modus == cdj::ARR_WARP_REPITCH);
      if (c.warp) {
        PRUEF(c.warp->beat[0] == -1.0 && c.warp->beat[2] == 3.0 && c.warp->frame[1] == 48000.0 && c.warp->frame[2] == 96000.0);
        PRUEF_NAH(cdj::warp_frame(*c.warp, 2.0), 72000.0, 1e-9);     // Mitte des zweiten Segments
        PRUEF_NAH(cdj::warp_frame(*c.warp, -3.0), -48000.0, 1e-9);   // Randsegment davor: gleiche Steigung weiter
        PRUEF_NAH(cdj::warp_frame(*c.warp, 5.0), 144000.0, 1e-9);    // Randsegment dahinter
      }
      PRUEF(e.snap->spur[1].clips[0].warp == nullptr);               // ein Clip ohne Warp bleibt ohne
      PRUEF(e.snap->warps.size() == 1 && e.snap->warp_beat.size() == 3);
      PRUEF(konto.gesperrt() == F * 8 + cdj::arr_audio_kopf() + e.snap->gesperrt_bytes);   // Warp-Vektoren stehen in den gebuchten Seiten
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 2: /1 kennt keinen Warp; die Positivkontrolle derselben Datei in /2 lädt
    PRUEF(grund(true, mit(gut)).empty());
    PRUEF(grund(false, mit(gut)) == "format");
    PRUEF(grund(false, spur(o.clip("c1", 0.0, 4.0, a, F))).empty());   // /1 ohne Warp lädt wie bisher
    ++nr;
    o.roh(nr, "{\"format\":\"cypherdj-arr/3\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(!e.snap && e.grund == "format");
  }
  {  // 3: Marker-Prüfung
    PRUEF(grund(true, mit({{0.0, 0.0}})) == "format");                                       // ein Marker
    PRUEF(grund(true, mit({})) == "format");                                                 // keiner
    PRUEF(grund(true, mit({{0.0, 0.0}, {0.0, 100.0}})) == "format");                         // Beat gleich
    PRUEF(grund(true, mit({{0.0, 0.0}, {4.0, 0.0}})) == "format");                           // Frame gleich
    PRUEF(grund(true, mit({{0.0, 0.0}, {2.0, 100.0}, {1.0, 200.0}})) == "format");           // Beat fällt
    PRUEF(grund(true, mit({{0.0, 0.0}, {2.0, 100.0}, {3.0, 50.0}})) == "format");            // Frame fällt
    PRUEF(grund(true, mit({{0.0, -1.0}, {4.0, 100.0}})) == "format");                        // Frame negativ
    PRUEF(grund(true, mit({{0.0, 0.0}, {4.0, 2.0e12}})) == "format");                        // Frame über 1,1e12
    PRUEF(grund(true, mit({{0.0, 0.0}, {2.0e6, 100.0}})) == "format");                       // Beat über 1e6
    PRUEF(grund(true, mit({{0.0, 0.0}, {4.0, 92160.0}, {8.0, 184320.0}})).empty());          // Positivkontrolle: drei Marker
    Marker viele;                                                                            // 4096 gehen, 4097 nicht
    for (int i = 0; i < 4096; ++i) viele.push_back({i * 0.01, i * 10.0});
    PRUEF(grund(true, mit(viele)).empty());
    viele.push_back({4096 * 0.01, 4096 * 10.0});
    PRUEF(grund(true, mit(viele)) == "format");
  }
  {  // 4: Form des JSON
    const std::string c = o.clip("c1", 0.0, 4.0, a, F);
    const auto roh = [&](const std::string& warp) {
      std::string x = c;
      x.insert(x.size() - 1, ",\"warp\":" + warp);
      return spur(x);
    };
    PRUEF(grund(true, roh("{\"modus\":0,\"w\":[[0,0],[4,92160]]}")).empty());              // Positivkontrolle, ganze Zahlen
    PRUEF(grund(true, roh("null")).empty());                                               // null = ohne Warp
    PRUEF(grund(false, roh("null")) == "format");   // Gesamtreview Minor 2: in /1 ist jedes warp-Feld format, auch null (wie ausgang, Vertrag)
    PRUEF(grund(true, roh("{\"modus\":1,\"w\":[[0,0],[4,92160]]}")) == "format");          // beats ist noch nicht gebaut
    PRUEF(grund(true, roh("{\"modus\":2,\"w\":[[0,0],[4,92160]]}")) == "format");          // complex auch nicht
    PRUEF(grund(true, roh("{\"modus\":0.5,\"w\":[[0,0],[4,92160]]}")) == "format");        // keine ganze Zahl
    PRUEF(grund(true, roh("{\"w\":[[0,0],[4,92160]]}")) == "format");                      // modus fehlt
    PRUEF(grund(true, roh("{\"modus\":0}")) == "format");                                  // w fehlt
    PRUEF(grund(true, roh("{\"modus\":0,\"w\":{\"a\":1}}")) == "format");                  // w kein Array
    PRUEF(grund(true, roh("{\"modus\":0,\"w\":[[0,0,1],[4,92160]]}")) == "format");        // Paar mit drei Zahlen
    PRUEF(grund(true, roh("{\"modus\":0,\"w\":[[0,\"0\"],[4,92160]]}")) == "format");      // Text statt Zahl
    PRUEF(grund(true, roh("[[0,0],[4,92160]]")) == "format");                              // warp kein Objekt
    PRUEF(grund(true, roh("42")) == "format");
  }
  {  // 5: Gesamtgrenze 262 144 Marker über alle Clips: 64 · 4096 gehen, ein Marker mehr nicht
    Marker m4096;
    for (int i = 0; i < 4096; ++i) m4096.push_back({i * 0.01, i * 10.0});
    std::string clips;
    for (int k = 0; k < 64; ++k) clips += (k ? "," : "") + o.clip_warp(("w" + std::to_string(k)).c_str(), 0.0, 4.0, a, F, m4096);
    PRUEF(grund(true, spur(clips)).empty());
    clips += "," + o.clip_warp("w64", 0.0, 4.0, a, F, {{0.0, 0.0}, {1.0, 1.0}});
    PRUEF(grund(true, spur(clips)) == "zu_gross");
  }
  PRUEF_ENDE();
}
