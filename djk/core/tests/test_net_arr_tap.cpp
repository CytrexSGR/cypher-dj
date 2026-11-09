// 1.10 slice 7 (T5, spec 5.7, 6.29): /k/arr/abgriff through the net thread and the Arrangement load thread, the sibling of test_netz_arr_freeze and
// test_netz_arr_freeze_uhr. Part A (units, no threads): the net checks the request and queues a job; the load thread allocates it with its buffer (capacity (bis - von)
// beats at 60 BPM plus 2 frames, no tail), the net hands it to the kern as command ARR_ABGRIFF. The event ARR_ABGRIFF goes back to the load thread: done writes
// <arr_ordner>/abgriff-<art>-<nr>-<kennung>.f32 (frames * 8 bytes, no temp file left, never replacing), the net reports /e/abgriff 0 with frames; aborted /e/abgriff 1 without
// a file; a write error or an existing file /e/abgriff 2; refused nothing. Range errors, the AI stop (cypher, before the range check) and a missing work folder are /q 6.
// Part B (threads, a timing test: expect it in kern-ctest-lastempfindlich.txt under load): kern, net and load thread run as in operation; during a tap of 256 beats
// (the maximum, 98 MB buffer and file at 60 BPM) the largest gap between two /uhr stays at most 10 ms in the window of the allocation and in the window of the writing;
// /e/abgriff 0 carries the frames and the file has the size; a second tap that /k/arr/stopp aborts gives /e/abgriff 1 and no file.
#include <sys/vfs.h>
#include <linux/magic.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <vector>

#include "arr_file.h"
#include "freeze_threads.h"
#include "peer.h"
#include "check.h"

namespace v = cypherdj::osc;

