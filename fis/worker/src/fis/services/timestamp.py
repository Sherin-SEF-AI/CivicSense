"""Reading the recorder's own clock, and working out how wrong it is.

Three things happen here and they are separate on purpose.

Reading is template matching against a per model glyph set at a fixed overlay
position. That is not a shortcut around general text recognition, it is the
right tool: a recorder draws the same bitmap every frame and the only variable is
what compression did to it.

Reconciliation fits the recorder's clock against the container's own
presentation timestamps. A single comparison is not enough, because recorders
drift: one that gains two seconds a day agrees with true time on the day it was
set and is a minute out by the end of the month. The fit reports offset and
drift separately, with a residual, so an examiner can see whether the recorder's
clock is merely wrong or also unstable.

Continuity checks that the burned clock advances by exactly one frame interval.
This is the test that finds frames removed from a scene where the picture alone
cannot show it, which is the gap the authenticity battery records as a known
limit.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from fis import digits

TIMESTAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$")

# What one tick of the burned overlay is worth. Everything time related here is
# quantised to it, and pretending otherwise is how a twelve second clip comes to
# report a drift rate.
OVERLAY_RESOLUTION_S = 1.0


@dataclass
class Reading:
    index: int
    text: str
    confidence: float
    epoch_ms: int | None


def _decode(path: Path, width: int, height: int) -> np.ndarray:
    out = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-flags", "+bitexact", "-ec", "0", "-threads", "1",
            "-i", str(path), "-f", "rawvideo", "-pix_fmt", "gray", "-",
        ],
        capture_output=True, check=True,
    )
    buffer = np.frombuffer(out.stdout, dtype=np.uint8)
    n = buffer.size // (width * height)
    return buffer[: n * width * height].reshape(n, height, width)


def read_overlay(
    path: Path,
    width: int,
    height: int,
    origin: tuple[int, int],
    layout: str,
    scale: int = 2,
    every: int = 1,
) -> list[Reading]:
    """Reads the burned clock from every Nth frame.

    The layout string says which cells are digits and which are fixed
    separators, so the reader only decides the characters that can vary. A
    recogniser free to read a hyphen as a one would invent dates that never
    existed.
    """
    frames = _decode(path, width, height)
    glyph_h = digits.GLYPH_H * scale
    glyph_w = digits.GLYPH_W * scale
    step = digits.cell_width(scale)
    template = digits.templates(scale)
    keys = sorted(template)
    bank = np.stack([template[k].ravel() for k in keys])
    bank = bank - bank.mean(axis=1, keepdims=True)
    bank_norm = np.linalg.norm(bank, axis=1)

    readings: list[Reading] = []
    y, x = origin

    for index in range(0, frames.shape[0], every):
        frame = frames[index].astype(np.float64)
        characters: list[str] = []
        scores: list[float] = []

        for position, expected in enumerate(layout):
            if expected != "#":
                characters.append(expected)
                continue

            left = x + position * step
            patch = frame[y : y + glyph_h, left : left + glyph_w]
            if patch.shape != (glyph_h, glyph_w):
                characters.append("?")
                scores.append(0.0)
                continue

            flat = patch.ravel() - patch.mean()
            norm = float(np.linalg.norm(flat))
            if norm < 1e-6:
                characters.append("?")
                scores.append(0.0)
                continue

            correlation = (bank @ flat) / (bank_norm * norm)
            best = int(np.argmax(correlation))
            characters.append(keys[best])
            scores.append(float(correlation[best]))

        text = "".join(characters)
        confidence = float(np.min(scores)) if scores else 0.0
        readings.append(Reading(index, text, round(confidence, 4), _parse(text)))

    return readings


def _parse(text: str) -> int | None:
    match = TIMESTAMP.match(text)
    if not match:
        return None
    try:
        stamp = datetime(
            int(match[1]), int(match[2]), int(match[3]), int(match[4]), int(match[5]), int(match[6]),
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None
    return int(stamp.timestamp() * 1000)


def reconcile(
    readings: list[Reading],
    fps: float,
    first_true_utc_ms: int | None,
    gaps: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Fits the recorder's clock against the container's own frame timing.

    The recorder's clock is the dependent variable and elapsed container time is
    the independent one, so the intercept is the offset at the start of the clip
    and the slope minus one is the drift rate. Reporting them separately is the
    point: an offset is a clock somebody set wrongly, a drift is a clock that
    cannot hold time, and they have different consequences for a case.
    """
    usable = [r for r in readings if r.epoch_ms is not None]
    if len(usable) < 4:
        return {"resolved": False, "reason": "too few legible timestamps to fit a clock"}

    # A fit that straddles a break in the recording measures the break, not the
    # clock. Reporting a drift rate from it would turn twenty missing frames
    # into a claim about the recorder's oscillator.
    if gaps:
        return {
            "resolved": True,
            "readings": len(usable),
            "spans_discontinuity": True,
            "offset_s": round((float(usable[0].epoch_ms) - first_true_utc_ms) / 1000.0, 3)
            if first_true_utc_ms is not None
            else None,
            "drift_s_per_day": None,
            "drift_measurable": False,
            "min_confidence": round(min(r.confidence for r in usable), 4),
            "statement": (
                "the recording is not continuous, so the recorder's rate cannot be fitted across it. "
                f"the offset at the start is reported; {len(gaps)} break(s) were found."
            ),
        }

    container_s = np.array([r.index / fps for r in usable], dtype=np.float64)
    shown_ms = np.array([r.epoch_ms for r in usable], dtype=np.float64)
    shown_s = (shown_ms - shown_ms[0]) / 1000.0

    slope, intercept = np.polyfit(container_s, shown_s, 1)
    residual = float(np.sqrt(np.mean((shown_s - (slope * container_s + intercept)) ** 2)))
    drift = float((slope - 1.0) * 86400.0)

    # Drift cannot be measured over a span too short to accumulate more than the
    # overlay's own resolution. A recorder overlay ticks once a second, so over
    # twelve seconds of footage the fitted slope is quantisation and nothing
    # else: an ungated version of this reported 594 seconds a day of drift on a
    # clip whose clock was exactly right. The floor is stated with the answer so
    # a reader can see what span would be needed to do better.
    span_s = float(container_s[-1] - container_s[0])
    span_days = max(span_s / 86400.0, 1e-9)
    resolvable = OVERLAY_RESOLUTION_S / span_days
    measurable = abs(drift) > resolvable

    result: dict[str, Any] = {
        "resolved": True,
        "readings": len(usable),
        "illegible": len(readings) - len(usable),
        "fit_residual_s": round(residual, 4),
        "first_shown_utc_ms": int(shown_ms[0]),
        "min_confidence": round(min(r.confidence for r in usable), 4),
        "span_s": round(span_s, 3),
        "drift_resolvable_s_per_day": round(resolvable, 3),
        "drift_measurable": measurable,
        "drift_s_per_day": round(drift, 4) if measurable else None,
        "drift_note": (
            None
            if measurable
            else f"a {span_s:.0f} s clip cannot resolve drift below {resolvable:.0f} s a day, because the overlay "
            f"ticks once a second. a span of about {OVERLAY_RESOLUTION_S / max(abs(drift), 1e-9) * 86400 / 3600:.0f} "
            "hours would be needed to measure a drift of this size."
        ),
    }

    if first_true_utc_ms is not None:
        offset_s = (float(shown_ms[0]) - first_true_utc_ms) / 1000.0
        result["offset_s"] = round(offset_s, 3)
        result["statement"] = _statement(offset_s, drift if measurable else None)

    return result


