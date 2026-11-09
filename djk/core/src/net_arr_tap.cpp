// 1.10 slice 7 (T5, spec 5.7; INTERFACES §4.11 /k/arr/abgriff, §5.13 /e/abgriff): the tap in the net thread, the sibling of net_arr_freeze.cpp (untouched).
// /k/arr/abgriff checks the fields (cypher in the AI stop refuses first, before any range check, §4.7) and queues a job for the Arrangement load thread; that one
// allocates it with its buffer (arr_loader.h), its result goes as command ARR_ABGRIFF into the kern. Whether and when it runs is the kern's decision at the sample.
// It comes back as event ARR_ABGRIFF and goes to the load thread: at status 0 it writes <arr_ordner>/abgriff-<art>-<nr>-<kennung>.f32 (never replacing) and frees the
// buffer; its message becomes /e/abgriff (0 done, 1 aborted, 2 not written). A refused job (receipt 6 came from the kern) is only freed. The net thread allocates no
// buffer and writes no file: with 256 beats /uhr and every OSC answer would stand still for 27 to 100 ms (spec 6.29, test_netz_arr_abgriff).
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

#include "cypherdj/net.h"

namespace cdj {

namespace v = cypherdj::osc;

namespace {

void kopiere(char* ziel, const char* quelle, size_t n) {
  std::strncpy(ziel, quelle, n - 1);
  ziel[n - 1] = '\0';
}

bool quelle_ok(const char* q) {
  for (const auto& n : v::werte::quelle)
    if (n == q) return true;
  return false;
}

// highest strip number per kind (track, group, return, PM); the kern still refuses a number that does not exist in the playback (spur_bereich)
int nr_max(int art) { return art == 0 ? ARR_SPUREN : art == 1 ? ARR_GRUPPEN : art == 2 ? ARR_RETURNS : 1; }

}  // namespace

bool Netz::arr_abgriff_paket(const osc::Nachricht& m) {
  namespace f = v::feld::k_arr_abgriff;
  ArrAuftrag a{};
  a.art = ArrAuftrag::ABGRIFF;
  a.id = m.werte[f::id].h;
  kopiere(a.quelle, m.werte[f::quelle].s, sizeof a.quelle);
  a.strang_art = m.werte[f::art].i;
  a.spur = m.werte[f::nr].i;
  a.punkt = m.werte[f::punkt].i;
  a.von_beat = m.werte[f::von_beat].d;
  a.bis_beat = m.werte[f::bis_beat].d;
  a.kennung = m.werte[f::kennung].i;
  auto ab = [&](const char* grund) {
    quittung(a.id, a.quelle, 6, stand_sample_, stand_beat_, grund);
    return true;
  };
  if (!quelle_ok(a.quelle)) return ab("ausserhalb_bereich");
  if (!std::strcmp(a.quelle, "cypher") && ki_gestoppt_) return ab("ki_gestoppt");   // §4.7; the kern checks again
  const double von = a.von_beat, bis = a.bis_beat;
  if (a.strang_art < 0 || a.strang_art > 3 || a.spur < 1 || a.spur > nr_max(a.strang_art) || a.punkt < 0 || a.punkt > 1 || !std::isfinite(von) ||
      !std::isfinite(bis) || von < 0.0 || !(bis - von >= 1.0) || a.kennung < 0)
    return ab("ausserhalb_bereich");
  if (bis - von > ARR_FREEZE_MAX_BEATS) return ab("zu_gross");
  if (arr_ordner_.empty() || !arr_ringe_) {
    std::fprintf(stderr, "/k/arr/abgriff: no work folder or no arrangement loader\n");
    return ab("datei_fehlt");
  }
  if (!arr_ringe_->auftraege.schiebe(a))
    quittung(a.id, a.quelle, 4, stand_sample_, stand_beat_, "zu_spaet");   // 16 jobs open: the loader hangs
  return true;
}

void Netz::arr_abgriff_ergebnis(const ArrErgebnis& e) {
  if (!e.abgriff) {   // not allocatable (zu_gross) or the result ring was full for too long (zu_spaet, /q 4)
    quittung(e.auftrag.id, e.auftrag.quelle, std::strcmp(e.grund, "zu_spaet") ? 6 : 4, stand_sample_, stand_beat_, e.grund);
    return;
  }
  Befehl b{};
  b.art = Befehl::ARR_ABGRIFF;
  b.id = e.auftrag.id;
  std::memcpy(b.quelle, e.auftrag.quelle, sizeof b.quelle);
  b.nr = e.auftrag.spur;
  b.zeiger = e.abgriff;
  if (!einreihen(b)) {   // einreihen reported zu_spaet; the job goes back to be freed
    e.abgriff->status = ARR_ABGRIFF_ABGELEHNT;
    arr_abgriff_zurueck(e.abgriff);
  }
}

void Netz::arr_abgriff_ereignis(const Ereignis& e) {
  auto* f = static_cast<ArrAbgriff*>(const_cast<void*>(e.zeiger));
  if (!f) return;
  f->status = e.status;   // 0 done, 1 aborted, ARR_ABGRIFF_ABGELEHNT: the load thread writes or only frees
  arr_abgriff_zurueck(f);
}

void Netz::arr_abgriff_zurueck(ArrAbgriff* f) {
  if (!arr_ringe_) {   // without a load thread (tests without verbinde_arr): free here
    delete f;
    return;
  }
  for (int i = 0; i < 1000; ++i) {   // the load thread empties it every pass; if it stands, report after 1 s (a leak instead of a crash)
    if (arr_ringe_->abgriff_zurueck.schiebe(f)) return;
    usleep(1000);
  }
  std::fprintf(stderr, "Arrangement: return ring full, tap art %d nr %d id %d not freed\n", f->art, f->nr, f->kennung);
}

void Netz::arr_abgriff_melden(const ArrAbgriffMeldung& m) {
  osc::Schreiber s(v::e_abgriff);
  s.i(m.art).i(m.nr).i(m.kennung).i(m.status).h(m.status == 0 ? m.frames : 0);
  an_alle(s);
}

}  // namespace cdj
