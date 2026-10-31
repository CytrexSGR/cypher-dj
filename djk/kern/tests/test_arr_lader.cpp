// D1 K1 Slice 3: Arrangement-Lade-Faden (arr_lader.h, Spec D1 2.1). Auftrag -> Ergebnis mit Schnappschuss oder Grund,
// Rückgabe -> Freigabe nur hier; der Faden läuft allein (laufen/stop); das gemeinsame Konto mit dem Deck-Lader: hält das
// Arrangement Speicher, scheitert ein Deck mit budget_speicher, ohne es lädt das Deck (Negativ-Kontrolle).
// K1-Fix 6 (Fall 4): der Deck-Lader bucht das Konto vor mmap und mlock; während das Arrangement das Konto hält, sperrt ein
// Deck-Laden keinen Speicher über das Konto hinaus (ein Beobachter-Faden misst VmLck). Mutation
// CYPHERDJ_MUTATION_LADER_KONTO_SPAET (Buchung erst nach dem Sperren, wie vorher) macht Fall 4 rot.
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <thread>

#include "arr_datei.h"
#include "cypherdj/arr_lader.h"
#include "cypherdj/lader.h"
#include "cypherdj/warp_werk.h"
#include "kern35.h"
#include "pruef.h"

bool g_waechter = false;

// Paket 1.13 Slice 2: ein Werk, das nur die Frage liest() beantwortet (Fall 6)
struct FragWerk final : cdj::WarpWerk {
  std::atomic<bool> liest_noch{false};
  cdj::StreckRing r;
  int belege() noexcept override { return -1; }
  void ansetzen(int, cdj::WarpAnsatz&) noexcept override {}
  void gib(int) noexcept override {}
  cdj::StreckRing& ring(int) noexcept override { return r; }
  int64_t ende_s(int) const noexcept override { return INT64_MAX; }
  void takt(int64_t) noexcept override {}
  int belegt() const noexcept override { return 0; }
  bool liest(const cdj::ArrSnapshot*) const noexcept override { return liest_noch.load(); }
  int faeden() const noexcept override { return 0; }
  int prioritaet(int) override { return 0; }
  void stoppe() override {}
  cdj::WarpZaehler zaehler() const noexcept override { return {}; }
  std::string schluss_json() const override { return "{}"; }
  void test_halte(bool) noexcept override {}
  void test_halte_block(bool) noexcept override {}
};

static cdj::ArrAuftrag auftrag(int64_t id, int64_t nr) {
  cdj::ArrAuftrag a{};
  a.id = id;
  std::snprintf(a.quelle, sizeof a.quelle, "andreas");
  a.nr = nr;
  return a;
}

