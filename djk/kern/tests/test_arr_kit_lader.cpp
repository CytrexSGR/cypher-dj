// Package 1.9 U1a: the kit store of the ArrAudioCache (arr_wiedergabe.h, arr_lader.h). A kit track {art:"intern", geraet:"kit", kit}
// gets one shared, reference-counted, memory-booked Kit, loaded off the callback through a loader function pointer (the cache keeps
// no link dependency on kit.cpp), freed only when no snapshot holds it AND the sink has let go (ArrKitLeser::nutzt).
// Mutations: ARR_KIT_OHNE_TEILEN (case 1), ARR_KIT_FREI_OHNE_LESER (case 5), ARR_KIT_OHNE_REF (case 7),
// ARR_KIT_FEHLER_OHNE_GIB (case 8), ARR_KIT_OHNE_NACHHOLEN (case 10).
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>

#include "arr_datei.h"
#include "cypherdj/arr_lader.h"
#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/kit.h"
#include "pruef.h"

namespace {

namespace fs = std::filesystem;

const std::string KITS = std::string(CYPHERDJ_DJK) + "/kern/tests/daten/kits";   // repo test kits of U0 T0.4

int g_lader_aufrufe = 0;   // a plain function pointer cannot capture, so the counting wrapper counts here
std::unique_ptr<cdj::Kit> zaehlender_lader(const std::string& ordner, std::string* fehler) {
  ++g_lader_aufrufe;
  return cdj::lade_kit(ordner, fehler);
}

struct Leser final : cdj::ArrKitLeser {
  const cdj::Kit* in_nutzung = nullptr;   // the kit the "sink" still plays; nullptr: none
  bool nutzt(const cdj::Kit* k) const noexcept override { return k != nullptr && k == in_nutzung; }
};

// bytes the store has to book for a kit: all sounds, frames * 2 channels * 4 bytes
int64_t kit_bytes(const cdj::Kit& k) {
  int64_t b = 0;
  for (const cdj::KitKlang& kl : k.klang) b += kl.frames * 8;
  return b;
}

// VmLck of this process in kB (the kernel's own count of locked memory); -1: unreadable
long vm_lck_kb() {
  std::ifstream f("/proc/self/status");
  std::string z;
  while (std::getline(f, z))
    if (z.compare(0, 6, "VmLck:") == 0) return std::stol(z.substr(6));
  return -1;
}

// a kit folder with one sound of `frames` frames on note 0 (the folder is made in the test's own work folder)
void schreibe_kit(const std::string& ordner, int64_t frames) {
  fs::create_directories(ordner);
  std::ofstream(ordner + "/kit.json") << "{\"schema\": 1, \"name\": \"gross\", \"klaenge\": [{\"note\": 0, \"name\": \"imp:0\", \"datei\": \"imp_0.f32\", \"frames\": " +
                                             std::to_string(frames) + "}]}";
  std::ofstream(ordner + "/imp_0.f32", std::ios::binary) << std::string(static_cast<size_t>(frames) * 8, '\x01');   // 0x01010101 is a small finite float
}

}  // namespace

