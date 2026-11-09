#!/usr/bin/env python3
"""Reference values for the automation lane evaluation (Automation Slice 1, ADR 032, AK26).

Generates lane_ref.json: random lanes and 1000 (lane, beat, expected dB) triples. The expected values come from the
specification of the lane (written out here with its own scan, no code shared with the C++ core, the TypeScript server or
the JavaScript page). All three read the file and must agree within a relative 1e-4 (absolute 1e-4 near zero).
Deterministic: a fixed seed, sorted keys, repr floats; the script run twice yields identical bytes (sha256).

Rules (one place, the spec of the lane):
  * before the first point the first value holds, after the last point the last value holds
  * between two points the form of the RIGHT point decides: linear, s (3u^2 - 2u^3), jump (the left value holds up to the beat of the right point)
  * two points at one beat: from that beat on the right value holds
  * mute rule like the mixer (types.h STUMM -200, STUMM_GRENZE -120, STUMM_RAMPE -60): a ramp from a point <= -120 dB to a louder one starts at
    min(-60, the louder value); a ramp to a point <= -120 dB runs towards min(-60, the left value), or stays mute if the left one is mute too;
    the point itself is exact (-200 at its beat)
Usage: generate_lane_ref.py [output.json]   (default: lane_ref.json next to this script)
"""
import json
import os
import random
import sys

STUMM, GRENZE, RAMPE = -200.0, -120.0, -60.0


def wert_bei(punkte, beat):
    """punkte: list of (beat, wert, form) with form 'linear' | 's' | 'sprung'."""
    if beat < punkte[0][0]:
        return punkte[0][1]
    # the last point whose beat is <= query beat (scan from the right)
    i = len(punkte) - 1
    while i > 0 and punkte[i][0] > beat:
        i -= 1
    if i == len(punkte) - 1 or punkte[i][0] == beat:
        return punkte[i][1]
    (b0, v0, _), (b1, v1, f1) = punkte[i], punkte[i + 1]
    if f1 == 'sprung':
        return v0
    u = (beat - b0) / (b1 - b0)
    g = u * u * (3.0 - 2.0 * u) if f1 == 's' else u
    if v0 <= GRENZE and v1 > GRENZE:
        v0 = min(RAMPE, v1)
    if v1 <= GRENZE:
        v1 = STUMM if v0 <= GRENZE else min(RAMPE, v0)
    return v0 + (v1 - v0) * g


def erzeuge():
    r = random.Random(20261031)
    lanes = []
    for _ in range(40):
        n = r.randint(2, 9)
        beat = float(r.randint(0, 8))
        punkte = []
        for k in range(n):
            if k > 0:
                # a gap, sometimes zero: a jump pair (never three at one beat)
                schon_zwei = k > 1 and punkte[-1][0] == punkte[-2][0]
                luecke = 0.0 if (not schon_zwei and r.random() < 0.2) else r.choice([0.25, 0.5, 1.0, 2.0, 4.0, 7.5])
                beat += luecke
            wahl = r.random()
            if wahl < 0.15:
                wert = r.choice([STUMM, -150.0, -125.0, GRENZE])
            elif wahl < 0.25:
                wert = r.choice([-119.0, -90.0, -61.0])
            else:
                wert = round(r.uniform(-60.0, 6.0), 3)
            form = r.choice(['linear', 'linear', 's', 'sprung'])
            punkte.append((beat, wert, form))
        lanes.append(punkte)
    paare = []
    while len(paare) < 1000:
        i = r.randrange(len(lanes))
        p = lanes[i]
        art = r.random()
        if art < 0.15:
            b = p[r.randrange(len(p))][0]                      # exactly on a point
        elif art < 0.20:
            b = p[0][0] - r.choice([0.5, 3.0])                 # before the first point
        elif art < 0.25:
            b = p[-1][0] + r.choice([0.5, 9.0])                # after the last point
        else:
            b = round(r.uniform(p[0][0], p[-1][0]), 4)
        paare.append({'lane': i, 'beat': b, 'wert': wert_bei(p, b)})
    return {
        'quelle': 'djk/core/tests/data/generate_lane_ref.py',
        'lanes': [[{'beat': b, 'wert': v, 'form': f} for (b, v, f) in p] for p in lanes],
        'paare': paare,
    }


def main():
    ziel = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lane_ref.json')
    with open(ziel, 'w', encoding='utf-8') as f:
        json.dump(erzeuge(), f, sort_keys=True, indent=0)
        f.write('\n')


if __name__ == '__main__':
    main()
