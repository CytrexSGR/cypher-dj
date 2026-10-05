# Installing cypher-dj (beta)

Tested on Ubuntu 24.04 (x86_64). Steps marked **checked** were run on a fresh Ubuntu 24.04 container;
the others were only run on the development machine. Please report what breaks.

## 1. System packages (checked)

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

`/dev/shm` must have room: the core keeps its working material there (several hundred MB per set).
On a normal desktop it is half the RAM; in Docker pass `--shm-size=4g`.

## 2. Python, then build the native parts (checked)

Create the virtual environment first: CMake remembers which `python3` it found, and the core's tests
use it to generate test material.

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r djk/requirements.txt
for t in kern notbahn vorhoerer; do
  cmake -S djk/$t -B djk/$t/build -G Ninja -DCMAKE_BUILD_TYPE=Release
  ninja -C djk/$t/build
done
```

This gives `cypherdj-kern` (the real-time core), `cypherdj-notbahn` (a fallback path that keeps audio
going if the core dies) and `cypherdj-vorhoerer` (the headphone previewer).

## 3. Tests (checked)

`ctest --test-dir djk/kern/build` runs the core's tests. Run them in a normal desktop session:
several tests (and `djk-start`) need `XDG_RUNTIME_DIR` and a running PipeWire with `pactl`
(package `pulseaudio-utils`).

## 4. Node.js 22.18 or newer (checked)

The web interface, the conductor, the agent interface and the pattern channels run on Node.js with
built-in TypeScript support, so 22.18 is the minimum. Ubuntu's own package is too old; use the
packages from nodejs.org or NodeSource. `djk-start` expects `node` at `/usr/bin/node`.

```sh
(cd djk/leitstand && npm ci)
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

## 7. The workshop (optional, for preparing your own tracks)

```sh
cd djk/werkstatt && ./einrichten.sh
```

It needs PyTorch (with CUDA if you have it) and installs Essentia, beat_this and soundfile into a
virtual environment.

## 8. Your paths

```sh
mkdir -p ~/.config/cypherdj
cp djk/konfig/umgebung.env.beispiel ~/.config/cypherdj/umgebung.env
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

To let an AI agent play along, register the MCP server from `djk/hand/` with your agent, see
`djk/hand/AUFRUF.md`.
