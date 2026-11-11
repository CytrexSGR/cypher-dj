# Installing cypher-dj (beta)

Tested on Ubuntu 24.04 (x86_64). Steps marked **checked** were run on a fresh Ubuntu 24.04 container on
5 October 2026. Since then the core build has gained a Rust dependency (section 1) and the workshop has changed
(section 7), so a fresh run of the current version is still to do. The other steps were only run on the development
machine. Please report what breaks.

## 1. System packages (checked, except the Rust paragraph)

```sh
sudo apt install build-essential cmake ninja-build pkg-config \
  libjack-jackd2-dev librubberband-dev libssl-dev \
  python3 python3-venv ffmpeg pipewire-jack
```

**Real-time limits.** The core locks its audio material in RAM (up to about 4 GiB) and runs with
real-time priority. Ubuntu's PipeWire package ships the limits for the group `pipewire`
(`/etc/security/limits.d/25-pw-rlimits.conf`: rtprio 95, memlock 4 GiB). Add yourself and log in again:

```sh
sudo usermod -aG pipewire "$USER"
ulimit -l    # should now print 4194304
```

Without it, decks refuse to load with `budget_speicher: mlock Cannot allocate memory`.

**Rust.** The core links a Rust library (Cypher Hall, Cypher Komp, the RB-338 voice, the EQ and saturation inserts and the
Cypher Modular graph engine, all under `djk/instruments/`), so the build needs `cargo` and `rustc`: `djk/core/CMakeLists.txt`
stops without `cargo`. The development machine uses Rust 1.93.1; Ubuntu's own cargo package has not been tried. The first
build downloads the crates pinned in `djk/instruments/Cargo.lock`, so it needs network access.

`/dev/shm` must have room: the core keeps its working material there (several hundred MB per set).
On a normal desktop it is half the RAM; in Docker pass `--shm-size=4g`.

## 2. Python, then build the native parts (checked)

Create the virtual environment first: CMake remembers which `python3` it found, and the core's tests
use it to generate test material.

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r djk/requirements.txt
for t in core fallback previewer; do
  cmake -S djk/$t -B djk/$t/build -G Ninja -DCMAKE_BUILD_TYPE=Release
