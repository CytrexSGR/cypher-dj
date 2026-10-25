// Paket 1.13 Warp, Slice 1 (AK12 Teil): Null-Test mit gewarpten Spuren. „Live“ ist ein Kern im Prozess (arr35::Lauf) mit einer
// Wiedergabe /2 (Spur 1: Rauschen als 125-BPM-Quelle gewarpt, Spur 2: Rauschen als 100-BPM-Quelle gewarpt, −6 dB, Start auf Beat 2,
// Spur 3: ungewarptes Rauschen als Kontrolle), Spur-Reglern über das Stellwerk und Loop-Klammer 0..8; sein Master wird wie im Betrieb
// über den Ring-Kopf mitgeschnitten. „Render“ ist rendere() mit dem Neustart-Fach des Live-Kerns. Erwartet (Form von test_nulltest):
//   1. bestanden mit Rest unter −120 dB (gemessen −145 dB, nicht bitgleich: D7) bei 128 und bei 120 BPM (der Warp folgt dem Projekttempo, Länge in Beats gleich);
//   2. Gegenprobe (eine gewarpte Spur um 1 Frame verschoben, die Marker mit) rot, für Spur 1 und für Spur 2; die ungewarpte Spur 3 auch;
//   3. Negativ-Kontrolle: der Render ohne Regler-Stand ist rot; die beiden Läufe sind nicht still (Signal > −20 dB).
// Mutation: RENDER_GEGENPROBE_WARP_BLIND (Fall 2 rot: die Gegenprobe fasst einen Warp nicht an und bleibt gleich).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <memory>
#include <vector>

#include "arr_bau.h"
#include "arr_lauf.h"
#include "cypherdj/nulltest.h"
#include "cypherdj/render.h"
#include "cypherdj/ring_mitschnitt.h"
#include "cypherdj/zustand.h"

bool g_waechter = false;

using k35::N;

namespace {

constexpr int64_t FPB125 = 23040;   // Frames je Beat einer 125-BPM-Quelle
constexpr int64_t FPB100 = 28800;   // Frames je Beat einer 100-BPM-Quelle

// Rauschen (feste Folge), Spitze 0,2: jede Verschiebung um 1 Sample ist im Rest sichtbar
std::string rauschen(const arrdatei::Ordner& o, char z, int64_t frames) {
  const std::string sha(64, z);
  std::vector<float> d(static_cast<size_t>(frames) * 2);
  uint32_t x = 12345u + static_cast<uint32_t>(z);
  for (float& v : d) {
    x = x * 1664525u + 1013904223u;
    v = 0.2f * (static_cast<float>(x >> 8) / 8388608.0f - 1.0f);
  }
  std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary)
      .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  return sha;
}

void start_tempo(arr35::Lauf& x, double bpm) {
  PRUEF(x.kern->sample() == 0);
  x.kern.reset(new cdj::Kern(bpm, x.ring, x.bef.get(), x.ere.get()));
  x.kern->verbinde_lader(x.lr.get());
  x.kern->setze_pruefmodus(false);
  x.vh = x.kern->mixer().limiter_vorhalt();
}

void lade_drei_spuren(arr35::Lauf& x) {
  const std::string a = rauschen(x.ordner, 'd', 10 * FPB125);
  const std::string b = rauschen(x.ordner, 'e', 6 * FPB100);
  const std::string c = rauschen(x.ordner, 'f', 10 * 22500);
  const std::string spuren =
      "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip_warp("c1", 0.0, 9.0, a, 10 * FPB125, {{0.0, 0.0}, {9.0, 9.0 * FPB125}}) + "]}," +
      "{\"nr\":2,\"art\":\"audio\",\"clips\":[" +
      x.ordner.clip_warp("c2", 2.0, 4.0, b, 6 * FPB100, {{0.0, 0.0}, {2.0, 2.0 * FPB100}, {5.0, 5.0 * 0.9 * FPB100}}, -6.0) + "]}," +
      "{\"nr\":3,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c3", 1.0, 5.0, c, 10 * 22500) + "]}";
  x.laden(1, spuren, "andreas", true);
  x.teil("spur/2/fader", -3.0f, 0.0, 0.0);
  x.teil("spur/1/pan", 0.3f, 0.0, 0.0);
  x.loop(true, 0.0, 8.0);
}

struct Live {
  cdj::RingMitschnitt m;
  int64_t ursprung = -1;
  std::unique_ptr<cdj_z_echtzeit> fach{new cdj_z_echtzeit()};
};

