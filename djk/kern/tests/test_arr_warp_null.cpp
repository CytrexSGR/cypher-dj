// Paket 1.13 Warp, Slice 1 (AK12 Teil): Null-Test mit gewarpten Spuren. „Live“ ist ein Kern im Prozess (arr35::Lauf) mit einer
// Wiedergabe /2 (Spur 1: Rauschen als 125-BPM-Quelle gewarpt, Spur 2: Rauschen als 100-BPM-Quelle gewarpt, −6 dB, Start auf Beat 2,
// Spur 3: ungewarptes Rauschen als Kontrolle), Spur-Reglern über das Stellwerk und Loop-Klammer 0..8; sein Master wird wie im Betrieb
// über den Ring-Kopf mitgeschnitten. „Render“ ist rendere() mit dem Neustart-Fach des Live-Kerns. Erwartet (Form von test_nulltest):
//   1. bestanden mit Rest unter −120 dB (gemessen −145 dB, nicht bitgleich: D7) bei 128 und bei 120 BPM (der Warp folgt dem Projekttempo, Länge in Beats gleich);
//   2. Gegenprobe (eine gewarpte Spur um 1 Frame verschoben, die Marker mit) rot, für Spur 1 und für Spur 2; die ungewarpte Spur 3 auch;
//   3. Negativ-Kontrolle: der Render ohne Regler-Stand ist rot; die beiden Läufe sind nicht still (Signal > −20 dB).
// Mutation: RENDER_GEGENPROBE_WARP_BLIND (Fall 2 rot: die Gegenprobe fasst einen Warp nicht an und bleibt gleich).
// Slice 4 (AK12, BEATS): Fall 8, Spur 1 und 2 als BEATS: Rest unter −120 dB bei 128 und 120 BPM, Gegenprobe (Marker und Einheiten um einen Frame) rot; Mutation RENDER_GEGENPROBE_BEATS_BLIND (Fall 8 rot).
// Slice 2 (AK12): derselbe Aufbau mit Spur 1 in COMPLEX und Spur 2 in TONES (Warp-Werk, live synchron im Kern, im Render synchron): Fall 4 (Rest unter −90 dB bei 128 und
// 120 BPM, im ersten Durchlauf bis zur Loop-Naht; die Naht selbst deckt der Render nicht, er kennt keine Klammer: Plan D14), Fall 5 (Gegenprobe: die Marker um einen Frame verschoben macht Spur 1 und Spur 2 rot), Fall 6 (Negativ-Kontrolle: das Werk fehlt im Live-Lauf
// -> die Spuren spielen als RE-PITCH, der Render mit Werk weicht ab: rot).
// Slice 5 (AK12-Teil): Fall 7, Spur 1 COMPLEX +7 st und Spur 2 TONES -5 st (pitch im Auftrag): Rest unter −90 dB bei 128 und 120 BPM (gemessen −200 dB, bitgleich) und eine
// Gegenprobe (der Render bekommt eine Wiedergabe-Datei, in der Spur 1 um 10 ct höher steht): rot; beide Läufe sind nicht still.
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
#include "cypherdj/warp_werk.h"
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

void start_tempo(arr35::Lauf& x, double bpm, cdj::WarpWerk* werk = nullptr) {
  PRUEF(x.kern->sample() == 0);
  x.kern.reset(new cdj::Kern(bpm, x.ring, x.bef.get(), x.ere.get()));
  x.kern->verbinde_lader(x.lr.get());
  x.kern->setze_pruefmodus(false);
  if (werk) x.kern->setze_arr_warp_werk(werk);   // Slice 2: live synchron im Kern; der Render legt sein eigenes an
  x.vh = x.kern->mixer().limiter_vorhalt();
}

// Slice 5: pitch1/pitch2 sind die Tonhöhen-Faktoren der beiden Werk-Spuren (1: nicht geschrieben)
// Slice 4: beats macht aus beiden gewarpten Spuren BEATS (modus 1, Einheiten 1/16, Spur 1 Lücke vor Hülle 100, Spur 2 vor_zurueck Hülle 70)
std::string beats_clip(std::string clip, int einheiten, int64_t frames_je_einheit, int loop, int huelle) {
  std::string e = ",\"e\":[";
  for (int k = 0; k < einheiten; ++k) e += (k ? "," : "") + std::string("[") + std::to_string(k * 0.25) + "," + std::to_string(k * frames_je_einheit) + "]";
  e += "],\"loop\":" + std::to_string(loop) + ",\"huelle\":" + std::to_string(huelle);
  const size_t m = clip.find("\"modus\":0");
  if (m == std::string::npos) return clip;
  clip.replace(m, 9, "\"modus\":1" + e);
  return clip;
}

