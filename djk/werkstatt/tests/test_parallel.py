import os
import time

import numpy as np
import pytest

from werkstatt.parallel import Kind, gleichzeitig


def test_kind_gibt_ergebnis_zurueck_auch_gross():
    x = np.arange(2_000_000, dtype=np.float64)       # groesser als der Pipe-Puffer: Kind darf nicht haengen
    k = Kind(lambda a: (a * 2.0, "ok"), (x,))
    y, text = k.ergebnis()
    assert text == "ok" and np.array_equal(y, x * 2.0)


def test_kind_rechnet_in_eigenem_prozess_und_parallel():
    t = time.perf_counter()
    ks = [Kind(lambda: (time.sleep(0.5), os.getpid())[1], ()) for _ in range(3)]
    pids = [k.ergebnis() for k in ks]
    assert time.perf_counter() - t < 1.2             # 3 x 0,5 s gleichzeitig
    assert len(set(pids)) == 3 and os.getpid() not in pids


def test_kind_wirft_die_ausnahme_im_elternprozess_neu():
    def boese():
        raise ValueError("kaputt")
    with pytest.raises(ValueError, match="kaputt"):
        Kind(boese, ()).ergebnis()


def test_kind_abbrechen_beendet_das_kind_und_ist_wiederholbar():
    k = Kind(time.sleep, (30,))
    k.abbrechen()
    k.abbrechen()
    with pytest.raises(OSError):
        os.kill(k.pid, 0)


def test_gleichzeitig_behaelt_die_reihenfolge():
    assert gleichzeitig((lambda a: a, (1,)), (lambda a, b: a + b, (2, 3))) == [1, 5]
