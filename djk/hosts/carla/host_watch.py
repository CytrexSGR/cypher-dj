"""RB-338 W1 (Prüferbefund CC123): ein nih-plug-VST3 bekommt über Carla weder CC123 noch CC120 (gemessen: Note hängt, auch mit
allen SEND_*-Optionen). Der Kern schickt All-Off, wenn er die Kante zum Wirt neu verbindet (main.cpp, F06/B10); ging das Off
in der Lücke verloren, hängt die Note. Diese Wache sieht die Neuverbindung selbst: sie fragt über einen eigenen portlosen
JACK-Client, welche Ports mit `<client>:events-in` verbunden sind, und meldet, wenn eine Verbindung dazukam. ParamSteuerung
antwortet darauf mit Note-Off für alle Noten (`panik`)."""
import ctypes


class JackVerbindungen:
    """Abfrage der Verbindungen eines Ports über libjack (unter pw-jack: PipeWire-JACK). Kein Port, keine Aktivierung."""

    def __init__(self, port_name: str, client_name: str):
        self.lib = ctypes.CDLL("libjack.so.0")
        self.lib.jack_client_open.restype = ctypes.c_void_p
        self.lib.jack_client_open.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p]
        self.lib.jack_port_by_name.restype = ctypes.c_void_p
        self.lib.jack_port_by_name.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
        self.lib.jack_port_get_all_connections.restype = ctypes.POINTER(ctypes.c_char_p)
        self.lib.jack_port_get_all_connections.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self.lib.jack_free.argtypes = [ctypes.c_void_p]
        self.lib.jack_client_close.argtypes = [ctypes.c_void_p]
        self.port_name = port_name.encode()
        self.client = self.lib.jack_client_open(client_name.encode(), 0x01, None)  # JackNoStartServer
        if not self.client:
            raise OSError("jack_client_open scheitert")

    def verbunden(self) -> set:
        port = self.lib.jack_port_by_name(self.client, self.port_name)
        if not port:
            return set()
        arr = self.lib.jack_port_get_all_connections(self.client, port)
        if not arr:
            return set()
        try:
            aus, i = set(), 0
            while arr[i]:
                aus.add(arr[i].decode())
                i += 1
            return aus
        finally:
            self.lib.jack_free(ctypes.cast(arr, ctypes.c_void_p))

    def schliesse(self):
        self.lib.jack_client_close(self.client)


class Wache:
    """Ruft `bei_neuverbindung()`, wenn gegenüber der letzten Abfrage eine Verbindung dazugekommen ist. Die erste Abfrage setzt
    nur den Ausgangsstand. Alle `periode` Sekunden (monotone Zeit) wird abgefragt.
    Bekannte Grenze: wird die Verbindung zwischen zwei Abfragen getrennt UND wieder verbunden, sieht die Wache nichts (bei 20 ms
    Periode ein Fenster von wenigen ms; der Kern prüft seine Kanten nur alle 500 ms).
    Ein Fehler in Abfrage oder Rückruf beendet die Wache (`fehler` gesetzt, `takt` gibt danach False), er bricht den Wirt nicht ab."""

    def __init__(self, abfrage, bei_neuverbindung, periode: float = 0.02):
        self.abfrage, self.bei, self.periode = abfrage, bei_neuverbindung, periode
        self.letzte, self.naechste, self.fehler = None, 0.0, None

    def takt(self, jetzt: float) -> bool:
        if self.fehler is not None or jetzt < self.naechste:
            return False
        self.naechste = jetzt + self.periode
        try:
            aktuell = self.abfrage()
            neu = self.letzte is not None and bool(aktuell - self.letzte)
            self.letzte = aktuell
            if neu:
                self.bei()
            return neu
        except Exception as e:
            self.fehler = f"{type(e).__name__}: {e}"
            return False
