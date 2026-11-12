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
//   12 (1.10 slice 4a T6): ins/komp/<n>/* are accepted by the render (range of the table), instance 13, ins/eq, an unknown name or a value out of range give "regler";
//   9 (1.10 Slice 1): Render mit Gruppen und PM-Fader aus der Regler-Datei;
//   10 (1.10 Slice 2, AK18): --abgriff produktion trägt die ungebremste Spitze (ueber_decke), set hält die Decke; limiter_db_max meldet den Eingriff;
//     leise: set ist der Abgriff durch den erz/4-Isolator (Nachzug N7), um den Vorhalt ausgerichtet, unter −90 dBFS.
// Mutationen: RENDER_ERZ4_NICHT_NEUTRAL (Fall 6 rot: der Render bleibt still), ARR_OHNE_RB_SENKE (Fall 5 rot),
// RENDER_OHNE_OBERGRENZE (Fall 1 rot, Fix L3), RING_OHNE_MARGE (Fall 4 rot, Fix L6), WAV_ERSETZT (Fall 3 rot, Fix L9:
// ein vorhandenes Ziel wird nie ersetzt), WAV_GANZE_KOPIE (Fall 8 rot, Fix 2/P4: verschränkte Kopie des ganzen Exports).
// Von Hand geprüft (Task 19, nicht in CMake): `if (pm)` → `if (false)` in der Kopierschleife macht Fall 10 rot; CYPHERDJ_MUTATION_RENDER_OHNE_VORHALT ebenso (Isolator-Vergleich).
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <vector>

#include <cypherdj/dsp/isolator.h>

