// Package 1.15: real-time check for gate and utility. 10^5 calls each of verarbeite() and setze() with changing
// block sizes 1..kMaxFrames and changing parameters: 0 allocations, 0 frees, 0 mutex locks.
// The positive control first: the watcher must see a vector allocation, otherwise the zero means nothing.
#include <cypherdj/dsp/gate.h>
#include <cypherdj/dsp/utility.h>

#include <cstdio>
#include <memory>
#include <vector>

#include "pruef.h"
#include "waechter.h"

using namespace cypherdj::dsp;

int main() {
    waechter::nullen();
    waechter::an();
    { std::vector<float> v(1000); v[1] = 1.0f; }
    waechter::aus();
    PRUEF(waechter::allokationen() >= 1);

    auto gate = std::make_unique<Gate>();
    auto util = std::make_unique<Utility>();
    std::vector<float> l(kMaxFrames), r(kMaxFrames), sc(kMaxFrames), ol(kMaxFrames), orr(kMaxFrames);
    unsigned s = 3;
    for (int i = 0; i < kMaxFrames; ++i) {
        s = s * 1664525u + 1013904223u;
        l[i] = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5);
        r[i] = -l[i];
        sc[i] = (i / 64) % 2 ? l[i] : 0.0f;
    }
    waechter::nullen();
    waechter::an();
    for (int k = 0; k < 100000; ++k) {
        s = s * 1664525u + 1013904223u;
        const int n = 1 + static_cast<int>((s >> 8) % kMaxFrames);
        if (k % 97 == 0) {
            GateParameter g;
            g.schwelle_db = -20.0f - static_cast<float>(k % 40);
            g.ratio = 1.0f + static_cast<float>(k % 120);
            gate->setze(g);
            UtilityParameter u;
            u.bass_mono_hz = static_cast<float>(k % 600);
            u.breite_prozent = static_cast<float>(k % 201);
            u.phase_umkehren_l = k % 2;
            u.dc_sperre = k % 3 == 0;
            util->setze(u);
        }
        gate->verarbeite(l.data(), r.data(), ol.data(), orr.data(), n, k % 2 ? sc.data() : nullptr, k % 2 ? sc.data() : nullptr);
        util->verarbeite(ol.data(), orr.data(), ol.data(), orr.data(), n);  // in place
        if (k % 1000 == 0) { gate->leeren(); util->leeren(); }
    }
    waechter::aus();
    std::printf("10^5 calls: %ld allocations, %ld frees, %ld locks\n", waechter::allokationen(), waechter::freigaben(),
                waechter::sperren());
    PRUEF(waechter::allokationen() == 0 && waechter::freigaben() == 0 && waechter::sperren() == 0);
    return pruef::ende();
}
