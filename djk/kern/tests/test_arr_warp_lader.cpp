// Paket 1.13 Warp, Slice 1 (AK3): der Lader liest cypherdj-arr/1 und /2. Ein Warp (modus 0, Marker [Clip-Beat, Quell-Frame]) lädt nur
// in /2, mit 2 bis 4096 Markern, beide Spalten streng steigend, endlich, Frame 0 bis 1,1e12, Beat höchstens ±1e6; alle Marker einer
// Wiedergabe zusammen höchstens 262 144 (zu_gross). Jeder Fehlerfall hat seine Positivkontrolle (derselbe Clip mit gültigem Warp lädt).
// Nichts bleibt gesperrt oder gebucht, auch nach Fehlern (Konto 0). Mutationen: keine eigene (der Lader ist eine Funktion; jede
// Ablehnung ist ihr eigener Fall).
// Slice 2: modus 2 (complex) und 3 (tones) laden, wenn der Kern mit Bungee gebaut ist; sonst, und im Ziel test_arr_warp_lader_ohne_maschine
// (CYPHERDJ_TEST_OHNE_MASCHINE), lehnt der Lader sie mit dem Grund warp_maschine_fehlt ab, statt still RE-PITCH zu spielen. Modus 4 ist
// format. Slice 4: Modus 1 (beats) lädt mit e, loop, huelle (Fall 8). Mutation ARR_WARP_MASCHINE_STILL: der Lader nimmt den Modus auch ohne Maschine an (der Fall 6 wird rot).
// Slice 5: Fall 7 prüft warp.pitch (fehlt = 1, 0,25 bis 4, nicht bei repitch); Mutation ARR_WARP_PITCH_OHNE_GRENZE.
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
    PRUEF(grund(true, roh("{\"modus\":1,\"w\":[[0,0],[4,92160]]}")) == "format");          // beats ohne e: format (Slice 4: modus 1 ist gebaut, e Pflicht)
    PRUEF(grund(true, roh("{\"modus\":4,\"w\":[[0,0],[4,92160]]}")) == "format");          // 4 gibt es nicht
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
  {  // 5b (Slice 3a): die größte echte Karte der Nachtanalyse hat 2321 Marker (E-W 1): 112 Clips damit (259 952 Punkte) laden, der 113. (262 273) nicht
    Marker m2321;
    for (int i = 0; i < 2321; ++i) m2321.push_back({i * 0.5, i * 24000.0});
    std::string clips;
    for (int k = 0; k < 112; ++k) clips += (k ? "," : "") + o.clip_warp(("k" + std::to_string(k)).c_str(), 0.0, 4.0, a, F, m2321);
    PRUEF(grund(true, spur(clips)).empty());
    clips += "," + o.clip_warp("k112", 0.0, 4.0, a, F, m2321);
    PRUEF(grund(true, spur(clips)) == "zu_gross");
  }
  {  // 6 (Slice 2): complex und tones; ohne Maschine warp_maschine_fehlt, mit ihr geladen, samt Modus im Schnappschuss
#if defined(CYPHERDJ_TEST_OHNE_MASCHINE) || defined(CYPHERDJ_MUTATION_ARR_WARP_MASCHINE_STILL) || !defined(CYPHERDJ_BUNGEE)
    const std::string erwartet = "warp_maschine_fehlt";
#else
    const std::string erwartet = "";
#endif
    for (int modus : {2, 3}) {
      ++nr;
      o.wiedergabe2_warp(nr, spur(o.clip_warp("c1", 0.0, 4.0, a, F, gut, 0.0, modus)));
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(e.grund == erwartet);
      PRUEF(e.snap ? erwartet.empty() : !erwartet.empty());
      if (e.snap) {
        PRUEF(e.snap->spur[0].clips[0].warp && e.snap->spur[0].clips[0].warp->modus == modus);
        cdj::gib_wiedergabe(e.snap.release(), cache);
      }
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);   // auch die Ablehnung hält nichts fest
    }
    PRUEF(grund(true, mit(gut)).empty());   // Positivkontrolle: modus 0 lädt in jeder Bauart
  }
  {  // 7 (Slice 5): warp.pitch. Fehlt = 1; gültig 0,25 bis 4 (D1), nur bei complex/tones; bei repitch nur 1; Positivkontrolle je Ablehnung.
#if defined(CYPHERDJ_TEST_OHNE_MASCHINE) || !defined(CYPHERDJ_BUNGEE)
    const std::string gut_grund = "warp_maschine_fehlt";   // ohne Maschine lehnt der Lader complex/tones vor dem Lesen von pitch ab
#else
    const std::string gut_grund = "";
#endif
    const auto mit_pitch = [&](int modus, double pitch) { return spur(o.clip_warp("c1", 0.0, 4.0, a, F, gut, 0.0, modus, pitch)); };
    PRUEF(grund(true, mit_pitch(2, 1.0)) == gut_grund);                                // Positivkontrolle: pitch 1 (wird nicht geschrieben)
    PRUEF(grund(true, mit_pitch(2, 1.4983070768766815)) == gut_grund);                 // +7 st
    PRUEF(grund(true, mit_pitch(3, 0.7071067811865476)) == gut_grund);                 // -6 st, TONES
    PRUEF(grund(true, mit_pitch(2, 0.25)) == gut_grund && grund(true, mit_pitch(2, 4.0)) == gut_grund);   // die Grenzen gelten
#if !defined(CYPHERDJ_TEST_OHNE_MASCHINE) && defined(CYPHERDJ_BUNGEE)
    PRUEF(grund(true, mit_pitch(2, 0.2)) == "format");                                 // unter ARR_WARP_PITCH_MIN
    PRUEF(grund(true, mit_pitch(2, 4.5)) == "format");                                 // über ARR_WARP_PITCH_MAX
    PRUEF(grund(true, mit_pitch(2, 0.0)) == "format" && grund(true, mit_pitch(2, -1.0)) == "format");
    PRUEF(grund(true, mit_pitch(0, 1.0)).empty());                                     // repitch: pitch 1 geht (Positivkontrolle für die nächste Zeile)
    PRUEF(grund(true, mit_pitch(0, 1.5)) == "format");                                 // repitch folgt dem Tempo: kein pitch
    {  // Form: Text statt Zahl, null
      const std::string c = o.clip("c1", 0.0, 4.0, a, F);
      const auto roh = [&](const std::string& warp) { std::string x = c; x.insert(x.size() - 1, ",\"warp\":" + warp); return spur(x); };
      PRUEF(grund(true, roh("{\"modus\":2,\"pitch\":\"2\",\"w\":[[0,0],[4,92160]]}")) == "format");
      PRUEF(grund(true, roh("{\"modus\":2,\"pitch\":null,\"w\":[[0,0],[4,92160]]}")) == "format");
      PRUEF(grund(true, roh("{\"modus\":2,\"pitch\":2,\"w\":[[0,0],[4,92160]]}")).empty());   // ganze Zahl 2 ist ein gültiges pitch
    }
    {  // der Wert kommt im Schnappschuss an
      ++nr;
      o.wiedergabe2_warp(nr, mit_pitch(2, 1.4983070768766815));
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(e.snap && e.snap->spur[0].clips[0].warp && e.snap->spur[0].clips[0].warp->pitch == 1.4983070768766815);
      cdj::gib_wiedergabe(e.snap.release(), cache);
      ++nr;
      o.wiedergabe2_warp(nr, mit_pitch(2, 1.0));
      e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(e.snap && e.snap->spur[0].clips[0].warp && e.snap->spur[0].clips[0].warp->pitch == 1.0);   // Gegenprobe: ohne Transpose bleibt es 1
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
#endif
  }
  {  // 8 (Slice 4): modus 1 (beats) mit e (Einheiten [Clip-Beat, Quell-Frame]), loop 0..2, huelle 0..100; e, loop, huelle nur bei modus 1
    const std::string c = o.clip("c1", 0.0, 4.0, a, F);
    const auto roh = [&](const std::string& warp) { std::string x = c; x.insert(x.size() - 1, ",\"warp\":" + warp); return spur(x); };
    const std::string w = "\"w\":[[0,0],[4,92160]]";
    const auto beats = [&](const std::string& rest) { return roh("{\"modus\":1," + w + "," + rest + "}"); };
    const std::string gute_e = "\"e\":[[0,0],[1,23040],[2,46080],[3,69120]]";
    PRUEF(grund(true, beats(gute_e + ",\"loop\":1,\"huelle\":100")).empty());                               // Positivkontrolle
    PRUEF(grund(true, beats("\"e\":[[0,0],[1,10]],\"loop\":0,\"huelle\":100")).empty());                   // zwei Einheiten
    PRUEF(grund(true, beats("\"e\":[[0,0]],\"loop\":2,\"huelle\":0")).empty());                            // eine Einheit, Grenzen loop 2 und huelle 0
    PRUEF(grund(true, roh("{\"modus\":1," + w + "}")) == "format");                                           // e fehlt
    PRUEF(grund(true, beats("\"e\":[],\"loop\":0,\"huelle\":100")) == "format");                             // e leer
    PRUEF(grund(true, beats("\"e\":[[1,0],[0,10]],\"loop\":0,\"huelle\":100")) == "format");                 // Beat nicht streng steigend
    PRUEF(grund(true, beats("\"e\":[[0,0],[0,10]],\"loop\":0,\"huelle\":100")) == "format");                 // Beat gleich
    PRUEF(grund(true, beats("\"e\":[[0,10],[1,10]],\"loop\":0,\"huelle\":100")) == "format");                // Frame nicht streng steigend
    PRUEF(grund(true, beats("\"e\":[[0,-1],[1,10]],\"loop\":0,\"huelle\":100")) == "format");                // Frame negativ
    PRUEF(grund(true, beats("\"e\":[[0,0],[1,10,3]],\"loop\":0,\"huelle\":100")) == "format");               // Paar mit drei Zahlen
    PRUEF(grund(true, beats("\"e\":[[0,0],[1,10]],\"loop\":3,\"huelle\":100")) == "format");                 // loop 3
    PRUEF(grund(true, beats("\"e\":[[0,0],[1,10]],\"loop\":-1,\"huelle\":100")) == "format");                // loop -1
    PRUEF(grund(true, beats("\"e\":[[0,0],[1,10]],\"loop\":0.5,\"huelle\":100")) == "format");               // loop keine ganze Zahl
    PRUEF(grund(true, beats("\"e\":[[0,0],[1,10]],\"loop\":0,\"huelle\":101")) == "format");                 // huelle 101
    PRUEF(grund(true, beats("\"e\":[[0,0],[1,10]],\"loop\":0,\"huelle\":-1")) == "format");                  // huelle -1
    PRUEF(grund(true, beats("\"e\":[[0,0],[1,10]],\"huelle\":100")) == "format");                              // loop fehlt
    PRUEF(grund(true, beats("\"e\":[[0,0],[1,10]],\"loop\":0")) == "format");                                  // huelle fehlt
    PRUEF(grund(true, roh("{\"modus\":0," + w + ",\"e\":[[0,0],[1,10]]}")) == "format");                       // e nur bei modus 1
    PRUEF(grund(true, roh("{\"modus\":0," + w + ",\"loop\":0}")) == "format");                                // loop nur bei modus 1
    PRUEF(grund(true, roh("{\"modus\":0," + w + ",\"huelle\":100}")) == "format");                            // huelle nur bei modus 1
    PRUEF(grund(true, roh("{\"modus\":0," + w + "}")).empty());                                               // Positivkontrolle derselben Form ohne e
    PRUEF(grund(true, beats(gute_e + ",\"loop\":0,\"huelle\":100,\"pitch\":1")).empty());                      // pitch 1 geht
    PRUEF(grund(true, beats(gute_e + ",\"loop\":0,\"huelle\":100,\"pitch\":1.5")) == "format");                // BEATS ohne Tonhöhe (D6b)
    {  // Felder im Schnappschuss; die Einheiten stehen hinter den Markern in denselben Vektoren
      ++nr;
      o.wiedergabe2_warp(nr, beats(gute_e + ",\"loop\":2,\"huelle\":40"));
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(e.snap && e.snap->spur[0].clips[0].warp);
      if (e.snap && e.snap->spur[0].clips[0].warp) {
        const cdj::ArrWarp& wb = *e.snap->spur[0].clips[0].warp;
        PRUEF(wb.modus == cdj::ARR_WARP_BEATS && wb.n == 2 && wb.e_n == 4 && wb.loop == 2 && wb.huelle == 40);
        PRUEF(wb.e_beat[3] == 3.0 && wb.e_frame[2] == 46080.0 && wb.e_frame[0] == 0.0);
        PRUEF(wb.beat[1] == 4.0 && wb.frame[1] == 92160.0);   // die Marker sind unberührt
        PRUEF(cdj::beats_einheit(wb, 2.5) == 2 && cdj::beats_einheit(wb, 3.0) == 3 && cdj::beats_einheit(wb, -1.0) == 0 && cdj::beats_einheit(wb, 99.0) == 3);
        PRUEF(e.snap->warp_beat.size() == 6);
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    {  // Gesamtgrenze: Marker und Einheiten zählen zusammen (64 Clips · (2 + 4094) = 262 144 gehen, ein Punkt mehr nicht)
      std::string eb = "\"e\":[";
      for (int i = 0; i < 4094; ++i) eb += (i ? "," : "") + std::string("[") + std::to_string(i) + "," + std::to_string(i * 10) + "]";
      eb += "]";
      const auto bclip = [&](int k, const std::string& ee) {
        std::string x = o.clip(("b" + std::to_string(k)).c_str(), 0.0, 4.0, a, F);
        x.insert(x.size() - 1, ",\"warp\":{\"modus\":1," + w + "," + ee + ",\"loop\":0,\"huelle\":100}");
        return x;
      };
      std::string clips;
      for (int k = 0; k < 64; ++k) clips += (k ? "," : "") + bclip(k, eb);
      PRUEF(grund(true, spur(clips)).empty());
      clips += "," + bclip(64, "\"e\":[[0,0]]");
      PRUEF(grund(true, spur(clips)) == "zu_gross");
    }
  }
  PRUEF_ENDE();
}
