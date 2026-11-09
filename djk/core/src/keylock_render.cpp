// Keylock Slice 4: Render-Faden der REC-Umrechnung, siehe keylock_render.h.
#include "cypherdj/keylock_render.h"

#include <sched.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <exception>
#include <system_error>

#include "cypherdj/loop_stretch.h"

namespace cdj {

namespace {

// Niedrigste Priorität für den aufrufenden Faden: nice 19 und SCHED_IDLE. Fehler werden ignoriert, einmal auf stderr.
void niedrige_prioritaet() {
  const pid_t tid = static_cast<pid_t>(::syscall(SYS_gettid));
  bool fehler = false;
  if (::setpriority(PRIO_PROCESS, static_cast<id_t>(tid), 19) != 0) fehler = true;
  sched_param sp{};
  sp.sched_priority = 0;
  if (::sched_setscheduler(tid, SCHED_IDLE, &sp) != 0) fehler = true;
  if (fehler) std::fprintf(stderr, "keylock: Render-Faden konnte die Prioritaet nicht ganz absenken (nice 19 / SCHED_IDLE)\n");
}

}  // namespace

KeylockRender::KeylockRender(const KeylockOpt& opt) : opt_(opt) {
  // die Vorgabe-Funktion sieht abbruch_: ein laufender Render endet zwischen zwei R3-Stücken (Slice 3b, F6)
  if (!opt_.rec_fn)
    opt_.rec_fn = [this](const float* d, int64_t roh, int64_t frames) { return rendere_rec(d, roh, frames, &abbruch_); };
  // Slice 3b (F5): ein Fadenstart, der scheitert (std::system_error bei Thread-Mangel), darf den Kern nicht mitnehmen
  try {
    if (opt_.faden_start_wirft) throw std::system_error(std::make_error_code(std::errc::resource_unavailable_try_again), "Test");
    faden_ = std::thread([this] { faden(); });
    faden_laeuft_ = true;
  } catch (const std::exception& x) {
    std::fprintf(stderr, "keylock: Render-Faden startet nicht (%s), REC bei T != 128 wird nicht umgerechnet\n", x.what());
  } catch (...) {
    std::fprintf(stderr, "keylock: Render-Faden startet nicht, REC bei T != 128 wird nicht umgerechnet\n");
  }
}

void KeylockRender::abbrechen() {
  abbruch_.store(true);
  {
    std::lock_guard<std::mutex> lk(m_);
    stopp_ = true;
  }
  cv_.notify_all();
}

KeylockRender::~KeylockRender() {
  abbrechen();
  if (faden_.joinable()) faden_.join();
  // Slice 4: ein REC, das beim Stopp noch wartet oder nicht abgeholt ist, geht verloren: das steht im Protokoll
  for (const auto* q : {&rec_auftraege_, &rec_fertig_})
    for (const RecErgebnis& r : *q)
      if (r.mt) std::fprintf(stderr, "keylock: REC %s verworfen (Netz wird beendet, Datei nicht geschrieben)\n", r.mt->name);
}

void KeylockRender::rec_auftrag(std::unique_ptr<Mitschnitt> mt, const RecMeldung& meldung) {
  if (!mt) return;
  if (!faden_laeuft_ || abbruch_.load()) {  // kein Faden oder das Netz wird beendet: der Mitschnitt geht verloren, sichtbar
    std::fprintf(stderr, "keylock: REC %s verworfen (Render-Faden steht nicht zur Verfügung, Datei nicht geschrieben)\n", mt->name);
    return;
  }
  {
    std::lock_guard<std::mutex> lk(m_);
    RecErgebnis a;
    a.mt = std::move(mt);
    a.meldung = meldung;
    rec_auftraege_.push_back(std::move(a));
  }
  cv_.notify_one();
}

bool KeylockRender::rec_hole(RecErgebnis& e) {
  std::lock_guard<std::mutex> lk(m_);
  if (rec_fertig_.empty()) return false;
  e = std::move(rec_fertig_.front());
  rec_fertig_.pop_front();
  return true;
}

KeylockRender::RecErgebnis KeylockRender::rechne_rec(RecErgebnis a) {
  Mitschnitt& mt = *a.mt;
  const auto t0 = std::chrono::steady_clock::now();
  try {
    std::vector<float> v = opt_.rec_fn(mt.daten.data(), mt.roh_frames, mt.frames);
    if (abbruch_.load()) {  // Netz wird beendet: der Faden gibt den Mitschnitt mit einer eigenen Zeile frei
      a.fehler = true;
      return a;
    }
    if (v.size() != (size_t)mt.frames * 2) {
      std::fprintf(stderr, "keylock: REC %s %.2f BPM: Umrechnung lieferte %zu statt %lld Werte, keine Datei\n", mt.name, mt.bpm,
                   v.size(), (long long)mt.frames * 2);
      a.fehler = true;
      return a;
    }
    mt.daten = std::move(v);
    mt.umgerechnet = true;
  } catch (const std::exception& x) {
    std::fprintf(stderr, "keylock: REC %s %.2f BPM: Umrechnung fehlgeschlagen (%s), keine Datei\n", mt.name, mt.bpm, x.what());
    a.fehler = true;
    return a;
  } catch (...) {
    std::fprintf(stderr, "keylock: REC %s %.2f BPM: Umrechnung fehlgeschlagen, keine Datei\n", mt.name, mt.bpm);
    a.fehler = true;
    return a;
  }
  const long long ms =
      (long long)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
  std::fprintf(stderr, "keylock: REC %s %.2f BPM umgerechnet %lld ms\n", mt.name, mt.bpm, ms);
  return a;
}

void KeylockRender::faden() {
  try {
    faden_schleife();
  } catch (...) {  // nichts darf den Faden verlassen (std::terminate): die REC-Umrechnung endet
    std::fprintf(stderr, "keylock: Render-Faden endet durch eine Ausnahme, REC bei T != 128 wird nicht mehr umgerechnet\n");
  }
}

void KeylockRender::faden_schleife() {
  if (opt_.niedrige_prio) niedrige_prioritaet();
  std::unique_lock<std::mutex> lk(m_);
  for (;;) {
    cv_.wait(lk, [&] { return stopp_ || !rec_auftraege_.empty(); });
    if (stopp_) break;  // ein wartender Auftrag startet nicht mehr
    RecErgebnis a = std::move(rec_auftraege_.front());  // Slice 4: in Eingangsreihenfolge
    rec_auftraege_.pop_front();
    lk.unlock();
    RecErgebnis r = rechne_rec(std::move(a));
    lk.lock();
    if (stopp_) {  // der Mitschnitt wird hier freigegeben: Zeile im Protokoll
      std::fprintf(stderr, "keylock: REC %s verworfen (Netz wird beendet, Datei nicht geschrieben)\n", r.mt->name);
      break;
    }
    try {
      rec_fertig_.push_back(std::move(r));
    } catch (...) {  // bad_alloc der Warteschlange: r ist dann nicht verschoben worden und wird hier freigegeben
      std::fprintf(stderr, "keylock: REC: Ergebnis nicht ablegbar (Speicher), keine Datei\n");
    }
  }
}

}  // namespace cdj
