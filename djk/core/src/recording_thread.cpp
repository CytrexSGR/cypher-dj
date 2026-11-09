#include "cypherdj/recording_thread.h"

#include <fcntl.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cerrno>
#include <cstdio>
#include <cstring>

namespace cdj {

static int64_t jetzt_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

AufnahmeFaden::AufnahmeFaden(std::string ordner) : ordner_(std::move(ordner)) {}
AufnahmeFaden::~AufnahmeFaden() {
  stoppe();
  std::lock_guard<std::mutex> g(m_);
  for (auto& kv : laeufe_) abbrechen(kv.second);   // Kern-Ende mitten im Take: der Puffer geht nicht verloren (die RecSpur werden hier nicht mehr angefasst)
  for (auto& kv : midi_laeufe_) {   // 1.8 T7a: the same for the MIDI take, the notes still open stay open (an aborted take is not closed by the thread)
    const bool ok = midi_schliessen(kv.second, -1);
    midi_begleitdatei(kv.second, -1, 0, ok ? "abgebrochen" : "kein_platz");
  }
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
void AufnahmeFaden::anmelden_midi(RecMidi* p) {
  std::lock_guard<std::mutex> g(m_);
  if (std::find(midis_.begin(), midis_.end(), p) == midis_.end()) midis_.push_back(p);
}
void AufnahmeFaden::abmelden_midi(RecMidi* p) {
  std::lock_guard<std::mutex> g(m_);
  midis_.erase(std::remove(midis_.begin(), midis_.end(), p), midis_.end());
  auto it = midi_laeufe_.find(p);
  if (it != midi_laeufe_.end()) {   // the take is aborted; what is in the ring still goes into the file
    MidiEinEreignis e;
    while (p->ring.hole(e)) midi_ereignis(it->second, e);
    const bool ok = midi_schliessen(it->second, -1);
    midi_begleitdatei(it->second, -1, static_cast<int64_t>(p->abgelehnt.load(std::memory_order_relaxed)), ok ? "abgebrochen" : "kein_platz");
    midi_laeufe_.erase(it);
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
  for (RecMidi* p : midis_) bearbeite_midi(p);
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
#ifdef REC_FADEN_BREMSE
  // 1.8 T11 negative control (build option CYPHERDJ_REC_FADEN_BREMSE, never in a product build): the record thread writes ONE chunk per track per pass and sleeps 50 ms after it
  // (one chunk per 50 ms against 188 produced per second), so the 512-chunk ring overflows within seconds and the take reports gaps. Taking one chunk per pass keeps the
  // mutex hold, and with it stoppe() and abmelden(), short; the final drain of phase 2 below is not slowed.
  if (p->ring.hole(c)) { l.w->chunk(c); usleep(50000); }
#else
  while (p->ring.hole(c)) l.w->chunk(c);   // das laufende Leeren in Phase 1; ohne es liefe der Ring über (Lücken nach 2,73 s)
#endif
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

// ---- 1.8 T7a: the MIDI take -------------------------------------------------------------------------------------------------------------------------------------------

void AufnahmeFaden::midi_leeren(MidiLauf& l) {
  const char* q = l.puf.data();
  std::size_t rest = l.puf.size();
  while (rest > 0 && !l.fehler && l.fd >= 0) {
    const ssize_t n = ::write(l.fd, q, rest);
    if (n < 0) { if (errno == EINTR) continue; l.fehler = true; break; }   // ENOSPC and everything else: status kein_platz, what is written stays
    q += n;
    rest -= static_cast<std::size_t>(n);
  }
  l.puf.clear();
}

void AufnahmeFaden::midi_satz(MidiLauf& l, int64_t sample, uint8_t st, uint8_t d1, uint8_t d2) {
  char r[12];
  std::memcpy(r, &sample, 8);   // little endian host (x86_64, aarch64): the layout of the file
  r[8] = static_cast<char>(st); r[9] = static_cast<char>(d1); r[10] = static_cast<char>(d2); r[11] = 0;
  l.puf.insert(l.puf.end(), r, r + 12);
  ++l.n;
}

void AufnahmeFaden::midi_ereignis(MidiLauf& l, const MidiEinEreignis& e) {
  const uint8_t t = e.b[0] & 0xF0, ton = e.b[1] & 0x7F;
  const bool ein = t == 0x90 && e.b[2] > 0, aus = t == 0x80 || (t == 0x90 && e.b[2] == 0);
  if (ein) {
    if (l.an[ton]) midi_satz(l, e.sample, static_cast<uint8_t>(0x80 | l.kanal[ton]), ton, 0);   // retrigger rule: the old note ends at the new onset
    l.an[ton] = true;
    l.kanal[ton] = e.b[0] & 0x0F;
  } else if (aus) {
    if (!l.an[ton]) return;   // held before the take began: no note on in this take, no note off either
    l.an[ton] = false;
  }
  midi_satz(l, e.sample, e.b[0], e.b[1], e.b[2]);
}

bool AufnahmeFaden::midi_schliessen(MidiLauf& l, int64_t ende_s) {
  if (ende_s >= 0)
    for (int ton = 0; ton < 128; ++ton)
      if (l.an[ton]) { midi_satz(l, ende_s, static_cast<uint8_t>(0x80 | l.kanal[ton]), static_cast<uint8_t>(ton), 0); l.an[ton] = false; }
  midi_leeren(l);
  if (l.fd >= 0) {
    if (!l.fehler && ::fsync(l.fd) != 0) l.fehler = true;
    if (::close(l.fd) != 0) l.fehler = true;
    l.fd = -1;
  }
  return !l.fehler && l.offen_ok;
}

void AufnahmeFaden::midi_begleitdatei(const MidiLauf& l, int64_t ende_s, int64_t abgelehnt, const char* status) {
  if (!l.offen_ok) return;   // the .bin does not belong to this take (exists, or cannot be created): the .json of the same name stays untouched
  const std::string pfad = ordner_ + "/midi-" + std::to_string(l.kennung) + ".json";
  const std::string tmp = pfad + ".teil";
  if (FILE* f = std::fopen(tmp.c_str(), "w")) {
    std::fprintf(f, "{\"art\":\"midi\",\"spur\":0,\"kennung\":%d,\"eingang\":30,\"start_sample\":%lld,\"ende_sample\":%lld,\"ereignisse\":%lld,\"abgelehnt\":%lld,\"status\":\"%s\"}\n",
                 l.kennung, static_cast<long long>(l.start_s), static_cast<long long>(ende_s), static_cast<long long>(l.n), static_cast<long long>(abgelehnt), status);
    std::fclose(f);
    std::rename(tmp.c_str(), pfad.c_str());
  }
}

void AufnahmeFaden::bearbeite_midi(RecMidi* p) {
  const int ph = p->phase.load(std::memory_order_acquire);
  if (ph != 1 && ph != 2) return;
  auto it = midi_laeufe_.find(p);
  if (it == midi_laeufe_.end()) {   // new take
    MidiLauf l;
    l.kennung = p->kennung;
    l.start_s = p->start_s;
    const std::string pfad = ordner_ + "/midi-" + std::to_string(p->kennung) + ".bin";
    l.fd = ::open(pfad.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0644);   // never replaces a file
    if (l.fd < 0) {
      std::fprintf(stderr, "Aufnahme MIDI: %s: %s\n", pfad.c_str(), std::strerror(errno));
      l.offen_ok = false;
    }
    it = midi_laeufe_.emplace(p, std::move(l)).first;
    midi_begleitdatei(it->second, -1, 0, "laeuft");
  }
  MidiLauf& l = it->second;
  MidiEinEreignis e;
  while (p->ring.hole(e)) midi_ereignis(l, e);   // the running drain in phase 1 (4096 events fill the ring in no time with a controller wheel)
  if (ph == 2) {   // the callback is done; after the acquire every event is in the ring
    while (p->ring.hole(e)) midi_ereignis(l, e);
    const bool ok = midi_schliessen(l, p->ende_s);
    const int64_t abgelehnt = static_cast<int64_t>(p->abgelehnt.load(std::memory_order_relaxed));
    TakeMeldung m{0, l.kennung, ok ? (abgelehnt > 0 ? 1 : 0) : 3, l.n, l.start_s, static_cast<int32_t>(abgelehnt), 1};
    midi_begleitdatei(l, p->ende_s, abgelehnt, ok ? (abgelehnt > 0 ? "luecken" : "fertig") : "kein_platz");
    meldungen_.schiebe(m);
    midi_laeufe_.erase(it);
    p->phase.store(3, std::memory_order_release);
  } else {
    midi_leeren(l);
    const int64_t jetzt = jetzt_ms();
    if (l.fd >= 0 && !l.fehler && jetzt - l.letzter_sync_ms >= 1000) {
      l.letzter_sync_ms = jetzt;
      if (::fsync(l.fd) != 0) l.fehler = true;
    }
  }
}

}  // namespace cdj
