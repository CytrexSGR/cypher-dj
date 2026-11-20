// Kanban t_7f487235 (2026-11-19): after a kern restart the restored controller values are reported, so the replay for new
// subscribers (regler_stand_ in net.cpp) holds them. Pin of the measured behaviour: the loss seen in /lage after restarts was
// the page server's UDP receive buffer (about 600 of 1659 replayed /e/regler dropped), fixed in conductor/src/kern.ts.
// Expected: after fortsetzen() one REGLER event per restored value, after the NEUSTART event, with the restored value and
// holder "frei", in the first cycles of the new generation; a value at its default is not stored and not reported.
#include <cstdio>
#include <cstring>

#include "cypherdj/state.h"
#include "core25.h"
#include "check.h"

static std::unique_ptr<cdj_z_echtzeit> fach_von(const Kern25& a) {
  auto f = std::make_unique<cdj_z_echtzeit>();
  std::memset(f.get(), 0, sizeof *f);
  a.kern->abbild(*f);
  f->anker_sample = a.kern->sample() - 256;
  f->quantum = 256;
  return f;
}

static const cdj::Ereignis* regler_ev(const Kern25& k, const char* pfad) {
  for (const auto& e : k.ev)
    if (e.art == cdj::Ereignis::REGLER && !std::strcmp(e.pfad, pfad)) return &e;
  return nullptr;
}

int main() {
  Kern25 a;
  a.teil(1, "cypher", "p", 0, "spektrum/kanal", 4.0, 0.0, 19.0f, 0, 0, "", "");
  a.teil(2, "cypher", "p", 0, "pad/1/fader", 4.0, 0.0, -4.6f, 0, 0, "", "");
  a.bis(200'000);
  const auto& tab = a.kern->stellwerk().tabelle();
  PRUEF_NAH(a.kern->stellwerk().wert(tab.suche("spektrum/kanal")), 19.0, 1e-6);
  PRUEF_NAH(a.kern->stellwerk().wert(tab.suche("pad/1/fader")), -4.6, 1e-4);
  auto f = fach_von(a);

  Kern25 b;
  b.mitschreiben = true;
  PRUEF(b.kern->wiederherstellen(*f));
  b.kern->fortsetzen(204'096);
  b.bis(220'000);
  PRUEF(!b.ev.empty() && b.ev.front().art == cdj::Ereignis::NEUSTART);
  const cdj::Ereignis* s = regler_ev(b, "spektrum/kanal");
  const cdj::Ereignis* p = regler_ev(b, "pad/1/fader");
  std::printf("spektrum/kanal reported: %s, pad/1/fader reported: %s\n", s ? "yes" : "no", p ? "yes" : "no");
  PRUEF(s && s->wert == 19.0f && !std::strcmp(s->text, "frei") && s->sample >= 204'096 && s->sample < 204'096 + 1024);
  PRUEF(p && std::fabs(p->wert + 4.6f) < 1e-4f && !std::strcmp(p->text, "frei"));
  // a controller at its default is neither stored nor reported
  PRUEF(regler_ev(b, "pad/2/fader") == nullptr);
  PRUEF_ENDE();
}
