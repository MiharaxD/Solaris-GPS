#!/usr/bin/env python3
"""Tampa o rombo do Overworld entre Jinzhou e Mengzhou (só mexe no disco, nunca acessa a rede).

O mapa original tem um retângulo de fundo azul entre as duas regiões, com cortes retos nas
bordas. O script preenche o vão com terra de verdade: espelha o terreno de cada lado do corte
(a borda continua sem emenda, com o mesmo detalhe e a mesma costa) e mistura os espelhos por
distância. Os pixels originais nunca mudam, só o fundo azul e o serrilhado dos cortes.

    .venv/Scripts/python tools/fill_overworld_gap.py [--preview PNG] [--write]

Sem `--write` só gera a prévia. Com `--write`, copia as tiles z6 originais pra
`assets/tiles_cache_backup/overworld_gap/` (uma vez), regrava as z6 afetadas e refaz as z5
correspondentes. Depois rode `tools/build_tiles.py build`. Os originais do backup sempre
são a fonte, então rodar de novo dá o mesmo resultado.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

MAP_ID = "AkiWorld_WP-e2f88b110e3b3c0bd074b0b86c81e40a"
CACHE = Path("assets/tiles_cache") / MAP_ID
BACKUP = Path("assets/tiles_cache_backup/overworld_gap")
TILE = 512
Z = 6
ROWS = range(24, 38)  # z6, linhas [24, 38)
COLS = range(16, 26)  # z6, colunas [16, 26)
BG = np.array([5, 39, 52], dtype=np.float32)
BG_DIFF = 10.0        # distância mínima do fundo pra contar como terra (ou costa esmaecida)

F = 4                 # a base suave é calculada a 1/4 da resolução do z6
SHIFT_L = 1400        # deslocamento da fonte de detalhe do lado esquerdo
SHIFT_R = 1100        # idem, lado direito
DETAIL_SIGMA = 9.0
DETAIL_CLIP = 40.0
DETAIL_FADE = 260.0
DETAIL_GAIN = 1.2


# Polígono da ponte em pixels a 1/4 de escala, origem no canto da região (linha 24, coluna 16).
BRIDGE = [
    (430, 150), (520, 128), (640, 150), (760, 190), (880, 140), (1000, 98), (1060, 110),
    (1060, 700), (1000, 1010), (900, 1050), (727, 1070), (600, 960), (500, 915), (430, 890),
]
COAST_SIGMA = 22.0


def gauss(x: np.ndarray, sigma: float) -> np.ndarray:
    """Desfoque gaussiano por FFT (borda replicada pelo tamanho do padding)."""
    pad = int(sigma * 3)
    xp = np.pad(x, ((pad, pad), (pad, pad)) + ((0, 0),) * (x.ndim - 2), mode="edge")
    h, w = xp.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fy**2 + fx**2))
    if x.ndim == 2:
        out = np.fft.irfft2(np.fft.rfft2(xp) * k, s=xp.shape)
    else:
        out = np.stack([np.fft.irfft2(np.fft.rfft2(xp[..., i]) * k, s=xp.shape[:2])
                        for i in range(x.shape[2])], axis=-1)
    return out[pad:-pad, pad:-pad]


def extrapolate(img: np.ndarray, known: np.ndarray) -> np.ndarray:
    """Preenche o que não é conhecido com a média ponderada da vizinhança, de perto pra longe."""
    k = known.astype(np.float32)
    out = img.copy()
    have = known.copy()
    for sigma in (6, 12, 24, 48, 96, 192, 384):
        den = gauss(k, sigma)
        num = gauss(img * k[..., None], sigma)
        est = num / np.maximum(den, 1e-6)[..., None]
        take = (~have) & (den > 0.02)
        out[take] = est[take]
        have |= take
    # costura final: suaviza só o que foi inventado
    smooth = gauss(out, 10)
    out[~known] = smooth[~known]
    return out


def load_region(root: Path) -> np.ndarray:
    h, w = len(ROWS) * TILE, len(COLS) * TILE
    big = np.empty((h, w, 3), dtype=np.uint8)
    big[:] = BG.astype(np.uint8)
    for r in ROWS:
        for c in COLS:
            p = root / str(Z) / f"{r}_{c}.webp"
            if p.exists() and p.stat().st_size:
                with Image.open(p) as im:
                    big[(r - ROWS.start) * TILE:(r - ROWS.start + 1) * TILE,
                        (c - COLS.start) * TILE:(c - COLS.start + 1) * TILE] = np.asarray(im.convert("RGB"))
    return big


def base_fill(big: np.ndarray) -> np.ndarray:
    h, w = big.shape[:2]
    known = np.linalg.norm(big.astype(np.float32) - BG, axis=-1) > BG_DIFF
    # os 2–3 px da borda dos cortes retos são escuros (serrilhado): contam como desconhecidos
    solid = gauss(known.astype(np.float32), 2.0) > 0.985
    sw = solid.astype(np.float32)
    blocks = lambda a: a.reshape(h // F, F, w // F, F, *a.shape[2:]).sum(axis=(1, 3))  # noqa: E731
    den = blocks(sw)
    small = blocks(big.astype(np.float32) * sw[..., None]) / np.maximum(den, 1)[..., None]
    known_s = den > F * F * 0.5
    fill_s = extrapolate(small, known_s)

    poly = Image.new("L", (w // F, h // F), 0)
    ImageDraw.Draw(poly).polygon(BRIDGE, fill=255)
    alpha_s = np.clip(gauss(np.asarray(poly, dtype=np.float32) / 255.0, COAST_SIGMA) * 1.6 - 0.15, 0, 1)

    up = lambda a, mode: np.asarray(  # noqa: E731
        Image.fromarray(a, mode).resize((w, h), Image.BICUBIC), dtype=np.float32)
    fill = np.stack([up(fill_s[..., i], "F") for i in range(3)], axis=-1)
    alpha = np.clip(up(alpha_s.astype(np.float32), "F"), 0, 1)[..., None]

    out = big.astype(np.float32)
    mix = (~solid) & (alpha[..., 0] > 0.004)
    out[mix] = (BG * (1 - alpha) + fill * alpha)[mix]
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def edges(known: np.ndarray) -> dict[str, int]:
    """Acha os cortes retos: última coluna do lado esquerdo, primeira do direito e do 'degrau'."""
    def frac_cols(rows: slice, cols: slice) -> np.ndarray:
        return known[rows, cols].mean(axis=0) > 0.5

    left = np.nonzero(frac_cols(slice(1700, 3200), slice(0, 2500)))[0]
    right = np.nonzero(frac_cols(slice(2400, 4000), slice(2000, 4800)))[0]
    notch_x = np.nonzero(frac_cols(slice(500, 1300), slice(3000, 5120)))[0]
    top = np.nonzero(known[0:2400, 3100:3800].mean(axis=1) > 0.5)[0]
    return {"xl": int(left.max()), "xr": int(right.min()) + 2000,
            "xn": int(notch_x.min()) + 3000, "yt": int(top.min())}


def compose(big: np.ndarray) -> np.ndarray:
    """Base suave (cor e costa) + detalhe real do próprio mapa, sem espelhar."""
    base = base_fill(big)
    h, w = big.shape[:2]
    known = np.linalg.norm(big.astype(np.float32) - BG, axis=-1) > BG_DIFF
    e = edges(known)
    xl, xr, xn, yt = e["xl"], e["xr"], e["xn"], e["yt"]
    print("cortes:", e)

    y1 = 5300
    xs0, xs1 = xl - 5, xn + 5
    ys, xs = np.mgrid[0:y1, xs0:xs1]
    # fonte do detalhe: terra do lado esquerdo (metade esquerda do vão) ou do direito, deslocada sem espelhar
    mid = (xl + xr) // 2
    left_src = np.clip(xs - SHIFT_L, 0, w - 1)
    right_src = np.clip(xs + SHIFT_R, 0, w - 1)
    pick = np.clip((xs - mid) / 300.0 + 0.5, 0, 1)[..., None]  # 0 = esquerda, 1 = direita

    rowi = np.arange(y1)[:, None]
    src_l = big[:y1][rowi, left_src].astype(np.float32)
    src_r = big[:y1][rowi, right_src].astype(np.float32)
    src = src_l * (1 - pick) + src_r * pick
    # alta frequência (contornos, rochas); a baixa fica com a base suave
    hp = src - gauss(src, DETAIL_SIGMA)
    hp = np.clip(hp, -DETAIL_CLIP, DETAIL_CLIP)
    # sem detalhe perto de costa ou de corte reto da própria fonte (viraria uma linha)
    kn = known[:y1].astype(np.float32)
    kn_src = kn[rowi, left_src] * (1 - pick[..., 0]) + kn[rowi, right_src] * pick[..., 0]
    hp *= (gauss(kn_src, DETAIL_SIGMA * 1.5) > 0.985)[..., None]

    # dist. ao corte mais próximo: o detalhe entra aos poucos pra não ter emenda
    d = np.minimum(xs - xl, np.where(xs < xr, xr - xs, np.where(ys < yt, np.minimum(yt - ys, xn - xs), 1e9)))
    fade = np.clip(d / DETAIL_FADE, 0, 1)[..., None]
    fade = fade * fade * (3 - 2 * fade)
    a = base[:y1, xs0:xs1].astype(np.float32) + hp * fade * DETAIL_GAIN

    out = base.copy()
    blk = out[:y1, xs0:xs1]
    changed = np.any(base[:y1, xs0:xs1] != big[:y1, xs0:xs1], axis=-1)  # só onde a base mexeu
    blk[changed] = np.clip(a[changed] + 0.5, 0, 255).astype(np.uint8)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preview", type=Path, help="grava uma prévia reduzida (PNG)")
    ap.add_argument("--write", action="store_true", help="regrava as tiles z6 e z5 no cache")
    ap.add_argument("--quality", type=int, default=92)
    args = ap.parse_args()

    first = not (BACKUP / str(Z)).exists()
    if args.write and first:
        for r in ROWS:
            for c in COLS:
                p = CACHE / str(Z) / f"{r}_{c}.webp"
                if p.exists() and p.stat().st_size:
                    (BACKUP / str(Z)).mkdir(parents=True, exist_ok=True)
                    shutil.copy2(p, BACKUP / str(Z) / p.name)
    root = BACKUP if (BACKUP / str(Z)).exists() else CACHE

    big = load_region(root)
    out = compose(big)
    if args.preview:
        Image.fromarray(out).resize((out.shape[1] // 4, out.shape[0] // 4), Image.BOX).save(args.preview)
    if not args.write:
        return 0

    changed = 0
    for r in ROWS:
        for c in COLS:
            sl = (slice((r - ROWS.start) * TILE, (r - ROWS.start + 1) * TILE),
                  slice((c - COLS.start) * TILE, (c - COLS.start + 1) * TILE))
            if np.array_equal(out[sl], big[sl]):
                if (BACKUP / str(Z) / f"{r}_{c}.webp").exists():  # desfaz uma rodada anterior
                    shutil.copy2(BACKUP / str(Z) / f"{r}_{c}.webp", CACHE / str(Z) / f"{r}_{c}.webp")
                continue
            Image.fromarray(out[sl]).save(CACHE / str(Z) / f"{r}_{c}.webp", "WEBP",
                                          quality=args.quality, method=6)
            changed += 1
    # z5 nativo: redução 2x2 das z6 refeitas
    z5 = 0
    for pr in range(ROWS.start // 2, ROWS.stop // 2):
        for pc in range(COLS.start // 2, COLS.stop // 2):
            r0, c0 = (2 * pr - ROWS.start) * TILE, (2 * pc - COLS.start) * TILE
            block = Image.fromarray(out[r0:r0 + 2 * TILE, c0:c0 + 2 * TILE])
            orig = Image.fromarray(big[r0:r0 + 2 * TILE, c0:c0 + 2 * TILE])
            if np.array_equal(np.asarray(block), np.asarray(orig)):
                continue
            block.resize((TILE, TILE), Image.BOX).save(CACHE / "5" / f"{pr}_{pc}.webp", "WEBP",
                                                       quality=args.quality, method=6)
            z5 += 1
    print(f"z6: {changed} tiles, z5: {z5} tiles regravadas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
