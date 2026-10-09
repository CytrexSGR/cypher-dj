// Dehner-Stub (Plan Keylock, Übergabe-Vertrag 13): für alle Ziele, die Quellen mit Keylock (Deck, Loop-Box, REC)
// übersetzen, ohne dehner.cpp (und damit ohne librubberband) zu linken. Die Fabrik liefert nullptr: Keylock ist dann
// immer aus, die Quelle spielt Varispeed. Liegt AUSSERHALB von src/, weil der GLOB KERN_QUELLEN (CMakeLists.txt) sonst beide Dateien in
// cypherdj_kernbib aufnähme und die Fabrik doppelt definiert wäre (Nachprüfung 3, N3).
#include "cypherdj/dehner.h"

namespace cdj {

std::unique_ptr<DehnerBasis> dehner_neu(int, const DehnerOptionen&) { return nullptr; }

}  // namespace cdj
