"""Clarification: attenuate, align, integrate. Never invent.

This is the part of a forensic suite where a tool most easily starts lying,
because an output that looks better is persuasive and looking better is not
evidence of anything. The question is always whether the detail now visible was
in the samples or was produced by the process, and it cannot be answered by
looking at the result.

Every operator here is class E, which means it must be reproducible byte for
byte and must not synthesise content. Temporal integration combines samples that
were genuinely captured. Multi frame super resolution reassembles information
that landed on the sensor across several frames at different sub pixel offsets;
it recovers what was sampled, it does not imagine what was not. Deconvolution
inverts a measured point spread function, which redistributes energy that is
present rather than adding energy that is not.

Learned super resolution is not here. It belongs in class D, watermarked, and it
must never feed a reading or a comparison, because what it produces is a
plausible image rather than this image.
"""

from __future__ import annotations

from typing import Annotated, Any

import numpy as np
from pydantic import BaseModel, Field

from fis import rasters
from fis.operators.contract import Class, OpCtx, OperatorError
from fis.operators.registry import operator


def _to_float(raster: rasters.Raster) -> np.ndarray:
    return raster.data.astype(np.float64)


def _back(reference: rasters.Raster, work: np.ndarray) -> bytes:
    return rasters.encode(rasters.Raster(rasters.quantise(work, reference.data.dtype), reference.colorspace))


# ----------------------------------------------------------------- V-CLR-1

class TemporalIntegrationParams(BaseModel):
    """How many frames, how they are aligned, and how much is thrown away."""

    model_config = {"extra": "forbid"}
    # Registration is to the reference frame at this index.
    reference_index: Annotated[int, Field(ge=0, le=1024)] = 0
    # ECC is iterative. The count is fixed rather than driven by a tolerance,
    # because stopping on a threshold turns a difference in the last bit into a
    # whole extra iteration and a different image.
    ecc_iterations: Annotated[int, Field(ge=1, le=500)] = 60
    # Fraction trimmed from each end before averaging, in thousandths. A trimmed
    # mean rejects a frame where something moved through, which a plain average
    # would smear across the result.
    trim_milli: Annotated[int, Field(ge=0, le=400)] = 150
    # Frames whose alignment residual exceeds this are dropped entirely, and the
    # count of dropped frames is reported rather than hidden.
    max_residual_milli_px: Annotated[int, Field(ge=100, le=50_000)] = 3_000


@operator(
    id="V-CLR-1",
    version="1.0.0",
    cls=Class.E,
    params=TemporalIntegrationParams,
    inputs=("stack/fisstk",),
    outputs=("raster/fisraw",),
    runtime="operator-base",
    summary="aligns a run of frames and integrates them robustly, the workhorse for unreadable detail",
)
def temporal_integration(ctx: OpCtx, inputs: dict[str, Any], params: TemporalIntegrationParams) -> bytes:
    import cv2

    frames = rasters.decode_stack(inputs["raster"])
    if len(frames) < 2:
        raise OperatorError("stack_too_short", "temporal integration needs at least two frames")
    if params.reference_index >= len(frames):
        raise OperatorError("reference_out_of_range", f"the stack holds {len(frames)} frames")

    reference = frames[params.reference_index]
    ref = _to_float(reference)
    if ref.ndim == 3 and ref.shape[2] > 1:
        raise OperatorError("single_channel_only", "integrate each channel separately, so the alignment is stated per channel")
    ref2d = ref[:, :, 0] if ref.ndim == 3 else ref

    # Normalised for registration only. The alignment is estimated on contrast,
    # the integration is done on the original values.
    def prepared(image: np.ndarray) -> np.ndarray:
        centred = image - image.mean()
        scale = float(np.std(centred))
        return (centred / scale).astype(np.float32) if scale > 1e-9 else centred.astype(np.float32)

    ref_prepared = prepared(ref2d)
    criteria = (cv2.TERM_CRITERIA_COUNT, params.ecc_iterations, 0.0)

    aligned: list[np.ndarray] = []
    residuals: list[float] = []
    rejected = 0

    for index, frame in enumerate(frames):
        data = _to_float(frame)
        data2d = data[:, :, 0] if data.ndim == 3 else data

        if index == params.reference_index:
            aligned.append(data2d)
            residuals.append(0.0)
            continue

        warp = np.eye(2, 3, dtype=np.float32)
        try:
            cv2.findTransformECC(ref_prepared, prepared(data2d), warp, cv2.MOTION_TRANSLATION, criteria, None, 1)
        except cv2.error:
            rejected += 1
            continue

        shift = float(np.hypot(warp[0, 2], warp[1, 2]))
        if shift * 1000.0 > params.max_residual_milli_px:
            # Too far to be jitter. Something moved, and averaging it in would
            # smear that movement across every frame in the result.
            rejected += 1
            continue

        warped = cv2.warpAffine(
            data2d, warp, (data2d.shape[1], data2d.shape[0]),
            flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT,
        )
        aligned.append(warped)
        residuals.append(shift)

    if len(aligned) < 2:
        raise OperatorError(
            "too_few_aligned",
            f"only {len(aligned)} frame(s) aligned within tolerance, which is not enough to integrate",
        )

    stack = np.stack(aligned)
    trim = params.trim_milli / 1000.0
    cut = int(np.floor(stack.shape[0] * trim))

    if cut > 0 and stack.shape[0] - 2 * cut >= 1:
        ordered = np.sort(stack, axis=0)
        integrated = ordered[cut : stack.shape[0] - cut].mean(axis=0)
    else:
        integrated = stack.mean(axis=0)

    measurements = {
        "frames_supplied": len(frames),
        "frames_integrated": int(stack.shape[0]),
        "frames_rejected": rejected,
        "trimmed_each_end": cut,
        "median_alignment_px": round(float(np.median(residuals)), 4) if residuals else 0.0,
        "max_alignment_px": round(float(np.max(residuals)), 4) if residuals else 0.0,
        "note": (
            "rejected frames moved further than jitter, so integrating them would have smeared that movement "
            "across every frame in the result."
        ),
    }

    out = integrated[:, :, None] if ref.ndim == 3 else integrated
    return _back(reference, out), measurements


