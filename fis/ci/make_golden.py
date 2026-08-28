#!/usr/bin/env python3
"""Writes the golden inputs for the determinism harness.

Generated from a stated rule rather than committed as opaque binaries, so a
second implementation can produce the same inputs and the digests stay
meaningful across languages.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker" / "src"))
from fis import rasters  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "fis" / "golden"


def scene(width: int, height: int, channels: int, dtype: str) -> np.ndarray:
    """A deterministic test image with structure at several scales.

    Flat noise would hide a filtering bug; a smooth ramp would hide a rounding
    one. This has a ramp, a hard edge, a checker and a small high frequency
    component, so a change to any stage of a pipeline moves the digest.
    """
    y, x = np.mgrid[0:height, 0:width].astype(np.float64)
    ramp = (x / max(1, width - 1)) * 0.5 + (y / max(1, height - 1)) * 0.25
    edge = (x > width * 0.6).astype(np.float64) * 0.2
    checker = (((x.astype(int) // 4) + (y.astype(int) // 4)) % 2) * 0.08
    detail = ((x.astype(int) * 37 + y.astype(int) * 17) % 11) / 11.0 * 0.05
    base = np.clip(ramp + edge + checker + detail, 0.0, 1.0)

    stack = np.stack([base * (1.0 - 0.15 * c) for c in range(channels)], axis=-1)
    if dtype == "u1":
        return rasters.quantise(stack * 255.0, np.dtype("<u1"))
    return rasters.quantise(stack * 4095.0, np.dtype("<u2"))


CASES = [
    ("X-ID-1", "1.0.0", "gray_u1_64", 64, 64, 1, "u1", "gray", None),
    ("X-ID-1", "1.0.0", "rgb_u2_97", 97, 61, 3, "u2", "rgb", None),
    ("X-CONV-1", "1.0.0", "gray_u1_64", 64, 64, 1, "u1", "gray", {"passes": 1}),
    ("X-CONV-1", "1.0.0", "rgb_u2_97", 97, 61, 3, "u2", "rgb", {"passes": 3}),
    ("X-CONV-1", "1.0.0", "odd_1x1", 1, 1, 1, "u1", "gray", {"passes": 2}),
]


def main() -> None:
    for operator, version, name, width, height, channels, dtype, colorspace, params in CASES:
        case = GOLDEN / operator / name
        case.mkdir(parents=True, exist_ok=True)
        raster = rasters.Raster(scene(width, height, channels, dtype), colorspace)
        (case / "input.bin").write_bytes(rasters.encode(raster))
        (case / "version.txt").write_text(f"{version}\n")
        if params is not None:
            (case / "params.json").write_text(json.dumps(params, sort_keys=True) + "\n")
        print(f"{operator}/{name}: {width}x{height}x{channels} {dtype}")


if __name__ == "__main__":
    main()