std::string drei_spuren_text(const arrdatei::Ordner& o, int modus1, int modus2, double pitch1, double pitch2, bool beats = false) {
  const std::string a = rauschen(o, 'd', 10 * FPB125);
  const std::string b = rauschen(o, 'e', 6 * FPB100);
  const std::string c = rauschen(o, 'f', 10 * 22500);
  std::string c1 = o.clip_warp("c1", 0.0, 9.0, a, 10 * FPB125, {{0.0, 0.0}, {9.0, 9.0 * FPB125}}, 0.0, modus1, pitch1);
  std::string c2 = o.clip_warp("c2", 2.0, 4.0, b, 6 * FPB100, {{0.0, 0.0}, {2.0, 2.0 * FPB100}, {5.0, 5.0 * 0.9 * FPB100}}, -6.0, modus2, pitch2);
  if (beats) {
    c1 = beats_clip(c1, 36, FPB125 / 4, 1, 100);   // 9 Beats in 1/16, die 125-BPM-Quelle
    c2 = beats_clip(c2, 16, FPB100 / 4, 2, 70);    // 4 Beats in 1/16, die 100-BPM-Quelle
  }
  return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + c1 + "]}," +
         "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + c2 + "]}," +
         "{\"nr\":3,\"art\":\"audio\",\"clips\":[" + o.clip("c3", 1.0, 5.0, c, 10 * 22500) + "]}";
}

