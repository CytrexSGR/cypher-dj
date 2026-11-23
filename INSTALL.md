# Installing cypher-dj (beta)

Tested on Ubuntu 24.04 (x86_64). Steps marked **checked** were run on a fresh Ubuntu 24.04.5 VM on 22 November 2026
(sections 1, 2, 4, 5, 8 to 11 and part of 6), and the demo played (master peaks -10.9 / -6.4 dBFS). Section 3 (tests) and
section 7 (workshop) were not part of that run, and the VM had no real audio device and no Surge. The other steps were
only run on the development machine. Please report what breaks.

## From the package

On Ubuntu 24.04 (x86_64) the .deb is the short way. Download it from the [releases page](https://github.com/CytrexSGR/cypher-dj/releases), then:

```sh
sudo apt install ./cypher-dj_<version>_amd64.deb
sudo usermod -aG pipewire "$USER"   # real-time limits for the audio services; log in again (or reboot) afterwards
cypher-dj start                     # real output on your default sink; prints the address of the web interface
cypher-dj demo                      # opens the starter project "demo" and plays it
cypher-dj mcp                       # prints the one JSON line that registers the agent tools in an MCP client
```

`cypher-dj stop` and `cypher-dj status` do what they say. Run `cypher-dj start` as your normal user, not as root.
If the real-time limits are missing, the start prints the fix.

Surge XT is not part of the package. Without it the melody channel plays the Cypher Modular instrument and the bass
channel the RB-338, so the package sounds without it. If you want Surge, install its LV2 plugin by hand (section 6);
the next `cypher-dj start` picks it up.

Building from source stays below.

## 1. System packages (checked)

```sh
sudo apt update
sudo apt install build-essential cmake ninja-build pkg-config \
  libjack-jackd2-dev librubberband-dev libssl-dev \
  python3 python3-venv ffmpeg pipewire-jack rubberband-cli pulseaudio-utils
```

`rubberband-cli` is the `rubberband` program that the workshop's warp calls (the core links the library `librubberband-dev`).
`pulseaudio-utils` provides `pactl`, which `djk-start` calls to create the silent output.

**Real-time limits.** The core locks its audio material in RAM (up to about 4 GiB) and runs with
real-time priority. Ubuntu's PipeWire package ships the limits for the group `pipewire`
(`/etc/security/limits.d/25-pw-rlimits.conf`: rtprio 95, memlock 4 GiB; the stock `pipewire-bin` package ships it, no PPA
needed). Add yourself and log in again:

```sh
sudo usermod -aG pipewire "$USER"
```

A fresh login is not enough when a user manager keeps running (lingering, or another open session): the services that
`djk-start` launches keep the old limits until you run `sudo systemctl restart user@$(id -u)` or reboot. Check what
those services will get, not your shell:

```sh
systemd-run --user --pipe --quiet bash -c 'ulimit -l; ulimit -r'    # should print 4194304 and 95
```

`djk-start` runs the same probe and warns when the values are too low.

Without it, decks refuse to load with `budget_speicher: mlock Cannot allocate memory`.

**Rust.** The core links a Rust library (Cypher Hall, Cypher Komp, the RB-338 voice, the EQ and saturation inserts and the
Cypher Modular graph engine, all under `djk/instruments/`), so the build needs `cargo` and `rustc`: `djk/core/CMakeLists.txt`
stops without `cargo`. Install it with rustup, then load it into the current shell:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"
```

Do not use Ubuntu's `cargo` package (1.75): `Cargo.lock` is version 4, which needs Cargo 1.78 or newer
(`lock file version 4 requires -Znext-lockfile-bump`). The development machine uses Rust 1.93.1; rustup's stable 1.100.0
built everything on 22 November 2026. The first build downloads the crates pinned in `djk/instruments/Cargo.lock`, so it
needs network access.

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

## 3. Tests

`ctest --test-dir djk/core/build` runs the core's tests. Run them in a normal desktop session:
several tests (and `djk-start`) need `XDG_RUNTIME_DIR` and a running PipeWire with `pactl`
(package `pulseaudio-utils`, section 1).
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
packages from nodejs.org or NodeSource. `djk-start` expects `node` at `/usr/bin/node`. NodeSource, as checked:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

Then install the dependencies:

```sh
(cd djk/conductor && npm ci)
(cd djk/hand && npm ci)
```

## 5. Strudel for the pattern channels (optional, checked)

```sh
sudo npm install -g pnpm@10
git clone https://codeberg.org/uzu/strudel.git ~/strudel
cd ~/strudel && git checkout 8f81463 && pnpm install
```

Use pnpm 10: pnpm 12 fails with `ERR_PNPM_IGNORED_BUILDS`. If you switch pnpm versions in the same folder, remove
`node_modules` first.

The generators read `~/strudel/packages` (override with `STRUDEL_PAKETE`; note that `djk-start` grants
Node read access to `~/strudel` only).

## 6. Instruments (optional)

Carla 2.5 and the Surge XT LV2 plugin. Carla from Ubuntu's apt (2.5.8) carried RB-338 and Cypher Modular in the
fresh-VM run (`sudo apt install carla`); Surge was not part of it. `djk/start/djk-instrumente` describes where it looks for them.

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

**Where your work lives.** A fresh install keeps everything you make in one visible folder, `~/cypherdj/`. The variable
`CYPHERDJ_HEIM` moves it (an absolute path; a trailing `/` is ignored). `djk-start` creates the folders that are missing
by running `djk/start/djk-umzug einrichten --still`; you can run that command yourself at any time. The layout:

```
~/cypherdj/
  werke/                    what you make
    projekte/               one folder per project (exports of a project are in its export/ folder)
    module/                 live modules, one folder per module, named <title>-<a|b>-<4 hex characters>
    sampler/                sample player data (cuts, instruments)
    presets/  klaenge/      device presets, sounds
    sammlungen/kollektionen/  your collections
    korrekturen/raster/  korrekturen/hotcues/   corrected beat grids and hot cues
    kits/  loops/  geraete/   drum kits, loops, Cypher Modular graphs
  pruefen/                  projects you moved out of the project list, see below
  quellen.toml              the list of your source folders, see section 10
  .umzug/                   journal and report of djk-umzug
```

The audio core reads a few folders at fixed places. For `kits`, `loops` and `geraete` the old place stays and becomes a
link: `~/.config/cypherdj/kits`, `~/.config/cypherdj/loops` and `~/.config/cypherdj/baukasten` lead to the folders
above, so nothing you wrote against those paths breaks. The paths of the other kinds can also be set one by one:
`CYPHERDJ_MODULE`, `CYPHERDJ_SAMPLER`, `CYPHERDJ_KLAENGE`, `CYPHERDJ_KIT_ORDNER` and `CYPHERDJ_BK_ORDNER` win over the
layout (an empty value counts as unset).

`CYPHERDJ_HEIM` can point to another disk. The commands never create that folder on a disk that is not there: when the
parent folder is missing or empty (an unmounted disk often leaves its empty mount folder behind), they refuse with
`the parent of CYPHERDJ_HEIM (...) is missing or empty: is the disk mounted?`.

**An install that already has the old folders** (`~/cypherdj-projekte` and the folders under `~/.config/cypherdj`) keeps
working as it is: a real old folder is used where it is. If you also copied a `werke/` folder from another machine, the
old folder still wins and a line in the log says so. To move to the layout above, stop everything with `djk-stop`, then:

```sh
djk/start/djk-umzug                           # table: every kind, its state, what a move would do; changes nothing
djk/start/djk-umzug presets --ausfuehren      # move one kind; the old place becomes a link
djk/start/djk-umzug zurueck presets --ausfuehren   # undo it
```

Without `--ausfuehren` nothing changes. A move is a rename when both places are on one disk, otherwise a verified copy
(every file compared by sha256) and the old folder is kept until you run `djk-umzug aufraeumen <kind> --ausfuehren`,
which deletes it only when it is still what was copied. A move is refused while a cypherdj unit runs or a process has the
folder open. It writes a journal under `.umzug/`: if a run is interrupted (power loss, kill), the next run finds the
state from the files and the journal and continues by one fixed rule, or refuses and changes nothing. Running a command
twice, or on an install that never had the old folders, does nothing. Return codes: 0 ok or nothing to do, 1 I/O error,
2 usage, 3 in use, 4 conflict, 5 verification failed, 6 home folder not ready; `djk-umzug --help` has the rest.

Two more tidying commands:

- `djk-umzug pruefen` lists which projects look like test projects (a suggestion only, it moves nothing). You write
  the names you want out of the project list into a file `{"slugs": ["name-1", "name-2"]}` and run
  `djk-umzug pruefen --liste <file> --ausfuehren`: exactly those projects move to `~/cypherdj/pruefen/` and leave a
  link, so they still open. `djk-umzug pruefen zurueck <name> --ausfuehren` (or `--alle`) brings them back.
- `djk-umzug modulnamen --ausfuehren` renames module folders that still carry a bare 16 character id to
  `<title>-<4 hex characters>`. The id inside `modul.json` stays the reference.

**Exports.** After every export, a project keeps its three newest exports; older ones move to
`<projects folder>/.papierkorb/exporte/<project>/`, nothing is deleted. The export you just wrote always stays, and
MIDI export folders do not count. A name that you wrote down in a `.md` file (a listening sheet, say) stays where it is:
`CYPHERDJ_EXPORT_GENANNT` takes the folders to search for such names, separated by `:`. If one of those folders does not
exist, nothing is tidied. `djk/start/djk-exporte` does the same for all projects at once; without `--ausfuehren` nothing
moves.

**Caches.** Two folders hold files that can be computed again: the decoded audio (capped at 5 GiB) and the waveform
cache (capped at 1 GiB). Over the cap the oldest files go first. A decoded file that any project or its history names is
never deleted, so the decode cache can stay over its cap; the log then says so once. Nothing under a project and no
source file is ever removed by a cap.

## 9. First sounds (optional)

A fresh install has no music and no kits. One command generates something to play on your machine, from this
project's own Cypher Modular graphs:

```sh
djk/start/djk-starter
```

It needs `cargo` (section 1) and writes only files that are absent; a file you edited or deleted a sound from is kept
and reported as `kept`. Steps:

- `graphen`: the example graphs go into the core's graph folder (`~/.config/cypherdj/baukasten/`, a link to
  `~/cypherdj/werke/geraete/` on a fresh install, section 8), with the three
  generated sample files that some of them need.
- `kits`: the drum kits `starter` (909 style), `starter-808` and `gm` (a copy of `starter`, written only if you have
  neither `gm` nor `techno`) go into the kit folder (`~/.config/cypherdj/kits/`, a link to `~/cypherdj/werke/kits/`).
- `loops`: three loops go into `~/.config/cypherdj/loops/` (a link to `~/cypherdj/werke/loops/`).
- `demo`: a small demo project, `demo`, goes into `~/cypherdj/werke/projekte/`.
- `bibliothek`: the generated sounds become a library folder (section 10) and the catalog is built.

`--nur <step>` runs one step (repeatable). Return codes: 0 all done, 2 usage, 4 done with skipped steps; the missing
tool (for example no usable `cargo`) is named on stderr. If the catalog at the target was built by another program,
that step leaves it alone and says so. The demo plays in the studio; `djk/starter/render_project.ts` renders it
offline to a WAV file, which needs the `cypherdj-render` built in section 2. Surge XT factory sounds are not part of
this repository and not generated.

## 10. Your own folders (optional)

`djk-bibliothek` turns your own music and sample folders into the catalog the web interface browses, searches and
previews. It needs no database of yours; it reads the folders you name.

```sh
djk/start/djk-bibliothek dazu ~/Music/samples     # add a folder (optional: --typ track|loop|oneshot)
djk/start/djk-bibliothek dazu ~/Music/tracks
djk/start/djk-bibliothek bauen                    # scan and build the catalog
djk/start/djk-bibliothek zeige                    # folders, target, state and counts
djk/start/djk-bibliothek weg ~/Music/tracks       # remove a folder again
```

The folders are listed in `~/.config/cypherdj/bibliothek.json`, or in `~/cypherdj/quellen.toml` once that file exists
(see below). Every file with an audio extension becomes a track, a
loop or a one-shot, by three rules. A folder added with `--typ` gives all its files that type. With the default
`auto`, a `loop` or `oneshot` word in the path decides first (for a loop under two minutes, for a one-shot under 30
seconds). Otherwise length decides: a minute or more is a track, a file of at least four beats (one bar) at the BPM in its name
is a loop, everything else is a one-shot. Files that are empty, cut off, unreadable or not audio are skipped and counted
by reason; the build still succeeds.

The catalog is written as a whole new file at the path the page reads: `CYPHERDJ_KATALOG`, else `katalog.sqlite` next
to `CYPHERDJ_MEDIATHEK`, else `~/.local/share/cypherdj/mediathek/katalog.sqlite`. A catalog that another program built
is never replaced: `bauen` returns 3 and `zeige` prints `state: foreign` and `built by another program, read only`; point `CYPHERDJ_KATALOG` at another file to
build your own. Other returns: 4 a folder is missing (an unplugged drive; nothing is changed; `--ohne-fehlende` builds
without it), 5 the file system cannot take the catalog (it needs hard links, so not exFAT or FAT), 6 the scan found
nothing but your catalog has rows (`--leer-erlaubt` empties it on purpose), 2 usage or no tool to read the files.

`mutagen` (in `djk/requirements.txt`) is optional: it reads tags and durations. Without it the build says so, reads
durations with soundfile or ffprobe, and stores no tags. A second `bauen` with nothing changed hashes no files.

**One list for all your source folders.** `~/cypherdj/quellen.toml` is the list of the folders the studio reads
sounds and tracks from. The sample shelf, the catalog and the kit sources all read it; the older lists
(`bibliothek.json`, the shelf list `sampler/wurzeln.json`) are generated from it when you add or remove a folder in the
studio. The format:

```toml
schema = 1

[[wurzel]]
name = "Samples"                   # 1 to 40 characters, no slash, unique
art = "sample"                     # sample, oneshot, loop, track (also mix, mitschnitt, midi, spiegel, erzeugt, stimme)
pfad = "/media/you/Music/Samples"  # absolute path
wechselplatte = true               # optional: removable disk; unset means: decided by the path (/media, /run/media)
regal = true                       # optional: also list it in the sample shelf
katalog = true                     # optional, default true: build the catalog from it

[wurzel.pfade]                     # optional: a different path per machine, by host name
laptop = "/media/you/Samples"
```

A root without a path for the machine you are on (no `pfad`, and no entry for its host name under `pfade`) is listed as not
reachable and ignored, never an error. In the studio, the button SOURCES in the shelf header opens the dialog SOURCE
FOLDERS: it lists every folder with a dot for "reachable now", adds a folder (path, name, kind, removable drive) and
removes one again (the files stay where they are). It is the same list as the file. Command line:

```sh
cd djk
python3 -m quellen zeige --json                                  # the list as this machine sees it
python3 -m quellen dazu --name Samples --pfad /media/you/Music/Samples --art sample --regal
python3 -m quellen weg --name Samples
```

The tablet port of the web interface does not offer the source dialog.

**Projects collect their sources.** A project refers to its audio by content (sha256), not only by path, so it finds a
file again when it was copied. Opening a project, and adding or replacing an audio clip in it, starts a copy in the
background of every source of that project that lies on a removable disk into `<project>/audio/` (named
`<file name>-<8 characters of the sha>.<ext>`), so the project plays when the disk is unplugged. In PRODUCTION the button
COLLECT does it for every source that lies outside the project folder, and a finished export does it too. Collecting
copies: it never moves or deletes a source. Each copy is checked against the sha of the clip and removed if it
differs. It runs at the lowest priority (`nice -n 19`, `ionice -c 3`) and streams, so a large file is never held in
memory. It waits while the transport runs, a deck plays or a loop box or studio stream is live (COLLECT answers that
music is playing and does not start); a file gets 120 seconds plus one second per MB. A source on a disk that is
not mounted is reported as missing and tried again at the next opening.

## 11. Start

```sh
djk/start/djk-start              # silent test sink, nothing reaches your speakers
djk/start/djk-start --strudel    # with the three pattern channels
```

`djk-start` starts everything as transient systemd user units and prints the address of the web
interface. To hear it, pass your output with `--master <sink>:<port>` and `--ton-frei`; see the
comments at the top of `djk/start/djk-start`. `djk/start/djk-stop` stops everything.

If the kit `techno` is missing, `--strudel` uses the starter kit from section 9 and says so, as long as its `kit.json`
is valid. A kit you name yourself with `--strudel-kit` and that is missing stops the start with a message.

`djk/start/djk-start --strudel --bk-stroeme` adds five more pattern streams for Cypher Modular graphs (erz/5 to erz/7 and
the two loop box pads).

**Cores.** `djk-start` gives the core four physical cores (with their SMT siblings) by default and every other CPU to
stem separation; `CYPHERDJ_KERN_KERNE=<n>` changes the number (a value outside 1 to cores minus 1 is clamped, with a
note), and `CYPHERDJ_KERN_CPUS` and `CYPHERDJ_STEMS_CPUS` set the CPU lists directly. In an arrangement the return Halls
are computed on up to seven worker threads, each on its own physical core inside the core's allowed CPUs: `hall_faeden`
(0 to 7, default 7) and `hall_cpus` in `djk/config/kern.toml` control them. With `hall_faeden = 0` everything is computed in the
audio callback, with the same output. With fewer free physical cores than workers the core starts fewer workers and
prints a start line.

To let an AI agent play along, register the MCP server from `djk/hand/` with your agent, see
`djk/hand/AUFRUF.md`.
