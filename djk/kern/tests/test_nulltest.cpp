// Paket K3 (Spec D1 A7, 2.5, 6.20, 6.24): Null-Test am Offline-Kern. „Live“ ist ein Kern im Prozess (arr35::Lauf) mit
// Wiedergabe (zwei Audio-Spuren aus Rauschen, eine interne Spur auf der RB-338 des Kerns, K2b), Spur-Reglern über das
// Stellwerk und Loop-Klammer 0..8; sein Master wird wie im Betrieb über den Ring-Kopf (sample_minus_w) mitgeschnitten,
// ausgerichtet über das Einsatz-Sample (Quittung 2, wie /zustand/arr ursprung_sample). „Render“ ist rendere() mit dem
// Neustart-Fach des Live-Kerns (abbild); auch dort spielt die RB-338 des Kerns die interne Spur. Erwartet:
//   1. bestanden mit Rest −200 dB (bitgleich), Blockphase live = Render = 25, bei 128, 124 und 97,3 BPM (gebrochene
//      Samples je Beat) und bei 124 BPM nach 10^7 Samples Leerlauf (hohes Kern-Sample, Risiko 1);
//   2. Gegenprobe (Spur 1 um 1 Sample verschoben) rot;
//   3. Negativ-Kontrolle: Render ohne Regler-Stand rot; Stille in beiden Läufen ungültig. Dazu Spec 6.20: Regler-Quelle
//      projekt mit denselben Spur-Reglern wie live bestanden (erz/4 neutral wie beim Live-Kern);
//   4. Start live mit Quant 1: Blockphase ≠ 25 (das Werkzeug erklärt den Test dann für ungültig);
//   5. Vorbedingungen: erfüllt am Live-Fach; Verstöße für Tempo, Metronom, FX an master, erz/1-Fader, erz/4-EQ.
// Mutationen: RENDER_OHNE_VORHALT (Fall 1 rot), NULL_OHNE_NAHTRAND (Fall 1 rot: die Kurzblende der Naht im Fenster).
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

// Rauschen (feste Folge), Spitze 0,2: jede Verschiebung um 1 Sample ist im Rest sichtbar; z ist ein Hex-Zeichen (sha256)
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

double spb_von(double bpm) { return 48000.0 * 60.0 / bpm; }

// Der Prüfaufbau startet seinen Kern mit 128 BPM; für ein anderes Projekttempo vor dem ersten Zyklus durch einen Kern mit
// diesem Start-Tempo ersetzen (wie der Dienst, der mit dem Projekttempo läuft). Der Befehl erz/4/fader 0 aus dem Aufbau
// liegt noch im Befehlsring und kommt beim neuen Kern an.
void start_tempo(arr35::Lauf& x, double bpm) {
  PRUEF(x.kern->sample() == 0);
  x.kern.reset(new cdj::Kern(bpm, x.ring, x.bef.get(), x.ere.get()));
  x.kern->verbinde_lader(x.lr.get());
  x.kern->setze_pruefmodus(false);
  x.vh = x.kern->mixer().limiter_vorhalt();
}

// Wiedergabe 1: Spur 1 Rauschen 0..9, Spur 2 Rauschen 2..6 (−6 dB), Spur 3 intern RB-338 mit zwei Noten
void lade_drei_spuren(arr35::Lauf& x, double bpm) {
  const int64_t spb = static_cast<int64_t>(std::ceil(spb_von(bpm)));
  const std::string a = rauschen(x.ordner, 'd', 9 * spb + 1);
  const std::string b = rauschen(x.ordner, 'e', 4 * spb + 1);
  const std::string spuren =
      "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 9.0, a, 9 * spb + 1) + "]}," +
      "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c2", 2.0, 4.0, b, 4 * spb + 1, 0, -6.0) + "]}," +
      "{\"nr\":3,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.4},\"noten\":["
      "{\"id\":\"m/n1\",\"beat\":1.0,\"laenge\":0.5,\"ton\":36,\"vel\":100},"
      "{\"id\":\"m/n2\",\"beat\":3.25,\"laenge\":0.5,\"ton\":38,\"vel\":100}]}";
  x.laden(1, spuren);
  x.teil("spur/2/fader", -3.0f, 0.0, 0.0);
  x.teil("spur/1/pan", 0.3f, 0.0, 0.0);
  x.loop(true, 0.0, 8.0);
}

struct Live {
  cdj::RingMitschnitt m;
  int64_t ursprung = -1;
  std::unique_ptr<cdj_z_echtzeit> fach{new cdj_z_echtzeit()};
};

