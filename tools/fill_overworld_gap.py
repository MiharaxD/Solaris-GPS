#!/usr/bin/env python3
"""Desfaz os cortes retos do Overworld entre Jinzhou e Mengzhou (só mexe no disco, nunca acessa a rede).

Os dados do mapa vêm em blocos retangulares e o que fica de fora é azul liso. Entre as duas
regiões isso deixa cortes retos atravessando a terra: a borda direita do bloco da esquerda e o
contorno em "L" do bloco da direita (lado esquerdo, degrau e topo). O script transforma cada
corte em costa: perto do corte, a terra continua por reflexo (com o espelho levemente
inclinado, pra não sair simétrica) até uma linha de costa irregular, com baías e penínsulas, e
esmaece no mar como as costas originais do mapa. As duas regiões viram ilhas separadas por mar.
Longe dos cortes, nada muda.

    .venv/Scripts/python tools/fill_overworld_gap.py [--preview PNG] [--write]

Sem `--write` só gera a prévia. Com `--write`, copia as tiles z6 originais da região pra
`assets/tiles_cache_backup/overworld_gap/` (as que ainda não estão lá), regrava as z6 afetadas
e refaz as z5 correspondentes. Depois rode `tools/build_tiles.py build`. Os originais do backup
sempre são a fonte, então rodar de novo dá o mesmo resultado.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

MAP_ID = "AkiWorld_WP-e2f88b110e3b3c0bd074b0b86c81e40a"
CACHE = Path("assets/tiles_cache") / MAP_ID
BACKUP = Path("assets/tiles_cache_backup/overworld_gap")
TILE = 512
Z = 6
ROWS = range(22, 40)  # z6, linhas [22, 40)
COLS = range(16, 30)  # z6, colunas [16, 30)
LEGACY_Z5 = (range(12, 19), range(8, 13))  # z5 que a versão antiga regravava: sempre refeitas
BG = np.array([5, 39, 52], dtype=np.float32)

# Cortes medidos no backup, em px do z6 com origem no canto da região (linha 22, coluna 16).
CUT_L = 1850          # última coluna de terra do bloco da esquerda
CUT_R = 2906          # primeira coluna do bloco da direita (parte de baixo)
CUT_N = 3963          # primeira coluna do bloco da direita (parte de cima, depois do degrau)
CUT_YT = 2477         # primeira linha da parte de baixo (o degrau)
CUT_YTOP = 1420       # primeira linha da parte de cima
CUT_TOP_END = 5770    # o topo reto da direita vira costa natural por volta de x = 5570

EDGE_INSET = 3        # os 2–3 px dos cortes são serrilhados: a costa começa um pouco pra dentro
COAST_MIN = -320.0    # a costa recua até isto pra dentro da terra original...
COAST_MAX = 420.0     # ...e avança até isto pro mar
FADE_MIN = 50.0       # largura do esmaecimento terra→mar, como nas costas do próprio mapa
FADE_MAX = 150.0
SKEW = 0.8            # inclinação variável do espelho, pra o reflexo não ficar simétrico
SEED = 11
GRID = 8              # passo da grade do ruído
STRIP = 512           # processa em faixas de linhas pra caber na memória


def gauss(x: np.ndarray, sigma: float) -> np.ndarray:
    """Desfoque gaussiano por FFT (borda replicada pelo tamanho do padding)."""
    pad = int(sigma * 3) + 1
    xp = np.pad(x, pad, mode="edge")
    fy = np.fft.fftfreq(xp.shape[0])[:, None]
    fx = np.fft.rfftfreq(xp.shape[1])[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fy**2 + fx**2))
    return np.fft.irfft2(np.fft.rfft2(xp) * k, s=xp.shape)[pad:-pad, pad:-pad]


class Noise:
    """Ruído suave em [-1, 1] com detalhe na escala `scale` (px), amostrado em qualquer ponto."""

    def __init__(self, h: int, w: int, scale: float, rng: np.random.Generator) -> None:
        g = gauss(rng.standard_normal((h // GRID + 3, w // GRID + 3)), scale / GRID / 2)
        self.g = np.clip(g / (2.5 * g.std() + 1e-12), -1, 1).astype(np.float32)

    def __call__(self, py: np.ndarray, px: np.ndarray) -> np.ndarray:
        gy, gx = py / GRID, px / GRID
        iy, ix = gy.astype(np.int32), gx.astype(np.int32)
        fy, fx = gy - iy, gx - ix
        g = self.g
        top = g[iy, ix] * (1 - fx) + g[iy, ix + 1] * fx
        bot = g[iy + 1, ix] * (1 - fx) + g[iy + 1, ix + 1] * fx
        return top * (1 - fy) + bot * fy


def tile_path(root: Path, r: int, c: int) -> Path:
    return root / str(Z) / f"{r}_{c}.webp"


def load_region() -> tuple[np.ndarray, set[tuple[int, int]]]:
    """Região original (backup quando existe) e o conjunto de tiles que existem de verdade."""
    big = np.empty((len(ROWS) * TILE, len(COLS) * TILE, 3), dtype=np.uint8)
    big[:] = BG.astype(np.uint8)
    present: set[tuple[int, int]] = set()
    for r in ROWS:
        for c in COLS:
            p = tile_path(BACKUP, r, c)
            if not p.exists():
                p = tile_path(CACHE, r, c)
            if p.exists() and p.stat().st_size:
                present.add((r, c))
                with Image.open(p) as im:
                    big[(r - ROWS.start) * TILE:(r - ROWS.start + 1) * TILE,
                        (c - COLS.start) * TILE:(c - COLS.start + 1) * TILE] = np.asarray(im.convert("RGB"))
    return big, present


def check_cuts(big: np.ndarray) -> None:
    """Confere que os cortes medidos batem com o disco (terra de um lado, azul liso do outro)."""
    def bg_frac(ys: slice, xs: slice) -> float:
        d = np.abs(big[ys, xs].astype(np.int16) - BG.astype(np.int16)).sum(axis=-1)
        return float((d <= 6).mean())

    probes = {
        "esquerda": (bg_frac(slice(2800, 4200), slice(CUT_L - 8, CUT_L)),
                     bg_frac(slice(2800, 4200), slice(CUT_L + 12, CUT_L + 20))),
        "direita": (bg_frac(slice(3600, 5000), slice(CUT_R, CUT_R + 8)),
                    bg_frac(slice(3600, 5000), slice(CUT_R - 20, CUT_R - 12))),
        "degrau": (bg_frac(slice(CUT_YT, CUT_YT + 8), slice(CUT_R + 100, CUT_N - 100)),
                   bg_frac(slice(CUT_YT - 20, CUT_YT - 12), slice(CUT_R + 100, CUT_N - 100))),
        "topo": (bg_frac(slice(CUT_YTOP, CUT_YTOP + 8), slice(CUT_N + 100, CUT_TOP_END - 300)),
                 bg_frac(slice(CUT_YTOP - 20, CUT_YTOP - 12), slice(CUT_N + 100, CUT_TOP_END - 300))),
    }
    for name, (land, sea) in probes.items():
        if land > 0.2 or sea < 0.95:
            raise SystemExit(f"o corte '{name}' não bate com o disco (terra {land:.2f}, mar {sea:.2f})")


def nearest_on_segment(py: np.ndarray, px: np.ndarray, a: tuple[float, float],
                       b: tuple[float, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ay, ax = a
    by, bx = b
    dy, dx = by - ay, bx - ax
    t = np.clip(((py - ay) * dy + (px - ax) * dx) / (dy * dy + dx * dx), 0, 1)
    qy, qx = ay + t * dy, ax + t * dx
    return np.hypot(py - qy, px - qx), qy, qx


def compose(big: np.ndarray) -> np.ndarray:
    h, w = big.shape[:2]
    xl, xr, xn = CUT_L - EDGE_INSET, CUT_R + EDGE_INSET, CUT_N + EDGE_INSET
    yt, ytop = CUT_YT + EDGE_INSET, CUT_YTOP + EDGE_INSET
    # contorno do bloco da direita, de cima pra baixo: (y, x)
    right = [(ytop, CUT_TOP_END), (ytop, xn), (yt, xn), (yt, xr), (h, xr)]

    rng = np.random.default_rng(SEED)
    n_big, n_mid, n_small = Noise(h, w, 1400, rng), Noise(h, w, 450, rng), Noise(h, w, 110, rng)
    n_fade, n_skew = Noise(h, w, 700, rng), Noise(h, w, 1200, rng)

    reach = int(COAST_MAX + FADE_MAX)
    x0, x1 = max(xl - reach, 0), min(CUT_TOP_END + reach, w)
    out = big.copy()
    for y0 in range(0, h, STRIP):
        y1 = min(y0 + STRIP, h)
        py, px = np.mgrid[y0:y1, x0:x1].astype(np.float32)

        # lado esquerdo: corte vertical em x = xl (tangente ao longo de y)
        s_l = px - xl
        # lado direito: distância ao contorno, negativa dentro do bloco
        d_r = np.full_like(px, np.inf)
        qy_r, qx_r, horiz = np.zeros_like(px), np.zeros_like(px), np.zeros_like(px, dtype=bool)
        for a, b in zip(right, right[1:]):
            d, qy, qx = nearest_on_segment(py, px, a, b)
            m = d < d_r
            d_r[m], qy_r[m], qx_r[m] = d[m], qy[m], qx[m]
            horiz[m] = a[0] == b[0]
        inside_r = ((px >= xr) & (py >= yt)) | ((px >= xn) & (py >= ytop))
        s_r = np.where(inside_r, -d_r, d_r)

        left = s_l < s_r
        s = np.where(left, s_l, s_r)
        if not np.any(s < COAST_MAX + FADE_MAX):
            continue
        qy = np.where(left, py, qy_r)
        qx = np.where(left, xl, qx_r)
        along_x = (~left) & horiz

        # linha de costa: avanço/recuo e largura do esmaecimento variam pelo caminho
        wav = 0.55 * n_big(py, px) + 0.3 * n_mid(py, px) + 0.15 * n_small(py, px)
        coast = COAST_MIN + (COAST_MAX - COAST_MIN) * np.clip(0.45 + 1.6 * wav, 0, 1)
        fade = FADE_MIN + (FADE_MAX - FADE_MIN) * (0.5 + 0.5 * n_fade(py, px))
        t = np.clip((coast - s) / fade + 0.5, 0, 1)
        alpha = t * t * (3 - 2 * t)

        # terra além do corte: reflexo no ponto mais próximo, deslizando ao longo do corte em
        # proporção à distância (contínuo no corte, sem simetria longe dele)
        out_s = np.maximum(s, 0)
        slide = SKEW * n_skew(py, px) * out_s
        ry = 2 * qy - py + np.where(along_x, 0, slide)
        rx = 2 * qx - px + np.where(along_x, slide, 0)
        ry = np.clip(ry, 0, h - 1).astype(np.int32)
        rx = np.clip(rx, 0, w - 1).astype(np.int32)
        gap = s > 0
        land = big[y0:y1, x0:x1].astype(np.float32)
        land[gap] = big[ry[gap], rx[gap]]

        touched = (s > COAST_MIN - FADE_MAX) & (s < COAST_MAX + FADE_MAX)
        val = BG + (land - BG) * alpha[..., None]
        blk = out[y0:y1, x0:x1]
        blk[touched] = np.clip(val[touched] + 0.5, 0, 255).astype(np.uint8)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preview", type=Path, help="grava uma prévia reduzida (PNG)")
    ap.add_argument("--write", action="store_true", help="regrava as tiles z6 e z5 no cache")
    ap.add_argument("--quality", type=int, default=92)
    args = ap.parse_args()

    if args.write:
        (BACKUP / str(Z)).mkdir(parents=True, exist_ok=True)
        for r in ROWS:
            for c in COLS:
                src, dst = tile_path(CACHE, r, c), tile_path(BACKUP, r, c)
                if src.exists() and not dst.exists():
                    shutil.copy2(src, dst)

    big, present = load_region()
    check_cuts(big)
    out = compose(big)
    if args.preview:
        Image.fromarray(out).resize((out.shape[1] // 4, out.shape[0] // 4), Image.BOX).save(args.preview)
    if not args.write:
        return 0

    written: set[tuple[int, int]] = set()
    for r in ROWS:
        for c in COLS:
            if (r, c) not in present:  # tile vazia continua vazia
                continue
            sl = (slice((r - ROWS.start) * TILE, (r - ROWS.start + 1) * TILE),
                  slice((c - COLS.start) * TILE, (c - COLS.start + 1) * TILE))
            if np.array_equal(out[sl], big[sl]):
                shutil.copy2(tile_path(BACKUP, r, c), tile_path(CACHE, r, c))  # desfaz rodadas antigas
                continue
            Image.fromarray(out[sl]).save(tile_path(CACHE, r, c), "WEBP", quality=args.quality, method=6)
            written.add((r, c))
    # z5 nativo: redução 2x2 das z6 (as que mudaram e as que a versão antiga mexeu)
    z5 = 0
    for pr in range(ROWS.start // 2, ROWS.stop // 2):
        for pc in range(COLS.start // 2, COLS.stop // 2):
            kids = {(2 * pr + i, 2 * pc + j) for i in (0, 1) for j in (0, 1)}
            legacy = pr in LEGACY_Z5[0] and pc in LEGACY_Z5[1]
            if not (kids & written) and not legacy:
                continue
            r0, c0 = (2 * pr - ROWS.start) * TILE, (2 * pc - COLS.start) * TILE
            Image.fromarray(out[r0:r0 + 2 * TILE, c0:c0 + 2 * TILE]).resize((TILE, TILE), Image.BOX).save(
                CACHE / "5" / f"{pr}_{pc}.webp", "WEBP", quality=args.quality, method=6)
            z5 += 1
    print(f"z6: {len(written)} tiles, z5: {z5} tiles regravadas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
