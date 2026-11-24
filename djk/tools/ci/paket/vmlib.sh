# vmlib.sh: the VM boot block shared by check_deb.sh and check_upgrade.sh. Source it, do not run it.
#
# The caller defines say() and die() and sets RES (result folder) before sourcing. Environment:
#   CDJ_CI_DIR  state folder (default ~/cypherdj-ci): vm/<release>.img (base image), vm/vmkey, vm/disk.qcow2, vm/seed.iso, out/
#   SMOKE_RELEASE  Ubuntu release of the guest: noble (24.04, default) or resolute (26.04)
#   CDJ_CPUSET  CPU list for qemu (taskset, run at nice 19), e.g. 24-31; empty = no restriction
#   VM_CPUS (8), VM_MEM (16G), SSH_PORT (2223)
# Functions:
#   vm_boot       base image (downloaded once, checked against the published list), fresh seed and overlay, qemu with KVM, ssh up, cloud-init done
#   vm <cmd...>   run a command in the guest as `tester` (stdin is passed through)
#   vm_copy <file...>   copy files into the guest home folder
#   vm_stop       power the guest off (hard stop through the pidfile when it does not go) and wait until its ssh port is free again
# Cleanup: sourcing this file sets traps, so a die, a timeout, INT or TERM after the VM started stops the VM too (KEEP=1 leaves it running).
# A VM of our own left over from an earlier run is stopped at the start of vm_boot, found by the pidfile and checked by its command line
# (qemu-system with -name cdj-smoke); no other qemu process is ever touched.
# The base image is never written: every run boots a new qcow2 overlay.

CI=${CDJ_CI_DIR:-$HOME/cypherdj-ci}; VM=$CI/vm; mkdir -p "$VM"
CPUS=${VM_CPUS:-8}; MEM=${VM_MEM:-16G}; PORT=${SSH_PORT:-2223}
SMOKE_RELEASE=${SMOKE_RELEASE:-noble}
case "$SMOKE_RELEASE" in noble|resolute) ;; *) die "SMOKE_RELEASE must be noble or resolute, not $SMOKE_RELEASE";; esac
IMG_URL=https://cloud-images.ubuntu.com/$SMOKE_RELEASE/current; IMG=$VM/$SMOKE_RELEASE.img
IMG_FILE=$SMOKE_RELEASE-server-cloudimg-amd64.img
SSH_OPT=(-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -i "$VM/vmkey" -p "$PORT")
SCP_OPT=(-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -i "$VM/vmkey" -P "$PORT")

SSH_OPT+=(-o ConnectTimeout=10)
vm() { ssh "${SSH_OPT[@]}" tester@127.0.0.1 "$@"; }
vm_copy() { scp "${SCP_OPT[@]}" -q "$@" tester@127.0.0.1: 2>"$RES/scp.err" || die "copying into the VM failed: $(cat "$RES/scp.err")"; }
porttaken() { ss -ltn 2>/dev/null | grep -qE "[:.]$PORT[[:space:]]"; }