Live live_lauf(arr35::Lauf& x, double bpm) {
  Live v;
  const int64_t spb = static_cast<int64_t>(std::ceil(48000.0 * 60.0 / bpm));
  cdj::RingLeser leser(x.ring);
  x.lauf(x.kern->sample() + 37 * N);
  PRUEF(leser.lies(v.m));
  const int64_t id = x.start(0.0, 0);
  const int64_t frist = x.kern->sample() + 20 * spb;
  while ((v.ursprung < 0 && x.kern->sample() < frist) || (v.ursprung >= 0 && x.kern->sample() < v.ursprung + 10 * spb)) {
    x.lauf(x.kern->sample() + N);
    PRUEF(leser.lies(v.m));
    if (v.ursprung < 0 && x.quittung(id, 2)) v.ursprung = x.quittung(id, 2)->sample;
  }
  x.kern->abbild(*v.fach);
  return v;
}

cdj::NullErgebnis vergleiche(const Live& v, const cdj::RenderErgebnis& r) {
  const int64_t ab = v.ursprung + r.vorhalt - v.m.s0;
  const int64_t n_live = static_cast<int64_t>(v.m.l.size()) - ab;
  PRUEF(ab >= 0 && n_live > 0);
  if (!(ab >= 0 && n_live > 0)) return cdj::NullErgebnis{};
  return cdj::null_vergleich(v.m.l.data() + ab, v.m.r.data() + ab, n_live, r.l.data(), r.r.data(), static_cast<int64_t>(r.l.size()),
                             r.frames);
}

cdj::RenderAuftrag auftrag(const arr35::Lauf& x, const Live& v, double bpm) {
  cdj::RenderAuftrag auf;
  auf.arr_ordner = x.ordner.pfad;
  auf.nr = 1;
  auf.von_beat = 0.0;
  auf.bis_beat = 8.0;
  auf.bpm = bpm;
  auf.quantum = N;
  auf.regler = v.fach.get();
  return auf;
}

void fall1(const std::string& ab, double bpm, const char* name) {
  arr35::Lauf x(ab, name);
  start_tempo(x, bpm);
  lade_drei_spuren(x);
  const Live v = live_lauf(x, bpm);
  PRUEF(v.ursprung > 0 && v.m.fehler.empty());
  const cdj::RenderErgebnis r = cdj::rendere(auftrag(x, v, bpm));
  PRUEF(r.fehler.empty() && r.regler > 0 && r.phase == 25);
  PRUEF(r.frames == std::llround(8.0 * 48000.0 * 60.0 / bpm));
  const cdj::NullErgebnis e = vergleiche(v, r);
  std::printf("Fall 1 (%.1f BPM): %s rest %.1f dB, signal %.1f dB, verschoben %.1f dB, fenster %lld\n", bpm,
              cdj::null_urteil_text(e.urteil), e.rest_db, e.signal_db, e.verschoben_db, (long long)e.fenster);
  // Tor A7: Rest unter −90 dBFS. Gemessen −145 dB, nicht −200: der Warp rechnet seine Quellposition aus dem absoluten Kern-Beat, und
  // live (Einsatz bei Sample ~10 000) und Render (Einsatz bei 3n + 25) runden ihn verschieden; gelegentlich kippt ein Float-Ulp.
  // Die Schranke −120 dB hält diesen Befund fest und trennt von der Gegenprobe (Rest um −8 dB) um über 100 dB.
  PRUEF(e.urteil == cdj::NullUrteil::bestanden && e.rest_db < -120.0 && e.signal_db > -20.0);
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_arr_warp_null");
  // 1: bestanden bei 128 und bei 120 BPM
  fall1(ab.pfad, 128.0, "test_arr_warp_null_128");
  fall1(ab.pfad, 120.0, "test_arr_warp_null_120");
  arr35::Lauf x(ab.pfad, "test_arr_warp_null");
  lade_drei_spuren(x);
  const Live v = live_lauf(x, 128.0);
  PRUEF(v.ursprung > 0 && v.m.fehler.empty());
  const cdj::RenderAuftrag auf = auftrag(x, v, 128.0);
  // 2: Gegenprobe je Spur: eine Verschiebung um 1 Frame (bei gewarpten Spuren mit allen Markern) macht den Test rot
  for (int spur : {1, 2, 3}) {
    cdj::RenderAuftrag g = auf;
    g.gegenprobe_spur = spur;
    const cdj::RenderErgebnis r = cdj::rendere(g);
    const cdj::NullErgebnis e = vergleiche(v, r);
    std::printf("Fall 2 (Spur %d): %s rest %.1f dB\n", spur, cdj::null_urteil_text(e.urteil), e.rest_db);
    PRUEF(r.fehler.empty() && e.urteil == cdj::NullUrteil::rot);
  }
  // 3: Negativ-Kontrolle: ohne Regler-Stand rot
  {
    cdj::RenderAuftrag o = auf;
    o.regler = nullptr;
    PRUEF(vergleiche(v, cdj::rendere(o)).urteil == cdj::NullUrteil::rot);
  }
  PRUEF_ENDE();
}