// Live-Lauf: Leerlauf, dann Start (Quant quant) bei Beat 0, mitgeschnitten bis 10 Beats nach dem Einsatz
Live live_lauf(arr35::Lauf& x, int quant, double bpm = 128.0) {
  Live v;
  const int64_t spb = static_cast<int64_t>(std::ceil(spb_von(bpm)));
  cdj::RingLeser leser(x.ring);
  x.lauf(x.kern->sample() + 37 * N);
  PRUEF(leser.lies(v.m));
  const int64_t id = x.start(0.0, quant);
  const int64_t frist = x.kern->sample() + 20 * spb;   // ohne Einsatz (nicht geladen) endet die Schleife hier
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
  return cdj::null_vergleich(v.m.l.data() + ab, v.m.r.data() + ab, n_live, r.l.data(), r.r.data(),
                             static_cast<int64_t>(r.l.size()), r.frames);
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

// Fall 1 an einem eigenen Live-Kern mit Start-Tempo bpm, optional nach leerlauf Samples
void fall1(const std::string& ab, double bpm, int64_t leerlauf, const char* name) {
  arr35::Lauf x(ab, name);
  start_tempo(x, bpm);
  lade_drei_spuren(x, bpm);
  if (leerlauf > 0) x.lauf(leerlauf);
  const Live v = live_lauf(x, 0, bpm);
  PRUEF(v.ursprung > 0 && v.m.fehler.empty());
  const cdj::RenderErgebnis r = cdj::rendere(auftrag(x, v, bpm));
  PRUEF(r.fehler.empty() && r.regler > 0 && r.phase == 25);
  PRUEF(r.frames == std::llround(8.0 * spb_von(bpm)));
  PRUEF(cdj::null_phase(v.ursprung, v.m.grenze, N) == r.phase);
  const cdj::NullErgebnis e = vergleiche(v, r);
  std::printf("Fall 1 (%.1f BPM, Einsatz bei Kern-Sample %lld): %s rest %.1f dB, signal %.1f dB, verschoben %.1f dB, "
              "fenster %lld\n",
              bpm, (long long)v.ursprung, cdj::null_urteil_text(e.urteil), e.rest_db, e.signal_db, e.verschoben_db,
              (long long)e.fenster);
  PRUEF(e.urteil == cdj::NullUrteil::bestanden && e.rest_db == -200.0 && e.fenster == r.frames - 480 && e.signal_db > -20.0);
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_nulltest");
  arr35::Lauf x(ab.pfad, "test_nulltest");
  lade_drei_spuren(x, 128.0);
  const Live v = live_lauf(x, 0);
  PRUEF(v.ursprung > 0 && v.m.fehler.empty());
  const cdj::RenderAuftrag auf = auftrag(x, v, 128.0);
  // 1: bestanden, Blockphase gleich; dazu gebrochene Samples je Beat und ein hohes Kern-Sample
  {
    const cdj::RenderErgebnis r = cdj::rendere(auf);
    PRUEF(r.fehler.empty() && r.frames == 8 * 22500 && r.regler > 0 && r.phase == 25);
    PRUEF(cdj::null_phase(v.ursprung, v.m.grenze, N) == r.phase);
    const cdj::NullErgebnis e = vergleiche(v, r);
    std::printf("Fall 1: %s rest %.1f dB, signal %.1f dB, verschoben %.1f dB, fenster %lld\n", cdj::null_urteil_text(e.urteil),
                e.rest_db, e.signal_db, e.verschoben_db, (long long)e.fenster);
    PRUEF(e.urteil == cdj::NullUrteil::bestanden && e.rest_db == -200.0 && e.fenster == 8 * 22500 - 480 && e.signal_db > -20.0);
    // die interne Spur trägt zum Vergleich bei: ohne sie (Spur 3 stumm) weicht der Render ab
    float rb = 0.0f;
    for (size_t i = 0; i < r.l.size(); ++i) rb = std::max(rb, std::fabs(r.l[i]));
    cdj::RenderAuftrag ohne_rb = auf;
    ohne_rb.regler = nullptr;
    ohne_rb.regler_projekt = true;
    ohne_rb.spur_regler = {{"spur/2/fader", -3.0f}, {"spur/1/pan", 0.3f}, {"spur/3/mute", 1.0f}};
    const cdj::NullErgebnis s = vergleiche(v, cdj::rendere(ohne_rb));
    std::printf("Fall 1: Spur 3 (RB-338) stumm im Render: %s rest %.1f dB\n", cdj::null_urteil_text(s.urteil), s.rest_db);
    PRUEF(s.urteil == cdj::NullUrteil::rot);
  }
  fall1(ab.pfad, 124.0, 0, "test_nulltest_124");
  fall1(ab.pfad, 97.3, 0, "test_nulltest_97");
  fall1(ab.pfad, 124.0, 10'000'000, "test_nulltest_124_hoch");
  // 2: Gegenprobe: Spur 1 um 1 Sample verschoben macht den Test rot
  {
    cdj::RenderAuftrag g = auf;
    g.gegenprobe_spur = 1;
    const cdj::RenderErgebnis r = cdj::rendere(g);
    const cdj::NullErgebnis e = vergleiche(v, r);
    std::printf("Fall 2: %s rest %.1f dB\n", cdj::null_urteil_text(e.urteil), e.rest_db);
    PRUEF(r.fehler.empty() && e.urteil == cdj::NullUrteil::rot);
    cdj::RenderAuftrag ohne = auf;
    ohne.gegenprobe_spur = 3;   // interne Spur: keine Audio-Clips
    PRUEF(cdj::rendere(ohne).fehler == "gegenprobe");
  }
  // 3: Negativ-Kontrollen: ohne Regler-Stand (erz/4 auf der Vorgabe −200 dB, Spur 2 auf 0 dB) rot; Stille ungültig.
  //    Spec 6.20: Regler-Quelle projekt mit den Spur-Reglern des Live-Laufs: bestanden
  {
    cdj::RenderAuftrag o = auf;
    o.regler = nullptr;
    const cdj::NullErgebnis e = vergleiche(v, cdj::rendere(o));
    PRUEF(e.urteil == cdj::NullUrteil::rot);
    cdj::RenderAuftrag p = auf;
    p.regler = nullptr;
    p.regler_projekt = true;
    p.spur_regler = {{"spur/2/fader", -3.0f}, {"spur/1/pan", 0.3f}};
    const cdj::RenderErgebnis rp = cdj::rendere(p);
    const cdj::NullErgebnis ep = vergleiche(v, rp);
    std::printf("Fall 3: Regler-Quelle %s: %s rest %.1f dB\n", rp.regler_quelle.c_str(), cdj::null_urteil_text(ep.urteil),
                ep.rest_db);
    PRUEF(rp.regler_quelle == "projekt" && ep.urteil == cdj::NullUrteil::bestanden);
    const std::vector<float> null(8 * 22500, 0.0f);
    const cdj::NullErgebnis s = cdj::null_vergleich(null.data(), null.data(), 8 * 22500, null.data(), null.data(),
                                                    8 * 22500, 8 * 22500 - 1);
    PRUEF(s.urteil == cdj::NullUrteil::ungueltig && s.ursache == "stille");
    const cdj::NullErgebnis k = cdj::null_vergleich(null.data(), null.data(), 100, null.data(), null.data(), 100, 400);
    PRUEF(k.urteil == cdj::NullUrteil::ungueltig && k.ursache == "fenster");
  }
  // 4: Live-Start mit Quant 1 (auf dem Kern-Beat): Blockphase weicht von 25 ab
  {
    arr35::Lauf y(ab.pfad, "test_nulltest_q1");
    y.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + y.ordner.clip("c1", 0.0, 4.0, rauschen(y.ordner, 'f', 4 * 22500),
                                                                           4 * 22500) + "]}");
    const Live w = live_lauf(y, 1);
    PRUEF(w.ursprung % 22500 == 0 && cdj::null_phase(w.ursprung, w.m.grenze, N) != 25);
  }
  // 5: Vorbedingungen am Neustart-Fach
  {
    const cypherdj::stellwerk::ReglerTabelle& tab = x.kern->stellwerk().tabelle();
    const std::vector<std::string> ok = cdj::null_vorbedingungen(*v.fach, tab, 128.0, false, false);
    for (const std::string& s : ok) std::printf("Verstoß: %s\n", s.c_str());
    PRUEF(ok.empty());
    PRUEF(cdj::null_vorbedingungen(*v.fach, tab, 120.0, false, false).size() == 1);
    PRUEF(cdj::null_vorbedingungen(*v.fach, tab, 128.0, true, false).size() == 1);
    const std::vector<std::string> fx = cdj::null_vorbedingungen(*v.fach, tab, 128.0, false, true);
    PRUEF(fx.size() == 1 && fx[0].find("FX") == 0);
    x.teil("erz/1/fader", -10.0f, 0.0, 0.0);
    x.teil("erz/4/eq/tief", -3.0f, 0.0, 0.0);
    x.lauf(x.kern->sample() + 4 * N);
    auto f = std::make_unique<cdj_z_echtzeit>();
    x.kern->abbild(*f);
    const std::vector<std::string> zwei = cdj::null_vorbedingungen(*f, tab, 128.0, false, false);
    PRUEF(zwei.size() == 2 && zwei[0].find("erz/1/fader") == 0 && zwei[1].find("erz/4/eq/tief") == 0);
  }
  PRUEF_ENDE();
}
