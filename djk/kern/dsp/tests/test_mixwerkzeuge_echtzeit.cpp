// Package 1.15, part C: real-time discipline of KanalLimiter::verarbeite() and SpektrumAnalysator::schreibe()
// (audio thread), and of SpektrumAnalysator::analysiere() (analysis thread, allocation-free as well).
// 10^5 calls each with changing block lengths 1 ... kMaxFrames: 0 allocations, 0 frees, 0 mutex locks.
// Positive control first: the watchdog must see a vector allocation and a mutex lock, else the zero is worthless.
#include <cypherdj/dsp/kanal_limiter.h>
#include <cypherdj/dsp/spektrum.h>

#include <cstdio>
#include <memory>
#include <mutex>
#include <vector>

#include "pruef.h"
#include "waechter.h"

using namespace cypherdj::dsp;

int main() {
    waechter::nullen();
    waechter::an();
    { std::vector<float> v(1000); v[1] = 1.0f; }
    waechter::aus();
    const long a0 = waechter::allokationen();
    waechter::nullen();
    std::mutex m;
    waechter::an();
    m.lock();
    m.unlock();
    waechter::aus();
    const long s0 = waechter::sperren();
    std::printf("positive control: vector -> %ld allocations; mutex -> %ld locks\n", a0, s0);
    PRUEF(a0 >= 1 && s0 >= 1);

    // set-up outside the window
    KanalLimiterEinstellung e;
    e.echtspitze = true;
    auto lim = std::make_unique<KanalLimiter>(48000.0, e);
    auto spek = std::make_unique<SpektrumAnalysator>();
    std::vector<float> l(kMaxFrames), r(kMaxFrames), ol(kMaxFrames), orr(kMaxFrames);
    for (int i = 0; i < kMaxFrames; ++i) {
        l[i] = static_cast<float>(((i * 37) % 101) / 101.0 - 0.5) * 4.0f;
        r[i] = -l[i];
    }
    const int laengen[] = {256, 1, 17, 64, 255, 128, 1024};
    const long aufrufe = 100000;

    waechter::nullen();
    waechter::an();
    for (long a = 0; a < aufrufe; ++a) {
        const int n = laengen[a % 7];
        if (a % 1000 == 0) lim->setze_decke_db(a % 2000 == 0 ? -1.0f : -6.0f);
        if (a % 1500 == 0) lim->setze_abklingen_ms(a % 3000 == 0 ? 50.0f : 300.0f);
        lim->verarbeite(l.data(), r.data(), ol.data(), orr.data(), n);
        spek->schreibe(ol.data(), orr.data(), n);
        if (a % 3 == 0) spek->analysiere();
        if (a % 20000 == 0) spek->setze_glaettung_ms(a % 40000 == 0 ? 0.0f : 300.0f);
        if (a == 50000) spek->setze_groesse(4096);
    }
    waechter::aus();
    const long a1 = waechter::allokationen(), f1 = waechter::freigaben(), s1 = waechter::sperren();
    std::printf("%ld calls: %ld allocations, %ld frees, %ld locks; %ld spectrum frames, %ld samples lost\n", aufrufe,
                a1, f1, s1, spek->rahmen(), spek->verlorene_samples());
    PRUEF(a1 == 0);
    PRUEF(f1 == 0);
    PRUEF(s1 == 0);
    return pruef::ende();
}
