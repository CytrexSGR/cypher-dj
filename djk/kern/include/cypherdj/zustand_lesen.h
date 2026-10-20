// Paket K3: den Neustart-Zustand eines laufenden Kerns nur lesend holen (SCHNITTSTELLEN §6.3, wie cypherdj-zustand):
// öffnen O_RDONLY, mmap PROT_READ, neuestes fertiges Echtzeit-Fach kopieren. Für cypherdj-render und cypherdj-nulltest.
#pragma once

#include <memory>
#include <string>

#include "cypherdj/zustand.h"

namespace cdj {

// nullptr mit fehler, wenn die Datei fehlt, die falsche Größe hat oder kein Fach fertig ist. fehlt (wenn nicht nullptr)
// ist genau dann true, wenn es die Datei nicht gibt (ENOENT): Spec 6.20 unterscheidet „kein Kern seit dem Boot“ (Rückfall
// auf die Projekt-Regler) von einem vorhandenen, aber unlesbaren Zustand (Rückgabe 3, kein stiller Rückfall).
std::unique_ptr<cdj_z_echtzeit> lies_echtzeit_fach(const std::string& pfad, std::string& fehler, bool* fehlt = nullptr);

}  // namespace cdj
