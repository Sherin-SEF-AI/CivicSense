"""The canonical raster container.

Determinism is asserted on this, never on an intermediate float buffer.

The reason is arithmetic. Two runs of a floating point pipeline can differ in the
last unit in the last place for reasons nobody controls: the order a compiler
chose for a reduction, which SIMD kernel numpy selected for this CPU, whether a
library used a fused multiply-add. Requiring the float buffers to match would
make the requirement unachievable and would tempt someone to weaken it. Requiring
the *quantised output* to match is achievable, because rounding to an integer
grid absorbs those differences, and it is also the honest requirement: what an
examiner sees, cites and re-runs is the image, not the accumulator.

So the format is fully specified and has nothing in it that varies: no
timestamps, no producer string, no compression whose implementation could change.
PNG is generated separately as a viewing derivative and is never what a digest
covers, because libpng's filter heuristics are free to change between versions.
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass

import numpy as np

MAGIC = b"FISRAW\x01"
HEADER_SIZE = 64

DTYPES = {1: np.dtype("<u1"), 2: np.dtype("<u2"), 3: np.dtype("<f8")}
DTYPE_CODES = {np.dtype("<u1"): 1, np.dtype("<u2"): 2, np.dtype("<f8"): 3}

COLORSPACES = {0: "gray", 1: "rgb", 2: "bgr", 3: "yuv", 4: "mask"}
COLORSPACE_CODES = {v: k for k, v in COLORSPACES.items()}


@dataclass(frozen=True)
class Raster:
    data: np.ndarray
    colorspace: str

    @property
    def height(self) -> int:
        return int(self.data.shape[0])

    @property
    def width(self) -> int:
        return int(self.data.shape[1])

    @property
    def channels(self) -> int:
        return int(self.data.shape[2]) if self.data.ndim == 3 else 1


def encode(raster: Raster) -> bytes:
    """Writes the canonical container. Byte for byte reproducible by construction."""
    array = raster.data
    if array.ndim == 2:
        array = array[:, :, None]
    if array.ndim != 3:
        raise ValueError("a raster is height by width by channels")

    dtype = array.dtype.newbyteorder("<")
    if dtype not in DTYPE_CODES:
        raise ValueError(f"{array.dtype} is not a canonical raster dtype")

    array = np.ascontiguousarray(array, dtype=dtype)
    height, width, channels = array.shape

    header = bytearray(HEADER_SIZE)
    header[0:7] = MAGIC
    header[7] = DTYPE_CODES[dtype]
    header[8] = channels
    header[9] = COLORSPACE_CODES[raster.colorspace]
    # bytes 10 and 11 are reserved and are always zero, so two encoders cannot
    # disagree about them.
    struct.pack_into("<II", header, 12, width, height)
    struct.pack_into("<I", header, 20, width * channels * dtype.itemsize)
    return bytes(header) + array.tobytes(order="C")


def decode(payload: bytes) -> Raster:
    if len(payload) < HEADER_SIZE or payload[0:7] != MAGIC:
        raise ValueError("not a FISRAW container")
    dtype = DTYPES[payload[7]]
    channels = payload[8]
    colorspace = COLORSPACES[payload[9]]
    width, height = struct.unpack_from("<II", payload, 12)
    array = np.frombuffer(payload, dtype=dtype, count=width * height * channels, offset=HEADER_SIZE)
    return Raster(array.reshape((height, width, channels)).copy(), colorspace)


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def quantise(array: np.ndarray, dtype: np.dtype) -> np.ndarray:
    """Rounds a working buffer onto the output grid.

    Half away from zero, explicitly, rather than numpy's banker's rounding. Not
    because banker's rounding is wrong, but because it must be stated: a
    reimplementation in another language that used the other rule would produce
    a different digest on exactly the samples that land on a half, and that
    divergence would be invisible until an export was verified elsewhere.
    """
    if dtype == np.dtype("<f8"):
        return array.astype(dtype)
    info = np.iinfo(dtype)
    rounded = np.floor(np.asarray(array, dtype=np.float64) + 0.5)
    return np.clip(rounded, info.min, info.max).astype(dtype)
