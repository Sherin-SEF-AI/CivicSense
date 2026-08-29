#!/usr/bin/env python3
"""Grades clarification against the sharp image it is trying to recover.

Two questions, and the second is the one that matters in a proceeding.

Does it help? Measured as the improvement in agreement with the truth. A tool
that makes a picture prettier without moving it closer to what was actually
there is worse than nothing, because it is persuasive.

Does it invent? An output that looks sharper is not evidence of anything. The
test is whether detail appears that the truth does not contain. Real recovery
moves the result toward the truth everywhere; invention produces structure that
correlates with nothing. So each operator is also run on a control where the
recoverable information is absent, and asserted not to produce detail there.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker" / "src"))

import numpy as np  # noqa: E402

from fis import rasters  # noqa: E402
from fis.corpora.clarify import build  # noqa: E402
from fis.operators.contract import OpCtx  # noqa: E402
from fis.operators.registry import get, load_all  # noqa: E402
from fis.operators.video.clarify import (  # noqa: E402
    DeblurParams,
    PhotometricParams,
    SuperResolutionParams,
    TemporalIntegrationParams,
)

OUT = Path("fis/corpora/out/clarify")


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return 99.0 if mse < 1e-9 else float(10.0 * np.log10(255.0**2 / mse))


def to_stack(array: np.ndarray) -> bytes:
    return rasters.encode_stack(
        [rasters.Raster(rasters.quantise(frame, np.dtype("<u1")), "gray") for frame in array]
    )


def run(operator_id: str, payload: bytes, params) -> np.ndarray:
    return run_full(operator_id, payload, params)[0]


def run_full(operator_id: str, payload: bytes, params) -> tuple[np.ndarray, dict]:
    from fis.operators.contract import split_result

    operator = get(operator_id, "1.0.0")
    with OpCtx("acceptance", "/tmp") as ctx:
        raw, measurements = split_result(operator.fn(ctx, {"raster": payload}, params))
    return rasters.decode(raw).data[:, :, 0].astype(np.float64), measurements


def main() -> int:
    manifest = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else build(OUT)
    truth = np.load(OUT / "truth.npy")
    load_all()

    cases = {item["name"]: item for item in manifest}

    # Alignment registers every frame to the reference frame, so the thing the
    # operator is trying to produce is the scene as the reference frame saw it,
    # not the unshifted original. An earlier version of this file compared
    # against the unshifted truth and concluded that integration made things
    # worse: the naive mean of a jittery stack sits nearer the unshifted truth
    # simply because averaging the shifts centres them, which is an artefact of
    # the comparison and not a property of anything. Measured correctly, the
    # naive mean is worse than a single frame, which is what smearing does.
    from fis.corpora.clarify import shift as apply_shift

    reference_shift = cases["shifted_stack"]["params"]["shifts"][0]
    stack_reference = apply_shift(truth, reference_shift[0], reference_shift[1])

    failures: list[str] = []
    print(f"{'case':<20} {'operator':<10} {'before':>8} {'after':>8} {'gain':>8}")

    def grade(case: str, operator_id: str, params, minimum_gain: float, against: np.ndarray | None = None) -> np.ndarray:
        target = truth if against is None else against
        stack = np.load(OUT / cases[case]["file"])
        before = psnr(stack[0], target)
        result = run(operator_id, to_stack(stack), params)
        after = psnr(result, target)
        gain = after - before
        print(f"{case:<20} {operator_id:<10} {before:>7.2f}dB {after:>7.2f}dB {gain:>+7.2f}dB")
        if gain < minimum_gain:
            failures.append(f"{case} through {operator_id}: {gain:+.2f} dB, the requirement is at least {minimum_gain:+.1f}")
        return result

    # Integrating a jittery run must beat any single frame of it, because that
    # is the entire premise: the noise is independent and the scene is not.
    integrated = grade("shifted_stack", "V-CLR-1", TemporalIntegrationParams(), minimum_gain=6.0, against=stack_reference)

    # And the control that keeps that number honest: averaging the same frames
    # without aligning them must be worse than one frame, because that is what
    # smearing does. If it were not, the alignment would be doing nothing.
    raw_stack = np.load(OUT / cases["shifted_stack"]["file"])
    naive = psnr(raw_stack.mean(axis=0), stack_reference)
    single = psnr(raw_stack[0], stack_reference)
    print(f"{'shifted_stack':<20} {'no align':<10} {single:>7.2f}dB {naive:>7.2f}dB {naive-single:>+7.2f}dB")
    if naive >= single:
        failures.append("averaging without alignment did not degrade the picture, so the corpus has no jitter to align")

    # Super resolution is graded against the same truth at the same scale, so a
    # gain means recovered detail rather than a bigger picture.
    stack = np.load(OUT / cases["shifted_stack"]["file"])
    fine = run("V-CLR-2", to_stack(stack), SuperResolutionParams(factor=2))
    import cv2

    downsampled = cv2.resize(fine, (truth.shape[1], truth.shape[0]), interpolation=cv2.INTER_AREA)
    before = psnr(stack[0], stack_reference)
    after = psnr(downsampled, stack_reference)
    print(f"{'shifted_stack':<20} {'V-CLR-2':<10} {before:>7.2f}dB {after:>7.2f}dB {after-before:>+7.2f}dB")
    if after - before < 5.0:
        failures.append(f"super resolution gained only {after-before:+.2f} dB")

    grade("motion_blur", "V-CLR-4", DeblurParams(kind="motion", length=9, angle_milli_deg=15_000), minimum_gain=2.0)
    grade("defocus", "V-CLR-4", DeblurParams(kind="defocus", radius=4), minimum_gain=1.0)

    # Photometric work changes the value distribution on purpose, so agreement
    # with the original values is the wrong measure. What must improve is local
    # contrast, and what must not change is the ordering of the pixels.
    low = np.load(OUT / cases["low_contrast"]["file"])
    adjusted = run("V-CLR-5", to_stack(low), PhotometricParams())
    before_std = float(np.std(low[0]))
    after_std = float(np.std(adjusted))
    print(f"{'low_contrast':<20} {'V-CLR-5':<10} {before_std:>7.2f}sd {after_std:>7.2f}sd {after_std-before_std:>+7.2f}sd")
    if after_std <= before_std:
        failures.append("the photometric suite did not increase contrast on a hazy image")

    # What the operators say about their own work. A restoration that reports
    # nothing asks to be judged by eye, which is the thing that cannot be done.
    print("\nwhat each operator reports about what it did:")
    _, integration_report = run_full("V-CLR-1", to_stack(np.load(OUT / cases["shifted_stack"]["file"])), TemporalIntegrationParams())
    print(
        f"  integration: {integration_report['frames_integrated']} of {integration_report['frames_supplied']} frames, "
        f"{integration_report['frames_rejected']} rejected, alignment median "
        f"{integration_report['median_alignment_px']} px"
    )
    _, sr_report = run_full("V-CLR-2", to_stack(np.load(OUT / cases["shifted_stack"]["file"])), SuperResolutionParams(factor=2))
    print(
        f"  super resolution: {sr_report['observed_fraction']*100:.0f} percent of the fine grid was sampled, "
        f"{sr_report['interpolated_fraction']*100:.0f} percent interpolated"
    )
    _, deblur_report = run_full("V-CLR-4", to_stack(np.load(OUT / cases["motion_blur"]["file"])), DeblurParams(kind="motion", length=9, angle_milli_deg=15_000))
    print(f"  deblur: ringing on {deblur_report['ringing_fraction']*100:.2f} percent of pixels, peak {deblur_report['ringing_max']:.3f} of range")

    if integration_report["frames_integrated"] < 2:
        failures.append("integration reported fewer than two frames used")
    if not 0.0 <= sr_report["observed_fraction"] <= 1.0:
        failures.append("super resolution reported an impossible sampled fraction")
    if "ringing_fraction" not in deblur_report:
        failures.append("deblur did not report the ringing it introduced")

    print("\ndoes it invent? each operator on material with nothing to recover:")

    # A stack of identical frames plus independent noise has no sub pixel
    # information in it at all. Super resolution must not manufacture any.
    rng = np.random.default_rng(7)
    flat = np.full_like(truth, 128.0)
    noise_only = np.stack([flat + rng.normal(0, 12, flat.shape) for _ in range(12)])
    invented = run("V-CLR-2", to_stack(noise_only), SuperResolutionParams(factor=2))
    # Real structure in the output would correlate with something. Noise does
    # not, so what comes out should be flat once the noise is averaged.
    structure = float(np.std(cv2.GaussianBlur(invented, (0, 0), 3.0)))
    print(f"  super resolution on pure noise: residual structure {structure:.2f} (a flat field is 0)")
    if structure > 6.0:
        failures.append(f"super resolution produced structure ({structure:.2f}) from a field containing none")

    # Deblurring with the wrong kernel must not improve agreement with the
    # truth. If it does, the operator is sharpening rather than inverting.
    blurred = np.load(OUT / cases["motion_blur"]["file"])
    right = run("V-CLR-4", to_stack(blurred), DeblurParams(kind="motion", length=9, angle_milli_deg=15_000))
    wrong = run("V-CLR-4", to_stack(blurred), DeblurParams(kind="motion", length=9, angle_milli_deg=105_000))
    print(f"  deblur with the true psf {psnr(right, truth):.2f} dB, with a psf rotated 90 degrees {psnr(wrong, truth):.2f} dB")
    if psnr(wrong, truth) >= psnr(right, truth):
        failures.append("deblurring with the wrong point spread function did as well as the right one, so it is not inverting anything")

    # The photometric suite must preserve pixel ordering: it redistributes
    # values and does not reorder the scene.
    sample = np.load(OUT / cases["low_contrast"]["file"])[0]
    out = run("V-CLR-5", to_stack(sample[None, :, :]), PhotometricParams(clip_limit_centi=200))
    order_before = np.argsort(sample.ravel())
    monotone = float(np.corrcoef(sample.ravel()[order_before], out.ravel()[order_before])[0, 1])
    print(f"  photometric rank correlation with the input: {monotone:.4f}")
    if monotone < 0.9:
        failures.append(f"the photometric suite reordered the scene (rank correlation {monotone:.3f})")

    print()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("clarification acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
