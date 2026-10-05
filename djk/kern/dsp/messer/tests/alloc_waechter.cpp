#include "alloc_waechter.h"

#include <cstddef>
#include <cstdlib>
#include <new>

bool g_alloc_zaehlen = false;
long g_allokationen = 0;

extern "C" {
void* __real_malloc(std::size_t n);
void* __real_calloc(std::size_t a, std::size_t b);
void* __real_realloc(void* p, std::size_t n);

void* __wrap_malloc(std::size_t n) {
  if (g_alloc_zaehlen) ++g_allokationen;
  return __real_malloc(n);
}
void* __wrap_calloc(std::size_t a, std::size_t b) {
  if (g_alloc_zaehlen) ++g_allokationen;
  return __real_calloc(a, b);
}
void* __wrap_realloc(void* p, std::size_t n) {
  if (g_alloc_zaehlen) ++g_allokationen;
  return __real_realloc(p, n);
}
}

void* operator new(std::size_t n) {
  if (g_alloc_zaehlen) ++g_allokationen;
  void* p = __real_malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  return p;
}
void* operator new[](std::size_t n) { return operator new(n); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }
