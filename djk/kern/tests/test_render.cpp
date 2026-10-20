// Paket K3 (Spec D1 2.5, 6.20, 6.24, 6.25, A7): Werkzeuge des Exports neben dem Null-Test. rendere() lehnt ab: Wirt-Spur
// nicht eingefroren, Wiedergabe fehlt, Aufruf außerhalb der Grenzen; ein Freeze-Clip (eine eingefrorene Wirt-Spur kommt
// als Audio-Spur mit der Datei freeze-<spur>-<kennung>.f32 aus dem Arbeitsordner) wird gespielt. WAV float32: Schreiben
// und Lesen bitgleich, Kopf 58 Bytes, keine Temp-Datei übrig, fremdes Format abgelehnt. RingLeser: lückenlos über mehrere
// Lesungen, ueberlauf (Fix L6: schon ab CAP − 8192 + 1 Frames, der Block im Flug), sprung, ungueltig. Dazu:
//   5 (6.24): eine interne RB-338-Spur klingt im Render ohne senke_intern (die RB des Kerns, K2b), Spitze > −60 dBFS;
//   6 (6.20): ohne Neustart-Fach mit Regler-Quelle projekt: erz/4 neutral, darüber die Spur-Regler (−6,02 dB halbiert,
//     Mute schweigt); ohne beides bleibt erz/4 auf der Vorgabe −200 dB (still);
//   7 (6.25): lies_spur_regler nimmt nur spur/<1..8>/{fader,pan,mute,solo} in Kern-Einheiten, sonst Fehler;
//   8 (Fix 2/P4): schreibe_wav_f32 verschränkt in festen Stücken: beim Schreiben von 8 Mio. Frames (L und R 64 MB) wächst
//     die Spitze des Arbeitsspeichers (VmHWM nach clear_refs 5) um weniger als 8 MB, vorher um die ganze Kopie (64 MB);
//     die Datei bleibt bitgleich.
// Mutationen: RENDER_ERZ4_NICHT_NEUTRAL (Fall 6 rot: der Render bleibt still), ARR_OHNE_RB_SENKE (Fall 5 rot),
// RENDER_OHNE_OBERGRENZE (Fall 1 rot, Fix L3), RING_OHNE_MARGE (Fall 4 rot, Fix L6), WAV_ERSETZT (Fall 3 rot, Fix L9:
// ein vorhandenes Ziel wird nie ersetzt), WAV_GANZE_KOPIE (Fall 8 rot, Fix 2/P4: verschränkte Kopie des ganzen Exports).
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/render.h"
#include "cypherdj/ring_mitschnitt.h"
#include "cypherdj/wav.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace {

double db(float x) { return x > 0.0f ? 20.0 * std::log10(static_cast<double>(x)) : -200.0; }

// Neustart-Fach mit nur erz/4/fader 0 dB (sonst Vorgabe −200: der Render wäre still)
std::unique_ptr<cdj_z_echtzeit> fach_erz4() {
  auto f = std::make_unique<cdj_z_echtzeit>();
  f->n_regler = 1;
  std::snprintf(f->regler[0].pfad, sizeof f->regler[0].pfad, "erz/4/fader");
  f->regler[0].wert = 0.0f;
  return f;
}

// Fix 2/P4: Arbeitsspeicher des Prozesses aus /proc/self/status (kB), Feld VmRSS oder VmHWM; −1, wenn nicht lesbar
long status_kb(const char* feld) {
  std::ifstream f("/proc/self/status");
  std::string z;
  const size_t n = std::strlen(feld);
  while (std::getline(f, z))
    if (z.compare(0, n, feld) == 0 && z.size() > n && z[n] == ':') return std::atol(z.c_str() + n + 1);
  return -1;
}

// Spitze (VmHWM) auf den heutigen Stand zurücksetzen (Linux ab 4.0: clear_refs 5); false, wenn es nicht geht
bool spitze_zuruecksetzen() {
  std::ofstream f("/proc/self/clear_refs");
  f << "5";
  f.flush();
  return static_cast<bool>(f);
}

bool regler_datei(const std::string& pfad, const char* text, std::vector<cdj::SpurRegler>& v, std::string& fehler) {
  std::ofstream(pfad) << text;
  v.clear();
  return cdj::lies_spur_regler(pfad, v, fehler);
}

}  // namespace