# eigenes_qemu PID: true when PID is a live qemu of ours (our -name), judged by its command line
eigenes_qemu() {
  [ -n "${1:-}" ] && [ -r "/proc/$1/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -q 'qemu-system.* -name cdj-smoke '
}
# vm_eigenes_stoppen: the VM named by $VM/qemu.pid, if it is ours and alive, is terminated (TERM, after 10 s KILL)
vm_eigenes_stoppen() {
  local pid i; pid=$(cat "$VM/qemu.pid" 2>/dev/null) || return 0
  eigenes_qemu "$pid" || return 0
  say "stopping a VM of an earlier run (pid $pid)"
  kill "$pid" 2>/dev/null
  for i in 1 2 3 4 5; do eigenes_qemu "$pid" || break; sleep 2; done
  eigenes_qemu "$pid" && kill -9 "$pid" 2>/dev/null
  return 0
}

vm_boot() {
  vm_eigenes_stoppen
  if [ ! -f "$IMG" ]; then
    say "downloading $SMOKE_RELEASE cloud image"
    curl -fsSL -o "$IMG.part" "$IMG_URL/$IMG_FILE" || die "image download failed"
    local want
    want=$(curl -fsSL "$IMG_URL/SHA256SUMS" | awk -v f="*$IMG_FILE" '$2==f{print $1}')
    [ -n "$want" ] && [ "$(sha256sum "$IMG.part" | cut -d' ' -f1)" = "$want" ] || die "image checksum mismatch"
    mv "$IMG.part" "$IMG"
  fi
  [ -f "$VM/vmkey" ] || ssh-keygen -q -t ed25519 -N '' -C cypherdj-ci -f "$VM/vmkey"
  # a fresh seed (new instance id) and a fresh overlay per run
  rm -rf "$VM/seed"; mkdir -p "$VM/seed"
  cat > "$VM/seed/user-data" <<EOF
#cloud-config
users:
  - name: tester
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    groups: [sudo]
    lock_passwd: true
    ssh_authorized_keys:
      - $(cat "$VM/vmkey.pub")
ssh_pwauth: false
EOF
  printf 'instance-id: cdj-smoke-%s\nlocal-hostname: smoke\n' "$(date +%s)" > "$VM/seed/meta-data"
  xorriso -as genisoimage -quiet -output "$VM/seed.iso" -volid cidata -joliet -rock "$VM/seed/user-data" "$VM/seed/meta-data" 2>/dev/null || die "seed iso failed"
  rm -f "$VM/disk.qcow2"
  qemu-img create -q -f qcow2 -b "$SMOKE_RELEASE.img" -F qcow2 "$VM/disk.qcow2" 40G || die "overlay failed"
  # the previous guest may still be shutting down: wait up to a minute for the port before giving up
  local i
  for i in $(seq 1 30); do porttaken || break; sleep 2; done
  porttaken && die "port $PORT is taken, not starting (another VM?)"
  [ -w /dev/kvm ] || die "/dev/kvm is not writable for $USER"

  # a memory ceiling for the guest through a transient user scope when the user bus is there (a runner service may have none)
  local scope=()
  systemd-run --user --scope -q -p MemoryMax=20G true 2>/dev/null && scope=(systemd-run --user --scope -q -p MemoryMax=20G)
  rm -f "$VM/qemu.pid"
  local pin=(); [ -z "${CDJ_CPUSET:-}" ] || pin=(nice -n 19 taskset -c "$CDJ_CPUSET")
  ( cd "$VM" && "${scope[@]}" "${pin[@]}" \
    qemu-system-x86_64 -enable-kvm -cpu host -smp "$CPUS" -m "$MEM" -name cdj-smoke \
    -drive file=disk.qcow2,if=virtio,format=qcow2 -drive file=seed.iso,if=virtio,format=raw,media=cdrom,readonly=on \
    -netdev user,id=n0,hostfwd=tcp:127.0.0.1:$PORT-:22 -device virtio-net-pci,netdev=n0 \
    -display none -serial file:serial.log -pidfile qemu.pid -daemonize ) || die "qemu did not start"
  local t0; t0=$(date +%s)
  for i in $(seq 1 90); do vm true 2>/dev/null && break; sleep 3; [ "$i" = 90 ] && die "the VM did not answer ssh within 270 s"; done
  say "VM up after $(( $(date +%s) - t0 )) s ($(vm 'lsb_release -ds; uname -r' | tr '\n' ' '))"
  vm 'cloud-init status --wait >/dev/null 2>&1; true'
}

vm_stop() {
  local pid i; pid=$(cat "$VM/qemu.pid" 2>/dev/null)
  vm 'sudo poweroff' >/dev/null 2>&1
  for i in $(seq 1 15); do eigenes_qemu "$pid" || break; sleep 2; done
  vm_eigenes_stoppen
  for i in $(seq 1 30); do porttaken || return 0; sleep 2; done
  return 0
}

# the traps: whatever ends the script after the VM started, the VM does not stay behind
vm_notaus() { [ "${KEEP:-0}" = 1 ] && return 0; eigenes_qemu "$(cat "$VM/qemu.pid" 2>/dev/null)" && vm_stop; return 0; }
trap vm_notaus EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
