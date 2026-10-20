"""Unabhaengige Teilarbeit der Vorbereitung gleichzeitig rechnen (Tempo, ohne das Ergebnis zu aendern).

Essentia (und Teile von numpy) halten den GIL, also laufen Threads dort nicht parallel: `im_kind` forkt einen
Kindprozess, der `fn(*args)` rechnet und das Ergebnis (pickle) ueber eine Pipe zurueckgibt. Das Kind rechnet mit
denselben Funktionen und denselben Eingaben wie der sequentielle Weg, also bitgleich. Fehler im Kind werden im
Elternprozess beim `ergebnis()` mit derselben Ausnahme neu geworfen. Das Kind fasst torch nie an (fork nach
torch-Import ist nur deshalb sicher) und beendet sich mit os._exit, ohne Pufferleeren des Elternprozesses."""
import os
import pickle
import signal
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor


class Kind:
    def __init__(self, fn, args):
        self._r, w = os.pipe()
        sys.stdout.flush()
        sys.stderr.flush()
        self.pid = os.fork()
        if self.pid == 0:                                   # Kind
            code = 0
            try:
                os.close(self._r)
                try:
                    antwort = ("ok", fn(*args))
                except BaseException as ex:                 # noqa: BLE001 - jede Ausnahme geht zum Elternprozess
                    traceback.print_exc()
                    antwort = ("fehler", ex)
                try:
                    daten = pickle.dumps(antwort, protocol=pickle.HIGHEST_PROTOCOL)
                except BaseException as ex:                 # Ausnahme nicht pickelbar
                    daten = pickle.dumps(("fehler", RuntimeError(f"{type(ex).__name__}: {ex}")))
                with os.fdopen(w, "wb") as f:
                    f.write(daten)
            except BaseException:
                code = 1
            finally:
                os._exit(code)
        os.close(w)
        self._daten = None
        self.fertig = False
        self._leser = threading.Thread(target=self._lies, args=(self._r,), daemon=True)
        self._leser.start()                                 # leert die Pipe, damit das Kind nie am vollen Puffer haengt

    def _lies(self, r):
        with os.fdopen(r, "rb") as f:
            self._daten = f.read()

    def ergebnis(self):
        self._leser.join()
        os.waitpid(self.pid, 0)
        self.fertig = True
        if not self._daten:
            raise RuntimeError("Kindprozess ohne Ergebnis beendet")
        art, wert = pickle.loads(self._daten)
        if art == "fehler":
            raise wert
        return wert

    def abbrechen(self):
        if self.fertig:
            return
        self.fertig = True
        try:
            os.kill(self.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            os.waitpid(self.pid, 0)
        except ChildProcessError:
            pass


def gleichzeitig(*aufrufe):
    """Mehrere (fn, args) in Threads (fuer ffmpeg-Aufrufe: subprocess gibt den GIL frei). Rueckgabe in Reihenfolge."""
    with ThreadPoolExecutor(max_workers=len(aufrufe)) as pool:
        fs = [pool.submit(fn, *args) for fn, args in aufrufe]
        return [f.result() for f in fs]
