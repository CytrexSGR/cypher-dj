// Allokations- und Sperr-Wächter für Tests (ADR 002: Echtzeit-Disziplin als Mechanik).
// waechter.cpp ersetzt malloc/calloc/realloc/free/aligned_alloc/posix_memalign/memalign und
// pthread_mutex_lock im Testprogramm und zählt jeden Aufruf, solange der Wächter an ist.
// Nicht zusammen mit ASan bauen (ASan ersetzt dieselben Funktionen).
#pragma once

namespace waechter {
void an();
void aus();
long allokationen();
long freigaben();
long sperren();
void nullen();
}  // namespace waechter
