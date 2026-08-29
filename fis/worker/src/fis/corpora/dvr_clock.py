"""Recordings carrying a burned in clock, with the truth about that clock.

The most common dispute about CCTV evidence is not whether the picture is real.
It is what time it was taken, because the recorder's own clock is almost never
right and is often the only timestamp anybody has. A recorder that runs four
minutes fast turns an alibi into a confession.

So this generates clips whose burned in clock is wrong in a stated way: fast,
slow, drifting, or backdated relative to the container's own timestamps. It also
generates a clip with frames removed, because a burned in clock is the thing
that makes that visible when the picture alone does not.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from fis import digits

WIDTH = 480
HEIGHT = 270
FPS = 10
SCALE = 2
# Where the recorder burns its clock. Fixed per model, which is the whole
# premise of template matching.
ORIGIN = (8, 8)


@dataclass(frozen=True)
class ClockCase:
    name: str
    detail: str
    # Seconds the recorder's clock is ahead of true time at the start.
    offset_s: float
    # Seconds gained per day. Recorders drift; this is what makes a single
    # comparison insufficient and a fit necessary.
    drift_s_per_day: float
    delete_from_frame: int | None = None
    delete_count: int = 0
    # Seconds of real time between recorded frames. A clock check pass samples
    # sparsely across a long period, because drift cannot be measured over a
    # span shorter than the time it takes to accumulate past the overlay's own
    # one second resolution.
    sample_interval_s: float = 1.0 / FPS


CASES = [
    ClockCase("aligned", "recorder clock agrees with true time", 0.0, 0.0),
    ClockCase("fast_4m12s", "recorder runs four minutes twelve seconds fast", 252.0, 0.0),
    ClockCase("slow_and_drifting", "recorder starts 38 s slow and gains 1.9 s a day", -38.0, 1.9),
    ClockCase("backdated_year", "recorder clock set to the previous year", -365 * 86400.0, 0.0),
    ClockCase("frames_removed", "twenty frames cut from the middle, clock intact", 0.0, 0.0, 60, 20),
    # Sampled every ten minutes across a day, which is what a clock check pass
    # over a recorder's archive looks like. This is the only span on which a
    # drift of a few seconds a day is measurable at all.
    ClockCase("day_long_drift", "sampled across 24 h, gaining 1.9 s a day", 12.0, 1.9, sample_interval_s=600.0),
]


def _scene(index: int) -> np.ndarray:
    """A plain moving scene. The clock is what this corpus is about."""
    frame = np.full((HEIGHT, WIDTH), 28.0)
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float64)
    frame += 18.0 * np.sin(xx / 41.0) * np.cos(yy / 37.0)
    x = int((index * 7) % (WIDTH - 60))
    frame[HEIGHT // 2 - 15 : HEIGHT // 2 + 15, x : x + 60] = 190.0
    return frame


def _burn(frame: np.ndarray, text: str) -> np.ndarray:
    """Draws the overlay the way a recorder does: bright ink, dark shadow box."""
    mask = digits.render(text, SCALE)
    h, w = mask.shape
    y, x = ORIGIN
    out = frame.copy()
    out[y - 2 : y + h + 2, x - 2 : x + w + 2] *= 0.25
    region = out[y : y + h, x : x + w]
    out[y : y + h, x : x + w] = np.where(mask > 0, 235.0, region)
    return out


def build(out_dir: Path, seconds: int = 12) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    start = datetime(2026, 3, 14, 9, 15, 0, tzinfo=timezone.utc)
    manifest: list[dict] = []

    for case in CASES:
        count = 144 if case.sample_interval_s > 1.0 else seconds * FPS
        frames: list[np.ndarray] = []
        readings: list[dict] = []

        for i in range(count):
            if case.delete_from_frame is not None and case.delete_from_frame <= i < case.delete_from_frame + case.delete_count:
                continue

            elapsed_s = i * case.sample_interval_s
            true_time = start + timedelta(seconds=elapsed_s)
            elapsed_days = elapsed_s / 86400.0
            shown = true_time + timedelta(seconds=case.offset_s + case.drift_s_per_day * elapsed_days)
            text = shown.strftime("%Y-%m-%d %H:%M:%S")

            frames.append(_burn(_scene(i), text))
            readings.append(
                {
                    "container_index": len(frames) - 1,
                    "true_utc_ms": int(true_time.timestamp() * 1000),
                    "shown_text": text,
                }
            )

        stacked = np.clip(np.stack(frames), 0, 255).astype(np.uint8)
        rgb = np.repeat(stacked[:, :, :, None], 3, axis=3)

        path = out_dir / f"{case.name}.mp4"
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "pipe:0",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26",
                "-g", "20", "-keyint_min", "20", "-sc_threshold", "0",
                str(path),
            ],
            input=rgb.tobytes(), check=True, capture_output=True,
        )

        manifest.append(
            {
                "name": case.name,
                "file": path.name,
                "detail": case.detail,
                "offset_s": case.offset_s,
                "drift_s_per_day": case.drift_s_per_day,
                "frames": len(frames),
                "deleted": case.delete_count,
                "deleted_at": case.delete_from_frame,
                "region": {"x": ORIGIN[1], "y": ORIGIN[0], "scale": SCALE, "format": "%Y-%m-%d %H:%M:%S"},
                "first_true_utc_ms": readings[0]["true_utc_ms"],
                "fps": FPS,
                # The rate real time advances per recorded frame, which is what
                # a reconciliation has to be told when frames are not
                # consecutive.
                "seconds_per_frame": case.sample_interval_s,
                "size": [WIDTH, HEIGHT],
            }
        )
        print(f"{case.name:<20} {len(frames):>4} frames  offset {case.offset_s:>10.1f}s  drift {case.drift_s_per_day:>5.1f}s/day")

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


if __name__ == "__main__":
    import sys

    build(Path(sys.argv[1] if len(sys.argv) > 1 else "fis/corpora/out/dvr_clock"))
