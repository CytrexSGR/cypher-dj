// Plan 1.11 T12 (INTERFACES §4.11 /k/arr/export_lauf, §5.13 /e/export_lauf): the real-time export in the net thread. /k/arr/export_lauf checks the fields (cypher in the AI stop is
// refused first, before any range check, §4.7), allocates the job with its ring, hands it to a writer thread of its own (ArrExportSchreiber, arr_export_writer.cpp) and queues it to the
// core as command ARR_EXPORT_LAUF; whether and when it runs is the core's decision at the sample. No event comes back: the core publishes the end in the job, the writer thread closes the file
// and its meldung becomes /e/export_lauf here (export_zyklus), with `luecken` = the growth of frame_luecken since the command, read from the same window /zustand/kern is built from.
// The net thread allocates the job (about 2 MB, zero-initialised once) but writes no file and runs no loop over audio.
#include <time.h>

#include <algorithm>
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

int64_t mono_ns() {
  timespec ts{};
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return static_cast<int64_t>(ts.tv_sec) * 1000000000LL + ts.tv_nsec;
}

bool endet_auf_f32(const std::string& p) { return p.size() > 4 && p.compare(p.size() - 4, 4, ".f32") == 0; }

}  // namespace

bool Netz::arr_export_paket(const osc::Nachricht& m) {
  namespace f = v::feld::k_arr_export_lauf;
  Befehl b{};
  b.art = Befehl::ARR_EXPORT_LAUF;
  b.id = m.werte[f::id].h;
  kopiere(b.quelle, m.werte[f::quelle].s, sizeof b.quelle);
  const std::string pfad = m.werte[f::pfad].s;
  const double von = m.werte[f::von_beat].d, bis = m.werte[f::bis_beat].d;
  auto ab = [&](const char* grund) {
    quittung(b.id, b.quelle, 6, stand_sample_, stand_beat_, grund);
    return true;
  };
  if (!quelle_ok(b.quelle)) return ab("ausserhalb_bereich");
  if (!std::strcmp(b.quelle, "cypher") && ki_gestoppt_) return ab("ki_gestoppt");   // §4.7; the core checks again
  if (pfad.size() > 4000 || pfad[0] != '/' || !endet_auf_f32(pfad) || !std::isfinite(von) || !std::isfinite(bis) || von < 0.0 || !(bis - von >= 1.0))
    return ab("ausserhalb_bereich");
  if (bis - von > ARR_EXPORT_MAX_BEATS) return ab("zu_gross");
  export_zyklus();   // a finished run is answered before a new one is looked at
  if (export_) return ab("belegt");   // one export at a time; the core checks again against recording, freeze and tap
  auto job = std::make_unique<ArrExportLauf>();
  job->von_beat = von;
  job->bis_beat = bis;
  export_ = std::make_unique<ArrExportSchreiber>(std::move(job), pfad);
  export_luecken0_ = fenster_.werte(mono_ns()).frame_luecken;
  b.zeiger = export_->job();
  if (!einreihen(b)) export_->job()->verwerfen("zu_spaet");   // einreihen reported zu_spaet (/q 4); the writer answers /e/export_lauf
  return true;
}

void Netz::export_zyklus() {
  if (!export_ || !export_->fertig()) return;
  const ArrExportMeldung& e = export_->meldung();
  const int32_t jetzt = fenster_.werte(mono_ns()).frame_luecken;
  const int32_t luecken = std::max<int32_t>(0, jetzt - export_luecken0_);
  osc::Schreiber s(v::e_export_lauf);
  s.h(e.frames).f(e.spitze).i(luecken).i(e.ungesund).s(e.grund);
  an_alle(s);
  export_.reset();   // joins the (finished) writer thread, frees the job
}

}  // namespace cdj
