# Third-party software

cypher-dj is licensed under the GNU Affero General Public License v3.0 or later (see `LICENSE`).
This file lists what it is built on. Versions are the ones the beta was built and tested with.

## Included in this repository

These files are copied verbatim into `djk/third_party/`. Each one is pinned by sha256 in
`djk/third_party/herkunft.json`; `djk/third_party/pruefe_herkunft.py` checks them.

| Component | Version | License | Where |
|---|---|---|---|
| libebur128 | 1.2.6 | MIT | `djk/third_party/libebur128/` |
| nlohmann/json | 3.12.0 | MIT | `djk/third_party/nlohmann/` |
| toml++ | 3.4.0 | MIT | `djk/third_party/toml++/` |
| Bungee | git 8cb6977 | MPL-2.0 | `djk/third_party/bungee/` (optional keylock engine, built only with `-DCYPHERDJ_BUNGEE=ON`) |
| Eigen (Core only, via Bungee) | git c29c800 | MPL-2.0 | `djk/third_party/bungee/submodules/eigen/` |
| PFFFT (via Bungee) | git 02fe771 | BSD-style (FFTPACK) | `djk/third_party/bungee/submodules/pffft/` |

Generated with Faust 2.70.3 and included as C++ in `djk/kern/include/cypherdj/gen/`: the reverb
(`zita_rev1_stereo` from Faust's `reverbs.lib`, Julius O. Smith III, STK-4.3 license, MIT-style).
Sources in `djk/kern/gen/*.dsp`, rebuild with `djk/kern/gen/erzeuge.sh`.

## Linked or loaded at build or run time (not included, install them yourself)

| Component | Tested with | License | How cypher-dj uses it |
|---|---|---|---|
| Rubber Band Library | 3.3.0 | GPL-2.0-or-later (commercial license available from its authors) | linked into the real-time core: keylock for decks and loop boxes (R3 engine, default) |
| JACK API (via PipeWire) | 1.9.21 | LGPL-2.1-or-later | audio I/O of core, fallback path and previewer |
| OpenSSL | 3.0 | Apache-2.0 | sha256 in the loader |
| Strudel | 1.2.6 | AGPL-3.0-or-later | pattern engine of the generators, loaded as modules |
| Essentia | 2.1-beta6 | AGPL-3.0 | key and energy analysis in the workshop |
| Model Context Protocol SDK | | MIT | agent interface ("the hand") |
| Node.js | 22 | MIT | web interface, generators, agent interface |
| Python, NumPy, SciPy, scikit-learn, soundfile, jsonschema | 3.12 | various permissive | workshop and analysis |

## Separate programs (own processes, talked to over JACK, MIDI or OSC)

| Component | License | Role |
|---|---|---|
| Carla | GPL-2.0-or-later | plugin host for instruments |
| Surge XT (LV2) | GPL-3.0-or-later | synthesizer |
| PipeWire | MIT | audio server |

## Optional analysis tools (not required to play)

| Component | Code license | Note |
|---|---|---|
| Demucs | MIT | stem separation. The pretrained weights are downloaded by Demucs itself; check their terms before commercial use |
| all-in-one (allin1) | MIT | structure analysis experiment. Pulls in madmom, whose bundled model files are licensed CC BY-NC-SA 4.0 (non-commercial) |

## Not included, on purpose

No music, no samples, no stems and no recordings of other people's tracks are part of this repository.
Bring your own audio. Sample-kit paths are configured on your machine (`djk/konfig/umgebung.env.beispiel`).
