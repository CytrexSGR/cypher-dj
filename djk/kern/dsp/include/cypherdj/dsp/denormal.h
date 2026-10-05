// Denormal-Schutz für den Echtzeit-Pfad: setzt Flush-to-Zero und Denormals-are-Zero (x86-64 MXCSR)
// für die Dauer eines Gültigkeitsbereichs und stellt den alten Zustand danach wieder her.
// IIR-Zustände, die nach dem Ende eines Signals abklingen, landen sonst in denormalen Zahlen
// und kosten ein Vielfaches an Rechenzeit. Teil der öffentlichen Naht von cypherdj_dsp.
#pragma once

#if defined(__x86_64__) || defined(__i386__)
#include <xmmintrin.h>
#endif

namespace cypherdj::dsp {

class DenormalSchutz {
public:
#if (defined(__x86_64__) || defined(__i386__)) && !defined(CYPHERDJ_DSP_MUTATION_OHNE_FTZ)
    DenormalSchutz() : alt_(_mm_getcsr()) { _mm_setcsr(alt_ | 0x8040u); }  // FTZ (15) | DAZ (6)
    ~DenormalSchutz() { _mm_setcsr(alt_); }
private:
    unsigned alt_;
#else
    DenormalSchutz() = default;
#endif
public:
    DenormalSchutz(const DenormalSchutz&) = delete;
    DenormalSchutz& operator=(const DenormalSchutz&) = delete;
};

}  // namespace cypherdj::dsp
