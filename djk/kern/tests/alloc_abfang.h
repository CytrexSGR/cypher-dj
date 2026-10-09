// Allokations-Abfang für Tests (Plan Keylock, Messgröße „Allokation“): ersetzt malloc, calloc, realloc, posix_memalign,
// aligned_alloc, memalign, valloc und fftw_malloc im Prozess durch Zähler, die zur echten Funktion (dlsym RTLD_NEXT)
// durchreichen. operator new und delete landen in malloc und werden mitgezählt. Gezählt wird nur in dem Faden, der
// `abfang_an()` gerufen hat (thread_local), nur bis `abfang_aus()`.
// Genau EINE Übersetzungseinheit je Programm darf diesen Kopf einbinden (er definiert die Symbole selbst).
// Unter AddressSanitizer und ThreadSanitizer fehlt der Abfang (deren Laufzeit besetzt dieselben Symbole):
// ALLOC_ABFANG_VERFUEGBAR ist dann 0 und der Test meldet „übersprungen“, nie „bestanden“.
#pragma once

#include <cstddef>

#if defined(__SANITIZE_ADDRESS__) || defined(__SANITIZE_THREAD__)
#define ALLOC_ABFANG_VERFUEGBAR 0
inline void abfang_an() {}
inline long abfang_aus() { return -1; }
#else
#define ALLOC_ABFANG_VERFUEGBAR 1

#include <dlfcn.h>

#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace abfang_intern {
inline thread_local bool an = false;
inline thread_local long zaehler = 0;
inline void zaehle() {
  if (an) ++zaehler;
}
using malloc_f = void* (*)(size_t);
using calloc_f = void* (*)(size_t, size_t);
using realloc_f = void* (*)(void*, size_t);
using pm_f = int (*)(void**, size_t, size_t);
using am_f = void* (*)(size_t, size_t);
using mem_f = void* (*)(size_t, size_t);
using valloc_f = void* (*)(size_t);
inline malloc_f r_malloc = nullptr;
inline calloc_f r_calloc = nullptr;
inline realloc_f r_realloc = nullptr;
inline pm_f r_pm = nullptr;
inline am_f r_am = nullptr;
inline mem_f r_mem = nullptr;
inline valloc_f r_valloc = nullptr;
inline malloc_f r_fftw = nullptr;
inline bool initialisiert = false, in_init = false;
// dlsym ruft selbst calloc: dafür ein kleiner statischer Vorrat
alignas(16) inline char boot[4096];
inline size_t boot_pos = 0;
inline void* boot_alloc(size_t n) {
  n = (n + 15) & ~size_t(15);
  if (boot_pos + n > sizeof boot) return nullptr;
  void* p = boot + boot_pos;
  boot_pos += n;
  return p;
}
inline void init() {
  if (initialisiert || in_init) return;
  in_init = true;
  r_malloc = reinterpret_cast<malloc_f>(dlsym(RTLD_NEXT, "malloc"));
  r_calloc = reinterpret_cast<calloc_f>(dlsym(RTLD_NEXT, "calloc"));
  r_realloc = reinterpret_cast<realloc_f>(dlsym(RTLD_NEXT, "realloc"));
  r_pm = reinterpret_cast<pm_f>(dlsym(RTLD_NEXT, "posix_memalign"));
  r_am = reinterpret_cast<am_f>(dlsym(RTLD_NEXT, "aligned_alloc"));
  r_mem = reinterpret_cast<mem_f>(dlsym(RTLD_NEXT, "memalign"));
  r_valloc = reinterpret_cast<valloc_f>(dlsym(RTLD_NEXT, "valloc"));
  r_fftw = reinterpret_cast<malloc_f>(dlsym(RTLD_NEXT, "fftw_malloc"));  // kann fehlen (kein fftw gelinkt)
  initialisiert = true;
  in_init = false;
}
inline bool im_boot(void* p) { return p >= static_cast<void*>(boot) && p < static_cast<void*>(boot + sizeof boot); }
}  // namespace abfang_intern

extern "C" {
void* malloc(size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) {
    if (in_init) return boot_alloc(n);
    init();
  }
  zaehle();
  return r_malloc(n);
}
void* calloc(size_t a, size_t b) {
  using namespace abfang_intern;
  if (!initialisiert) {
    if (in_init) {
      void* p = boot_alloc(a * b);
      if (p) std::memset(p, 0, a * b);
      return p;
    }
    init();
  }
  zaehle();
  return r_calloc(a, b);
}
void* realloc(void* p, size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  if (p && im_boot(p)) {  // Vorrat: kopieren, nie freigeben
    void* q = r_malloc(n);
    if (q) std::memcpy(q, p, n);
    return q;
  }
  return r_realloc(p, n);
}
void free(void* p) {
  using namespace abfang_intern;
  if (!p || im_boot(p)) return;
  using free_f = void (*)(void*);
  static free_f r_free = reinterpret_cast<free_f>(dlsym(RTLD_NEXT, "free"));
  r_free(p);
}
int posix_memalign(void** out, size_t al, size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_pm(out, al, n);
}
void* aligned_alloc(size_t al, size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_am(al, n);
}
void* memalign(size_t al, size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_mem(al, n);
}
void* valloc(size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_valloc(n);
}
void* fftw_malloc(size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_fftw ? r_fftw(n) : r_malloc(n);
}
}  // extern "C"

inline void abfang_an() {
  abfang_intern::zaehler = 0;
  abfang_intern::an = true;
}
inline long abfang_aus() {
  abfang_intern::an = false;
  return abfang_intern::zaehler;
}
#endif
