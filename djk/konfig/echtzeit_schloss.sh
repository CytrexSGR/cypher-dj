# Setzt und exportiert CYPHERDJ_ECHTZEIT_SCHLOSS: den Pfad der Sperrdatei, die zeitkritische Messläufe per flock nehmen,
# damit nie zwei gleichzeitig laufen. Zum Einlesen mit "." (POSIX sh und bash).
# Reihenfolge: schon gesetzte Variable des Aufrufers; sonst die Zeile in ~/.config/cypherdj/umgebung.env
# (CYPHERDJ_UMGEBUNG: andere Datei); sonst ${XDG_RUNTIME_DIR:-/tmp}/cypherdj-echtzeit.lock.
if [ -z "${CYPHERDJ_ECHTZEIT_SCHLOSS:-}" ]; then
  _umg=${CYPHERDJ_UMGEBUNG:-${HOME:-/nonexistent}/.config/cypherdj/umgebung.env}
  if [ -f "$_umg" ]; then
    CYPHERDJ_ECHTZEIT_SCHLOSS=$(. "$_umg" >/dev/null 2>&1; printf '%s' "${CYPHERDJ_ECHTZEIT_SCHLOSS:-}")
  fi
  : "${CYPHERDJ_ECHTZEIT_SCHLOSS:=${XDG_RUNTIME_DIR:-/tmp}/cypherdj-echtzeit.lock}"
  unset _umg
fi
export CYPHERDJ_ECHTZEIT_SCHLOSS
