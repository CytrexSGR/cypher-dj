// Paket K3 (Spec 6.29): Puffer anlegen und Freeze-Datei schreiben laufen nicht im Netz-Faden. Während eines Freeze von
// 256 Beats (Höchstlänge) liegt der größte Abstand zweier /uhr-Meldungen an der Gegenstelle unter dem Doppelten des
// normalen Abstands (Median vor dem Freeze). Gemessen in zwei Fenstern: Anlegen (1 s ab /k/arr/freeze) und Schreiben
// (0,5 s vor bis 0,3 s nach /e/freeze). Kern, Netz und Lade-Faden laufen in eigenen Fäden (freeze_faeden.h); der
// Kern-Faden spielt die Fenster in Echtzeit und den langen Mittelteil ohne Pause (sonst dauerte die Probe 4 Minuten).
// Fix L4: Projekttempo 60 BPM (Puffer und Datei je rund 99 MB, vorher bei 128 BPM eine Datei von 46 MB) und der
// Arbeitsordner auf einer echten Platte ($TMPDIR, sonst /tmp; kein tmpfs, geprüft), damit jede Mutation für sich rot wird.
// Mutationen, getrennt: ARR_FREEZE_ANLEGEN_IM_NETZ (Fenster Anlegen rot) und ARR_FREEZE_SCHREIBEN_IM_NETZ (Fenster
// Schreiben rot). Vorher, gemischt und auf /dev/shm, blieb „nur Schreiben verschoben“ in 1 von 7 Läufen grün.
#include <sys/vfs.h>
#include <linux/magic.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>

#include "freeze_faeden.h"

int main() {
  const char* tmp = std::getenv("TMPDIR");
  const std::string basis = tmp && *tmp ? tmp : "/tmp";
  ff::Aufbau x("test_netz_arr_freeze_uhr", basis, 60.0);
  struct statfs fs {};
  const bool platte = statfs(x.ordner.pfad.c_str(), &fs) == 0 && fs.f_type != TMPFS_MAGIC && fs.f_type != RAMFS_MAGIC;
  std::printf("freeze_uhr: Arbeitsordner %s, Dateisystem 0x%lx (%s)\n", x.ordner.pfad.c_str(),
              static_cast<unsigned long>(fs.f_type), platte ? "Platte" : "tmpfs/ramfs");
  PRUEF(platte);
  const std::string a = x.ordner.audio('a', 48000);
  x.ordner.wiedergabe(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 1.0, a, 48000) + "]}");
  constexpr int64_t SPB = 48000;   // 60 BPM
  constexpr int64_t FRAMES = (256 + 2) * SPB;
  std::atomic<bool> schnell_frei{false};
  std::atomic<int64_t> einsatz{-1};
  // Kern-Faden: nach dem Einsatz bleibt er in Echtzeit, bis die Probe das Anlege-Fenster hinter sich hat; dann ohne Pause
  // bis 0,6 s vor das Ende des Nachlaufs, dann wieder in Echtzeit
  x.starten([&](cdj::Kern& k) {
    if (einsatz.load() < 0 && k.arrangement().freeze_laeuft() && k.arrangement().status() == cdj::ArrStatus::spielt)
      einsatz.store(k.sample());
    const int64_t e = einsatz.load();
    if (e < 0 || !schnell_frei.load()) return;
    x.echtzeit.store(k.sample() >= e + FRAMES - 28800 || !k.arrangement().freeze_laeuft());
  });
  x.hallo();
  PRUEF(x.warte("/k/willkommen", 1000, [](const cdj::osc::Nachricht&) { return true; }) >= 0);
  const int64_t l = x.laden(1);
  PRUEF(x.warte_q(l, 3, 3000) >= 0);
  // Bezug: 1 s normaler Betrieb
  const size_t bezug_ab = x.pakete.size();
  const int64_t t0 = ff::real_ns();
  while (ff::real_ns() < t0 + 1000000000LL) x.sammeln(5);
  const size_t bezug_bis = x.pakete.size();
  const int64_t t_freeze = ff::real_ns();
  const int64_t fid = x.freeze(1, 0.0, 256.0, 1);
  PRUEF(x.warte_q(fid, 1, 3000) >= 0);
  PRUEF(x.warte_q(fid, 2, 3000) >= 0);
  while (ff::real_ns() < t_freeze + 1000000000LL) x.sammeln(5);
  schnell_frei.store(true);
  const long e = x.warte("/e/freeze", 120000, [](const cdj::osc::Nachricht& m) { return m.werte[1].i == 1; });
  PRUEF(e >= 0);
  const int64_t t_e = e >= 0 ? x.pakete[static_cast<size_t>(e)].t_ns : ff::real_ns();
  while (ff::real_ns() < t_e + 300000000LL) x.sammeln(5);
  x.anhalten();

  // Abstände zweier /uhr in [von, bis) (Empfangszeit)
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
  const int64_t max_an = groesster(abstaende(t_freeze, t_freeze + 1000000000LL));
  const int64_t max_schreib = groesster(abstaende(t_e - 500000000LL, t_e + 300000000LL));
  int status = -1;
  int64_t frames = -1;
  if (e >= 0) {
    cdj::osc::Nachricht m;
    const ff::Paket& p = x.pakete[static_cast<size_t>(e)];
    if (cdj::osc::lesen(p.roh.data(), p.roh.size(), m)) {
      status = m.werte[2].i;
      frames = m.werte[3].h;
    }
  }
  std::printf("freeze_uhr: normal %.2f ms (%zu Abstände), größter Abstand beim Anlegen %.2f ms, beim Schreiben %.2f ms; "
              "/e/freeze Status %d, frames %lld, Datei %lld Bytes\n",
              normal / 1e6, bezug.size(), max_an / 1e6, max_schreib / 1e6, status, (long long)frames,
              std::filesystem::exists(x.ordner.pfad + "/freeze-1-1.f32")
                  ? (long long)std::filesystem::file_size(x.ordner.pfad + "/freeze-1-1.f32")
                  : -1LL);
  PRUEF(normal > 4000000 && normal < 7000000);   // ein Zyklus 256/48000 s = 5,33 ms
  PRUEF(status == 0 && frames == FRAMES);
  PRUEF(max_an > 0 && max_an < 2 * normal);
  PRUEF(max_schreib > 0 && max_schreib < 2 * normal);
  PRUEF_ENDE();
}