int main() {
  arrdatei::Ordner o("test_arr_kit_lader");
  const cdj::Kit* k = nullptr;
  uint64_t gen = 0;
  std::string grund, meldung;

  {  // 1: the three repo kits load with n = 1, 2, 2; two holds of one kit share one Kit and the loader runs once
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_kit_ordner(KITS);
    cache.setze_kit_lader(zaehlender_lader);
    g_lader_aufrufe = 0;
    struct Soll {
      const char* name;
      int n;
    };
    for (const Soll& s : {Soll{"kit_impuls", 1}, Soll{"kit_zwei", 2}, Soll{"kit_rack", 2}}) {
      const cdj::Kit* x = nullptr;
      uint64_t g = 0;
      const int32_t sl = cache.kit_hole(s.name, &x, &g, grund, meldung);
      PRUEF(sl >= 0);
      PRUEF(x != nullptr && x->n == s.n && g > 0);
      if (x) PRUEF(konto.gesperrt() >= kit_bytes(*x));   // the bytes of all sounds are booked on the shared account
      cache.kit_gib(sl);
      PRUEF(cache.kit_eintraege() == 0 && cache.kit_aufgeschoben() == 0 && konto.gesperrt() == 0);   // freed, booking undone
    }
    g_lader_aufrufe = 0;
    const cdj::Kit *a = nullptr, *b = nullptr;
    uint64_t ga = 0, gb = 0;
    const int32_t s1 = cache.kit_hole("kit_zwei", &a, &ga, grund, meldung);
    const int32_t s2 = cache.kit_hole("kit_zwei", &b, &gb, grund, meldung);
    PRUEF(s1 >= 0 && s2 == s1);
    PRUEF(a != nullptr && a == b && ga == gb);   // one Kit, one generation
    PRUEF(g_lader_aufrufe == 1);                  // the loader ran once
    PRUEF(cache.kit_eintraege() == 1);
    if (a) PRUEF(konto.gesperrt() == kit_bytes(*a));   // booked once, not twice
    cache.kit_gib(s1);
    PRUEF(cache.kit_eintraege() == 1);   // the second reference still holds it
    cache.kit_gib(s2);
    PRUEF(cache.kit_eintraege() == 0 && konto.gesperrt() == 0);
    {  // another kit does not share
      const cdj::Kit* c = nullptr;
      uint64_t gc = 0;
      const int32_t s3 = cache.kit_hole("kit_zwei", &a, &ga, grund, meldung), s4 = cache.kit_hole("kit_rack", &c, &gc, grund, meldung);
      PRUEF(s3 >= 0 && s4 >= 0 && s3 != s4 && a != c && ga != gc && cache.kit_eintraege() == 2);
      cache.kit_gib(s3);
      cache.kit_gib(s4);
    }
  }
  {  // 2: a touched kit.json (mtime changed in a temp copy) loads a new Kit; the untouched one is shared
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    const std::string kits = o.pfad + "/kits";
    fs::create_directories(kits);
    fs::copy(KITS + "/kit_zwei", kits + "/kit_zwei", fs::copy_options::recursive);
    cache.setze_kit_ordner(kits);
    cache.setze_kit_lader(zaehlender_lader);
    g_lader_aufrufe = 0;
    const cdj::Kit *a = nullptr, *b = nullptr, *c = nullptr;
    uint64_t ga = 0, gb = 0, gc = 0;
    const int32_t s1 = cache.kit_hole("kit_zwei", &a, &ga, grund, meldung);
    const int32_t s3 = cache.kit_hole("kit_zwei", &c, &gc, grund, meldung);   // negative control: nothing touched yet
    PRUEF(s1 >= 0 && s3 == s1 && a == c && g_lader_aufrufe == 1);
    fs::last_write_time(kits + "/kit_zwei/kit.json", fs::last_write_time(kits + "/kit_zwei/kit.json") + std::chrono::seconds(7));
    const int32_t s2 = cache.kit_hole("kit_zwei", &b, &gb, grund, meldung);
    PRUEF(s2 >= 0 && s2 != s1);
    PRUEF(b != nullptr && gb != ga);       // a new generation: the sink tells the old from the new
    PRUEF(g_lader_aufrufe == 2);
    PRUEF(cache.kit_eintraege() == 2);     // the old one lives while a snapshot holds it
    cache.kit_gib(s1);
    cache.kit_gib(s3);
    PRUEF(cache.kit_eintraege() == 1);
    cache.kit_gib(s2);
    PRUEF(cache.kit_eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 3: a missing folder gives format and names the folder; a folder without readable kit.json too
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_kit_ordner(KITS);
    cache.setze_kit_lader(cdj::lade_kit);
    const int32_t sl = cache.kit_hole("nicht-da-i19", &k, &gen, grund, meldung);
    PRUEF(sl < 0 && k == nullptr);
    PRUEF(grund == "format");
    PRUEF(meldung.find(KITS + "/nicht-da-i19") != std::string::npos);
    PRUEF(cache.kit_eintraege() == 0 && konto.gesperrt() == 0);
    fs::create_directories(o.pfad + "/leer/halb");   // a folder, but no kit.json in it
    cache.setze_kit_ordner(o.pfad + "/leer");
    PRUEF(cache.kit_hole("halb", &k, &gen, grund, meldung) < 0 && grund == "format" && meldung.find(o.pfad + "/leer/halb") != std::string::npos);
    cache.setze_kit_ordner(KITS);   // negative control: a present kit loads from the same cache
    const int32_t ok = cache.kit_hole("kit_impuls", &k, &gen, grund, meldung);
    PRUEF(ok >= 0 && k != nullptr);
    cache.kit_gib(ok);
  }
  {  // 4: no loader set gives format "no kit loader"; the standalone targets of arr_wiedergabe.cpp stay link-free of kit.cpp
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_kit_ordner(KITS);
    k = nullptr;
    PRUEF(cache.kit_hole("kit_impuls", &k, &gen, grund, meldung) < 0);
    PRUEF(grund == "format" && meldung.find("no kit loader") != std::string::npos);
    PRUEF(k == nullptr && cache.kit_eintraege() == 0 && konto.gesperrt() == 0);
    cache.setze_kit_lader(cdj::lade_kit);   // negative control: with the loader the same call works
    const int32_t sl = cache.kit_hole("kit_impuls", &k, &gen, grund, meldung);
    PRUEF(sl >= 0 && k != nullptr);
    cache.kit_gib(sl);
  }
  {  // 5: a Kit the reader still uses survives kit_gib to 0 and is freed by kit_nachholen() only after the reader lets go
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_kit_ordner(KITS);
    cache.setze_kit_lader(cdj::lade_kit);
    Leser leser;
    cache.setze_kit_leser(&leser);
    {  // negative control: the sink is not using it, freed at once
      const int32_t sl = cache.kit_hole("kit_zwei", &k, &gen, grund, meldung);
      PRUEF(sl >= 0);
      cache.kit_gib(sl);
      PRUEF(cache.kit_eintraege() == 0 && cache.kit_aufgeschoben() == 0 && konto.gesperrt() == 0);
      PRUEF(!cache.kit_nachholen());
    }
    const int32_t sl = cache.kit_hole("kit_zwei", &k, &gen, grund, meldung);
    PRUEF(sl >= 0 && k != nullptr);
    const int64_t gebucht = konto.gesperrt();
    leser.in_nutzung = k;
    cache.kit_gib(sl);
    PRUEF(cache.kit_eintraege() == 0 && cache.kit_aufgeschoben() == 1);   // deferred, not freed
    PRUEF(konto.gesperrt() == gebucht);                                    // the memory is still resident, so still booked
    PRUEF(!cache.kit_nachholen() && cache.kit_aufgeschoben() == 1);       // the sink still uses it: kept
    leser.in_nutzung = nullptr;
    PRUEF(cache.kit_nachholen() && cache.kit_aufgeschoben() == 0);        // let go: freed now
    PRUEF(konto.gesperrt() == 0);                                          // and unbooked
    PRUEF(!cache.kit_nachholen());                                         // nothing left to do
    {  // a deferred Kit at the end of the cache is freed by the destructor without asking; the booking is undone
      const int32_t s9 = cache.kit_hole("kit_rack", &k, &gen, grund, meldung);
      leser.in_nutzung = k;
      cache.kit_gib(s9);
      PRUEF(cache.kit_aufgeschoben() == 1 && konto.gesperrt() > 0);
    }
  }
  {  // 6: a budget smaller than the kit gives zu_gross and books nothing; a kit that fits loads (negative control)
    cdj::SpeicherKonto konto(1000);   // kit_impuls = 96 frames = 768 bytes fits, kit_zwei = 4608 bytes does not
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_kit_ordner(KITS);
    cache.setze_kit_lader(cdj::lade_kit);
    k = nullptr;
    PRUEF(cache.kit_hole("kit_zwei", &k, &gen, grund, meldung) < 0);
    PRUEF(grund == "zu_gross" && meldung.find("kit_zwei") != std::string::npos);
    PRUEF(k == nullptr && konto.gesperrt() == 0 && cache.kit_eintraege() == 0);
    const int32_t sl = cache.kit_hole("kit_impuls", &k, &gen, grund, meldung);
    PRUEF(sl >= 0 && k != nullptr && konto.gesperrt() == 768);
    cache.kit_gib(sl);
    PRUEF(konto.gesperrt() == 0);
  }
  {  // 6b: a cache that locks (the live core) mlocks the sample memory and gives it back; the account books the same
    const std::string gross = o.pfad + "/gross";
    schreibe_kit(gross + "/gross_kit", 480000);   // the largest sound a kit may hold: 3 840 000 bytes
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, true);
    cache.setze_kit_ordner(gross);
    cache.setze_kit_lader(cdj::lade_kit);
    const long vorher = vm_lck_kb();
    PRUEF(vorher >= 0);
    const int32_t sl = cache.kit_hole("gross_kit", &k, &gen, grund, meldung);
    PRUEF(sl >= 0 && k != nullptr);
    const long locked = vm_lck_kb();
    PRUEF(locked - vorher >= 3700);                   // 3 840 000 bytes = 3750 kB, the kernel counts them as locked
    PRUEF(konto.gesperrt() == 480000LL * 8);
    cache.kit_gib(sl);
    const long danach = vm_lck_kb();
    PRUEF(danach - vorher <= 16);                     // unlocked again (the two boundary pages of the range may stay: see kit_entsperren)
    PRUEF(konto.gesperrt() == 0);
    // a refused mlock leaves nothing booked: the kit does not fit the account (negative control above: it fits)
    cdj::SpeicherKonto eng(1000000);
    cdj::ArrAudioCache enger(&eng, 50LL << 20, true);
    enger.setze_kit_ordner(gross);
    enger.setze_kit_lader(cdj::lade_kit);
    PRUEF(enger.kit_hole("gross_kit", &k, &gen, grund, meldung) < 0 && grund == "zu_gross" && eng.gesperrt() == 0);
    PRUEF(vm_lck_kb() - vorher <= 16);
  }
  // ---- T1.2: the parser takes a reference per kit track and gives every one back --------------------------------------------------
  auto kit_spur = [](int nr, const std::string& kit, int noten = 1) {
    std::string n;
    for (int i = 0; i < noten; ++i) {
      char z[160];
      std::snprintf(z, sizeof z, "%s{\"id\":\"c%d/n%d\",\"beat\":%d,\"laenge\":0.5,\"ton\":%d,\"vel\":100}", i ? "," : "", nr, i, i, i);
      n += z;
    }
    return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"" + kit + "\",\"noten\":[" + n + "]}";
  };
  {  // 6c: a well-formed kit track loads with cdj::lade_kit and its kit_ptr is set; two tracks on one kit share it
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_kit_ordner(KITS);
    cache.setze_kit_lader(cdj::lade_kit);
    o.wiedergabe(1, kit_spur(3, "kit_zwei", 2) + "," + kit_spur(5, "kit_zwei") + "," + kit_spur(6, "kit_impuls"));
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 1, cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSpur& s = e.snap->spur[2];
      PRUEF(s.art == cdj::ArrArt::intern && std::string(s.geraet) == "kit" && std::string(s.kit) == "kit_zwei");
      PRUEF(s.kit_ptr != nullptr && s.kit_ptr->n == 2 && s.kit_gen > 0);
      PRUEF(s.bk == nullptr && s.graph[0] == '\0' && s.n_param == 0);   // a kit track has no graph and no device parameter
      PRUEF(s.n_noten == 2 && s.noten[1].ton == 1);
      PRUEF(e.snap->spur[4].kit_ptr == s.kit_ptr && e.snap->spur[4].kit_gen == s.kit_gen);   // track 5: same kit, shared
      PRUEF(e.snap->spur[5].kit_ptr != nullptr && e.snap->spur[5].kit_ptr != s.kit_ptr);       // track 6: kit_impuls
      PRUEF(e.snap->kit_refs.size() == 3 && cache.kit_eintraege() == 2);
      // 7: gib_wiedergabe drops the references
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    PRUEF(cache.kit_eintraege() == 0 && cache.kit_aufgeschoben() == 0 && konto.gesperrt() == 0);
  }
  {  // 8: a playback refused after the kit was taken leaves nothing behind: abort by a malformed second track, by the snapshot booking
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_kit_ordner(KITS);
    cache.setze_kit_lader(cdj::lade_kit);
    o.wiedergabe(2, kit_spur(1, "kit_zwei") + ",{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":2.5},\"noten\":[]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 2, cache);
    PRUEF(e.snap == nullptr && e.grund == "format" && e.meldung.find("cutoff") != std::string::npos);
    PRUEF(cache.kit_eintraege() == 0 && cache.kit_aufgeschoben() == 0 && konto.gesperrt() == 0);
    // the kit is on the account, then the snapshot does not fit: the kit goes back, the account is empty
    cdj::SpeicherKonto eng(768 + 1000);
    cdj::ArrAudioCache enger(&eng, 50LL << 20, false);
    enger.setze_kit_ordner(KITS);
    enger.setze_kit_lader(cdj::lade_kit);
    o.wiedergabe(3, kit_spur(1, "kit_impuls"));
    e = cdj::lade_wiedergabe(o.pfad, 3, enger);
    PRUEF(e.snap == nullptr && e.grund == "zu_gross" && e.meldung.find("Schnappschuss") != std::string::npos);
    PRUEF(enger.kit_eintraege() == 0 && eng.gesperrt() == 0);
    // negative control: the same playback with room loads and balances out
    cdj::SpeicherKonto weit(100LL << 20);
    cdj::ArrAudioCache cache2(&weit, 50LL << 20, false);
    cache2.setze_kit_ordner(KITS);
    cache2.setze_kit_lader(cdj::lade_kit);
    e = cdj::lade_wiedergabe(o.pfad, 3, cache2);
    PRUEF(e.snap != nullptr && cache2.kit_eintraege() == 1);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache2);
    PRUEF(cache2.kit_eintraege() == 0 && weit.gesperrt() == 0);
  }
  {  // 9: nine kit tracks are refused zu_gross, eight load; nothing is left behind
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_kit_ordner(KITS);
    cache.setze_kit_lader(cdj::lade_kit);
    std::string acht, neun;
    for (int i = 1; i <= 9; ++i) neun += (i > 1 ? "," : "") + kit_spur(i, "kit_impuls");
    for (int i = 1; i <= 8; ++i) acht += (i > 1 ? "," : "") + kit_spur(i, "kit_impuls");
    o.wiedergabe(4, neun);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 4, cache);
    PRUEF(e.snap == nullptr && e.grund == "zu_gross" && e.meldung.find("8") != std::string::npos);
    PRUEF(cache.kit_eintraege() == 0 && konto.gesperrt() == 0);
    o.wiedergabe(5, acht);
    e = cdj::lade_wiedergabe(o.pfad, 5, cache);
    PRUEF(e.snap && e.snap->kit_refs.size() == 8 && cache.kit_eintraege() == 1);   // eight tracks, one shared Kit
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.kit_eintraege() == 0);
  }
  {  // negative control of T1.1: a playback without a kit track loads nothing from the kit store
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_kit_ordner(KITS);
    cache.setze_kit_lader(zaehlender_lader);
    g_lader_aufrufe = 0;
    o.wiedergabe(6, "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.5},\"noten\":[]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 6, cache);
    PRUEF(e.snap != nullptr && g_lader_aufrufe == 0 && cache.kit_eintraege() == 0);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(konto.gesperrt() == 0);
  }
  {  // 10: through the loader thread's function: the deferred pass of the kit store runs inside ArrLader::einmal()
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
    Leser leser;
    lader.setze_kit_ordner(KITS);
    lader.setze_kit_lader(cdj::lade_kit);
    lader.setze_kit_leser(&leser);
    auto r = std::make_unique<cdj::ArrLaderRinge>();
    auto auftrag = [](int64_t id, int64_t nr) {
      cdj::ArrAuftrag a{};
      a.id = id;
      std::snprintf(a.quelle, sizeof a.quelle, "andreas");
      a.nr = nr;
      return a;
    };
    o.wiedergabe(51, kit_spur(3, "kit_zwei"));
    PRUEF(r->auftraege.schiebe(auftrag(1, 51)));
    PRUEF(lader.einmal(*r));
    cdj::ArrErgebnis e1{};
    PRUEF(r->ergebnisse.hole(e1) && e1.snap != nullptr);
    if (e1.snap) {
      PRUEF(e1.snap->spur[2].kit_ptr != nullptr && lader.cache().kit_eintraege() == 1);
      leser.in_nutzung = e1.snap->spur[2].kit_ptr;   // the sink plays it while the snapshot goes back
      PRUEF(r->rueckgabe.schiebe(e1.snap));
      lader.einmal(*r);
      PRUEF(lader.cache().kit_eintraege() == 0 && lader.cache().kit_aufgeschoben() == 1);
      PRUEF(!lader.einmal(*r) && lader.cache().kit_aufgeschoben() == 1);   // later pass, the sink still uses it: nothing to do
      leser.in_nutzung = nullptr;
      PRUEF(lader.einmal(*r));                                              // the deferred pass counts as work, on the first pass after
      PRUEF(lader.cache().kit_aufgeschoben() == 0);
      PRUEF(konto.gesperrt() == 0);
    }
  }
  PRUEF_ENDE();
}