namespace {

cdj::Ereignis rueckgabe(cdj::ArrAbgriff* f, int32_t status) {
  cdj::Ereignis e{};
  e.art = cdj::Ereignis::ARR_ABGRIFF;
  e.status = status;
  e.zeiger = f;
  return e;
}

std::vector<float> lies(const std::string& datei, size_t n) {
  std::vector<float> d(n);
  std::ifstream(datei, std::ios::binary).read(reinterpret_cast<char*>(d.data()), static_cast<std::streamsize>(n * 4));
  return d;
}

size_t teildateien(const std::string& ordner) {
  size_t n = 0;
  for (const auto& e : std::filesystem::directory_iterator(ordner)) n += e.path().string().find(".teil") != std::string::npos;
  return n;
}

void teil_a() {
  arrdatei::Ordner o("test_netz_arr_abgriff");
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  auto ringe = std::make_unique<cdj::ArrLaderRinge>();
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
  cdj::Netz netz(0, false, bef.get(), ere.get());
  Gegenstelle g;
  {
    cdj::osc::Schreiber s(v::k_hallo);
    s.s("x").i(g.port).i(1);
    netz.paket(s.daten(), s.groesse());
    PRUEF(g.warte("/k/willkommen", 200));
  }
  auto anfrage = [&](int64_t id, const char* quelle, int32_t art, int32_t nr, int32_t punkt, double von, double bis, int32_t kennung) {
    cdj::osc::Schreiber s(v::k_arr_abgriff);
    s.h(id).s(quelle).i(art).i(nr).i(punkt).d(von).d(bis).i(kennung);
    netz.paket(s.daten(), s.groesse());
  };
  auto q6 = [&](int64_t id, const char* grund) {
    return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund);
  };
  cdj::Befehl b;
  cdj::ArrAuftrag au;
  // 1: without loader and without work folder: datei_fehlt, no command, no job
  anfrage(90, "andreas", 0, 1, 1, 0.0, 4.0, 1);
  PRUEF(q6(90, "datei_fehlt") && !bef->hole(b));
  netz.verbinde_arr(ringe.get());
  anfrage(89, "andreas", 0, 1, 1, 0.0, 4.0, 1);
  PRUEF(q6(89, "datei_fehlt") && !bef->hole(b) && !ringe->auftraege.hole(au));
  netz.setze_arr_ordner(o.pfad);
  // 2: a good request: the net queues only a job (no buffer, no command); the load thread allocates it, then the net hands it to the kern as ARR_ABGRIFF
  anfrage(91, "andreas", 1, 2, 0, 4.0, 8.0, 17);
  PRUEF(!bef->hole(b));
  PRUEF(lader.einmal(*ringe));
  netz.ereignisse_senden();
  PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_ABGRIFF && b.id == 91 && b.nr == 2 && b.zeiger && !std::strcmp(b.quelle, "andreas"));
  cdj::ArrAbgriff* f = static_cast<cdj::ArrAbgriff*>(const_cast<void*>(b.zeiger));
  PRUEF(f->art == 1 && f->nr == 2 && f->punkt == 0 && f->kennung == 17 && f->von_beat == 4.0 && f->bis_beat == 8.0);
  PRUEF(f->kap == 4 * 48000 + 2 && f->daten.size() == static_cast<size_t>(f->kap) * 2);   // no tail beats
  // 3: range errors: art, nr per kind (track 33, group 9, return 5, PM 2), punkt, bis - von < 1, kennung < 0, von < 0, NaN, a stranger; above 256 beats zu_gross
  struct Bf { int art, nr, punkt; double von, bis; int kennung; const char* quelle; const char* grund; };
  const Bf bfs[] = {{4, 1, 1, 0.0, 4.0, 1, "andreas", "ausserhalb_bereich"}, {-1, 1, 1, 0.0, 4.0, 1, "andreas", "ausserhalb_bereich"},
                    {0, 0, 1, 0.0, 4.0, 1, "andreas", "ausserhalb_bereich"}, {0, 33, 1, 0.0, 4.0, 1, "andreas", "ausserhalb_bereich"},
                    {1, 9, 1, 0.0, 4.0, 1, "andreas", "ausserhalb_bereich"}, {2, 5, 1, 0.0, 4.0, 1, "andreas", "ausserhalb_bereich"},
                    {3, 2, 1, 0.0, 4.0, 1, "andreas", "ausserhalb_bereich"}, {0, 1, 2, 0.0, 4.0, 1, "andreas", "ausserhalb_bereich"},
                    {0, 1, 1, 0.0, 0.5, 1, "andreas", "ausserhalb_bereich"}, {0, 1, 1, 0.0, 4.0, -1, "andreas", "ausserhalb_bereich"},
                    {0, 1, 1, -1.0, 4.0, 1, "andreas", "ausserhalb_bereich"}, {0, 1, 1, 0.0, std::nan(""), 1, "andreas", "ausserhalb_bereich"},
                    {0, 1, 1, 0.0, 4.0, 1, "fremd", "ausserhalb_bereich"}, {0, 1, 1, 0.0, 257.0, 1, "andreas", "zu_gross"}};
  int64_t id = 200;
  for (const Bf& x : bfs) {
    anfrage(++id, x.quelle, x.art, x.nr, x.punkt, x.von, x.bis, x.kennung);
    const bool ok = q6(id, x.grund);
    if (!ok) std::fprintf(stderr, "case art %d nr %d punkt %d bis %g: expected %s\n", x.art, x.nr, x.punkt, x.bis, x.grund);
    PRUEF(ok);
  }
  PRUEF(!ringe->auftraege.hole(au) && !bef->hole(b));
  anfrage(++id, "andreas", 3, 1, 1, 0.0, 256.0, 1);   // the maximum is allowed
  PRUEF(ringe->auftraege.hole(au) && au.art == cdj::ArrAuftrag::ABGRIFF && au.strang_art == 3 && au.spur == 1 && au.punkt == 1);
  // 4: AI stop: cypher refused before the range check, andreas not
  {
    cdj::Ereignis ki{};
    ki.art = cdj::Ereignis::KI;
    ki.status = 1;
    PRUEF(ere->schiebe(ki));
    netz.ereignisse_senden();
    anfrage(99, "cypher", 0, 1, 1, 0.0, 4.0, 1);
    PRUEF(q6(99, "ki_gestoppt"));
    anfrage(87, "cypher", 0, 1, 1, 0.0, 0.5, 1);   // invalid and in the AI stop: ki_gestoppt first
    PRUEF(q6(87, "ki_gestoppt"));
    PRUEF(!ringe->auftraege.hole(au));
    anfrage(100, "andreas", 0, 1, 1, 0.0, 4.0, 1);
    PRUEF(ringe->auftraege.hole(au) && au.id == 100 && au.art == cdj::ArrAuftrag::ABGRIFF);
    ki.status = 0;
    PRUEF(ere->schiebe(ki));
    netz.ereignisse_senden();
  }
  // 5: done: the load thread writes the file (frames * 8 bytes, content, no temp file), then /e/abgriff 0
  f->frames = 1000;
  for (int64_t i = 0; i < 2 * f->frames; ++i) f->daten[static_cast<size_t>(i)] = static_cast<float>(i) * 0.001f;
  PRUEF(ere->schiebe(rueckgabe(f, 0)));
  netz.ereignisse_senden();
  const std::string datei = o.pfad + "/abgriff-1-2-17.f32";
  PRUEF(cdj::abgriff_datei(o.pfad, 1, 2, 17) == datei);
  PRUEF(!std::filesystem::exists(datei));   // the net does not write itself (spec 6.29)
  PRUEF(!g.warte("/e/abgriff", 20));
  PRUEF(lader.einmal(*ringe));
  netz.ereignisse_senden();
  PRUEF(g.warte("/e/abgriff", 200) && g.m.werte[0].i == 1 && g.m.werte[1].i == 2 && g.m.werte[2].i == 17 && g.m.werte[3].i == 0 && g.m.werte[4].h == 1000);
  PRUEF(std::filesystem::exists(datei) && std::filesystem::file_size(datei) == 1000 * 8);
  {
    const std::vector<float> d = lies(datei, 2000);
    PRUEF(d[0] == 0.0f && d[1999] == 1999 * 0.001f);
  }
  PRUEF(teildateien(o.pfad) == 0);
  // 6: aborted: /e/abgriff 1, frames 0, no file
  auto a = std::make_unique<cdj::ArrAbgriff>();
  a->art = 0;
  a->nr = 3;
  a->kennung = 4;
  a->frames = 500;
  a->daten.assign(1000, 0.5f);
  PRUEF(ere->schiebe(rueckgabe(a.release(), 1)));
  netz.ereignisse_senden();
  lader.einmal(*ringe);
  netz.ereignisse_senden();
  PRUEF(g.warte("/e/abgriff", 200) && g.m.werte[0].i == 0 && g.m.werte[1].i == 3 && g.m.werte[3].i == 1 && g.m.werte[4].h == 0);
  PRUEF(!std::filesystem::exists(o.pfad + "/abgriff-0-3-4.f32"));
  // 7: refused: no /e/abgriff (only freed in the load thread)
  PRUEF(ere->schiebe(rueckgabe(std::make_unique<cdj::ArrAbgriff>().release(), cdj::ARR_ABGRIFF_ABGELEHNT)));
  netz.ereignisse_senden();
  lader.einmal(*ringe);
  netz.ereignisse_senden();
  PRUEF(!g.warte("/e/abgriff", 50));
  // 8: write error (folder missing): /e/abgriff 2
  {
    cdj::ArrLader weg(o.pfad + "/gibtsnicht", &konto, 50LL << 20, false);
    auto w = std::make_unique<cdj::ArrAbgriff>();
    w->kennung = 1;
    w->frames = 10;
    w->daten.assign(20, 0.0f);
    PRUEF(ere->schiebe(rueckgabe(w.release(), 0)));
    netz.ereignisse_senden();
    weg.einmal(*ringe);
    netz.ereignisse_senden();
    PRUEF(g.warte("/e/abgriff", 200) && g.m.werte[3].i == 2 && g.m.werte[4].h == 0);
  }
  // 9: the file exists already (from case 5): never replaced silently, /e/abgriff 2, no temp file left, the content stays
  {
    auto z = std::make_unique<cdj::ArrAbgriff>();
    z->art = 1;
    z->nr = 2;
    z->kennung = 17;
    z->frames = 1000;
    z->daten.assign(2000, 0.75f);
    PRUEF(ere->schiebe(rueckgabe(z.release(), 0)));
    netz.ereignisse_senden();
    lader.einmal(*ringe);
    netz.ereignisse_senden();
    PRUEF(g.warte("/e/abgriff", 200) && g.m.werte[2].i == 17 && g.m.werte[3].i == 2 && g.m.werte[4].h == 0);
    const std::vector<float> d = lies(datei, 2000);
    PRUEF(std::filesystem::file_size(datei) == 1000 * 8 && d[0] == 0.0f && d[1999] == 1999 * 0.001f && teildateien(o.pfad) == 0);
  }
  // 10: command ring full: the job goes back to the load thread and is freed there (no leak), /q 4
  {
    cdj::Befehl fuell{};
    fuell.art = cdj::Befehl::ARR_STOPP;
    while (bef->schiebe(fuell)) {
    }
    anfrage(101, "andreas", 0, 1, 1, 0.0, 4.0, 5);
    lader.einmal(*ringe);
    netz.ereignisse_senden();   // einreihen waits up to 100 ms, then zu_spaet
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 101 && g.m.werte[2].i == 4);
    cdj::ArrAbgriff* zurueck = nullptr;
    PRUEF(ringe->abgriff_zurueck.hole(zurueck) && zurueck && zurueck->kennung == 5 && zurueck->status == cdj::ARR_ABGRIFF_ABGELEHNT);
    delete zurueck;
    while (bef->hole(b)) {
    }
  }
}

