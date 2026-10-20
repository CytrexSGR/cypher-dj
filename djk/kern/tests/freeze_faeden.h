// Paket K3 (Spec 6.29, A10): Prüfaufbau mit echten Fäden wie im Betrieb, ohne JACK und ohne Ton. Ein Kern-Faden spielt den
// Callback (Kern::zyklus, Quantum 256), getaktet in Echtzeit oder ohne Pause; der Netz-Faden läuft mit Netz::laufen, der
// Arrangement-Lade-Faden mit ArrLader::laufen. Die Gegenstelle spricht mit dem Netz über UDP wie Server und Leitstand;
// jedes empfangene Paket trägt den Zeitstempel des Betriebssystems bei der Ankunft (SO_TIMESTAMPNS, CLOCK_REALTIME), nicht
// den des Abholens, damit die Messung nicht am Takt des Prüffadens hängt. Die Wiedergabe liegt im Arbeitsordner (arr_datei.h) und geht den
// Lade-Weg des Betriebs (/k/arr/laden -> Lade-Faden -> Netz -> Kern).
#pragma once

#include <poll.h>
#include <sys/socket.h>
#include <time.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/arr_lader.h"
#include "cypherdj/kern.h"
#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace ff {

namespace v = cypherdj::osc;

constexpr int N = 256;

