# CI test image

`Containerfile` builds `localhost/cypherdj-test`, the image `djk/tools/ci/im_container.sh` runs the gate in. `build.sh` builds it only if the
runner has no image tagged with the hash of Containerfile + `djk/requirements.txt` + `kf_cli.cpp` + the cache `MANIFEST`; it then points
`localhost/cypherdj-test:latest` to that image. The CI jobs call it before the first container run.

## What is downloaded, what is not

Fetched while building (small, 1 GB in all at most): Ubuntu 24.04 base and apt packages, the node tarball (sha256 pinned), rustup, libKeyFinder 2.2.8 (git). The python
packages of `djk/requirements.txt` are NOT fetched: pip runs with `--no-index` against `wheels/` in the cache. Guards: every apt step stops above
1 GB of download (`apt-sicher.sh`), curl has `--max-filesize`, `build.sh` checks every cache folder against `MANIFEST` (file count and bytes) and
refuses an active torch/tensorflow/nvidia/triton line in `djk/requirements.txt` (torch comes from `torch-gpu/`). Never downloaded: everything in the local cache folder below. `build.sh` stops with
a message when a part of it is missing; it does not fall back to the internet.

## The local cache folder

`$CI_IMAGE_CACHE`, default `$HOME/cypherdj-ci/image-cache` on the runner. It holds installed trees (what `site-packages` of a working install looks like):

| folder | content | size | used for |
|---|---|---|---|
| `torch-gpu/` | `torch` 2.10.0+cu128, `torchvision` 0.25.0, `triton` 3.6.0, the `nvidia-*` cu12 packages, `torchgen`, `functorch`, with their `*.dist-info` | 6.6 GB | `/usr/local/lib/python3.12/dist-packages` (Stems, S6, werkstatt) |
| `werkstatt-venv-sp/` | the werkstatt packages (site-packages of `djk/workshop/.venv`) | 0.4 GB | `/opt/werkstatt-venv` |
| `mik-sp/` | essentia-tensorflow and its dependencies (key_energy) | 0.6 GB | `/opt/mik` |
| `mik-modelle/` | the Jamendo/Discogs models of key_energy | 25 MB | `/opt/mik/modelle` |
| `wheels/` | the wheels of `djk/requirements.txt` and the torch helper packages (cp312 manylinux), 95 MB | 0.1 GB | offline `pip install --no-index --find-links` |
| `MANIFEST` | one line per folder: `name file-count bytes` | - | part of the image hash, so a changed cache gives a new tag |

Write the manifest after filling the folders:

    cd "$CI_IMAGE_CACHE" && for d in torch-gpu werkstatt-venv-sp mik-sp mik-modelle wheels; do
      echo "$d $(find $d -type f | wc -l) $(du -sb $d | cut -f1)"; done > MANIFEST

Fill `wheels/` from inside the image (same python as the build): `podman run --rm -v REQ:/tmp/req.txt:ro -v $CI_IMAGE_CACHE/wheels:/w localhost/cypherdj-test:latest pip download --only-binary=:all: -d /w -r /tmp/req.txt six sympy==1.14.0 mpmath==1.3.0 networkx==3.7 Jinja2==3.1.6 fsspec filelock typing_extensions`. Fill the other folders from a machine that has a working set-up of the same versions (the development host has them under `djk/workshop/.venv` and
its python): copy the installed packages over the LAN, e.g. `rsync -a dev:.../site-packages/torch ... torch-gpu/`. Torch needs the CUDA 12.8
build; the version pins above are the ones the gate was green with. The GPU is passed into the container by `im_container.sh`
(NVIDIA CDI, `/etc/cdi/nvidia.yaml` on the runner). The model weights of the Stems tests are not in the image: `im_container.sh` mounts
`$CI_GEWICHTE` (default `$HOME/cypherdj-ci/gewichte`, 825 MB) read-only.

## Not in the image, mounted by `im_container.sh`

- Strudel sources: `$CI_STRUDEL` (default `~/strudel` on the runner host), mounted read-only at `/home/bau/strudel`. The generator and the suites that start it fail with `ERR_MODULE_NOT_FOUND` without it.
- Model weights: `$CI_GEWICHTE` (default `~/cypherdj-ci/gewichte`), see above.

## Volumes on the runner host

- `cdjci-cargo-reg` and `cdjci-cargo-git` hold the cargo crates. The gate runs cargo with `--offline`, so they must be filled once while online
  (the instruments suite fails with "failed to download ... --offline was specified" otherwise). On the laptop they were filled from the
  `cdjtest-cargo-*` volumes (about 420 MB): `podman volume export cdjtest-cargo-reg | podman volume import cdjci-cargo-reg -`, the same for `-git`.
- `cdjci-ccache` keeps the compiler cache between runs.