#include "arr_file.h"
#include "cypherdj/render.h"
#include "cypherdj/ring_capture.h"
#include "cypherdj/wav.h"
#include "cypherdj/state.h"
#include "check.h"

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
    {  // 1.9 U6 T6.4: a rack with a Surge member is refused like a Wirt track (the render has no host); a rack without one is not refused for that
      o.wiedergabe2_warp(31, "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rack\",\"kette\":0,\"glieder\":["
                       "{\"id\":\"a\",\"art\":\"intern\",\"geraet\":\"rb338\"},{\"id\":\"s\",\"art\":\"wirt\",\"slot\":1}],\"noten\":[]}");
      o.wiedergabe2_warp(32, "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rack\",\"kette\":0,\"glieder\":["
                       "{\"id\":\"a\",\"art\":\"intern\",\"geraet\":\"rb338\"}],\"noten\":[]}");
      cdj::RenderAuftrag q = r;
      q.nr = 31;
      const cdj::RenderErgebnis surge = cdj::rendere(q);
      std::printf("rack with a Surge member: error '%s' (%s)\n", surge.fehler.c_str(), surge.meldung.c_str());
      PRUEF(surge.fehler == "wirt_nicht_eingefroren" && surge.meldung.find("Surge") != std::string::npos);
      q.nr = 32;
      PRUEF(cdj::rendere(q).fehler != "wirt_nicht_eingefroren");   // negative control: a rack of internal members passes the gate
    }
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
    PRUEF(e.fehler.empty() && e.regler == 1 && e.frames == 4 * 22500 && e.start_sample == 3 * 256);
    PRUEF(e.l.size() == 4 * 22500 && e.spitze > 0.1f && e.l[22500] > 0.1f);
    PRUEF(e.regler_quelle == "kern");
    kern_l = e.l;
    // 1.15 A5b (D8): with the bus limiters built the whole mix is L samples later; the export is aligned with vorhalt + L, so the clip lands on the same
    // export sample as without them (and the reported vorhalt carries L). Mutation RENDER_OHNE_KANAL_LATENZ (aligned with the master limiter only) turns it red.
    for (const auto& lim : {std::pair<double, bool>{0.5, false}, {0.5, true}, {1.5, false}}) {
      cdj::RenderAuftrag r2 = r;
      r2.kanal_limiter_vorhalt_ms = lim.first;
      r2.kanal_limiter_echtspitze = lim.second;
      const cdj::RenderErgebnis e2 = cdj::rendere(r2);
      const int L = lim.first == 0.5 ? (lim.second ? 38 : 26) : 74;
      PRUEF(e2.fehler.empty() && e2.vorhalt == e.vorhalt + L && e2.start_sample == e.start_sample);
      PRUEF(e2.l.size() == e.l.size());
      long erster0 = -1, erster1 = -1;
      double d = 0.0;
      for (size_t i = 0; i < e.l.size() && i < e2.l.size(); ++i) {
        if (erster0 < 0 && std::fabs(e.l[i]) > 0.05f) erster0 = static_cast<long>(i);
        if (erster1 < 0 && std::fabs(e2.l[i]) > 0.05f) erster1 = static_cast<long>(i);
        d = std::fmax(d, std::fabs(static_cast<double>(e2.l[i]) - e.l[i]));
      }
      std::printf("render with bus limiters (%.1f ms, true peak %d): vorhalt %d (+%d), first sample above 0.05 at %ld (without: %ld), largest difference %.2e\n", lim.first,
                  lim.second ? 1 : 0, e2.vorhalt, e2.vorhalt - e.vorhalt, erster1, erster0, d);
      PRUEF(erster0 >= 0 && erster1 == erster0);
      PRUEF(d < 1e-6);
    }
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
  // 12 (1.10 slice 4a T6, AK-S4-12): the insert rows ins/komp/<1..12>/* are project mixer controls of the render: accepted with their range from the table,
  // refused with "regler" outside the table (instance 13, an instance beyond the eq or saett pool, a value out of range), and in the controls file
  {
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = 3;
    r.von_beat = 0.0;
    r.bis_beat = 4.0;
    r.bpm = 128.0;
    r.regler_projekt = true;
    r.spur_regler = {{"ins/komp/1/schwelle", -30.0f}, {"ins/komp/12/ratio", 8.0f}, {"ins/komp/1/an", 1.0f}};
    const cdj::RenderErgebnis mit = cdj::rendere(r);
    std::printf("Fall 12: ins/komp/1/schwelle, 12/ratio, 1/an: Fehler '%s', Regler %d\n", mit.fehler.c_str(), mit.regler);
    PRUEF(mit.fehler.empty() && mit.regler == 3 && mit.regler_quelle == "projekt");
    // slice 4b: eq and saett rows are table rows too (accepted with their ranges); the first instance beyond each pool and a band out of range are refused
    r.spur_regler = {{"ins/eq/1/b8/gain", 6.0f}, {"ins/eq/1/an", 1.0f}, {"ins/saett/1/drive", 20.0f}, {"ins/saett/1/an", 1.0f}};
    const cdj::RenderErgebnis eqs = cdj::rendere(r);
    std::printf("Fall 12: eq and saett rows: Fehler '%s', Regler %d\n", eqs.fehler.c_str(), eqs.regler);
    PRUEF(eqs.fehler.empty() && eqs.regler == 4);
    for (const char* pfad : {"ins/komp/13/schwelle", "ins/komp/0/schwelle", "ins/eq/9/an", "ins/saett/5/an", "ins/lim/3/an", "ins/utility/9/an", "ins/utility/1/zz", "ins/eq/1/b9/gain", "ins/eq/1/b8/gain/x", "ins/komp/1/zz"}) {
      r.spur_regler = {{pfad, 0.0f}};
      const cdj::RenderErgebnis e = cdj::rendere(r);
      std::printf("Fall 12: %s: Fehler '%s'\n", pfad, e.fehler.c_str());
      PRUEF(e.fehler == "regler");
    }
    r.spur_regler = {{"ins/komp/1/schwelle", 5.0f}};   // -60..0
    PRUEF(cdj::rendere(r).fehler == "regler");
    r.spur_regler = {{"ins/komp/1/an", 0.5f}};         // switch: 0 or 1 (integer)
    PRUEF(cdj::rendere(r).fehler == "regler");
    const std::string p = o.pfad + "/spur_regler_ins.json";
    std::vector<cdj::SpurRegler> v;
    std::string fehler;
    PRUEF(regler_datei(p, "{\"ins/komp/1/schwelle\":-30,\"ins/komp/12/sc\":2,\"ins/komp/3/an\":1}", v, fehler) && v.size() == 3);
    PRUEF(!regler_datei(p, "{\"ins/komp/13/schwelle\":-30}", v, fehler));
    PRUEF(!regler_datei(p, "{\"ins/komp/1/sc\":33}", v, fehler));
    // negative control: the old families are untouched, an unknown family prefix is no mixer control
    r.spur_regler = {{"spur/3/fader", -6.0206f}};
    PRUEF(cdj::rendere(r).fehler.empty());
    r.spur_regler = {{"erz/4/fader", 0.0f}};
    PRUEF(cdj::rendere(r).fehler == "regler");
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
    PRUEF(!regler_datei(p, ("{\"spur/" + std::to_string(cdj::ARR_SPUREN + 1) + "/fader\":0}").c_str(), v, fehler));   // n+1 (T09)
    PRUEF(!regler_datei(p, "{\"erz/4/fader\":0}", v, fehler));            // nur Spur-Regler
    PRUEF(!regler_datei(p, "{\"spur/1/fader\":6.5}", v, fehler));         // −200..+6
    PRUEF(!regler_datei(p, "{\"spur/1/pan\":-1.5}", v, fehler));          // −1..+1
    PRUEF(!regler_datei(p, "{\"spur/1/mute\":0.5}", v, fehler));          // 0 oder 1
    PRUEF(!regler_datei(p, "{\"spur/1/fader\":\"0\"}", v, fehler));       // Zahl
    PRUEF(!cdj::lies_spur_regler(o.pfad + "/gibtsnicht.json", v, fehler) && !fehler.empty());
    // 1.10: Gruppen-Regler und PM-Fader sind Mixer-Regler des Projekts; Grenzen der Tabelle gelten
    PRUEF(regler_datei(p, "{\"grp/1/fader\":-6,\"grp/8/pan\":0.5,\"grp/2/mute\":1,\"grp/3/solo\":0,\"grp/16/pan\":0.25,\"pm/fader\":-1.5}", v, fehler) && v.size() == 6);
    PRUEF(!regler_datei(p, "{\"grp/17/fader\":0}", v, fehler));        // n+1
    PRUEF(!regler_datei(p, "{\"grp/1/send/5\":0}", v, fehler));       // r+1 (the group sends exist since slice 3: grp/n/send/1..4)
    // 1.10 slice 3: send, return and hall controls are project mixer controls; the table checks their ranges
    PRUEF(regler_datei(p, "{\"spur/1/send/1\":-6,\"grp/2/send/4\":-200,\"ret/1/fader\":-3,\"ret/4/pan\":0.5,\"ret/2/mute\":1,\"ret/3/hall/an\":0,\"ret/1/hall/decay\":0.8}", v, fehler) && v.size() == 7);
    PRUEF(!regler_datei(p, "{\"spur/1/send/5\":0}", v, fehler));     // r+1
    PRUEF(!regler_datei(p, "{\"ret/5/fader\":0}", v, fehler));       // r+1
    PRUEF(!regler_datei(p, "{\"ret/1/hall/mix\":0.5}", v, fehler));  // no such control
    PRUEF(!regler_datei(p, "{\"ret/1/hall/decay\":1.5}", v, fehler));   // 0..1
    PRUEF(!regler_datei(p, "{\"ret/1/hall/an\":0.5}", v, fehler));   // switch: 0 or 1
    PRUEF(!regler_datei(p, "{\"pm/fader\":6.5}", v, fehler));          // −200..+6
    PRUEF(!regler_datei(p, "{\"pm/pan\":0}", v, fehler));
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
  // 9 (1.10 Slice 1): Render mit Wiedergabe /2, zwei Spuren in Gruppe 1: Gruppen-Fader −6,02 dB halbiert den Export, PM-Fader ebenso
  {
    const std::string h = o.audio('a', 300000, 0.25f);
    const std::string clip = o.clip("c1", 0.0, 4.0, h, 300000);
    o.wiedergabe2(9, "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + clip + "]},"
                     "{\"nr\":2,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + clip + "]}",
                  "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}");
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = 9;
    r.von_beat = 0.0;
    r.bis_beat = 4.0;
    r.bpm = 128.0;
    r.regler_projekt = true;
    const cdj::RenderErgebnis roh = cdj::rendere(r);
    PRUEF(roh.fehler.empty() && roh.l.size() == 4 * 22500 && db(roh.spitze) > -30.0);
    r.spur_regler = {{"grp/1/fader", -6.0206f}};
    const cdj::RenderErgebnis halb = cdj::rendere(r);
    PRUEF(halb.fehler.empty() && halb.regler == 1);
    PRUEF(std::fabs(halb.l[22500] / roh.l[22500] - 0.5f) < 1e-3f);
    r.spur_regler = {{"pm/fader", -6.0206f}};
    const cdj::RenderErgebnis pm = cdj::rendere(r);
    PRUEF(std::fabs(pm.l[22500] / roh.l[22500] - 0.5f) < 1e-3f);
    r.spur_regler = {{"grp/1/mute", 1.0f}};
    PRUEF(cdj::rendere(r).spitze == 0.0f);   // Gruppen-Mute: der Export schweigt
    r.spur_regler = {{"grp/17/fader", 0.0f}};
    PRUEF(cdj::rendere(r).fehler == "regler");   // Negativ-Kontrolle: keine Gruppe 17
  }
  // 10 (1.10 Slice 2, AK18): heißes Material (Spur 1,5 · 0,7071 = 1,06 am PM): abgriff produktion enthält die ungebremste Spitze, abgriff set hält die Decke;
  // ueber_decke und limiter_db_max sagen es; leises Material: set ist der Abgriff durch den erz/4-Isolator (Gains 1,0), um den Limiter-Vorhalt ausgerichtet,
  // unter −90 dBFS (Nachzug N7: erz/4 ist nur im Betrag neutral, die Phase dreht der LR8-Isolator; ein Sample-Vergleich produktion gegen set ist nie null),
  // ueber_decke aus (Negativ-Kontrolle)
  {
    const std::string heiss = o.audio('b', 300000, 1.5f), leise = o.audio('c', 300000, 0.2f);   // sha nur aus Hex-Zeichen (arr_playback.cpp)
    o.wiedergabe(10, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 4.0, heiss, 300000) + "]}");
    o.wiedergabe(11, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 4.0, leise, 300000) + "]}");
    auto lauf = [&](int64_t nr, cdj::RenderAbgriff ab) {
      cdj::RenderAuftrag r;
      r.arr_ordner = o.pfad;
      r.nr = nr;
      r.von_beat = 0.0;
      r.bis_beat = 4.0;
      r.bpm = 128.0;
      r.regler_projekt = true;
      r.abgriff = ab;
      return cdj::rendere(r);
    };
    const cdj::RenderErgebnis prod = lauf(10, cdj::RenderAbgriff::produktion), set = lauf(10, cdj::RenderAbgriff::set);
    std::printf("Fall 10: heiß, produktion Spitze %.3f (%.1f dBFS), set Spitze %.3f, Limiter bis %.1f dB\n", prod.spitze, db(prod.spitze), set.spitze, prod.limiter_db_max);
    PRUEF(prod.fehler.empty() && set.fehler.empty() && prod.frames == set.frames && prod.frames == 4 * 22500);
    PRUEF(prod.abgriff == "produktion" && set.abgriff == "set");
    PRUEF(prod.spitze > 1.0f && prod.ueber_decke);                 // ungebremst, über 0 dBFS, über der Decke (−1 dBTP)
    PRUEF(set.spitze <= 0.92f && !set.ueber_decke);               // die Decke hält
    PRUEF(prod.limiter_db_max > 1.0f && set.limiter_db_max > 1.0f);   // der Set-Limiter hat in beiden Läufen eingegriffen (beide rendern denselben Kern)
    PRUEF(std::fabs(prod.l[40000] - 1.5f * 0.70710677f) < 1e-3f);    // Mitte des Clips: Wert · 0,7071 unverändert
    const cdj::RenderErgebnis pl = lauf(11, cdj::RenderAbgriff::produktion), sl = lauf(11, cdj::RenderAbgriff::set);
    PRUEF(pl.fehler.empty() && sl.fehler.empty() && !pl.ueber_decke && !sl.ueber_decke && pl.limiter_db_max < 0.05f);
    PRUEF(pl.frames == sl.frames && pl.l.size() == sl.l.size() && pl.l.size() == static_cast<size_t>(pl.frames));
    PRUEF(!std::signbit(pl.limiter_db_max) && !std::signbit(sl.limiter_db_max));   // „0 = griff nie ein“ ist +0, nicht −0 (die Zeile des Programms schriebe sonst "-0.000")
    // N7: Referenz = cypherdj::dsp::Isolator (Gains 1,0), frisch ab Renderbeginn, über den Abgriff gerechnet. Der Abgriff beginnt am Kern-Sample start_sample,
    // der Master hinter dem Limiter um den Vorhalt später: l[j] von set klingt, wo der Isolator den Abgriff-Wert j ausgibt (Task 17 Fall 1: Ring[t + vh] = Iso(PM[t])).
    std::vector<float> ref_l(pl.l.size()), ref_r(pl.r.size());
    {
      cypherdj::dsp::Isolator iso;
      const std::vector<float> eins(256, 1.0f);
      for (size_t i = 0; i < pl.l.size(); i += 256) {
        const int m = static_cast<int>(std::min<size_t>(256, pl.l.size() - i));
        iso.verarbeite(&pl.l[i], &pl.r[i], &ref_l[i], &ref_r[i], m, eins.data(), eins.data(), eins.data());
      }
    }
    double rest = 0.0, verschoben = 0.0, signal = 0.0;
    for (size_t j = 0; j + 1 < sl.l.size(); ++j) {
      rest = std::max(rest, static_cast<double>(std::fabs(sl.l[j] - ref_l[j])));
      rest = std::max(rest, static_cast<double>(std::fabs(sl.r[j] - ref_r[j])));
      verschoben = std::max(verschoben, static_cast<double>(std::fabs(sl.l[j + 1] - ref_l[j])));
      signal = std::max(signal, static_cast<double>(std::fabs(pl.l[j])));
    }
    std::printf("Fall 10: leise, set gegen Isolator(produktion): Rest %.1f dBFS, um 1 Sample verschoben %.1f dBFS, Signal %.1f dBFS, Vorhalt %d\n",
                20.0 * std::log10(rest + 1e-12), 20.0 * std::log10(verschoben + 1e-12), 20.0 * std::log10(signal + 1e-12), sl.vorhalt);
    PRUEF(signal > 0.1);                         // hörbar: Stille in beiden Läufen gilt als ungültig, nicht als bestanden
    PRUEF(rest < std::pow(10.0, -90.0 / 20.0));
    PRUEF(verschoben > 1e-3);                    // Gegenprobe: um 1 Sample verschoben ist der Rest nicht null
    // Ausrichtung: der Abgriff beginnt mit dem Einsatz, der Ring-Master (set) liegt um den Limiter-Vorhalt dahinter; die strenge Ausrichtung
    // prüft der Vergleich oben (Index j) und Task 17 Fall 1 (Index t + vh)
    int64_t ip = -1, is = -1;
    for (size_t i = 0; i < pl.l.size() && (ip < 0 || is < 0); ++i) {
      if (ip < 0 && pl.l[i] != 0.0f) ip = static_cast<int64_t>(i);
      if (is < 0 && sl.l[i] != 0.0f) is = static_cast<int64_t>(i);
    }
    std::printf("Fall 10: erster Wert produktion %lld, set %lld, Vorhalt %d\n", (long long)ip, (long long)is, sl.vorhalt);
    PRUEF(ip >= 0 && is >= 0 && ip <= is);
  }
  {  // 1.10 slice 3 (Task 6): returns in the export. Two returns wake in the same block with non-default Hall targets: hall_sofort() applies both before block 0
     // (no Hall runs a block on its old setting); without the call the second return would (mutation ARR_RENDER_OHNE_HALL_SOFORT)
    const std::string clip = "{\"id\":\"s4/freeze\",\"start_beat\":0.0,\"laenge_beats\":4.0,\"sha256\":\"" + std::string(64, 'c') +
                             "\",\"datei\":\"" + o.pfad + "/freeze-3-9.f32\",\"frames\":90000,\"offset_frames\":0,\"gain_db\":0.0,\"ein_beats\":0.0,\"aus_beats\":0.0}";
    o.wiedergabe2_ret(4, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + clip + "]}", "",
                      "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}},{\"nr\":2,\"ausgang\":{\"art\":\"master\"}}");
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = 4;
    r.von_beat = 0.0;
    r.bis_beat = 4.0;
    r.bpm = 128.0;
    r.regler_projekt = true;
    r.spur_regler = {{"spur/1/send/1", 0.0f}, {"spur/1/send/2", 0.0f}, {"ret/1/hall/decay", 0.8f}, {"ret/2/hall/decay", 0.6f}};
    const cdj::RenderErgebnis e = cdj::rendere(r);
    std::printf("Fall 11: returns im Export, regler %d, hall_start_alt %llu, decay %.2f / %.2f\n", e.regler, (unsigned long long)e.hall_start_alt, e.hall_decay[0], e.hall_decay[1]);
    PRUEF(e.fehler.empty() && e.regler == 4);
    PRUEF(e.hall_start_alt == 0);
    PRUEF(e.hall_decay[0] == 0.8f && e.hall_decay[1] == 0.6f);
    // the returns are in the export: the same project without the sends is quieter than with them (the Hall adds its tail), negative control above
    cdj::RenderAuftrag ohne = r;
    ohne.spur_regler = {{"ret/1/hall/decay", 0.8f}, {"ret/2/hall/decay", 0.6f}};
    const cdj::RenderErgebnis ohne_e = cdj::rendere(ohne);
    PRUEF(ohne_e.fehler.empty() && ohne_e.l.size() == e.l.size());
    double diff = 0.0;
    for (size_t i = 0; i < e.l.size(); ++i) diff = std::max(diff, static_cast<double>(std::fabs(e.l[i] - ohne_e.l[i])));
    PRUEF(diff > 1e-3);
    // a control the table does not know is refused (no silent clamp)
    cdj::RenderAuftrag schlecht = r;
    schlecht.spur_regler = {{"ret/5/fader", 0.0f}};
    PRUEF(cdj::rendere(schlecht).fehler == "regler");
  }
  PRUEF_ENDE();
}