void lade_drei_spuren(arr35::Lauf& x, int modus1 = 0, int modus2 = 0, double pitch1 = 1.0, double pitch2 = 1.0, bool beats = false) {
  x.laden(1, drei_spuren_text(x.ordner, modus1, modus2, pitch1, pitch2, beats), "andreas", true);
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

void fall1(const std::string& ab, double bpm, const char* name, int modus1 = 0, int modus2 = 0, double pitch1 = 1.0, double pitch2 = 1.0, bool beats = false) {
  std::unique_ptr<cdj::WarpWerk> werk;   // vor dem Lauf angelegt, danach abgebaut (der Kern hält nur den Zeiger)
  if (modus1 || modus2) {
    werk = cdj::warp_werk_neu({});
    PRUEF(werk != nullptr);
  }
  arr35::Lauf x(ab, name);
  start_tempo(x, bpm, werk.get());
  lade_drei_spuren(x, modus1, modus2, pitch1, pitch2, beats);
  const Live v = live_lauf(x, bpm);
  PRUEF(v.ursprung > 0 && v.m.fehler.empty());
  const cdj::RenderErgebnis r = cdj::rendere(auftrag(x, v, bpm));
  if (!r.fehler.empty()) std::printf("Render-Fehler: %s: %s\n", r.fehler.c_str(), r.meldung.c_str());
  PRUEF(r.fehler.empty() && r.regler > 0 && r.phase == 25);
  PRUEF(r.frames == std::llround(8.0 * 48000.0 * 60.0 / bpm));
  const cdj::NullErgebnis e = vergleiche(v, r);
  std::printf("Fall %s (%.1f BPM): %s rest %.1f dB, signal %.1f dB, verschoben %.1f dB, fenster %lld\n", beats ? "8" : (pitch1 != 1.0 || pitch2 != 1.0) ? "7" : (modus1 || modus2) ? "4" : "1", bpm,
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
  // ---- Slice 2 (AK12): Spur 1 COMPLEX, Spur 2 TONES
  fall1(ab.pfad, 128.0, "test_arr_warp_null_w128", cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES);
  fall1(ab.pfad, 120.0, "test_arr_warp_null_w120", cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES);
  {
    auto werk = cdj::warp_werk_neu({});
    PRUEF(werk != nullptr);
    arr35::Lauf y(ab.pfad, "test_arr_warp_null_w");
    start_tempo(y, 128.0, werk.get());
    lade_drei_spuren(y, cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES);
    const Live w = live_lauf(y, 128.0);
    PRUEF(w.ursprung > 0 && w.m.fehler.empty());
    const cdj::RenderAuftrag aw = auftrag(y, w, 128.0);
    // 5: Gegenprobe je Werk-Spur: die Marker einen Frame weiter in der Quelle -> rot
    for (int spur : {1, 2}) {
      cdj::RenderAuftrag g = aw;
      g.gegenprobe_spur = spur;
      const cdj::RenderErgebnis r = cdj::rendere(g);
      const cdj::NullErgebnis e = vergleiche(w, r);
      std::printf("Fall 5 (Werk-Spur %d): %s rest %.1f dB\n", spur, cdj::null_urteil_text(e.urteil), e.rest_db);
      PRUEF(r.fehler.empty() && e.urteil == cdj::NullUrteil::rot);
    }
    // 6: Negativ-Kontrolle: der Live-Lauf ohne Werk spielt COMPLEX und TONES als RE-PITCH; der Render (mit Werk) weicht ab
    arr35::Lauf z(ab.pfad, "test_arr_warp_null_wz");
    start_tempo(z, 128.0, nullptr);
    lade_drei_spuren(z, cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES);
    const Live ohne = live_lauf(z, 128.0);
    const cdj::NullErgebnis e6 = vergleiche(ohne, cdj::rendere(auftrag(z, ohne, 128.0)));
    std::printf("Fall 6 (Live ohne Werk gegen Render mit Werk): %s rest %.1f dB\n", cdj::null_urteil_text(e6.urteil), e6.rest_db);
    PRUEF(e6.urteil == cdj::NullUrteil::rot);
  }
  // ---- Slice 5 (AK12-Teil): Spur 1 COMPLEX +7 st, Spur 2 TONES -5 st
  constexpr double P_PLUS7 = 1.4983070768766815;    // 2^(7/12)
  constexpr double P_MINUS5 = 0.7491535384383408;   // 2^(-5/12)
  fall1(ab.pfad, 128.0, "test_arr_warp_null_p128", cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES, P_PLUS7, P_MINUS5);
  fall1(ab.pfad, 120.0, "test_arr_warp_null_p120", cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES, P_PLUS7, P_MINUS5);
  {
    // 7, Gegenprobe: der Live-Lauf spielt P_PLUS7, der Render bekommt eine Wiedergabe-Datei, in der Spur 1 um 10 ct höher steht -> rot
    // (der Render liest die Datei neu; der Kern hat seine Wiedergabe schon im Speicher). Negativ-Kontrolle: beide Läufe sind nicht still.
    auto werk = cdj::warp_werk_neu({});
    PRUEF(werk != nullptr);
    arr35::Lauf y(ab.pfad, "test_arr_warp_null_pg");
    start_tempo(y, 128.0, werk.get());
    lade_drei_spuren(y, cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES, P_PLUS7, P_MINUS5);
    const Live w = live_lauf(y, 128.0);
    PRUEF(w.ursprung > 0 && w.m.fehler.empty());
    const cdj::NullErgebnis gleich = vergleiche(w, cdj::rendere(auftrag(y, w, 128.0)));
    y.ordner.wiedergabe2_warp(1, drei_spuren_text(y.ordner, cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES, P_PLUS7 * std::pow(2.0, 10.0 / 1200.0), P_MINUS5));
    const cdj::RenderErgebnis rg = cdj::rendere(auftrag(y, w, 128.0));
    const cdj::NullErgebnis e = vergleiche(w, rg);
    std::printf("Fall 7 (Gegenprobe, Spur 1 um 10 ct): %s rest %.1f dB, signal %.1f dB (Kontrolle ohne Abweichung: %s rest %.1f dB)\n",
                cdj::null_urteil_text(e.urteil), e.rest_db, e.signal_db, cdj::null_urteil_text(gleich.urteil), gleich.rest_db);
    PRUEF(rg.fehler.empty() && e.urteil == cdj::NullUrteil::rot);
    PRUEF(e.signal_db > -20.0 && gleich.signal_db > -20.0);
  }
  // ---- Slice 4 (AK12, BEATS): Spur 1 und Spur 2 als BEATS (Raster 1/16, Lücke vor bzw. vor_zurueck, Hülle 100 bzw. 70), live im Kern gegen den Render
  fall1(ab.pfad, 128.0, "test_arr_warp_null_b128", 0, 0, 1.0, 1.0, true);
  fall1(ab.pfad, 120.0, "test_arr_warp_null_b120", 0, 0, 1.0, 1.0, true);
  {
    // 8, Gegenprobe: eine BEATS-Spur liest ihre Einheiten, nicht die Marker; die Verschiebung um 1 Frame muss auch die Einheiten treffen -> rot (Mutation
    // RENDER_GEGENPROBE_BEATS_BLIND: sie lässt die Einheiten stehen)
    arr35::Lauf y(ab.pfad, "test_arr_warp_null_bg");
    lade_drei_spuren(y, 0, 0, 1.0, 1.0, true);
    const Live w = live_lauf(y, 128.0);
    PRUEF(w.ursprung > 0 && w.m.fehler.empty());
    const cdj::RenderAuftrag aw = auftrag(y, w, 128.0);
    for (int spur : {1, 2}) {
      cdj::RenderAuftrag g = aw;
      g.gegenprobe_spur = spur;
      const cdj::RenderErgebnis r = cdj::rendere(g);
      const cdj::NullErgebnis e = vergleiche(w, r);
      std::printf("Fall 8 (BEATS-Spur %d): Gegenprobe %s rest %.1f dB\n", spur, cdj::null_urteil_text(e.urteil), e.rest_db);
      PRUEF(r.fehler.empty() && e.urteil == cdj::NullUrteil::rot);
    }
  }
  PRUEF_ENDE();
}
