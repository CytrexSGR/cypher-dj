// Keylock Slice 3: Render-Faden, siehe keylock_render.h.
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

KeylockRender::KeylockRender(int boxen, const KeylockOpt& opt)
    : opt_(opt), auftraege_((size_t)boxen), fertig_((size_t)boxen), fertig_da_((size_t)boxen, false) {
  // die Vorgabe-Funktionen sehen abbruch_: ein laufender Render endet zwischen zwei R3-Stücken (Slice 3b, F6)
  if (!opt_.fn)
    opt_.fn = [this](const std::vector<float>& d, double b) { return rendere_keylock(d, b, &abbruch_); };
  if (!opt_.rec_fn)
    opt_.rec_fn = [this](const float* d, int64_t roh, int64_t frames) { return rendere_rec(d, roh, frames, &abbruch_); };
  // Slice 3b (F5): ein Fadenstart, der scheitert (std::system_error bei Thread-Mangel), darf den Kern nicht mitnehmen
  try {
    if (opt_.faden_start_wirft) throw std::system_error(std::make_error_code(std::errc::resource_unavailable_try_again), "Test");
    faden_ = std::thread([this] { faden(); });
    faden_laeuft_ = true;
  } catch (const std::exception& x) {
    std::fprintf(stderr, "keylock: Render-Faden startet nicht (%s), Keylock bleibt aus, die Boxen bleiben im Varispeed\n", x.what());
  } catch (...) {
    std::fprintf(stderr, "keylock: Render-Faden startet nicht, Keylock bleibt aus, die Boxen bleiben im Varispeed\n");
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

void KeylockRender::auftrag(int box, std::shared_ptr<const KeylockQuelle> q, double bpm) {
  if (box < 1 || box > (int)auftraege_.size() || !q || !faden_laeuft_ || abbruch_.load()) return;
  {
    std::lock_guard<std::mutex> lk(m_);
    Auftrag& a = auftraege_[(size_t)box - 1];
    a.da = true;  // ersetzt einen noch nicht gestarteten
    a.nr = ++zaehler_;
    a.quelle = std::move(q);
    a.bpm = bpm;
  }
  cv_.notify_one();
}

bool KeylockRender::hole(Ergebnis& e) {
  std::lock_guard<std::mutex> lk(m_);
  for (size_t i = 0; i < fertig_.size(); ++i)
    if (fertig_da_[i]) {
      e = std::move(fertig_[i]);
      fertig_[i] = Ergebnis{};
      fertig_da_[i] = false;
      return true;
    }
  return false;
}

KeylockRender::Ergebnis KeylockRender::rechne(int box, const std::shared_ptr<const KeylockQuelle>& q, double bpm) {
  Ergebnis e;
  e.box = box;
  e.quelle = q;
  e.bpm = bpm;
  const auto t0 = std::chrono::steady_clock::now();
  // Slice 3b (F5): der ganze Auftrag steht im try (Render, Bau der Loop, Kopien), nicht nur die Render-Funktion: std::bad_alloc
  // in make_unique<Loop> oder beim Kopieren des Namens würde den Faden verlassen und den Kern über std::terminate mitnehmen
  try {
    if (opt_.haken_start) opt_.haken_start();  // Test-Zugang
    std::vector<float> v = opt_.fn(q->daten, bpm);
    if (abbruch_.load()) {  // Netz wird beendet: das leere Ergebnis ist der Abbruch, kein Fehler des Renders
      e.fehler = true;
      return e;
    }
    if (v.empty() || v.size() % 2 != 0) {
      std::fprintf(stderr, "keylock: Box %d %.2f BPM: Render lieferte nichts, die Box bleibt im Varispeed\n", box, bpm);
      e.fehler = true;
      return e;
    }
    if (opt_.haken_bau) opt_.haken_bau();  // Test-Zugang
    auto l = std::make_unique<Loop>();
    l->name = q->name;  // der Kern lehnt eine Variante mit anderem name oder anderen beats ab
    l->beats = q->beats;
    l->frames = (int64_t)(v.size() / 2);
    l->bpm = bpm;  // T_r, das Tempo, bei dem gerendert wurde
    l->versatz = q->versatz;
    l->daten = std::move(v);
    e.loop = std::move(l);
  } catch (const std::exception& x) {
    std::fprintf(stderr, "keylock: Box %d %.2f BPM: Render fehlgeschlagen (%s), die Box bleibt im Varispeed\n", box, bpm, x.what());
    e.loop.reset();
    e.fehler = true;
    return e;
  } catch (...) {
    std::fprintf(stderr, "keylock: Box %d %.2f BPM: Render fehlgeschlagen, die Box bleibt im Varispeed\n", box, bpm);
    e.loop.reset();
    e.fehler = true;
    return e;
  }
  const long long ms =
      (long long)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
  std::fprintf(stderr, "keylock: Box %d %.2f BPM fertig %lld ms\n", box, bpm, ms);
  return e;
}

void KeylockRender::faden() {
  try {
    faden_schleife();
  } catch (...) {  // nichts darf den Faden verlassen (std::terminate): Keylock endet, die Boxen bleiben im Varispeed
    std::fprintf(stderr, "keylock: Render-Faden endet durch eine Ausnahme, Keylock bleibt aus\n");
  }
}

void KeylockRender::faden_schleife() {
  if (opt_.niedrige_prio) niedrige_prioritaet();
  std::unique_lock<std::mutex> lk(m_);
  for (;;) {
    int box = -1;
    cv_.wait(lk, [&] {
      if (stopp_) return true;
      if (!rec_auftraege_.empty()) return true;
      for (size_t i = 0; i < auftraege_.size(); ++i)
        if (auftraege_[i].da) return true;
      return false;
    });
    if (stopp_) break;  // ein wartender Auftrag startet nicht mehr
    if (!rec_auftraege_.empty()) {  // Slice 4: REC zuerst, in Eingangsreihenfolge
      RecErgebnis a = std::move(rec_auftraege_.front());
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
      continue;
    }
    uint64_t aelteste = UINT64_MAX;  // der älteste wartende Auftrag zuerst (je Box gibt es nur den neuesten)
    for (size_t i = 0; i < auftraege_.size(); ++i)
      if (auftraege_[i].da && auftraege_[i].nr < aelteste) {
        aelteste = auftraege_[i].nr;
        box = (int)i + 1;
      }
    Auftrag a = std::move(auftraege_[(size_t)box - 1]);
    auftraege_[(size_t)box - 1] = Auftrag{};
    lk.unlock();
    Ergebnis e = rechne(box, a.quelle, a.bpm);
    a.quelle.reset();
    lk.lock();
    if (stopp_) break;  // e wird hier freigegeben
    fertig_[(size_t)box - 1] = std::move(e);  // ein nicht abgeholtes älteres wird freigegeben
    fertig_da_[(size_t)box - 1] = true;
  }
}

}  // namespace cdj
