# Places that resolve from the code's own location (package 1.0, spec D4 to D6). Sourced by the start scripts with DJK set.
# root = the folder above djk/ (a checkout, or /opt/cypher-dj). Transient units do not inherit the caller's environment and the
# hand MCP server is started by a foreign client, so nothing here may depend on the environment alone.
#   orte_node             node binary: CYPHERDJ_NODE, else <root>/node/bin/node when executable, else /usr/bin/node
#   orte_strudel          folder that holds packages/: parent of STRUDEL_PAKETE, else CYPHERDJ_STRUDEL (must exist, else rc 2),
#                         else <root>/strudel when present, else $HOME/strudel
#   orte_vst3_pfade       newline list: ~/.local/lib/cypherdj/vst3, the elements of CYPHERDJ_VST3_PFADE (colon list, empty
#                         elements ignored), <root>/lib/vst3 when present
#   orte_bundle <name>    the first folder of that list holding <name> (e.g. rb338.vst3), else empty

orte_wurzel() { dirname -- "$DJK"; }

orte_node() {
  if [ -n "${CYPHERDJ_NODE:-}" ]; then printf '%s\n' "$CYPHERDJ_NODE"; return 0; fi
  local w; w=$(orte_wurzel)
  if [ -x "$w/node/bin/node" ]; then printf '%s\n' "$w/node/bin/node"; else printf '%s\n' /usr/bin/node; fi
}

orte_strudel() {
  if [ -n "${STRUDEL_PAKETE:-}" ]; then dirname -- "$STRUDEL_PAKETE"; return 0; fi
  if [ -n "${CYPHERDJ_STRUDEL:-}" ]; then
    [ -d "$CYPHERDJ_STRUDEL" ] || { echo "CYPHERDJ_STRUDEL: $CYPHERDJ_STRUDEL does not exist" >&2; return 2; }
    printf '%s\n' "$CYPHERDJ_STRUDEL"; return 0
  fi
  local w; w=$(orte_wurzel)
  if [ -d "$w/strudel" ]; then printf '%s\n' "$w/strudel"; else printf '%s\n' "$HOME/strudel"; fi
}

orte_vst3_pfade() {
  printf '%s\n' "$HOME/.local/lib/cypherdj/vst3"
  local p w; w=$(orte_wurzel)
  local -a el
  IFS=: read -r -a el <<<"${CYPHERDJ_VST3_PFADE:-}"
  for p in "${el[@]}"; do [ -n "$p" ] && printf '%s\n' "$p"; done
  [ -d "$w/lib/vst3" ] && printf '%s\n' "$w/lib/vst3"
  return 0
}

orte_bundle() {
  local p
  while IFS= read -r p; do
    if [ -d "$p/$1" ]; then printf '%s\n' "$p/$1"; return 0; fi
  done < <(orte_vst3_pfade)
  return 0
}