void teil_b() {
  const char* tmp = std::getenv("TMPDIR");
  const std::string basis = tmp && *tmp ? tmp : "/tmp";
  ff::Aufbau x("test_netz_arr_abgriff_uhr", basis, 60.0);
  struct statfs fs {};
  const bool platte = statfs(x.ordner.pfad.c_str(), &fs) == 0 && fs.f_type != TMPFS_MAGIC && fs.f_type != RAMFS_MAGIC;
  std::printf("abgriff_uhr: work folder %s, file system 0x%lx (%s)\n", x.ordner.pfad.c_str(), static_cast<unsigned long>(fs.f_type), platte ? "disk" : "tmpfs/ramfs");
  PRUEF(platte);
  const std::string a = x.ordner.audio('a', 48000);
  x.ordner.wiedergabe(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 1.0, a, 48000) + "]}");
  constexpr int64_t SPB = 48000;   // 60 BPM
  constexpr int64_t FRAMES = 256 * SPB;   // no tail
  std::atomic<bool> schnell_frei{false};
  std::atomic<int64_t> einsatz{-1};
  x.starten([&](cdj::Kern& k) {
    if (einsatz.load() < 0 && k.arrangement().abgriff_laeuft() && k.arrangement().status() == cdj::ArrStatus::spielt) einsatz.store(k.sample());
    const int64_t e = einsatz.load();
    if (e < 0 || !schnell_frei.load()) return;
    x.echtzeit.store(k.sample() >= e + FRAMES - 28800 || !k.arrangement().abgriff_laeuft());
  });
  x.hallo();
  PRUEF(x.warte("/k/willkommen", 1000, [](const cdj::osc::Nachricht&) { return true; }) >= 0);
  const int64_t l = x.laden(1);
  PRUEF(x.warte_q(l, 3, 3000) >= 0);
  auto sende = [&](int art, int nr, int punkt, double von, double bis, int kennung) {
    cdj::osc::Schreiber s(v::k_arr_abgriff);
    s.h(++x.id).s("andreas").i(art).i(nr).i(punkt).d(von).d(bis).i(kennung);
    x.g->sende(s);
    return x.id;
  };
  const size_t bezug_ab = x.pakete.size();
  const int64_t t0 = ff::real_ns();
  while (ff::real_ns() < t0 + 1000000000LL) x.sammeln(5);
  const size_t bezug_bis = x.pakete.size();
  const int64_t t_abg = ff::real_ns();
  const int64_t fid = sende(0, 1, 1, 0.0, 256.0, 1);
  PRUEF(x.warte_q(fid, 1, 3000) >= 0);
  PRUEF(x.warte_q(fid, 2, 3000) >= 0);
  while (ff::real_ns() < t_abg + 1000000000LL) x.sammeln(5);
  schnell_frei.store(true);
  const long e = x.warte("/e/abgriff", 120000, [](const cdj::osc::Nachricht& m) { return m.werte[2].i == 1; });
  PRUEF(e >= 0);
  const int64_t t_e = e >= 0 ? x.pakete[static_cast<size_t>(e)].t_ns : ff::real_ns();
  while (ff::real_ns() < t_e + 300000000LL) x.sammeln(5);
  auto abstaende = [&](int64_t von, int64_t bis) {
    std::vector<int64_t> d;
    int64_t vorige = -1;
    for (const ff::Paket& p : x.pakete) {
      if (p.adresse != "/uhr") continue;
      if (vorige >= 0 && p.t_ns >= von && vorige < bis) d.push_back(p.t_ns - vorige);
      vorige = p.t_ns;
    }
    return d;
  };
  std::vector<int64_t> bezug = abstaende(x.pakete[bezug_ab].t_ns, x.pakete[bezug_bis - 1].t_ns);
  std::sort(bezug.begin(), bezug.end());
  const int64_t normal = bezug.empty() ? 0 : bezug[bezug.size() / 2];
  auto groesster = [](const std::vector<int64_t>& d) { return d.empty() ? -1 : *std::max_element(d.begin(), d.end()); };
  const int64_t max_an = groesster(abstaende(t_abg, t_abg + 1000000000LL));
  const int64_t max_schreib = groesster(abstaende(t_e - 500000000LL, t_e + 300000000LL));
  int status = -1;
  int64_t frames = -1;
  if (e >= 0) {
    cdj::osc::Nachricht m;
    const ff::Paket& p = x.pakete[static_cast<size_t>(e)];
    if (cdj::osc::lesen(p.roh.data(), p.roh.size(), m)) {
      status = m.werte[3].i;
      frames = m.werte[4].h;
    }
  }
  const std::string datei = x.ordner.pfad + "/abgriff-0-1-1.f32";
  std::printf("abgriff_uhr: normal %.2f ms (%zu gaps), largest gap at the allocation %.2f ms, at the writing %.2f ms; /e/abgriff status %d, frames %lld, file %lld bytes\n",
              normal / 1e6, bezug.size(), max_an / 1e6, max_schreib / 1e6, status, (long long)frames,
              std::filesystem::exists(datei) ? (long long)std::filesystem::file_size(datei) : -1LL);
  PRUEF(normal > 4000000 && normal < 7000000);   // one cycle 256/48000 s = 5.33 ms
  PRUEF(status == 0 && frames == FRAMES);
  PRUEF(std::filesystem::exists(datei) && std::filesystem::file_size(datei) == static_cast<uintmax_t>(FRAMES) * 8);
  PRUEF(max_an > 0 && max_an <= 10000000);       // at most 10 ms
  PRUEF(max_schreib > 0 && max_schreib <= 10000000);
  std::filesystem::remove(datei);
  // a tap that /k/arr/stopp aborts: /e/abgriff 1, no file; then the same name again is free
  schnell_frei.store(false);
  x.echtzeit.store(true);
  const size_t ab_ab = x.pakete.size();
  const int64_t gid = sende(0, 1, 0, 0.0, 16.0, 2);
  PRUEF(x.warte_q(gid, 2, 3000) >= 0);
  x.stopp();
  PRUEF(x.warte_q(gid, 7, 3000) >= 0);
  const long e2 = x.warte("/e/abgriff", 3000, [](const cdj::osc::Nachricht& m) { return m.werte[2].i == 2; }, ab_ab);
  PRUEF(e2 >= 0);
  if (e2 >= 0) {
    cdj::osc::Nachricht m;
    const ff::Paket& p = x.pakete[static_cast<size_t>(e2)];
    PRUEF(cdj::osc::lesen(p.roh.data(), p.roh.size(), m) && m.werte[3].i == 1 && m.werte[4].h == 0);
  }
  PRUEF(!std::filesystem::exists(x.ordner.pfad + "/abgriff-0-1-2.f32"));
  x.anhalten();
}

}  // namespace

int main() {
  teil_a();
  teil_b();
  PRUEF_ENDE();
}
