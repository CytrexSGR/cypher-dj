# Marks a test as an integration test: it starts real units (systemd-run, PipeWire sinks, the real djk-stop) and therefore never runs by default.
# Source it and call `I=$(integration_instanz "${1:-}") || exit 2`: the test instance (a to i) must be named explicitly, as the argument or in
# DJK_INTEGRATION_INSTANZ. There is no default instance and no empty one (2026-11-18: a start test run without an explicit instance deleted the
# core state of the running studio). Nothing is started before this check passes.
integration_instanz() {
  local i=${1:-${DJK_INTEGRATION_INSTANZ:-}}
  case "$i" in
    [a-i]) printf '%s' "$i" ;;
    *) echo "integration test: it starts real units and needs an explicit test instance (a to i), as argument or DJK_INTEGRATION_INSTANZ. Nothing started." >&2; return 2 ;;
  esac
}
