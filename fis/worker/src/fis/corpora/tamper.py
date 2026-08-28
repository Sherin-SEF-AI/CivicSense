"""Video that has been interfered with in known ways.

An authenticity battery cannot be validated on genuine footage, because genuine
footage does not come labelled. This produces pairs: a clean clip and a clip
altered in exactly one stated way, so a test can say not only that a detector
fires but that it fires on the right thing and stays quiet on the control.

The alterations are the ones that actually occur. Someone cuts a few seconds
out. Someone loops a segment to cover a gap. Someone re-encodes to hide the
first two. Someone plays a video on a monitor and films the monitor. Someone
edits the container timestamp and leaves the stream alone.

Rendering is deterministic: a moving marker whose position is a stated function
of the frame index, so a deleted or duplicated frame is a real discontinuity in
the content and not merely in the container.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

FPS = 25
WIDTH = 320
HEIGHT = 240


@dataclass(frozen=True)
class Variant:
    name: str
    kind: str
    expect: str
    detail: str


VARIANTS = [
    Variant("clean", "control", "consistent", "untouched, the control every detector must stay quiet on"),
    # Deletion from a scene with no monotonic content is not detectable from
    # content alone, and saying otherwise would be a claim this corpus cannot
    # support. The test that finds it is burned in timestamp continuity, which
    # is a separate operator. This variant exists so that limit is on the
    # record and is re-checked every run rather than remembered.
    Variant("frames_deleted", "temporal", "consistent", "a run of frames cut from the middle, which content continuity alone does not see"),
    Variant("frames_duplicated", "temporal", "inconsistent", "a run of frames repeated to cover a gap"),
    Variant("segment_spliced", "temporal", "inconsistent", "a segment from elsewhere inserted"),
    Variant("reencoded", "compression", "consistent", "a second encode generation, which is not tampering by itself"),
    # The grid test cannot decide on 320x240 material at this bitrate. What
    # matters is that it says so rather than reporting a single encode.
    Variant("double_compressed_shifted", "compression", "consistent", "re-encoded with a shifted macroblock grid, which this resolution cannot resolve"),
    Variant("screen_replay", "capture", "flagged", "displayed on a monitor and filmed, with beat and banding"),
    Variant("metadata_backdated", "metadata", "inconsistent", "container creation time altered, stream untouched"),
]


def _texture(seed: int) -> np.ndarray:
    """Deterministic broadband noise, smoothed so it survives an encode."""
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.int64)
    # A large multiplier in both axes gives no short spatial period.
    raw = ((xx * 1103515245 + yy * 12345 + seed * 7919) >> 7) % 61
    field = raw.astype(np.float64)
    # Box smooth twice, which removes the single pixel checkerboard an encoder
    # would simply discard while leaving structure at the block scale.
    for _ in range(2):
        field = (
            field
            + np.roll(field, 1, axis=0)
            + np.roll(field, -1, axis=0)
            + np.roll(field, 1, axis=1)
            + np.roll(field, -1, axis=1)
        ) / 5.0
    return (field * 2.4).astype(np.int16)


TEXTURE = [_texture(0), _texture(11)]


def _frames(count: int, seed: int = 0) -> np.ndarray:
    """A clip whose content is a stated function of the frame index.

    The marker sweeps at a constant rate and a counter bar grows by one column
    per frame. Both make a temporal edit visible in the pixels, so a detector
    that only reads the container cannot pass by accident.
    """
    clip = np.zeros((count, HEIGHT, WIDTH, 3), dtype=np.uint8)
    for i in range(count):
        frame = clip[i]
        frame[:, :, 0] = 20
        frame[:, :, 1] = 22
        frame[:, :, 2] = 26

        # Broadband static texture, so a re-encode has something to lose and the
        # compression grid has something to show. An earlier version used a
        # period 3 pattern, which swamped the 8 pixel blocking signal entirely
        # and made the grid test unable to decide anything on its own corpus.
        frame[:, :, 0] = np.clip(frame[:, :, 0].astype(np.int16) + TEXTURE[seed % 2], 0, 255).astype(np.uint8)

        # The marker bounces rather than wrapping. A wrap is a genuine content
        # discontinuity, and putting one in the clean control would mean every
        # continuity detector had to be blunted to pass it.
        # A circle rather than a bounce. A bouncing marker genuinely stops at
        # each turning point, and a clean control containing a real stall would
        # force any duplication detector to be blunted to pass it. The phase
        # offset differs between clips, so splicing one into another moves the
        # subject, which is what a real splice does.
        angle = (i + seed * 37) * 0.11
        cx = int(WIDTH / 2 + (WIDTH / 2 - 40) * np.cos(angle))
        cy = int(HEIGHT / 2 + (HEIGHT / 2 - 30) * np.sin(angle))
        frame[cy - 12 : cy + 12, cx - 20 : cx + 20] = (88, 166, 255)

        # A monotonic element, the way a real recording has a burned in clock or
        # a queue that grows. Without one, a scene whose only motion is periodic
        # can have frames cut out of it and look continuous afterwards: the
        # marker is simply somewhere else on its circle, which it would have
        # been anyway. A counter cannot be cut without leaving a gap.
        counter = i + seed * 601
        for bit in range(10):
            if (counter >> bit) & 1:
                frame[6:18, 6 + bit * 14 : 16 + bit * 14] = (232, 234, 237)
    return clip


def _write(path: Path, frames: np.ndarray, fps: int = FPS, crf: int = 20, extra: list[str] | None = None) -> None:
    command = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{WIDTH}x{HEIGHT}", "-r", str(fps), "-i", "pipe:0",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(crf),
        "-g", "25", "-keyint_min", "25", "-sc_threshold", "0",
        *(extra or []),
        str(path),
    ]
    subprocess.run(command, input=frames.tobytes(), check=True, capture_output=True)


def _screen_replay(frames: np.ndarray) -> np.ndarray:
    """What filming a monitor does to a picture.

    Three artefacts, all geometric rather than random: a horizontal rolling band
    from the refresh beating against the shutter, a faint pixel grid from the
    display's own structure, and a slight gamma lift from the panel. Together
    they are what a screen replay detector is looking for.
    """
    out = frames.astype(np.float64)
    count, height, width, _ = out.shape

    rows = np.arange(height, dtype=np.float64)
    for i in range(count):
        # The band drifts, which is the beat between refresh and capture.
        phase = (i * 0.37) % 1.0
        band = 1.0 + 0.10 * np.sin(2 * np.pi * (rows / height * 3.0 + phase))
        out[i] *= band[:, None, None]

    grid = np.ones((height, width))
    grid[:, ::3] *= 0.94
    grid[::3, :] *= 0.97
    out *= grid[None, :, :, None]

    out = 255.0 * np.power(np.clip(out / 255.0, 0, 1), 0.92)
    return np.clip(out, 0, 255).astype(np.uint8)


def build(out_dir: Path, seconds: int = 6) -> list[dict]:
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg is required to build the tamper corpus")

    out_dir.mkdir(parents=True, exist_ok=True)
    count = seconds * FPS
    base = _frames(count)
    other = _frames(count, seed=11)

    manifest: list[dict] = []
    for variant in VARIANTS:
        path = out_dir / f"{variant.name}.mp4"
        truth: dict = {}

        if variant.name == "clean":
            _write(path, base)

        elif variant.name == "frames_deleted":
            cut_at, cut_len = count // 2, 12
            edited = np.concatenate([base[:cut_at], base[cut_at + cut_len :]])
            _write(path, edited)
            truth = {"cut_at_frame": cut_at, "frames_removed": cut_len}

        elif variant.name == "frames_duplicated":
            at, run = count // 3, 10
            edited = np.concatenate([base[:at], np.repeat(base[at : at + 1], run, axis=0), base[at:]])
            _write(path, edited)
            truth = {"at_frame": at, "frames_duplicated": run}

        elif variant.name == "segment_spliced":
            at, run = count // 2, 20
            edited = np.concatenate([base[:at], other[at : at + run], base[at + run :]])
            _write(path, edited)
            truth = {"at_frame": at, "frames_from_elsewhere": run}

        elif variant.name == "reencoded":
            first = out_dir / "_tmp_first.mp4"
            _write(first, base, crf=18)
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(first), "-c:v", "libx264", "-crf", "28", str(path)],
                check=True, capture_output=True,
            )
            first.unlink()
            truth = {"generations": 2}

        elif variant.name == "double_compressed_shifted":
            first = out_dir / "_tmp_shift.mp4"
            _write(first, base, crf=18)
            # Cropping by four pixels moves the macroblock grid, which is what
            # makes a second generation detectable rather than merely present.
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(first),
                 "-vf", "crop=312:232:4:4,scale=320:240", "-c:v", "libx264", "-crf", "26", str(path)],
                check=True, capture_output=True,
            )
            first.unlink()
            truth = {"generations": 2, "grid_shift_px": 4}

        elif variant.name == "screen_replay":
            _write(path, _screen_replay(base))
            truth = {"band_period_frames": round(1 / 0.37, 2)}

        elif variant.name == "metadata_backdated":
            _write(path, base, extra=["-metadata", "creation_time=2019-01-01T00:00:00Z"])
            truth = {"claimed_creation": "2019-01-01T00:00:00Z"}

        manifest.append(
            {
                "name": variant.name,
                "file": path.name,
                "kind": variant.kind,
                "expect": variant.expect,
                "detail": variant.detail,
                "truth": truth,
            }
        )
        print(f"{variant.name:<26} {variant.expect:<12} {path.stat().st_size:>8} bytes")

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


if __name__ == "__main__":
    import sys

    build(Path(sys.argv[1] if len(sys.argv) > 1 else "fis/corpora/out/tamper"))