done
ninja -C djk/core/build cypherdj-kern cypherdj-render cypherdj-setmitschnitt cypherdj-stimme cypherdj-mitschnitt
ninja -C djk/fallback/build
ninja -C djk/previewer/build
```

That builds only the programs. The core's build folder also defines about 4,000 test and mutation targets; to run
the core's tests (section 3), build everything first with `ninja -C djk/core/build`.

This gives `cypherdj-kern` (the real-time core), `cypherdj-notbahn` (a fallback path that keeps audio
going if the core dies) and `cypherdj-vorhoerer` (the headphone previewer).

## 3. Tests (checked)

`ctest --test-dir djk/core/build` runs the core's tests. Run them in a normal desktop session:
several tests (and `djk-start`) need `XDG_RUNTIME_DIR` and a running PipeWire with `pactl`
(package `pulseaudio-utils`).
A few of them call `node`, so install Node.js (section 4) before you run them.

`(cd djk/ui && npm test)` runs the web interface's tests (Node.js, section 4). Some of them
start Python helpers and the conductor: they take Python from `CYPHERDJ_PYTHON`, else from
`djk/workshop/.venv` or `.venv`, and they need `djk/conductor/node_modules` (section 4). Neither
is in git, so a second checkout made with `git worktree add` has neither. Run the tests there with
`CYPHERDJ_PYTHON` set to an existing venv's `bin/python` and with `npm ci` in `djk/conductor`,
otherwise about twenty tests fail for that reason alone (stems, warp corrections, process stack).

## 4. Node.js 22.18 or newer (checked)

The web interface, the conductor, the agent interface and the pattern channels run on Node.js with
built-in TypeScript support, so 22.18 is the minimum. Ubuntu's own package is too old; use the
packages from nodejs.org or NodeSource. `djk-start` expects `node` at `/usr/bin/node`.

```sh
(cd djk/conductor && npm ci)
(cd djk/hand && npm install)
```

## 5. Strudel for the pattern channels (optional, checked)

```sh
git clone https://codeberg.org/uzu/strudel.git ~/strudel
cd ~/strudel && git checkout 8f81463 && pnpm install
```

The generators read `~/strudel/packages` (override with `STRUDEL_PAKETE`; note that `djk-start` grants
Node read access to `~/strudel` only).

## 6. Instruments (optional)

Carla 2.5 and the Surge XT LV2 plugin. `djk/start/djk-instrumente` describes where it looks for them.

The own instruments are Rust crates built as VST3 plugins (nih-plug). With the Rust toolchain from section 1:

```sh
djk/instruments/install.sh rb338       # RB-338, the 303-style bass
djk/instruments/install.sh baukasten   # Cypher Modular, the modular synth
djk/start/djk-instrumente --bass rb338 --melodie baukasten
```

Cypher Modular reads its patch, a JSON graph, from `~/.config/cypherdj/baukasten-melodie.json` each time its host
starts; without that file it plays a built-in saw and ladder filter. Example graphs are in
`djk/instruments/modular_dsp/demos/`.

## 7. The workshop (optional, for preparing your own tracks)

```sh
cd djk/workshop && ./einrichten.sh
```

It needs a system PyTorch 2.10 with CUDA: the script keeps your torch, and torchaudio is pinned to 2.10.0 from the
PyTorch cu128 index. It installs Essentia, beat_this, soundfile, soxr and the runtime packages of the stem model
(rotary-embedding-torch, einops, beartype) into a virtual environment, then fetches the BS-RoFormer-SW weights (about
700 MB, checked by sha256; `python -m werkstatt.weights_stems --von <file>` takes a local copy instead of the network)
for stem separation in PRODUCTION. The model code itself is in `djk/third_party/bs_roformer/`.

Stem separation runs on the GPU only. It needs a CUDA GPU with about 4.5 GB of free video memory (the threshold is
`CYPHERDJ_STEMS_GPU_FREI_MB`, default 4500); without one, Separate Stems is refused and there is no CPU fallback.

## 8. Your paths

```sh
mkdir -p ~/.config/cypherdj
cp djk/config/umgebung.env.beispiel ~/.config/cypherdj/umgebung.env
```

Edit it: where your music is, an optional Traktor `collection.nml`, sample folders for the kits.

## 9. Start

```sh
djk/start/djk-start              # silent test sink, nothing reaches your speakers
djk/start/djk-start --strudel    # with the three pattern channels
```

`djk-start` starts everything as transient systemd user units and prints the address of the web
interface. To hear it, pass your output with `--master <sink>:<port>` and `--ton-frei`; see the
comments at the top of `djk/start/djk-start`. `djk/start/djk-stop` stops everything.

`djk/start/djk-start --strudel --bk-stroeme` adds five more pattern streams for Cypher Modular graphs (erz/5 to erz/7 and
the two loop box pads).

**Cores.** `djk-start` gives the core four physical cores (with their SMT siblings) by default and every other CPU to
stem separation; `CYPHERDJ_KERN_KERNE=<n>` changes the number (a value outside 1 to cores minus 1 is clamped, with a
note), and `CYPHERDJ_KERN_CPUS` and `CYPHERDJ_STEMS_CPUS` set the CPU lists directly. In an arrangement the return Halls
are computed on up to three worker threads, each on its own physical core inside the core's allowed CPUs: `hall_faeden`
(0 to 3, default 3) and `hall_cpus` in `djk/config/kern.toml` control them. With `hall_faeden = 0` everything is computed in the
audio callback, with the same output. With fewer free physical cores than workers the core starts fewer workers and
prints a start line.

To let an AI agent play along, register the MCP server from `djk/hand/` with your agent, see
`djk/hand/AUFRUF.md`.