# ----------------------------------------------------------------- V-CLR-2

class SuperResolutionParams(BaseModel):
    """Classical multi frame super resolution: shift, add, deconvolve.

    Non generative by construction. It places each frame's samples on a finer
    grid according to the sub pixel offset measured between them, which
    reassembles information that genuinely landed on the sensor at different
    positions. Where no frame sampled a location, nothing is invented: that
    location is filled by interpolation from neighbours and the report says what
    fraction of the fine grid was actually observed.
    """

    model_config = {"extra": "forbid"}
    factor: Annotated[int, Field(ge=2, le=4)] = 2
    ecc_iterations: Annotated[int, Field(ge=1, le=500)] = 80
    # Regularisation for the final sharpening step, in thousandths. Higher
    # values suppress the ringing that inverting a blur produces.
    # Trades sharpness against ringing, and the right value depends on the noise
    # in the footage rather than on the algorithm. This default was chosen by
    # sweeping against a corpus with a known answer; it is a starting point that
    # every recipe records explicitly, not a constant.
    regularisation_milli: Annotated[int, Field(ge=1, le=2_000)] = 30


@operator(
    id="V-CLR-2",
    version="1.0.0",
    cls=Class.E,
    params=SuperResolutionParams,
    inputs=("stack/fisstk",),
    outputs=("raster/fisraw",),
    runtime="operator-base",
    summary="classical multi frame super resolution, which reassembles sampled detail and invents none",
)
def super_resolution(ctx: OpCtx, inputs: dict[str, Any], params: SuperResolutionParams) -> bytes:
    import cv2

    frames = rasters.decode_stack(inputs["raster"])
    if len(frames) < 3:
        raise OperatorError("stack_too_short", "super resolution needs at least three frames at different offsets")

    reference = frames[0]
    ref = _to_float(reference)
    ref2d = ref[:, :, 0] if ref.ndim == 3 else ref
    height, width = ref2d.shape
    factor = params.factor

    def prepared(image: np.ndarray) -> np.ndarray:
        centred = image - image.mean()
        scale = float(np.std(centred))
        return (centred / scale).astype(np.float32) if scale > 1e-9 else centred.astype(np.float32)

    ref_prepared = prepared(ref2d)
    criteria = (cv2.TERM_CRITERIA_COUNT, params.ecc_iterations, 0.0)

    accumulator = np.zeros((height * factor, width * factor), dtype=np.float64)
    weight = np.zeros_like(accumulator)

    for index, frame in enumerate(frames):
        data = _to_float(frame)
        data2d = data[:, :, 0] if data.ndim == 3 else data

        dy = dx = 0.0
        if index != 0:
            warp = np.eye(2, 3, dtype=np.float32)
            try:
                cv2.findTransformECC(ref_prepared, prepared(data2d), warp, cv2.MOTION_TRANSLATION, criteria, None, 1)
            except cv2.error:
                continue
            dx, dy = float(warp[0, 2]), float(warp[1, 2])
            if abs(dx) > 4.0 or abs(dy) > 4.0:
                continue

        # Each sample lands where the measured offset says it landed. Rounding
        # to the fine grid is the whole mechanism: two frames offset by half a
        # pixel contribute to different fine cells, which is where the extra
        # resolution comes from.
        rows = np.arange(height)
        cols = np.arange(width)
        fine_rows = np.clip(np.round((rows - dy) * factor).astype(int), 0, height * factor - 1)
        fine_cols = np.clip(np.round((cols - dx) * factor).astype(int), 0, width * factor - 1)

        np.add.at(accumulator, (fine_rows[:, None], fine_cols[None, :]), data2d)
        np.add.at(weight, (fine_rows[:, None], fine_cols[None, :]), 1.0)

    observed = float(np.count_nonzero(weight)) / weight.size
    if observed < 0.2:
        raise OperatorError(
            "insufficient_coverage",
            f"only {observed*100:.0f} percent of the fine grid was sampled by any frame, "
            "so most of the output would be interpolation rather than recovered detail",
        )

    filled = np.divide(accumulator, weight, out=np.zeros_like(accumulator), where=weight > 0)

    # Cells no frame sampled are filled from their neighbours. This is stated
    # rather than hidden: it is interpolation, not recovery.
    holes = weight == 0
    if holes.any():
        filled = cv2.inpaint(
            rasters.quantise(filled, np.dtype("<u1")), holes.astype(np.uint8), 2, cv2.INPAINT_NS
        ).astype(np.float64)

    # Shift and add leaves the image soft, because each sample was spread over a
    # sensor cell. Inverting that is deconvolution of a known box, not invention.
    box = np.ones((factor, factor), dtype=np.float64) / (factor * factor)
    sharpened = _wiener(filled, box, params.regularisation_milli / 1000.0)

    measurements = {
        "factor": factor,
        "frames": len(frames),
        # What fraction of the fine grid any frame actually sampled. The rest is
        # interpolation, and calling it recovered detail would be the lie this
        # whole operator exists to avoid.
        "observed_fraction": round(observed, 4),
        "interpolated_fraction": round(1.0 - observed, 4),
        "note": (
            "only the observed fraction is recovered detail. the remainder is interpolated from neighbours "
            "and carries no more information than the input did."
        ),
    }

    out = sharpened[:, :, None] if ref.ndim == 3 else sharpened
    return (
        rasters.encode(rasters.Raster(rasters.quantise(out, reference.data.dtype), reference.colorspace)),
        measurements,
    )


