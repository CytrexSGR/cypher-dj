# Windows VST3 plugins on Linux through yabridge (install notes, plan 1.11 task 1b)

Reproduction notes for the measurement setup; nothing here is product code. Measured with Wine 11.21 (staging) and
yabridge 5.1.1 on Ubuntu 24.04. Results: `~/messungen/2026-11-10-1.11-plugins/t1b.md`.

## 1. Wine

Wine staging from the WineHQ repository (`winehq-staging`, binaries under `/opt/wine-staging/bin`). The distro's own
`wine64 9.0` is not what the measurements used. Check with `wine --version`.

## 2. yabridge

    mkdir -p ~/.local/share/yabridge && cd ~/.local/share
    curl -LO https://github.com/robbert-vdh/yabridge/releases/download/5.1.1/yabridge-5.1.1.tar.gz
    tar xzf yabridge-5.1.1.tar.gz        # unpacks into ./yabridge (chainloader .so files, yabridge-host.exe(.so), yabridgectl)
    export PATH="$HOME/.local/share/yabridge:$PATH"
    yabridgectl --version

## 3. A Wine prefix of its own

A separate prefix keeps the plugin installers away from any other Wine use. The Vital install alone took 2.0 GB in it.

    export WINEPREFIX="$HOME/.wine-plugins"
    WINEARCH=win64 wineboot -u
    yabridgectl add "$WINEPREFIX/drive_c/Program Files/Common Files/VST3"

## 4. Installing a Windows plugin

Installers are foreign files: run them only with Wine inside the prefix, never directly, and in an empty download folder.

    export WINEPREFIX="$HOME/.wine-plugins" WINEDEBUG=-all
    wine /path/to/installer.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART    # Inno Setup installers
    yabridgectl sync                                                        # writes the Linux shell into ~/.vst3/yabridge

Examples, both ended in `~/.vst3/yabridge/<Name>.vst3`:

* Vital for Windows (`VitalInstaller.exe`, Inno Setup): `/VERYSILENT`, about 2 GB in the prefix.
* Valhalla Supermassive 5.0.0 (free, no account, 3 MB). The Valhalla pages sit behind a Cloudflare challenge, but the files are
  on S3 and fetch with plain `curl`:
  `https://valhallaproduction.s3.us-west-2.amazonaws.com/supermassive/ValhallaSupermassiveWin_V5_0_0.zip`
  (the link name was read from the site's download page as archived on 2026-10-25). The zip holds one Inno Setup exe,
  `wine ValhallaSupermassiveWin_V5_0_0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` installs in about 5 s into
  `C:\Program Files\Common Files\VST3\ValhallaSupermassive.vst3`; then `yabridgectl sync`.

## 5. Check

    /usr/lib/carla/carla-discovery-native vst3 ~/.vst3/yabridge/ValhallaSupermassive.vst3   # must end with carla-discovery::end::

Measuring: `messlauf.py start3|lang|killwine|hostkill|ui <smw|vitw|vitn>` (see its docstring; run under both timing locks).
Notes for the instrument keys are sent by `carla_host.py --hold-note 48`. `ui` needs `DISPLAY` and `XAUTHORITY` in the
environment (they are passed to the transient unit).

## 6. Facts that cost time

* The Valhalla "Clear" parameter (index 5) has default 1.0 in the VST3 parameter list. `carla_host.py --defaults` sets every
  parameter to its default, which holds the reverb tail cleared: pass `--param 5=0` (the `smw` key does).
* `yabridge-host.exe` runs in the host's cgroup, so a transient systemd unit sees the whole Wine tree (`rss_tree`,
  `wine_pids`).

## 7. Cleanup

Wine processes of the prefix (wineserver, services.exe, winedevice.exe, plugplay.exe, explorer.exe, rpcss.exe, svchost.exe,
yabridge-host.exe.so) normally end by themselves within about one second after the last host is gone (measured after
`SIGKILL` of the host process: nothing left after 1 s). If something stays behind:

    WINEPREFIX="$HOME/.wine-plugins" wineserver -k         # asks wineserver to terminate all processes of the prefix
    systemctl --user kill -s KILL <unit>; systemctl --user stop <unit>   # when the host was a transient unit: kills the whole cgroup

Check with `ps -eo pid,args | grep -E 'wineserver|yabridge-host|winedevice' | grep -v grep`.
