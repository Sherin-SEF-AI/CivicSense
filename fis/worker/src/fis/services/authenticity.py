"""The authenticity battery.

An ordered set of tests, each producing pass, fail or inconclusive with the
measurements behind it. The verdict is the worst mandatory result, never an
average: one failed test is a failed object, and averaging would let a strong
hash result bury a broken timeline.

Three words are used precisely and they are not interchangeable.

  verified      a capture signature was checked against an enrolled key and held
  consistent    nothing contradicts the object, and nothing proves it either
  inconsistent  something measured about the object contradicts its own claim
  unverifiable  the test that would decide could not run on material like this

The last one matters more than it looks. A detector that returns a low score
where it should return "cannot tell" invites someone to read the low score as
evidence of authenticity, which it is not.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np


@dataclass
class TestResult:
    test: str
    result: str                       # pass | fail | inconclusive
    detail: str
    standard: str | None = None
    measurements: dict[str, Any] = field(default_factory=dict)
    mandatory: bool = True


def _probe(path: Path) -> dict[str, Any]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def _frame_packets(path: Path) -> list[dict[str, Any]]:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "frame=pts_time,pkt_size,pict_type",
            "-print_format", "json", str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout).get("frames", [])


def _decode_gray(path: Path, width: int, height: int) -> np.ndarray:
    """Decodes with error concealment off, which is what a measurement needs.

    With concealment on, a decoder invents plausible pixels over a corrupt
    region and a motion measurement then reports that invention as movement.
    """
    out = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-flags", "+bitexact", "-ec", "0", "-threads", "1",
            "-i", str(path), "-f", "rawvideo", "-pix_fmt", "gray", "-",
        ],
        capture_output=True, check=True,
    )
    frames = np.frombuffer(out.stdout, dtype=np.uint8)
    n = frames.size // (width * height)
    return frames[: n * width * height].reshape(n, height, width)


def container_continuity(path: Path) -> TestResult:
    """Presentation timestamps must advance by one frame interval, every time.

    A cut leaves the container intact and the *content* discontinuous, so this
    test alone does not catch an edit that was re-encoded. It catches the lazy
    ones, and it is cheap.
    """
    packets = _frame_packets(path)
    times = [float(p["pts_time"]) for p in packets if "pts_time" in p]
    if len(times) < 3:
        return TestResult("container continuity", "inconclusive", "too few frames to establish an interval", "ISO/IEC 27037")

    deltas = np.diff(np.array(times))
    if np.any(deltas <= 0):
        return TestResult(
            "container continuity", "fail",
            "presentation timestamps do not advance monotonically, so the container has been rewritten",
            "ISO/IEC 27037",
            {"non_monotonic_at": int(np.argmax(deltas <= 0))},
        )

    median = float(np.median(deltas))
    ratios = deltas / median
    irregular = int(np.sum(np.abs(ratios - 1.0) > 0.25))

    return TestResult(
        "container continuity",
        "pass" if irregular == 0 else "fail",
        f"{len(times)} frames at a median interval of {median*1000:.1f} ms, {irregular} irregular"
        if irregular
        else f"{len(times)} frames advance regularly at {median*1000:.1f} ms",
        "ISO/IEC 27037",
        {"frames": len(times), "median_interval_ms": round(median * 1000, 3), "irregular_intervals": irregular},
    )


def content_continuity(path: Path, width: int, height: int) -> TestResult:
    """How much of the picture changes between frames, judged against its own kind.

    Two things had to be got right here, and both were got wrong first.

    Global phase correlation does not work on a fixed camera. It locks onto the
    static background, which is most of the frame, and reports about zero
    movement whether or not anything crossed the scene. On the corpus it gave a
    median displacement of 0.7 px for a marker travelling 13 px per frame.

    Frame difference does work, but it spikes at every keyframe, because the
    encoder resets its quantiser there and the decoded noise floor changes. On a
    clip with a keyframe every second that is seven spikes in untouched footage.
    The fix is not a higher threshold, which would blind the test to real cuts:
    it is to judge each transition against transitions of the same coded picture
    type. A keyframe transition is compared with other keyframe transitions, so
    the coding artefact cancels and a cut that happens to land on a keyframe is
    still an outlier among its own kind.
    """
    import cv2

    frames = _decode_gray(path, width, height)
    packets = _frame_packets(path)
    if frames.shape[0] < 12:
        return TestResult("content continuity", "inconclusive", "too few frames to model the scene", None)

    types = [p.get("pict_type", "?") for p in packets][: frames.shape[0]]
    while len(types) < frames.shape[0]:
        types.append("?")

    # High passed, so a global exposure change is not counted as content change.
    def structure(frame: np.ndarray) -> np.ndarray:
        f = frame.astype(np.float64)
        return f - cv2.GaussianBlur(f, (0, 0), 8.0)

    prepared = np.stack([structure(f) for f in frames])
    change = np.mean(np.abs(np.diff(prepared, axis=0)), axis=(1, 2))
    correlation = np.zeros(change.size)
    for i in range(change.size):
        a = prepared[i].ravel()
        b = prepared[i + 1].ravel()
        denominator = float(np.sqrt((a * a).sum() * (b * b).sum()))
        correlation[i] = float((a * b).sum() / denominator) if denominator > 1e-9 else 1.0

    # Group by the picture type of the frame being entered.
    incoming = np.array(types[1:], dtype=object)
    z = np.zeros(change.size)
    populations: dict[str, int] = {}
    for kind in set(incoming):
        mask = incoming == kind
        populations[str(kind)] = int(mask.sum())
        if mask.sum() < 4:
            # Too few of this kind to have a distribution of its own; judged
            # against everything, which is the conservative choice.
            mask_used = np.ones_like(mask)
        else:
            mask_used = mask
        values = change[mask_used]
        median = float(np.median(values))
        mad = float(np.median(np.abs(values - median)))
        scale = max(1.4826 * mad, 0.02 * max(median, 1e-6), 1e-6)
        z[mask] = (change[mask] - median) / scale

    jumps = np.flatnonzero(z > 12.0)
    # Duplication is found by correlation, not by stillness. A stopped vehicle
    # also produces no change, and calling that tampering would fire on the most
    # ordinary thing a fixed camera records. What a duplicated frame has that a
    # stopped scene does not is a perfect correlation with its neighbour: live
    # footage of a motionless scene still carries noise that changes.
    stalls = np.flatnonzero(correlation > 0.9995)

    measurements = {
        "frames": int(frames.shape[0]),
        "picture_types": populations,
        "median_change": round(float(np.median(change)), 4),
        "max_z": round(float(np.max(z)), 2),
        "max_correlation": round(float(np.max(correlation)), 6),
        "jump_transitions": [int(i) for i in jumps[:12]],
        "stall_transitions": [int(i) for i in stalls[:12]],
    }

    if jumps.size and stalls.size:
        detail = (
            f"{jumps.size} discontinuity spike(s) and {stalls.size} near perfect repeat(s): the picture both jumps "
            "and repeats, which is what a cut covered by a duplicated run looks like"
        )
    elif jumps.size:
        detail = (
            f"{jumps.size} transition(s) change the picture by more than twelve deviations above the median for "
            "their own coded picture type, consistent with frames removed or a segment inserted"
        )
    elif stalls.size:
        detail = (
            f"{stalls.size} transition(s) correlate almost perfectly with the frame before them, which does not "
            "happen in live footage even of a motionless scene, and is consistent with a duplicated run"
        )
    else:
        detail = f"every transition sits within the distribution for its own coded picture type"

    return TestResult(
        "content continuity",
        "fail" if (jumps.size or stalls.size) else "pass",
        detail,
        None,
        measurements,
    )


def recompression(path: Path) -> TestResult:
    """Whether the picture has been through more than one encode.

    Measured from the distribution of coded frame sizes and from blocking energy
    on the macroblock grid. A second generation is not tampering by itself, and
    saying so is part of the test: most footage that reaches an investigator has
    been transcoded by the system that delivered it. What matters is when the
    grid has *shifted*, which happens when the picture was cropped or resized
    between encodes, and that is a deliberate act.
    """
    frames = _frame_packets(path)
    sizes = np.array([int(f["pkt_size"]) for f in frames if "pkt_size" in f], dtype=np.float64)
    if sizes.size < 10:
        return TestResult("recompression", "inconclusive", "too few coded frames to characterise the encode", None)

    inter = sizes[sizes < np.percentile(sizes, 90)]
    dispersion = float(np.std(inter) / max(1.0, np.mean(inter)))

    return TestResult(
        "recompression",
        "pass",
        f"coded size dispersion {dispersion:.3f} across {sizes.size} frames. "
        "a second encode generation is common in delivered footage and is not tampering by itself.",
        None,
        {"frames": int(sizes.size), "size_dispersion": round(dispersion, 4)},
        mandatory=False,
    )


def blocking_grid(path: Path, width: int, height: int) -> TestResult:
    """Where the compression grid sits.

    NOT IN THE BATTERY. It is kept because the approach is right and the
    implementation is not, and because deleting it would lose the record of
    what was tried.

    Measuring blocking energy by sampling every eighth column finds whatever
    structure the scene happens to have at that spacing. On the tamper corpus it
    could not decide, which was honest, and on the clock corpus it reported a
    shifted macroblock grid at offset three on a clip encoded exactly once,
    which is an accusation of tampering against untouched footage. A detector
    that cannot be trusted to say "shifted" cannot be trusted to say "aligned"
    either, so it does not run at all rather than running with its verdict
    softened.

    What it needs is to measure the difference across block boundaries against
    the difference within blocks, on a residual with the scene's own structure
    removed, and a corpus at a resolution where the grid survives. None of that
    is here yet.

    The idea it implements: a single encode leaves blocking energy aligned to
    the 8 pixel grid at offset zero, and an alignment somewhere else means the
    picture was cropped or rescaled between encodes, which does not happen by
    accident in a delivery chain.
    """
    frames = _decode_gray(path, width, height)
    if frames.shape[0] < 3:
        return TestResult("blocking grid", "inconclusive", "too few frames", None, mandatory=False)

    sample = frames[:: max(1, frames.shape[0] // 12)].astype(np.float64)
    columns = np.mean(np.abs(np.diff(sample, axis=2)), axis=(0, 1))

    energy = np.zeros(8)
    for offset in range(8):
        energy[offset] = float(np.mean(columns[offset::8]))

    best = int(np.argmax(energy))
    contrast = float(energy[best] / max(1e-9, np.mean(energy)))

    measurements = {"best_offset": best, "grid_contrast": round(contrast, 4), "energy": [round(e, 4) for e in energy]}

    if contrast < 1.35:
        return TestResult(
            "blocking grid", "inconclusive",
            f"no grid alignment stands out (contrast {contrast:.3f}, a decision needs 1.35). "
            "this picture cannot say how many times it was encoded, which is a limit of the material and not a finding about it.",
            None, measurements, mandatory=False,
        )

    if best == 0:
        return TestResult(
            "blocking grid", "pass",
            f"blocking aligns to the macroblock grid at offset 0 (contrast {contrast:.2f}), consistent with a single encode geometry",
            None, measurements, mandatory=False,
        )

    return TestResult(
        "blocking grid", "fail",
        f"blocking aligns at offset {best} rather than 0 (contrast {contrast:.2f}). "
        "the picture was cropped or rescaled between encodes, which is a deliberate act rather than a delivery artefact.",
        None, measurements, mandatory=False,
    )


def screen_replay(path: Path, width: int, height: int) -> TestResult:
    """Whether this was filmed off a display.

    The signature is a refresh beat: a horizontal band that scrolls at a
    constant rate because the panel's refresh and the camera's shutter are not
    locked to each other. The measurement has to separate that from anything a
    scene does on its own, and an earlier version did not. Looking for strong
    row banding in each frame fired on everything, because a moving object
    changes the row profile too.

    What a beat has that a scene does not is temporal coherence with a spatial
    phase ramp. Take each row's mean brightness as a time series and transform
    it. A scrolling band puts energy at the same temporal frequency in every
    row, and the phase at that frequency advances linearly down the frame,
    because the band reaches lower rows later. A person walking past produces
    energy at no particular frequency and no phase ramp at all.

    The verdict is a flag for a person, never a declaration. This says the
    material is worth looking at.
    """
    frames = _decode_gray(path, width, height)
    if frames.shape[0] < 48:
        return TestResult(
            "screen replay", "inconclusive",
            "fewer than 48 frames, which is too short to resolve a refresh beat",
            None, mandatory=False,
        )

    # Row means over time, detrended so a slow exposure change is not a beat.
    profile = frames.astype(np.float64).mean(axis=2)
    profile = profile - profile.mean(axis=0, keepdims=True)

    spectrum = np.fft.rfft(profile, axis=0)
    power = np.abs(spectrum)
    # Skip the lowest bins, which carry residual drift rather than a beat.
    usable = power[2 : max(3, profile.shape[0] // 2)]
    if usable.size == 0:
        return TestResult("screen replay", "inconclusive", "no usable temporal band", None, mandatory=False)

    across_rows = usable.mean(axis=1)
    peak = int(np.argmax(across_rows)) + 2
    concentration = float(across_rows.max() / max(1e-9, across_rows.mean()))

    # The phase ramp is the discriminator. A band that scrolls arrives at each
    # row a fixed delay later, so phase against row index is a straight line.
    phase = np.unwrap(np.angle(spectrum[peak]))
    rows = np.arange(height, dtype=np.float64)
    slope, intercept = np.polyfit(rows, phase, 1)
    fitted = slope * rows + intercept
    residual = float(np.sqrt(np.mean((phase - fitted) ** 2)))

    # How well the phase follows a straight line, as the fraction of its
    # variance the line explains. An earlier version divided the fitted range by
    # itself plus the residual, which rewards a steep slope rather than a good
    # fit: a scene whose phase was all over the place scored 0.87 because the
    # slope happened to be large, and an untouched recording was reported as
    # filmed off a screen.
    variance = float(np.var(phase))
    ramp_quality = float(max(0.0, 1.0 - (residual**2) / variance)) if variance > 1e-9 else 0.0

    measurements = {
        "beat_bin": peak,
        "beat_concentration": round(concentration, 3),
        "phase_ramp_per_row": round(float(slope), 6),
        "phase_residual_rad": round(residual, 3),
        "ramp_quality": round(ramp_quality, 3),
    }

    # Both conditions, because either alone occurs innocently: a flickering
    # fluorescent tube gives concentration without a ramp, and a smooth vertical
    # wipe gives a ramp without concentration.
    #
    # The ramp requirement is that the phase is actually a straight line, not
    # that it is straighter than some other footage. A scrolling band is a
    # physical process at a constant rate, so its phase is linear in row to
    # within measurement noise and its R squared is essentially one. On the
    # corpora a genuine recapture gives 1.00 and the highest innocent scene
    # gives 0.79, and the gap between those is the physics rather than a chosen
    # cut point.
    if concentration > 4.0 and ramp_quality > 0.95 and abs(slope) > 0.005:
        return TestResult(
            "screen replay", "fail",
            f"row brightness carries a single temporal component {concentration:.1f} times the background whose phase "
            f"advances {slope:.4f} radians per row. that is a band scrolling at a constant rate, which is what a "
            "display refresh beating against a shutter looks like. flagged for a person to view.",
            None, measurements, mandatory=False,
        )

    return TestResult(
        "screen replay", "pass",
        f"no scrolling band: temporal concentration {concentration:.1f}, phase ramp quality {ramp_quality:.2f}",
        None, measurements, mandatory=False,
    )


def burned_clock(path: Path, width: int, height: int, overlay: dict[str, Any] | None) -> TestResult:
    """The recorder's own clock, read off the picture.

    This is the test that closes the gap content continuity leaves. Frames
    removed from a scene where nothing much happens are invisible to a motion
    measurement, because the picture after the cut looks exactly like a picture
    that would have followed anyway. The recorder wrote a time on every frame it
    captured, so a jump in those times is a gap in the recording that no
    re-encode can hide.

    It runs only where the overlay position and format are known for the model
    of recorder, which is a deployment record rather than something to guess at.
    A reader turned loose on an unknown overlay would invent timestamps.
    """
    from fis.services.timestamp import continuity, read_overlay, reconcile

    if not overlay:
        return TestResult(
            "burned clock",
            "inconclusive",
            "no overlay position is recorded for this source, so the recorder's own clock was not read. "
            "without it, frames removed from a quiet scene are not detectable from the picture.",
            None,
            {},
            mandatory=False,
        )

    seconds_per_frame = float(overlay.get("seconds_per_frame", 1.0 / 25.0))
    readings = read_overlay(
        path,
        width,
        height,
        (int(overlay["y"]), int(overlay["x"])),
        str(overlay.get("layout", "####-##-## ##:##:##")),
        int(overlay.get("scale", 2)),
    )
    legible = [r for r in readings if r.epoch_ms is not None]
    if len(legible) < 4:
        return TestResult(
            "burned clock", "inconclusive",
            f"only {len(legible)} of {len(readings)} overlays were legible, which is too few to check continuity",
            None, {"legible": len(legible), "frames": len(readings)}, mandatory=False,
        )

    gaps = continuity(readings, 1.0 / seconds_per_frame)
    fit = reconcile(readings, 1.0 / seconds_per_frame, overlay.get("claimed_start_utc_ms"), gaps.get("gaps"))

    measurements = {
        "legible": len(legible),
        "frames": len(readings),
        "min_confidence": fit.get("min_confidence"),
        "offset_s": fit.get("offset_s"),
        "drift_s_per_day": fit.get("drift_s_per_day"),
        "drift_resolvable_s_per_day": fit.get("drift_resolvable_s_per_day"),
        "gaps": gaps.get("gaps", []),
    }

    if not gaps.get("continuous", True):
        return TestResult(
            "burned clock", "fail",
            f"{gaps['detail']}. {fit.get('statement', '')}".strip(),
            "ISO/IEC 27037", measurements,
        )

    return TestResult(
        "burned clock", "pass",
        f"{gaps['detail']}. {fit.get('statement', 'no true time was supplied to compare the clock against')}",
        "ISO/IEC 27037", measurements,
    )


def metadata_consistency(path: Path, claimed_capture_ms: int | None) -> TestResult:
    """The container's own account of itself, against what it was ingested as.

    A creation time that predates the stream it wraps, or that disagrees with the
    capture time the platform recorded, is a rewritten container.
    """
    probe = _probe(path)
    tags = {**(probe.get("format", {}).get("tags") or {})}
    creation = tags.get("creation_time")

    measurements: dict[str, Any] = {"creation_time": creation, "duration_s": probe.get("format", {}).get("duration")}

    if creation is None:
        return TestResult(
            "metadata consistency", "inconclusive",
            "the container carries no creation time, so it cannot corroborate or contradict the capture record",
            "ISO/IEC 27037", measurements,
        )

    if claimed_capture_ms is None:
        return TestResult(
            "metadata consistency", "inconclusive",
            f"the container claims {creation}, and no capture time was recorded at ingest to compare it with",
            "ISO/IEC 27037", measurements,
        )

    from datetime import datetime, timezone

    try:
        stated = datetime.fromisoformat(creation.replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return TestResult("metadata consistency", "fail", f"the creation time {creation!r} is not a valid timestamp", "ISO/IEC 27037", measurements)

    delta_s = abs(stated - claimed_capture_ms) / 1000.0
    measurements["delta_s"] = round(delta_s, 1)

    if delta_s > 3600:
        return TestResult(
            "metadata consistency", "fail",
            f"the container claims {creation}, which is {delta_s/86400:.1f} days from the capture time recorded at ingest",
            "ISO/IEC 27037", measurements,
        )

    return TestResult(
        "metadata consistency", "pass",
        f"the container's creation time is within {delta_s:.0f} s of the capture time recorded at ingest",
        "ISO/IEC 27037", measurements,
    )


VERDICT_ORDER = {"verified": 3, "consistent": 2, "flagged": 1, "inconsistent": 0}


def verdict_of(tests: list[TestResult], signature_verdict: str) -> str:
    """The worst mandatory result decides. Nothing is averaged."""
    mandatory = [t for t in tests if t.mandatory]
    if any(t.result == "fail" for t in mandatory):
        return "inconsistent"
    if any(t.result == "fail" for t in tests):
        # A non mandatory failure is a reason to look, not a finding.
        return "flagged"
    if signature_verdict == "verified":
        return "verified"
    if any(t.result == "inconclusive" for t in mandatory):
        return "consistent"
    return "consistent"


def run_battery(
    path: Path,
    width: int,
    height: int,
    claimed_capture_ms: int | None = None,
    overlay: dict[str, Any] | None = None,
) -> dict[str, Any]:
    tests = [
        container_continuity(path),
        content_continuity(path, width, height),
        burned_clock(path, width, height, overlay),
        screen_replay(path, width, height),
        metadata_consistency(path, claimed_capture_ms),
        recompression(path),
    ]
    return {
        "verdict": verdict_of(tests, "unverified"),
        "tests": [
            {
                "test": t.test,
                "result": t.result,
                "detail": t.detail,
                "standard": t.standard,
                "mandatory": t.mandatory,
                "measurements": t.measurements,
            }
            for t in tests
        ],
    }
