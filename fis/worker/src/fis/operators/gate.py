"""The two operators that prove the framework before any real tool uses it.

Neither does anything useful. That is the point: if the identity operator is not
byte-identical across a rebuild, nothing built on top of it can be, and the
failure should be found here rather than inside a deblur.
"""

from __future__ import annotations

from typing import Annotated, Any

import numpy as np
from pydantic import BaseModel, Field

from fis import rasters
from fis.operators.contract import Class, OpCtx
from fis.operators.registry import operator


class IdentityParams(BaseModel):
    model_config = {"extra": "forbid"}


@operator(
    id="X-ID-1",
    version="1.0.0",
    cls=Class.E,
    params=IdentityParams,
    inputs=("raster/fisraw",),
    outputs=("raster/fisraw",),
    runtime="operator-base",
    summary="returns its input unchanged, so the harness itself can be tested",
)
def identity(ctx: OpCtx, inputs: dict[str, Any], params: IdentityParams) -> bytes:
    return rasters.encode(rasters.decode(inputs["raster"]))


class ConvolveParams(BaseModel):
    model_config = {"extra": "forbid"}
    # A fixed kernel expressed in thousandths. Integer parameters with a declared
    # scale, per the class E rule: a float here would be a digest that depends on
    # how a language prints numbers.
    kernel_milli: Annotated[list[int], Field(min_length=9, max_length=9)] = [
        62, 125, 62,
        125, 250, 125,
        62, 125, 62,
    ]
    passes: Annotated[int, Field(ge=1, le=8)] = 1


@operator(
    id="X-CONV-1",
    version="1.0.0",
    cls=Class.E,
    params=ConvolveParams,
    inputs=("raster/fisraw",),
    outputs=("raster/fisraw",),
    runtime="operator-base",
    summary="fixed 3x3 kernel, applied a fixed number of times, with edges held",
)
def convolve(ctx: OpCtx, inputs: dict[str, Any], params: ConvolveParams) -> bytes:
    raster = rasters.decode(inputs["raster"])
    kernel = np.array(params.kernel_milli, dtype=np.float64).reshape(3, 3) / 1000.0

    work = raster.data.astype(np.float64)
    for _ in range(params.passes):
        work = _convolve3(work, kernel)

    return rasters.encode(rasters.Raster(rasters.quantise(work, raster.data.dtype), raster.colorspace))


def _convolve3(array: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """Correlation with edge replication, summed in a fixed order.

    Written out rather than delegated to a library call so the summation order is
    part of this file and cannot change under it. The nine terms accumulate in
    raster order every time, on every machine.
    """
    padded = np.pad(array, ((1, 1), (1, 1), (0, 0)), mode="edge")
    out = np.zeros_like(array, dtype=np.float64)
    height, width = array.shape[0], array.shape[1]
    for dy in range(3):
        for dx in range(3):
            out += padded[dy : dy + height, dx : dx + width, :] * kernel[dy, dx]
    return out
