# kit_wahl: choice of the Strudel stream kits for djk-start (sourced, defines one function).
# kit_wahl <kit folder> <given 0|1> <default>   prints the chosen kit name on stdout.
#   default present                  -> default
#   default absent, not given        -> starter, with a note on stderr
#   default absent, given            -> return 2 (the user named a kit that is not there)
#   default and starter both absent  -> return 2
# The starter kit only counts when its kit.json is readable JSON with "schema": 1 (a damaged one acts like an absent one).
_starter_ok() {  # $1 kit.json
  [ -f "$1" ] || return 1
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; j=json.load(open(sys.argv[1])); sys.exit(0 if isinstance(j, dict) and j.get("schema") == 1 else 1)' "$1" 2>/dev/null
    return
  fi
  # No python3: a coarse text check (an object that carries "schema": 1), enough to tell a kit from garbage.
  local t; t=$(tr -d ' \t\r\n' < "$1" 2>/dev/null) || return 1
  [[ "$t" == \{*\} ]] && [[ "$t" =~ [\{,]\"schema\":1[,\}] ]]
}

kit_wahl() {
  local ordner=$1 gegeben=$2 vorgabe=$3
  local hinweis="run djk/start/djk-starter (or build one with djk/generator/kit_build.py)"
  if [ -f "$ordner/$vorgabe/kit.json" ]; then echo "$vorgabe"; return 0; fi
  if [ "$gegeben" = 1 ] || ! _starter_ok "$ordner/starter/kit.json"; then
    echo "djk-start: kit $vorgabe missing: $hinweis" >&2; return 2
  fi
  echo "djk-start: kit $vorgabe not found, using the starter kit" >&2
  echo starter
}