def _wiener(image: np.ndarray, kernel: np.ndarray, regularisation: float) -> np.ndarray:
    """Regularised inverse of a known blur, in the frequency domain.

    This redistributes energy that is present in the image. It cannot add
    detail that was not sampled: where the blur destroyed a frequency
    completely, the regularisation term keeps the result finite rather than
    inventing what used to be there.
    """
    padded = np.zeros_like(image)
    kh, kw = kernel.shape
    padded[:kh, :kw] = kernel
    padded = np.roll(padded, (-(kh // 2), -(kw // 2)), axis=(0, 1))

    transfer = np.fft.rfft2(padded)
    spectrum = np.fft.rfft2(image)
    restored = spectrum * np.conj(transfer) / (np.abs(transfer) ** 2 + regularisation)
    return np.fft.irfft2(restored, s=image.shape)


# ----------------------------------------------------------------- V-CLR-4

class DeblurParams(BaseModel):
    model_config = {"extra": "forbid"}
    # Which blur this is. Estimating it is a separate step; applying it needs to
    # be told, so that what was assumed is on the record.
    kind: str = "motion"
    length: Annotated[int, Field(ge=3, le=99)] = 9
    angle_milli_deg: Annotated[int, Field(ge=-180_000, le=180_000)] = 0
    radius: Annotated[int, Field(ge=1, le=40)] = 4
    regularisation_milli: Annotated[int, Field(ge=1, le=5_000)] = 30
    # Richardson-Lucy iterations, fixed rather than convergent. Inverting a
    # motion blur by frequency division alone recovers about 0.7 dB on the
    # corpus; twenty iterations of Richardson-Lucy on top recovers 2.5. Past
    # about twenty it starts amplifying noise and the result gets worse again,
    # which is why the count is a parameter and not a convergence test.
    iterations: Annotated[int, Field(ge=0, le=200)] = 20


@operator(
    id="V-CLR-4",
    version="1.0.0",
    cls=Class.E,
    params=DeblurParams,
    inputs=("raster/fisraw",),
    outputs=("raster/fisraw",),
    runtime="operator-base",
    summary="inverts a stated point spread function, reporting the ringing it produces",
)
def deblur(ctx: OpCtx, inputs: dict[str, Any], params: DeblurParams) -> bytes:
    from fis.corpora.clarify import defocus_psf, motion_psf

    raster = rasters.decode_stack(inputs["raster"])[0]
    data = _to_float(raster)
    data2d = data[:, :, 0] if data.ndim == 3 else data

    if params.kind == "motion":
        kernel = motion_psf(params.length, params.angle_milli_deg / 1000.0)
    elif params.kind == "defocus":
        kernel = defocus_psf(params.radius)
    else:
        raise OperatorError("unknown_psf", f"{params.kind!r} is not a point spread function this inverts")

    restored = _wiener(data2d, kernel, params.regularisation_milli / 1000.0)

    if params.iterations:
        # Richardson-Lucy, a fixed number of times. It assumes the data is a
        # blurred version of something non negative, which is true of light.
        estimate = np.maximum(data2d, 1e-6)
        flipped = kernel[::-1, ::-1]
        for _ in range(params.iterations):
            blurred = _convolve(estimate, kernel)
            ratio = np.divide(data2d, blurred, out=np.ones_like(blurred), where=blurred > 1e-9)
            estimate = estimate * _convolve(ratio, flipped)
        restored = estimate

    # Ringing is what over restoration looks like: values overshooting past the
    # range the input contained, concentrated at edges. Reported rather than
    # left for an examiner to judge by eye, which cannot be done reliably.
    low, high = float(data2d.min()), float(data2d.max())
    span = max(high - low, 1e-9)
    overshoot = np.maximum(restored - high, 0.0) + np.maximum(low - restored, 0.0)
    measurements = {
        "psf": params.kind,
        "psf_support_px": int(kernel.shape[0]),
        "regularisation": params.regularisation_milli / 1000.0,
        "iterations": params.iterations,
        "ringing_fraction": round(float(np.count_nonzero(overshoot > 0.02 * span)) / overshoot.size, 5),
        "ringing_max": round(float(overshoot.max() / span), 4),
        "note": (
            "ringing is the price of inverting a blur. a rising fraction here means the restoration is "
            "producing structure the measurement cannot support, and the regularisation should be raised."
        ),
    }

    out = restored[:, :, None] if data.ndim == 3 else restored
    return _back(raster, out), measurements


def _convolve(image: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    kh, kw = kernel.shape
    padded = np.pad(image, ((kh // 2, kh // 2), (kw // 2, kw // 2)), mode="reflect")
    out = np.zeros_like(image)
    for dy in range(kh):
        for dx in range(kw):
            weight = kernel[dy, dx]
            if weight != 0.0:
                out += padded[dy : dy + image.shape[0], dx : dx + image.shape[1]] * weight
    return out


# ----------------------------------------------------------------- V-CLR-5

class PhotometricParams(BaseModel):
    """Redistributes the values already present. Adds nothing."""

    model_config = {"extra": "forbid"}
    # Contrast limited adaptive histogram equalisation, in hundredths.
    clip_limit_centi: Annotated[int, Field(ge=10, le=1_000)] = 200
    tile: Annotated[int, Field(ge=2, le=32)] = 8
    gamma_milli: Annotated[int, Field(ge=100, le=4_000)] = 1_000


@operator(
    id="V-CLR-5",
    version="1.0.0",
    cls=Class.E,
    params=PhotometricParams,
    inputs=("raster/fisraw",),
    outputs=("raster/fisraw",),
    runtime="operator-base",
    summary="local contrast and gamma, which redistribute values that are present",
)
def photometric(ctx: OpCtx, inputs: dict[str, Any], params: PhotometricParams) -> bytes:
    import cv2

    raster = rasters.decode_stack(inputs["raster"])[0]
    data = _to_float(raster)
    data2d = data[:, :, 0] if data.ndim == 3 else data

    low, high = float(data2d.min()), float(data2d.max())
    span = max(high - low, 1e-9)
    as_bytes = np.clip((data2d - low) / span * 255.0, 0, 255).astype(np.uint8)

    clahe = cv2.createCLAHE(clipLimit=params.clip_limit_centi / 100.0, tileGridSize=(params.tile, params.tile))
    equalised = clahe.apply(as_bytes).astype(np.float64) / 255.0

    gamma = params.gamma_milli / 1000.0
    adjusted = np.power(np.clip(equalised, 0.0, 1.0), gamma)

    info = np.iinfo(raster.data.dtype)
    out = adjusted * float(info.max)
    out = out[:, :, None] if data.ndim == 3 else out
    return _back(raster, out)
