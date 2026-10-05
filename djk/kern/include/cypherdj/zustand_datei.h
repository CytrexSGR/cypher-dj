// Zugriff auf den Neustart-Zustand (zustand.h, SCHNITTSTELLEN.md §6.3): Datei öffnen oder anlegen, Fächer schreiben
// (Seqlock) und lesen. Je Fachart genau ein Schreiber (Echtzeit-Fächer: der Callback; Abonnenten-Fächer: der
// Netz-Faden). FachSchreiber::beginne() und beende() sind echtzeitfest: keine Allokation, keine Sperre, kein
// Systemaufruf. Scheibe 18.
#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>

#include "cypherdj/zustand.h"

namespace cdj {

// Seqlock-Schreiber: seq wird ungerade, dann die Daten, dann seq gerade (Release). Ein toter Schreiber hinterlässt
// seq ungerade; der nächste Schreiber desselben Fachs macht daraus wieder gerade.
inline void z_seq_beginne(uint64_t* seq) noexcept {
  const uint64_t q = __atomic_load_n(seq, __ATOMIC_RELAXED);
  __atomic_store_n(seq, q | 1u, __ATOMIC_RELAXED);
  __atomic_thread_fence(__ATOMIC_RELEASE);
}
inline void z_seq_beende(uint64_t* seq) noexcept {
  const uint64_t q = __atomic_load_n(seq, __ATOMIC_RELAXED);
  __atomic_store_n(seq, (q | 1u) + 1u, __ATOMIC_RELEASE);
}

// Kopiert `laenge` Bytes ab `von` (innerhalb eines Fachs, dessen erstes Feld `seq` ist) nach `aus`, wenn das Fach
// fertig ist und sich während des Kopierens nicht geändert hat. `versuche` begrenzt das Warten auf einen lebenden
// Schreiber. Gibt den gelesenen seq-Wert zurück oder 1 (ungerade = ungültig).
inline uint64_t z_lies_roh(const uint64_t* seq, const void* von, void* aus, std::size_t laenge, int versuche) noexcept {
  for (int v = 0; v < versuche; ++v) {
    const uint64_t a = __atomic_load_n(seq, __ATOMIC_ACQUIRE);
    if (a & 1u) {
      __builtin_ia32_pause();
      continue;
    }
    std::memcpy(aus, von, laenge);
    __atomic_thread_fence(__ATOMIC_ACQUIRE);
    if (__atomic_load_n(seq, __ATOMIC_RELAXED) == a) return a;
  }
  return 1u;
}

// Kopie eines ganzen Fachs, nur wenn es fertig und je beschrieben ist (stand > 0).
template <class Fach>
bool z_lies_fach(const Fach& f, Fach& aus, int versuche = 100) noexcept {
  return !(z_lies_roh(&f.seq, &f, &aus, sizeof(Fach), versuche) & 1u) && aus.stand > 0;
}

// Index des fertigen Fachs mit dem höchsten Stand und Kopie davon; -1, wenn keines fertig und beschrieben ist.
template <class Fach>
int z_neuestes(const Fach (&f)[2], Fach& aus, int versuche = 100) noexcept {
  int beste = -1;
  uint64_t stand = 0;
  for (int i = 0; i < 2; ++i)
    if (z_lies_fach(f[i], aus, versuche) && aus.stand > stand) {
      beste = i;
      stand = aus.stand;
    }
  if (beste >= 0 && !z_lies_fach(f[beste], aus, versuche)) return -1;
  return beste;
}

// Liest aus dem neuesten fertigen Echtzeit-Fach nur die offenen Befehle (für /q/stand im Netz-Faden, während der
// Callback schreibt). `befehle` fasst CDJ_Z_BEFEHLE Einträge. false: kein gültiges Fach.
bool z_lies_befehle(const cdj_z_datei* d, cdj_z_befehl* befehle, int& n) noexcept;

template <class Fach>
class FachSchreiber {
 public:
  void verbinde(Fach* faecher, uint64_t letzter_stand) noexcept {
    f_ = faecher;
    stand_ = letzter_stand;
  }
  bool verbunden() const noexcept { return f_ != nullptr; }
  // Fach für Stand + 1, seq ungerade. Der Aufrufer füllt es und ruft beende().
  Fach* beginne() noexcept {
    ++stand_;
    aktuell_ = &f_[stand_ & 1u];
    z_seq_beginne(&aktuell_->seq);
    aktuell_->stand = stand_;
    return aktuell_;
  }
  void beende() noexcept { z_seq_beende(&aktuell_->seq); }
  uint64_t stand() const noexcept { return stand_; }

 private:
  Fach* f_ = nullptr;
  Fach* aktuell_ = nullptr;
  uint64_t stand_ = 0;
};

class ZustandDatei {
 public:
  ZustandDatei() = default;
  ZustandDatei(const ZustandDatei&) = delete;
  ZustandDatei& operator=(const ZustandDatei&) = delete;
  ~ZustandDatei();

  // Pfad nach ROADMAP Z2: /dev/shm/cypherdj/zustand oder /dev/shm/cypherdj-<instanz>/zustand
  static std::string pfad_fuer(const char* instanz);
  // Öffnet die Datei oder legt sie an (Rechte 0600, Ordner 0700). Passen Magic, Version oder Größe nicht, wird der
  // Inhalt neu angelegt (neu() == true, meldung() sagt warum). Sperrt die Seiten im Speicher. Nicht im Callback.
  bool oeffne(const std::string& pfad);
  cdj_z_datei* daten() const { return d_; }
  bool neu() const { return neu_; }
  const std::string& meldung() const { return meldung_; }

 private:
  cdj_z_datei* d_ = nullptr;
  bool neu_ = false;
  std::string meldung_;
};

}  // namespace cdj
