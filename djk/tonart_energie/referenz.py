"""Tonart aus einer Referenzbibliothek beschrifteter Tracks (Patent US 7842878, erloschen 2022-11).
Klassen: 0..11 Moll mit Grundton g (C=0), 12..23 Dur. Das Modell bewertet ein Profil fuer jeden Grundton mit
denselben Gewichten (Profil rotiert), dadurch lernt jeder Track fuer alle 12 Tonarten."""
from __future__ import annotations

import numpy as np
import torch
from torch import nn

from .camelot import zu_camelot


def klasse(grundton: int, moll: bool) -> int:
    return (0 if moll else 12) + grundton % 12


def camelot_aus_klasse(k: int) -> str:
    return zu_camelot(int(k) % 12, int(k) < 12)


class Modell(nn.Module):
    def __init__(self, kanaele: int, versteckt: int = 0):
        super().__init__()
        self.kanaele, self.versteckt = kanaele, versteckt
        rein = kanaele * 36
        self.kopf = (nn.Sequential(nn.Linear(rein, versteckt), nn.ReLU(), nn.Linear(versteckt, 2)) if versteckt
                     else nn.Linear(rein, 2))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (n, kanaele, 36), Index 0 = C. Rueckgabe Logits (n, 24): [Moll g=0..11, Dur g=0..11]."""
        rot = torch.stack([torch.roll(x, -3 * g, dims=-1) for g in range(12)], dim=1)   # (n, 12, k, 36), Grundton g auf 0
        s = self.kopf(rot.flatten(2))                                                  # (n, 12, 2)
        return torch.cat([s[..., 0], s[..., 1]], dim=1)


def trainiere(X: np.ndarray, y: np.ndarray, epochen: int = 400, versteckt: int = 0, gewicht: float = 1e-4,
              lr: float = 0.02, saat: int = 0) -> Modell:
    torch.manual_seed(saat)
    m = Modell(X.shape[1], versteckt)
    opt = torch.optim.Adam(m.parameters(), lr=lr, weight_decay=gewicht)
    xt, yt = torch.tensor(np.asarray(X, dtype=np.float32)), torch.tensor(y, dtype=torch.long)
    for _ in range(epochen):
        opt.zero_grad()
        nn.functional.cross_entropy(m(xt), yt).backward()
        opt.step()
    return m.eval()


@torch.no_grad()
def vorhersage(m: Modell, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    p = torch.softmax(m(torch.tensor(np.asarray(X, dtype=np.float32))), dim=1)
    k = p.max(dim=1)
    return k.indices.numpy(), k.values.numpy()


def speichere(m: Modell, pfad: str, meta: dict) -> None:
    torch.save({"zustand": m.state_dict(), "kanaele": m.kanaele, "versteckt": m.versteckt, "meta": meta}, pfad)


def lade(pfad: str) -> tuple[Modell, dict]:
    d = torch.load(pfad, weights_only=False)
    m = Modell(d["kanaele"], d["versteckt"])
    m.load_state_dict(d["zustand"])
    return m.eval(), d["meta"]


def merkmale(p: dict, kanaele: tuple[str, ...] = ("voll", "bass")) -> np.ndarray:
    """Profil-dict (aus profil.py oder npz) -> (kanaele, 36), Reihenfolge wie `kanaele`."""
    return np.stack([p[k] for k in kanaele]).astype(np.float32)