int main() {
  arrdatei::Ordner o("test_render");
  // 1: rendere(): Ablehnungen
  {
    o.wiedergabe(1, "{\"nr\":1,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}");
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = 1;
    r.von_beat = 0.0;
    r.bis_beat = 4.0;
    r.bpm = 128.0;
    PRUEF(cdj::rendere(r).fehler == "wirt_nicht_eingefroren");
    r.nr = 2;
    PRUEF(cdj::rendere(r).fehler == "datei_fehlt");
    r.bis_beat = 0.5;
    PRUEF(cdj::rendere(r).fehler == "aufruf");
    r.bis_beat = 4.0;
    r.bpm = 250.0;
    PRUEF(cdj::rendere(r).fehler == "aufruf");
    // Fix L3: bis − von höchstens 2048 Beats. Die Grenze selbst geht durch die Prüfung (dann fehlt Wiedergabe 2), knapp
    // darüber und 1e9 sind Aufruffehler mit der Grenze im Text (vorher: 1e9 lief bis zum bad_alloc, Abbruch 134)
    r.bpm = 128.0;
    r.bis_beat = 2048.0;
    PRUEF(cdj::rendere(r).fehler == "datei_fehlt");
    r.bis_beat = 2048.0 + 1e-6;
    const cdj::RenderErgebnis g = cdj::rendere(r);
    PRUEF(g.fehler == "aufruf" && g.meldung.find("2048") != std::string::npos);
    r.von_beat = 10.0;
    r.bis_beat = 1e9;
    PRUEF(cdj::rendere(r).fehler == "aufruf");
    r.von_beat = 0.0;
    // der längste Export (2048 Beats bei 60 BPM, plus ein Beat Rundung) passt in den u32-Kopf der WAV-Datei
    PRUEF(cdj::RENDER_MAX_BEATS == 2048.0 && cdj::WAV_F32_MAX_FRAMES == 536870905LL);
    PRUEF((cdj::RENDER_MAX_BEATS + 1.0) * 48000.0 < static_cast<double>(cdj::WAV_F32_MAX_FRAMES));
  }
  // 2: Freeze-Clip aus dem Arbeitsordner: Gleichwert 0,25 ab Beat 0, Master ab dem Einsatz plus Vorhalt
  std::vector<float> kern_l;   // für Fall 6: derselbe Render mit Regler-Quelle kern
  {
    std::vector<float> d(2 * 4 * 22500, 0.25f);
    std::ofstream(o.pfad + "/freeze-3-9.f32", std::ios::binary)
        .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
    char clip[512];
    std::snprintf(clip, sizeof clip,
                  "{\"id\":\"s3/freeze\",\"start_beat\":0.0,\"laenge_beats\":4.0,\"sha256\":\"%s\",\"datei\":\"%s/freeze-3-9.f32\","
                  "\"frames\":90000,\"offset_frames\":0,\"gain_db\":0.0,\"ein_beats\":0.0,\"aus_beats\":0.0}",
                  std::string(64, 'c').c_str(), o.pfad.c_str());
    o.wiedergabe(3, std::string("{\"nr\":3,\"art\":\"audio\",\"clips\":[") + clip + "]}");
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = 3;
    r.von_beat = 0.0;
    r.bis_beat = 4.0;
    r.bpm = 128.0;
    const auto fach = fach_erz4();
    r.regler = fach.get();
    const cdj::RenderErgebnis e = cdj::rendere(r);
    PRUEF(e.fehler.empty() && e.regler == 1 && e.frames == 4 * 22500 && e.start_sample == 3 * 256 + 25);
    PRUEF(e.l.size() == 4 * 22500 && e.spitze > 0.1f && e.l[22500] > 0.1f);
    PRUEF(e.regler_quelle == "kern");
    kern_l = e.l;
    // 3: WAV schreiben und lesen, bitgleich; Kopf 58 Bytes; keine Temp-Datei
    const std::string w = o.pfad + "/export.wav";
    std::string fehler;
    PRUEF(cdj::schreibe_wav_f32(w, e.l, e.r, fehler));
    PRUEF(std::filesystem::file_size(w) == 58 + e.l.size() * 8);
    std::vector<float> l, rr;
    PRUEF(cdj::lies_wav_f32(w, l, rr, fehler) && l == e.l && rr == e.r);
    size_t teile = 0;
    for (const auto& x : std::filesystem::directory_iterator(o.pfad)) teile += x.path().string().find(".teil") != std::string::npos;
    PRUEF(teile == 0);
    // Fix L9: ein vorhandenes Ziel wird nie ersetzt: false mit besteht, Inhalt unverändert, keine Teil-Datei
    {
      const std::vector<float> kurz(10, 0.5f);
      bool besteht = false;
      const bool ersetzt = cdj::schreibe_wav_f32(w, kurz, kurz, fehler, &besteht);
      std::vector<float> l2, r2;
      PRUEF(!ersetzt && besteht && fehler.find("besteht") != std::string::npos);
      PRUEF(cdj::lies_wav_f32(w, l2, r2, fehler) && l2 == e.l);
      size_t teile2 = 0;
      for (const auto& x : std::filesystem::directory_iterator(o.pfad)) teile2 += x.path().string().find(".teil") != std::string::npos;
      PRUEF(teile2 == 0);
    }
    {  // PCM 16 bit statt float: abgelehnt
      const unsigned char k[] = {'R', 'I', 'F', 'F', 36, 0, 0, 0, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ', 16, 0, 0, 0, 1, 0, 2, 0,
                                 0x80, 0xBB, 0, 0, 0, 0xEE, 2, 0, 4, 0, 16, 0, 'd', 'a', 't', 'a', 0, 0, 0, 0};
      std::ofstream(o.pfad + "/fremd.wav", std::ios::binary).write(reinterpret_cast<const char*>(k), sizeof k);
    }
    PRUEF(!cdj::lies_wav_f32(o.pfad + "/fremd.wav", l, rr, fehler));
  }
  // 4: RingLeser
  {
    auto mem = std::make_unique<unsigned char[]>(CDJ_RING_BYTES);
    auto* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
    std::memset(ring, 0, CDJ_RING_KOPF);
    cdj::RingMitschnitt m;
    cdj::RingLeser kaputt(ring);
    PRUEF(!kaputt.lies(m) && m.fehler == "ungueltig");
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    float* d = cdj_ring_daten(ring);
    auto schreibe = [&](uint64_t von, uint64_t bis) {   // Frame f trägt f (L) und −f (R)
      for (uint64_t f = von; f < bis; ++f) {
        d[(f % CDJ_RING_CAP) * 4 + 0] = static_cast<float>(f);
        d[(f % CDJ_RING_CAP) * 4 + 1] = -static_cast<float>(f);
      }
      cdj_setze(&ring->w, bis);
    };
    cdj_setze(&ring->sample_minus_w, 1000);
    schreibe(0, 512);
    cdj::RingMitschnitt a;
    cdj::RingLeser l1(ring);
    PRUEF(l1.lies(a) && a.s0 == 1512 && a.grenze == 1512 && a.l.empty());
    schreibe(512, 1024);
    schreibe(1024, 4096);
    PRUEF(l1.lies(a) && a.l.size() == 3584 && a.l[0] == 512.0f && a.r[3583] == -4095.0f);
    schreibe(4096, 4096 + CDJ_RING_CAP + 1);
    PRUEF(!l1.lies(a) && a.fehler == "ueberlauf");
    cdj::RingMitschnitt b;
    cdj::RingLeser l2(ring);
    PRUEF(l2.lies(b));
    cdj_setze(&ring->sample_minus_w, 7);
    schreibe(4096 + CDJ_RING_CAP + 1, 4096 + CDJ_RING_CAP + 257);
    PRUEF(!l2.lies(b) && b.fehler == "sprung");
    // Fix L6: der Kern schreibt [w, w + n) vor dem Veröffentlichen von w + n und überschreibt dabei die Plätze der Frames
    // [w − CAP, w − CAP + n). Lesbar ist darum nur, was höchstens CAP − 8192 (ein Block der Höchstgröße) hinter w liegt:
    // genau so weit geht (Negativ-Kontrolle), ein Frame mehr ist ueberlauf (vorher bis CAP angenommen).
    cdj_setze(&ring->sample_minus_w, 1000);
    cdj::RingMitschnitt c;
    cdj::RingLeser l3(ring);
    PRUEF(l3.lies(c));
    const uint64_t w3 = cdj_lade(&ring->w);
    schreibe(w3, w3 + CDJ_RING_CAP - 8192);
    PRUEF(l3.lies(c) && c.l.size() == CDJ_RING_CAP - 8192);
    cdj::RingMitschnitt d4;
    cdj::RingLeser l4(ring);
    PRUEF(l4.lies(d4));
    const uint64_t w4 = cdj_lade(&ring->w);
    schreibe(w4, w4 + CDJ_RING_CAP - 8192 + 1);
    const bool l4_ok = l4.lies(d4);
    std::printf("Fall 4: CAP − 8192 + 1 Frames hinter w: %s\n", l4_ok ? "angenommen" : d4.fehler.c_str());
    PRUEF(!l4_ok && d4.fehler == "ueberlauf");
  }
  // 5 (Spec 6.24): interne RB-338-Spur ohne senke_intern: die RB des Kerns spielt sie
  {
    o.wiedergabe(5, "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.5},\"noten\":["
                    "{\"id\":\"c2/n1\",\"beat\":0.5,\"laenge\":0.5,\"ton\":36,\"vel\":100},"
                    "{\"id\":\"c2/n2\",\"beat\":2.0,\"laenge\":0.5,\"ton\":43,\"vel\":100}]}");
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = 5;
    r.von_beat = 0.0;
    r.bis_beat = 4.0;
    r.bpm = 128.0;
    const auto fach = fach_erz4();
    r.regler = fach.get();
    const cdj::RenderErgebnis e = cdj::rendere(r);
    std::printf("Fall 5: interne RB-Spur, Spitze %.1f dBFS, vor der ersten Note %.1f dBFS\n", db(e.spitze),
                db(e.l.empty() ? 0.0f : *std::max_element(e.l.begin(), e.l.begin() + 11000)));
    PRUEF(e.fehler.empty() && db(e.spitze) > -60.0);
    float vor = 0.0f;   // vor der ersten Note (Beat 0,5 = 11 250 Samples) still: die Stimme ruht bis zum Note-Ein
    for (size_t i = 0; i < 11000 && i < e.l.size(); ++i) vor = std::max(vor, std::fabs(e.l[i]));
    PRUEF(vor == 0.0f);
  }
  // 6 (Spec 6.20): ohne Neustart-Fach, Regler-Quelle projekt
  {
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = 3;
    r.von_beat = 0.0;
    r.bis_beat = 4.0;
    r.bpm = 128.0;
    r.regler_projekt = true;
    const cdj::RenderErgebnis neutral = cdj::rendere(r);   // erz/4 neutral, alle Spur-Regler auf der Vorgabe
    std::printf("Fall 6: projekt ohne Spur-Regler Spitze %.1f dBFS\n", db(neutral.spitze));
    PRUEF(neutral.fehler.empty() && neutral.regler_quelle == "projekt" && neutral.regler == 0);
    PRUEF(db(neutral.spitze) > -60.0 && neutral.l == kern_l);   // gleich dem Render mit erz/4/fader 0 aus dem Fach
    r.spur_regler = {{"spur/3/fader", -6.0206f}, {"spur/3/pan", 0.0f}};
    const cdj::RenderErgebnis halb = cdj::rendere(r);
    PRUEF(halb.fehler.empty() && halb.regler == 2 && halb.regler_quelle == "projekt");
    PRUEF(neutral.l.size() == halb.l.size() && std::fabs(halb.l[22500] / neutral.l[22500] - 0.5f) < 1e-3f);
    std::printf("Fall 6: spur/3/fader -6.02 dB: Verhältnis %.5f\n", halb.l[22500] / neutral.l[22500]);
    r.spur_regler = {{"spur/3/mute", 1.0f}};
    const cdj::RenderErgebnis stumm = cdj::rendere(r);
    PRUEF(stumm.fehler.empty() && stumm.spitze == 0.0f);
    r.spur_regler = {{"spur/3/fader", 7.0f}};   // außerhalb −200..+6: abgelehnt, kein stilles Klemmen
    PRUEF(cdj::rendere(r).fehler == "regler");
    // Negativ-Kontrolle: weder Fach noch projekt: erz/4 bleibt auf der Vorgabe −200 dB, der Render ist still
    cdj::RenderAuftrag ohne = r;
    ohne.regler_projekt = false;
    ohne.spur_regler.clear();
    const cdj::RenderErgebnis still = cdj::rendere(ohne);
    PRUEF(still.fehler.empty() && still.spitze == 0.0f && still.regler_quelle.empty());
  }
  // 7 (Spec 6.25): Spur-Regler-Datei, ein Objekt Pfad -> Wert in Kern-Einheiten
  {
    const std::string p = o.pfad + "/spur_regler.json";
    std::vector<cdj::SpurRegler> v;
    std::string fehler;
    PRUEF(regler_datei(p, "{\"spur/1/fader\":-3.5,\"spur/1/pan\":-1,\"spur/8/mute\":1,\"spur/2/solo\":0}", v, fehler));
    PRUEF(v.size() == 4 && v[0].pfad == "spur/1/fader" && v[0].wert == -3.5f);
    PRUEF(regler_datei(p, "{}", v, fehler) && v.empty());
    PRUEF(!regler_datei(p, "{\"spur/1/fader\":", v, fehler));             // kein JSON
    PRUEF(!regler_datei(p, "[1,2]", v, fehler));                          // kein Objekt
    PRUEF(!regler_datei(p, "{\"spur/9/fader\":0}", v, fehler));           // Spur 1..8
    PRUEF(!regler_datei(p, "{\"erz/4/fader\":0}", v, fehler));            // nur Spur-Regler
    PRUEF(!regler_datei(p, "{\"spur/1/fader\":6.5}", v, fehler));         // −200..+6
    PRUEF(!regler_datei(p, "{\"spur/1/pan\":-1.5}", v, fehler));          // −1..+1
    PRUEF(!regler_datei(p, "{\"spur/1/mute\":0.5}", v, fehler));          // 0 oder 1
    PRUEF(!regler_datei(p, "{\"spur/1/fader\":\"0\"}", v, fehler));       // Zahl
    PRUEF(!cdj::lies_spur_regler(o.pfad + "/gibtsnicht.json", v, fehler) && !fehler.empty());
  }
  // 8 (Fix 2/P4): Schreiben ohne Kopie des ganzen Exports. Vorher legte schreibe_wav_f32 L und R verschränkt in einen
  // zweiten Vektor (beim größten Export 786 MB zusätzlich; cypherdj-render 2048 Beats bei 60 BPM: 1,58 GB Spitze).
  {
    const size_t frames = 8u << 20;   // 8 388 608 Frames, L und R zusammen 64 MB
    std::vector<float> l(frames), r(frames);
    for (size_t i = 0; i < frames; ++i) {   // jede Seite berührt; Werte, an denen eine Vertauschung auffiele
      l[i] = static_cast<float>(i % 1000) * 0.001f;
      r[i] = -static_cast<float>(i % 777) * 0.001f;
    }
    const std::string w = o.pfad + "/gross.wav";
    std::string fehler;
    const long rss0 = status_kb("VmRSS");
    const bool zurueck = spitze_zuruecksetzen();
    const long hwm0 = status_kb("VmHWM");
    const bool ok = cdj::schreibe_wav_f32(w, l, r, fehler);
    const long hwm1 = status_kb("VmHWM");
    const long zuwachs = hwm1 - std::max(rss0, hwm0);
    std::printf("Fall 8: %zu Frames (L+R %zu kB), VmRSS vorher %ld kB, VmHWM nach dem Zurücksetzen %ld kB, nach dem "
                "Schreiben %ld kB: Zuwachs %ld kB\n",
                frames, frames * 8 / 1024, rss0, hwm0, hwm1, zuwachs);
    PRUEF(ok && zurueck && rss0 > 0 && hwm0 > 0 && hwm0 <= rss0 + 1024);   // das Instrument misst ab hier
    PRUEF(zuwachs >= 0 && zuwachs < 8 * 1024);   // vorher rund 64 MB (die ganze Kopie)
    PRUEF(std::filesystem::file_size(w) == 58 + frames * 8);
    std::vector<float> l2, r2;
    PRUEF(cdj::lies_wav_f32(w, l2, r2, fehler) && l2 == l && r2 == r);
    std::filesystem::remove(w);
    // Positiv-Kontrolle des Instruments: eine Kopie von L im Fenster muss als Zuwachs um ihre Größe erscheinen
    spitze_zuruecksetzen();
    const long hwm2 = status_kb("VmHWM");
    std::vector<float> kopie(l);
    const long hwm3 = status_kb("VmHWM");
    std::printf("Fall 8 Gegenprobe: Kopie von L (%zu kB) im Fenster: Zuwachs %ld kB\n", frames * 4 / 1024, hwm3 - hwm2);
    PRUEF(kopie.size() == frames && hwm3 - hwm2 > static_cast<long>(frames * 4 / 1024) * 9 / 10);
  }
  PRUEF_ENDE();
}
