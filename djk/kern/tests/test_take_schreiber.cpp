// 1.8 Task 21: TakeSchreiber. Bitgleich; Lücken (Sprungstelle der Samples) werden mit Stille gefüllt und gezählt; nie ersetzen; Platte voll = Status.
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "cypherdj/take_schreiber.h"
#include "pruef.h"

static cdj::AufnahmeChunk chunk(int64_t s0, int n = cdj::REC_CHUNK) {
  cdj::AufnahmeChunk c{};
  c.s0 = s0;
  c.n = n;
  for (int i = 0; i < n; ++i) { c.l[i] = 0.001f * static_cast<float>((s0 + i) % 977 + 1); c.r[i] = -c.l[i]; }  // nie 0: Stille wäre sonst nicht von Daten zu trennen
  return c;
}
static std::vector<float> lies(const std::string& pfad) {
  std::ifstream f(pfad, std::ios::binary);
  std::vector<char> b((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  std::vector<float> v(b.size() / 4);
  std::memcpy(v.data(), b.data(), v.size() * 4);
  return v;
}

int main() {
  char vorlage[] = "/tmp/take_sXXXXXX";
  PRUEF(mkdtemp(vorlage) != nullptr);
  const std::string d = vorlage;
  {  // lückenlos: 4 Chunks ab Sample 5000, Datei bitgleich
    cdj::TakeSchreiber w(d + "/a.f32", 5000);
    std::string f;
    PRUEF(w.offen(f));
    for (int i = 0; i < 4; ++i) w.chunk(chunk(5000 + i * 256));
    PRUEF(w.schliessen(5000 + 4 * 256, f));
    const std::vector<float> v = lies(d + "/a.f32");
    PRUEF(v.size() == 4 * 256 * 2 && w.frames() == 1024 && w.luecken() == 0 && !w.fehler());
    bool gleich = true;
    for (int i = 0; i < 1024; ++i) gleich = gleich && v[2 * i] == chunk(5000 + (i / 256) * 256).l[i % 256] && v[2 * i + 1] == -v[2 * i];
    PRUEF(gleich);
  }
  {  // Lücke in der Mitte (ein Chunk fehlt), am Anfang (erster Chunk fehlt) und am Ende (letzter fehlt): Stille, Länge stimmt, drei Lücken gezählt
    cdj::TakeSchreiber w(d + "/b.f32", 0);
    std::string f;
    PRUEF(w.offen(f));
    w.chunk(chunk(256));            // Anfang: 0..255 fehlt
    w.chunk(chunk(768));            // Mitte: 512..767 fehlt
    PRUEF(w.schliessen(1280, f));   // Ende: 1024..1279 fehlt
    const std::vector<float> v = lies(d + "/b.f32");
    PRUEF(v.size() == 1280 * 2 && w.frames() == 1280 && w.luecken() == 3 && w.luecken_frames() == 3 * 256);
    auto still = [&](int von, int bis) { for (int i = von; i < bis; ++i) if (v[2 * i] != 0.0f || v[2 * i + 1] != 0.0f) return false; return true; };
    auto daten = [&](int von, int bis) { for (int i = von; i < bis; ++i) if (v[2 * i] == 0.0f) return false; return true; };
    PRUEF(still(0, 256) && daten(256, 512) && still(512, 768) && daten(768, 1024) && still(1024, 1280));
  }
  {  // Überlappung (derselbe Chunk zweimal): das Doppelte wird nicht geschrieben
    cdj::TakeSchreiber w(d + "/c.f32", 0);
    std::string f;
    PRUEF(w.offen(f));
    w.chunk(chunk(0));
    w.chunk(chunk(128));
    PRUEF(w.schliessen(384, f));
    PRUEF(w.frames() == 384 && w.luecken() == 0);
  }
  {  // nie ersetzen
    cdj::TakeSchreiber w1(d + "/d.f32", 0), w2(d + "/d.f32", 0);
    std::string f;
    PRUEF(w1.offen(f));
    PRUEF(!w2.offen(f) && !f.empty());
    w1.schliessen(0, f);
  }
  {  // Platte voll: /dev/full nimmt keine Bytes; Status fehler, das Zählen der Frames läuft weiter
    cdj::TakeSchreiber w("/dev/full", 0, false);
    std::string f;
    PRUEF(w.offen(f));
    for (int i = 0; i < 400; ++i) w.chunk(chunk(i * 256));   // 400 * 2 KB > Puffer: der Schreibversuch scheitert
    PRUEF(w.fehler());
    PRUEF(!w.schliessen(400 * 256, f));
  }
  std::system((std::string("rm -rf ") + d).c_str());
  PRUEF_ENDE();
}
