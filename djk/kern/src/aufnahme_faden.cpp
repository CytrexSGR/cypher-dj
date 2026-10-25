#include "cypherdj/aufnahme_faden.h"

#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cstdio>

namespace cdj {

static int64_t jetzt_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

AufnahmeFaden::AufnahmeFaden(std::string ordner) : ordner_(std::move(ordner)) {}
AufnahmeFaden::~AufnahmeFaden() {
  stoppe();
  std::lock_guard<std::mutex> g(m_);
  for (auto& kv : laeufe_) abbrechen(kv.second);   // Kern-Ende mitten im Take: der Puffer geht nicht verloren (die RecSpur werden hier nicht mehr angefasst)
}

void AufnahmeFaden::anmelden(RecSpur* p) {
  std::lock_guard<std::mutex> g(m_);
  if (std::find(spuren_.begin(), spuren_.end(), p) == spuren_.end()) spuren_.push_back(p);
}
void AufnahmeFaden::abmelden(RecSpur* p) {
  std::lock_guard<std::mutex> g(m_);
  spuren_.erase(std::remove(spuren_.begin(), spuren_.end(), p), spuren_.end());
  auto it = laeufe_.find(p);
  if (it != laeufe_.end()) {   // der Take ist abgebrochen; was schon im Ring und im Puffer liegt, kommt noch in die Datei
    AufnahmeChunk c;
    while (p->ring.hole(c)) it->second.w->chunk(c);
    abbrechen(it->second);
    laeufe_.erase(it);
  }
}
void AufnahmeFaden::starte() {
  aus_ = false;
  t_ = std::thread([this] { while (!aus_) { durchgang(); usleep(10000); } });
}
void AufnahmeFaden::stoppe() {
  aus_ = true;
  if (t_.joinable()) t_.join();
}

void AufnahmeFaden::durchgang() {
  std::lock_guard<std::mutex> g(m_);
  for (RecSpur* p : spuren_) bearbeite(p);
}

void AufnahmeFaden::begleitdatei(const Lauf& l, int64_t frames, const char* status, int32_t luecken) {
  if (!l.offen_ok) return;   // die .f32 gehört nicht diesem Take (vorhanden oder nicht anlegbar): die .json desselben Namens bleibt unberührt
  const std::string pfad = ordner_ + "/aufnahme-" + std::to_string(l.spur) + "-" + std::to_string(l.kennung) + ".json";
  const std::string tmp = pfad + ".teil";
  if (FILE* f = std::fopen(tmp.c_str(), "w")) {
    std::fprintf(f, "{\"spur\":%d,\"kennung\":%d,\"eingang\":%d,\"start_sample\":%lld,\"frames\":%lld,\"luecken\":%d,\"status\":\"%s\"}\n", l.spur,
                 l.kennung, l.eingang, static_cast<long long>(l.start_s), static_cast<long long>(frames), luecken, status);
    std::fclose(f);
    std::rename(tmp.c_str(), pfad.c_str());
  }
}

void AufnahmeFaden::abbrechen(Lauf& l) {
  std::string fehler;
  const bool ok = l.w->schliessen(l.start_s + l.w->frames(), fehler) && l.offen_ok;
  begleitdatei(l, l.w->frames(), ok ? "abgebrochen" : "kein_platz", l.w->luecken());
}

void AufnahmeFaden::bearbeite(RecSpur* p) {
  const int ph = p->phase.load(std::memory_order_acquire);
  if (ph != 1 && ph != 2) return;
  auto it = laeufe_.find(p);
  if (it == laeufe_.end()) {   // neuer Take
    Lauf l;
    l.spur = p->spur;
    l.eingang = p->eingang;
    l.kennung = p->kennung;
    l.start_s = p->start_s;
    l.w.reset(new TakeSchreiber(ordner_ + "/aufnahme-" + std::to_string(p->spur) + "-" + std::to_string(p->kennung) + ".f32", p->start_s));
    std::string fehler;
    if (!l.w->offen(fehler)) {   // Öffnungsfehler (vorhanden, kein Ordner, Rechte): der Take endet mit Status 3, auch ohne einen Frame
      std::fprintf(stderr, "Aufnahme Spur %d: %s\n", p->spur, fehler.c_str());
      l.offen_ok = false;
    }
    it = laeufe_.emplace(p, std::move(l)).first;
    begleitdatei(it->second, 0, "laeuft", 0);
  }
  Lauf& l = it->second;
  AufnahmeChunk c;
#ifndef CYPHERDJ_MUTATION_REC_FADEN_OHNE_LEEREN
  while (p->ring.hole(c)) l.w->chunk(c);   // das laufende Leeren in Phase 1; ohne es liefe der Ring über (Lücken nach 2,73 s)
#endif
  if (ph == 2) {   // der Callback ist fertig; nach dem acquire sind alle Chunks im Ring sichtbar
    while (p->ring.hole(c)) l.w->chunk(c);
    std::string fehler;
#ifdef CYPHERDJ_MUTATION_REC_FADEN_ENDE_FEHLT
    const bool ok = l.w->schliessen(l.start_s + l.w->frames(), fehler);   // Fehlerfall: das Ende des Takes erreicht den Schreiber nicht, verlorene letzte Chunks fehlen still
#else
    const bool ok = l.w->schliessen(p->ende_s, fehler) && l.offen_ok;
#endif
    TakeMeldung m{p->spur, l.kennung, ok ? (l.w->luecken() > 0 ? 1 : 0) : 3, l.w->frames(), l.start_s, l.w->luecken()};
    begleitdatei(l, m.frames, ok ? (m.status == 0 ? "fertig" : "luecken") : "kein_platz", m.luecken);
    meldungen_.schiebe(m);
    laeufe_.erase(it);
    p->phase.store(3, std::memory_order_release);
  } else {
    l.w->sync_wenn_faellig(jetzt_ms());
  }
}

}  // namespace cdj