def _statement(offset_s: float, drift_s_per_day: float | None) -> str:
    """Plain words, because this is the finding an examiner has to explain."""
    if abs(offset_s) < 1.0 and (drift_s_per_day is None or abs(drift_s_per_day) < 0.5):
        stable = " and is stable" if drift_s_per_day is not None else ""
        return f"the recorder clock agrees with true time to within a second{stable}"

    direction = "fast" if offset_s > 0 else "slow"
    magnitude = abs(offset_s)
    if magnitude >= 86400:
        amount = f"{magnitude / 86400:.1f} days"
    elif magnitude >= 3600:
        amount = f"{int(magnitude // 3600)} h {int((magnitude % 3600) // 60)} m"
    elif magnitude >= 60:
        amount = f"{int(magnitude // 60)} m {magnitude % 60:.0f} s"
    else:
        amount = f"{magnitude:.1f} s"

    if drift_s_per_day is None:
        drift = ", over a span too short to say whether it also drifts"
    elif abs(drift_s_per_day) < 0.5:
        drift = ", and stable"
    else:
        drift = f", drifting {abs(drift_s_per_day):.1f} s a day {'fast' if drift_s_per_day > 0 else 'slow'}"
    return f"the recorder clock ran {amount} {direction}{drift}"


def continuity(readings: list[Reading], fps: float) -> dict[str, Any]:
    """Whether the burned clock advances the way the container says it should.

    This is what finds frames removed from footage where the picture alone
    cannot show it: the recorder wrote a time on every frame it captured, and a
    gap in those times is a gap in the recording no re-encode can hide.
    """
    usable = [r for r in readings if r.epoch_ms is not None]
    if len(usable) < 4:
        return {"resolved": False, "reason": "too few legible timestamps to check continuity"}

    gaps = []
    for previous, current in zip(usable, usable[1:]):
        frames_apart = current.index - previous.index
        expected_ms = frames_apart / fps * 1000.0
        shown_ms = float(current.epoch_ms - previous.epoch_ms)
        # The overlay has one second resolution, so a discrepancy under about a
        # second and a half is the display rounding rather than a missing frame.
        if abs(shown_ms - expected_ms) > 1500.0:
            gaps.append(
                {
                    "after_frame": previous.index,
                    "expected_ms": round(expected_ms, 1),
                    "shown_ms": round(shown_ms, 1),
                    "missing_ms": round(shown_ms - expected_ms, 1),
                    "missing_frames": int(round((shown_ms - expected_ms) / 1000.0 * fps)),
                }
            )

    return {
        "resolved": True,
        "continuous": not gaps,
        "gaps": gaps,
        "detail": (
            "the burned clock advances by exactly the container's frame interval throughout"
            if not gaps
            else f"the burned clock skips at {len(gaps)} point(s), which is {sum(g['missing_frames'] for g in gaps)} frame(s) "
            "the recorder wrote a time for and the file does not contain"
        ),
    }