int main() {
  arrdatei::Ordner o("test_arr_lader");
  const int64_t F = 48000 * 4;   // 4 s, 1,5 MiB
  const std::string a = o.audio('a', F);
  o.wiedergabe(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, F) + "]}");
  {  // 1: synchron: ein Auftrag je Durchgang, Ergebnis mit Schnappschuss oder Grund, Rückgabe gibt frei
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
    auto r = std::make_unique<cdj::ArrLaderRinge>();
    PRUEF(!lader.einmal(*r));   // nichts zu tun
    PRUEF(r->auftraege.schiebe(auftrag(11, 1)) && r->auftraege.schiebe(auftrag(12, 99)));
    PRUEF(lader.einmal(*r));
    cdj::ArrErgebnis e{};
    PRUEF(r->ergebnisse.hole(e) && e.auftrag.id == 11 && e.snap && e.snap->nr == 1 && e.grund[0] == '\0');
    PRUEF(!r->ergebnisse.hole(e));   // höchstens ein Auftrag je Durchgang
    PRUEF(lader.einmal(*r));
    cdj::ArrErgebnis f{};
    PRUEF(r->ergebnisse.hole(f) && f.auftrag.id == 12 && !f.snap && !std::strcmp(f.grund, "datei_fehlt"));
    PRUEF(lader.cache().eintraege() == 1 && konto.gesperrt() == F * 8 + cdj::arr_audio_kopf() + e.snap->gesperrt_bytes);   // Audio (Daten, Kopf) und Schnappschuss
    PRUEF(r->rueckgabe.schiebe(e.snap));
    lader.einmal(*r);
    PRUEF(lader.cache().eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 2: als Faden: Ergebnis kommt ohne Zutun des Aufrufers, stop beendet ihn
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
    auto r = std::make_unique<cdj::ArrLaderRinge>();
    std::atomic<bool> stop{false};
    std::thread t([&] { lader.laufen(*r, stop); });
    PRUEF(r->auftraege.schiebe(auftrag(21, 1)));
    cdj::ArrErgebnis e{};
    bool da = false;
    for (int i = 0; i < 2000 && !da; ++i) {
      da = r->ergebnisse.hole(e);
      if (!da) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    PRUEF(da && e.snap);
    if (da && e.snap) PRUEF(r->rueckgabe.schiebe(e.snap));
    for (int i = 0; i < 2000 && konto.gesperrt() != 0; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    PRUEF(konto.gesperrt() == 0);
    stop = true;
    t.join();
  }
  {  // 3: ein Konto für Decks und Arrangement: das Deck (64 Beats Träger, 11 MiB) passt nur ohne das Arrangement
    k35::Arbeitsbestand ab("test_arr_lader_ab");
    k35::traeger(ab.pfad, "a1a0000000000e01", "--ohne-klick --traeger 0.1");
    for (int mit_arr = 0; mit_arr < 2; ++mit_arr) {
      cdj::SpeicherKonto konto(12LL << 20);
      cdj::Lader deck(ab.pfad, 3800LL << 20);
      deck.verbinde_konto(&konto);
      cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
      auto r = std::make_unique<cdj::ArrLaderRinge>();
      cdj::ArrErgebnis e{};
      if (mit_arr) {
        r->auftraege.schiebe(auftrag(31, 1));
        lader.einmal(*r);
        PRUEF(r->ergebnisse.hole(e) && e.snap);
      }
      cdj::LadeAuftrag la{};
      std::snprintf(la.material_id, sizeof la.material_id, "a1a0000000000e01");
      la.deck = 1;
      la.fassung = 1;
      la.basis_bpm = 128.0;
      cdj::LadeGrund g;
      std::string m;
      cdj::LaderOptionen opt;
      opt.sperren = false;
      cdj::Material* mat = deck.lade(la, g, m, opt);
      if (mit_arr) PRUEF(!mat && g == cdj::LadeGrund::budget_speicher);
      else PRUEF(mat && g == cdj::LadeGrund::ok && konto.gesperrt() == deck.gesperrt());
      deck.gib_frei(mat);
      if (e.snap) {
        r->rueckgabe.schiebe(e.snap);
        lader.einmal(*r);
      }
      PRUEF(konto.gesperrt() == 0);
    }
  }
  {  // 4: K1-Fix 6: zwei Lade-Fäden, ein Konto. Das Arrangement (Lade-Faden, gesperrt) hält 11 MiB von 16 MiB; dann lädt
     // ein Deck (11 MiB, eigener Faden, sperren und Prüfsumme an: das Abbild bliebe für die sha256 gesperrt). Gebucht vor
     // dem Einblenden scheitert es mit budget_speicher, ohne zu sperren: VmLck bleibt ≤ Konto. Gegenprobe mit einem
     // Konto für beide: der Beobachter sieht beide gesperrt (das Instrument trifft).
    auto vm_lck = [] {
      std::ifstream f("/proc/self/status");
      std::string z;
      while (std::getline(f, z))
        if (z.rfind("VmLck:", 0) == 0) return std::atol(z.c_str() + 6) * 1024L;
      return -1L;
    };
    k35::Arbeitsbestand ab("test_arr_lader_ab4");
    k35::traeger(ab.pfad, "a1a0000000000e02", "--ohne-klick --traeger 0.1");
    const int64_t FA = 48000 * 30;   // 30 s, 11 MiB
    const std::string gross = o.audio('d', FA);
    o.wiedergabe(41, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, gross, FA) + "]}");
    for (int beide = 0; beide < 2; ++beide) {
      const long basis = vm_lck();
      cdj::SpeicherKonto konto(beide ? (40LL << 20) : (16LL << 20));
      cdj::Lader deck(ab.pfad, 3800LL << 20);
      deck.verbinde_konto(&konto);
      cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, true);
      auto r = std::make_unique<cdj::ArrLaderRinge>();
      r->auftraege.schiebe(auftrag(41, 41));
      lader.einmal(*r);
      cdj::ArrErgebnis e{};
      PRUEF(r->ergebnisse.hole(e) && e.snap);
      std::atomic<bool> fertig{false};
      long spitze = 0;
      std::thread beob([&] {
        while (!fertig.load()) spitze = std::max(spitze, vm_lck() - basis);
      });
      cdj::LadeAuftrag la{};
      std::snprintf(la.material_id, sizeof la.material_id, "a1a0000000000e02");
      la.deck = 1;
      la.fassung = 1;
      la.basis_bpm = 128.0;
      cdj::LadeGrund g = cdj::LadeGrund::ok;
      std::string m;
      cdj::Material* mat = nullptr;
      std::thread faden([&] { mat = deck.lade(la, g, m, cdj::LaderOptionen{}); });
      faden.join();
      fertig = true;
      beob.join();
      std::printf("Fall 4 (%s): VmLck-Spitze %ld KiB, Konto %lld KiB, Deck %s\n", beide ? "Konto für beide" : "Konto für eins",
                  spitze >> 10, static_cast<long long>(konto.budget() >> 10), mat ? "geladen" : m.c_str());
#ifdef __SANITIZE_THREAD__
      constexpr bool vmlck_sichtbar = false;   // TSan fängt mlock ab (wirkungslos): VmLck bleibt 0, nur das Konto zählt
#else
      constexpr bool vmlck_sichtbar = true;
#endif
      if (beide) {
        PRUEF(mat && g == cdj::LadeGrund::ok);
        if (vmlck_sichtbar) PRUEF(spitze > (16L << 20));   // Gegenprobe: der Beobachter sieht Arrangement und Deck gesperrt
      } else {
        PRUEF(!mat && g == cdj::LadeGrund::budget_speicher);
        PRUEF(spitze <= konto.budget());
      }
      deck.gib_frei(mat);
      r->rueckgabe.schiebe(e.snap);
      lader.einmal(*r);
      PRUEF(konto.gesperrt() == 0);
    }
    // jeder Fehlerpfad nach der Buchung bucht zurück: falsche Prüfsumme, NaN in der Stichprobe
    const std::string kf = "python3 " + k35::djk() + "/kern/tests/deck/klick_fassung.py --ziel " + ab.pfad + " --beats 8 ";
    PRUEF(std::system((kf + "--material-id c1c0000000000e03 --falsche-pruefsumme > /dev/null").c_str()) == 0);
    PRUEF(std::system((kf + "--material-id c1c0000000000e04 --nan-bei 0 > /dev/null").c_str()) == 0);
    for (const char* id : {"c1c0000000000e03", "c1c0000000000e04"}) {
      cdj::SpeicherKonto konto(16LL << 20);
      cdj::Lader deck(ab.pfad, 3800LL << 20);
      deck.verbinde_konto(&konto);
      cdj::LadeAuftrag la{};
      std::snprintf(la.material_id, sizeof la.material_id, "%s", id);
      la.deck = 1;
      la.fassung = 1;
      la.basis_bpm = 128.0;
      cdj::LadeGrund g = cdj::LadeGrund::ok;
      std::string m;
      cdj::Material* mat = deck.lade(la, g, m, cdj::LaderOptionen{});
      PRUEF(!mat && g == cdj::LadeGrund::pruefung);
      if (konto.gesperrt() != 0) std::printf("Fall 4 %s: Konto %lld nach %s\n", id, static_cast<long long>(konto.gesperrt()), m.c_str());
      PRUEF(konto.gesperrt() == 0);
      deck.gib_frei(mat);
    }
  }
  {  // 5: K1-Fix 9: der Ergebnisring ist 1 s voll (das Netz steht). Das Ergebnis geht nicht verloren: der Schnappschuss
     // wird freigegeben, das Ergebnis wird zu_spaet ohne Schnappschuss und wartet, bis Platz ist; so endet die id genau
     // einmal (/q 4 im Netz). Solange es wartet, nimmt der Lader keinen neuen Auftrag.
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
    auto r = std::make_unique<cdj::ArrLaderRinge>();
    cdj::ArrErgebnis voll{};
    int n = 0;
    while (r->ergebnisse.schiebe(voll)) ++n;
    PRUEF(r->auftraege.schiebe(auftrag(51, 1)) && r->auftraege.schiebe(auftrag(52, 1)));
    lader.einmal(*r);   // wartet 1 s, gibt auf
    PRUEF(konto.gesperrt() == 0 && lader.cache().eintraege() == 0);
    lader.einmal(*r);   // der Ring ist noch voll: kein neuer Auftrag
    cdj::ArrAuftrag x;
    cdj::ArrErgebnis e{};
    for (int i = 0; i < n; ++i) PRUEF(r->ergebnisse.hole(e) && e.auftrag.id == 0);
    PRUEF(!r->ergebnisse.hole(e));
    lader.einmal(*r);   // Platz: das wartende Ergebnis geht hinaus
    const bool da = r->ergebnisse.hole(e);
    if (!da || e.auftrag.id != 51) std::printf("Fall 5: kein Ergebnis für 51 (da %d, id %lld)\n", da, (long long)e.auftrag.id);
    PRUEF(da && e.auftrag.id == 51 && !e.snap && !std::strcmp(e.grund, "zu_spaet"));
    lader.einmal(*r);   // danach der nächste Auftrag
    PRUEF(r->ergebnisse.hole(e) && e.auftrag.id == 52 && e.snap);
    if (e.snap) {
      r->rueckgabe.schiebe(e.snap);
      lader.einmal(*r);
    }
    PRUEF(konto.gesperrt() == 0 && !r->auftraege.hole(x));
  }
  {  // 6 (Slice 2): ein abgelöster Schnappschuss, den das Warp-Werk noch liest, wartet; erst danach gibt der Lader ihn frei
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
    FragWerk werk;
    lader.setze_warp_werk(&werk);
    auto r = std::make_unique<cdj::ArrLaderRinge>();
    PRUEF(r->auftraege.schiebe(auftrag(61, 1)));
    lader.einmal(*r);
    cdj::ArrErgebnis e{};
    PRUEF(r->ergebnisse.hole(e) && e.snap);
    werk.liest_noch = true;
    PRUEF(r->rueckgabe.schiebe(e.snap));
    lader.einmal(*r);
    PRUEF(lader.cache().eintraege() == 1 && konto.gesperrt() > 0 && lader.aufgeschoben() == 1);   // das Werk liest noch: nicht freigegeben
    lader.einmal(*r);
    PRUEF(lader.cache().eintraege() == 1 && lader.aufgeschoben() == 1);                          // auch im nächsten Durchgang nicht
    werk.liest_noch = false;
    PRUEF(lader.einmal(*r));
    PRUEF(lader.cache().eintraege() == 0 && konto.gesperrt() == 0 && lader.aufgeschoben() == 0);   // jetzt ja
  }
  PRUEF_ENDE();
}
