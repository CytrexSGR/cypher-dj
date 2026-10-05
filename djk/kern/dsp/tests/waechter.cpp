#include "waechter.h"

#include <dlfcn.h>
#include <pthread.h>

#include <atomic>
#include <cstddef>

extern "C" {
void* __libc_malloc(std::size_t);
void* __libc_calloc(std::size_t, std::size_t);
void* __libc_realloc(void*, std::size_t);
void __libc_free(void*);
void* __libc_memalign(std::size_t, std::size_t);
}

namespace {
std::atomic<bool> g_aktiv{false};
std::atomic<long> g_alloc{0}, g_frei{0}, g_sperren{0};
inline void zaehle(std::atomic<long>& z) {
    if (g_aktiv.load(std::memory_order_relaxed)) z.fetch_add(1, std::memory_order_relaxed);
}
using lock_fn = int (*)(pthread_mutex_t*);
lock_fn g_echt_lock = nullptr;
}  // namespace

namespace waechter {
void an() { g_aktiv.store(true); }
void aus() { g_aktiv.store(false); }
long allokationen() { return g_alloc.load(); }
long freigaben() { return g_frei.load(); }
long sperren() { return g_sperren.load(); }
void nullen() { g_alloc = 0; g_frei = 0; g_sperren = 0; }
}  // namespace waechter

extern "C" {
void* malloc(std::size_t n) { zaehle(g_alloc); return __libc_malloc(n); }
void* calloc(std::size_t a, std::size_t b) { zaehle(g_alloc); return __libc_calloc(a, b); }
void* realloc(void* p, std::size_t n) { zaehle(g_alloc); return __libc_realloc(p, n); }
void free(void* p) { if (p) zaehle(g_frei); __libc_free(p); }
void* memalign(std::size_t a, std::size_t n) { zaehle(g_alloc); return __libc_memalign(a, n); }
void* aligned_alloc(std::size_t a, std::size_t n) { zaehle(g_alloc); return __libc_memalign(a, n); }
int posix_memalign(void** p, std::size_t a, std::size_t n) {
    zaehle(g_alloc);
    *p = __libc_memalign(a, n);
    return *p ? 0 : 12;  // ENOMEM
}
int pthread_mutex_lock(pthread_mutex_t* m) {
    if (!g_echt_lock) g_echt_lock = reinterpret_cast<lock_fn>(dlsym(RTLD_NEXT, "pthread_mutex_lock"));
    zaehle(g_sperren);
    return g_echt_lock(m);
}
}