inline int64_t real_ns() {   // Uhr der Ankunftsstempel
  timespec t{};
  clock_gettime(CLOCK_REALTIME, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

inline int64_t mono_ns() {
  timespec t{};
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

struct Paket {
  int64_t t_ns;
  std::string adresse;
  cdj::osc::Nachricht m;   // nur für /q und /e/freeze gelesen
  std::vector<char> roh;
};

struct Aufbau {
  arrdatei::Ordner ordner;
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::ArrLaderRinge> ringe{new cdj::ArrLaderRinge()};
  cdj::SpeicherKonto konto{1024LL << 20};
  cdj::ArrLader lader;
  std::unique_ptr<cdj::Kern> kern;
  std::unique_ptr<cdj::Netz> netz;
  std::atomic<bool> stop{false};
  std::atomic<bool> echtzeit{true};   // Kern-Faden: true je Zyklus 256/48000 s, false ohne Pause
  std::atomic<int64_t> pause_us{0};   // ohne Echtzeit: Pause je Zyklus (TSan: andere Fäden kommen dran)
  std::thread t_kern, t_netz, t_lader;
  std::vector<Paket> pakete;
  std::unique_ptr<Gegenstelle> g;
  int64_t id = 1000;

  // basis: Ort des Arbeitsordners (Vorgabe /dev/shm); bpm: Start-Tempo des Kerns (Fix L4: die Uhr-Probe nimmt eine echte
  // Platte und 60 BPM, damit die Datei so groß wird wie der Puffer)
  explicit Aufbau(const char* name, const std::string& basis = "/dev/shm", double bpm = 128.0)
      : ordner(name, basis), lader(ordner.pfad, &konto, 512LL << 20, false) {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    kern.reset(new cdj::Kern(bpm, ring, bef.get(), ere.get()));
    kern->setze_pruefmodus(false);
    netz.reset(new cdj::Netz(0, false, bef.get(), ere.get(), 600'000'000'000LL));
    netz->verbinde_arr(ringe.get());
    netz->setze_arr_ordner(ordner.pfad);
    g.reset(new Gegenstelle(netz->port()));
    int an = 1;
    setsockopt(g->sock, SOL_SOCKET, SO_TIMESTAMPNS, &an, sizeof an);
  }
  ~Aufbau() { anhalten(); }

  // Kern-Faden: haken(kern) nach jedem Zyklus im Kern-Faden (Echtzeit-Steuerung der Probe)
  template <class Haken>
  void starten(Haken haken) {
    t_netz = std::thread([this] { netz->laufen(stop); });
    t_lader = std::thread([this] { lader.laufen(*ringe, stop); });
    t_kern = std::thread([this, haken] {
      auto naechst = std::chrono::steady_clock::now();
      const auto quantum = std::chrono::nanoseconds(static_cast<int64_t>(N) * 1000000000LL / 48000);
      while (!stop.load()) {
        kern->zyklus(N, mono_ns());
        haken(*kern);
        if (echtzeit.load()) {
          naechst += quantum;
          std::this_thread::sleep_until(naechst);
        } else {
          naechst = std::chrono::steady_clock::now();
          if (const int64_t p = pause_us.load()) std::this_thread::sleep_for(std::chrono::microseconds(p));
        }
      }
    });
  }
  void anhalten() {
    if (stop.exchange(true)) return;
    if (t_kern.joinable()) t_kern.join();
    if (t_netz.joinable()) t_netz.join();
    if (t_lader.joinable()) t_lader.join();
  }

  // alles Anstehende aus dem Socket holen, mit Empfangszeit
  void sammeln(int warte_ms) {
    char buf[2048];
    pollfd pf{g->sock, POLLIN, 0};
    if (poll(&pf, 1, warte_ms) <= 0) return;
    for (;;) {
      char ctl[256];
      iovec io{buf, sizeof buf};
      msghdr mh{};
      mh.msg_iov = &io;
      mh.msg_iovlen = 1;
      mh.msg_control = ctl;
      mh.msg_controllen = sizeof ctl;
      const ssize_t r = recvmsg(g->sock, &mh, MSG_DONTWAIT);
      if (r <= 0) break;
      Paket p;
      p.t_ns = real_ns();
      for (cmsghdr* c = CMSG_FIRSTHDR(&mh); c; c = CMSG_NXTHDR(&mh, c))
        if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_TIMESTAMPNS) {
          timespec ts{};
          std::memcpy(&ts, CMSG_DATA(c), sizeof ts);
          p.t_ns = static_cast<int64_t>(ts.tv_sec) * 1000000000LL + ts.tv_nsec;
        }
      p.adresse = std::string(buf, strnlen(buf, static_cast<size_t>(r)));
      if (p.adresse == "/q" || p.adresse == "/e/freeze") p.roh.assign(buf, buf + r);
      pakete.push_back(std::move(p));
    }
  }
  // bis ms: sammeln, bis ein Paket mit adresse (und Bedingung) gekommen ist; Rückgabe Index oder −1
  template <class Bed>
  long warte(const char* adresse, int ms, Bed bed, size_t ab = 0) {
    const int64_t ende = real_ns() + static_cast<int64_t>(ms) * 1000000LL;
    size_t i = ab;
    for (;;) {
      for (; i < pakete.size(); ++i) {
        if (pakete[i].adresse != adresse) continue;
        cdj::osc::Nachricht m;
        if (!pakete[i].roh.empty() && !cdj::osc::lesen(pakete[i].roh.data(), pakete[i].roh.size(), m)) continue;
        if (bed(m)) return static_cast<long>(i);
      }
      if (real_ns() >= ende) return -1;
      sammeln(2);
    }
  }
  long warte_q(int64_t qid, int32_t status, int ms) {
    return warte("/q", ms, [&](const cdj::osc::Nachricht& m) { return m.werte[0].h == qid && m.werte[2].i == status; });
  }
  void hallo() {
    cdj::osc::Schreiber s(v::k_hallo);
    s.s("probe").i(g->port).i(v::vertrag);
    g->sende(s);
  }
  int64_t laden(int32_t nr) {
    cdj::osc::Schreiber s(v::k_arr_laden);
    s.h(++id).s("andreas").i(nr);
    g->sende(s);
    return id;
  }
  int64_t stopp() {
    cdj::osc::Schreiber s(v::k_arr_stopp);
    s.h(++id).s("andreas").i(0);
    g->sende(s);
    return id;
  }
  int64_t freeze(int32_t spur, double von, double bis, int32_t kennung) {
    cdj::osc::Schreiber s(v::k_arr_freeze);
    s.h(++id).s("andreas").i(spur).d(von).d(bis).i(kennung);
    g->sende(s);
    return id;
  }
};

}  // namespace ff
