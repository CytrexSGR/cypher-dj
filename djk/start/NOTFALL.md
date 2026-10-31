# Emergency card djk

Start `~/cypher-dj/djk/start/djk-start` · state `djk-start --zustand` · stop `djk-stop`. The sound belongs to the core;
the page and the control room may hang without the sound stopping. **Rule of thumb: listen first, then `--zustand`, then act.**

**Test mode is the default until slice 35.** `djk-start` starts the core with `--pruefmodus`, because the page's hand
(faders, buttons) only reaches `hand_osc` as `/test/hand` until then. The start announces this (`test mode ON`), and `--zustand` shows
it in the `kern` line. With `--ohne-pruefmodus` it starts without test mode, and then the page's controls do **not** take effect. MVP.md
says for operation: not test mode; once `hand_osc` is in place the default is reversed and this paragraph drops out.

## 1. Silence

1. Read `djk-start --zustand`. The `output` line: if it shows `cypher_stumm`, that is the default: **it was never loud.**
   Restart with the real output: first `djk-ausgang` (read-only; if **foreign** clients hang on the sink, return code 4,
   no `--ton-frei`), then `djk-stop`, then `djk-start --master <senke>:playback_F --ohne-cue --ton-frei`.
   `<senke>` is the `node.name` from `pw-link -i` (without `:playback_FL`) **or** the description of the device; `djk-start`
   resolves either. **Port name trap:** `pw-link` only knows the `node.name`, while the core runs under `pw-jack` and needs
   the description. `djk-start` therefore gives the core the description itself (`--zustand`, line `names under pw-jack`);
   never start the core by hand with the `node.name` (measured on a test sink: "Verbinden … gescheitert", start
   aborted). Cue with a real master: `--ohne-cue`; a cue on the silent sink is rejected, and the core cannot connect pro-audio ports
   (`playback_AUX0…`). `djk-stop --alles` additionally ends the cue server and the cue listener
   of the instance (`--trocken` only lists).
2. All four `active`, and `restarts` on the core does not rise? Then it is the mix: channel fader, crossfader side, gain,
   EQ kill, filter fully left/right, master. Check on the page whether the deck is running (the bar moves).
3. `pw-link -l | grep -A2 cypherdj-kern:master_L` must point to the output. If the connection is missing: `djk-stop`,
   then `djk-start` again (it connects by itself, never wire by hand).
4. If it takes longer than one track: **fallback to the XZ (4.)**, and look for the cause afterwards.

## 2. Restart loop

Sign: `restarts` on the core keeps counting up, the sound stutters or is missing. The core restarts without a pause (RestartSec=0,
no start limit, measured up to 1659 restarts in 5 s), and a loop does not stop by itself.

1. **Immediately `djk-stop`.** That ends the loop and clears everything.
2. Read the cause: `journalctl --user -u cypherdj-kern -n 40 -o cat`. Common: PipeWire gone (`pw-link -o` fails),
   start error with return code 2 (configuration, `~/.config/cypherdj/kern.toml`), output gone (interface unplugged).
3. Once the cause is fixed, run `djk-start` once. If it loops again: not a third time, **fallback to the XZ.**

## 3. Page hangs

The sound keeps running, the page is only display and hand. Do not restart the core.

1. Reload in the browser (F5), with the address from `--zustand` (`open`, default `http://127.0.0.1:47300/`).
2. If that does not help: `systemctl --user restart cypherdj-oberflaeche`, then reload.
3. Bar or announcements missing, but controls work: `systemctl --user restart cypherdj-leitstand`.
4. Controls do not work from the start: `--zustand`, `kern` line. If it says `without test mode`, the start ran with
   `--ohne-pruefmodus`; let the track run out, `djk-stop`, `djk-start` without this switch.
5. Controls no longer work at all and the core is `active`: crossfader and faders stay where they are. Let the track
   run out, then `djk-stop` and `djk-start`, or fallback to the XZ.

## 4. Fallback to the XDJ-XZ with a USB stick

Prepare beforehand: a stick with the tracks as files in folders, file system **FAT32 or HFS+** (the XZ does not read exFAT and
NTFS; manual p. 6). Assumption, not yet confirmed with Andreas: the XZ is connected with MASTER OUT
to the speakers and is already running while djk is playing.

1. On the computer, go quiet: master or crossfader down on the page, then `djk-stop`.
2. On the XZ: open the cover of **[USB 1]** or **[USB 2]**, insert the stick (manual p. 111).
3. Press **[USB 1]**/**[USB 2]**, open the folder with the jog knob (press), **[BACK]** one level up.
4. Select the track, **[LOAD 1]** or **[LOAD 2]**, then **PLAY/PAUSE** (manual p. 112 f.).
5. Pull the stick only after **[USB STOP]** has been held for 2 s and the USB indicator is off (p. 112).

Back to djk later: XZ channel down, `djk-start` with the same parameters as before, check `--zustand`.
