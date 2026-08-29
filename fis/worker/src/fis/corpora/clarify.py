"""A sharp scene, degraded in stated ways, so restoration can be graded.

Enhancement is where a forensic tool most easily starts lying. An output that
looks better is not evidence of anything: the question is whether the detail now
visible was in the original samples or was invented by the process. That cannot
be answered by looking, which is why this exists.

Every degradation here is applied by a known operator with known parameters, so
a restoration can be compared against the truth it is trying to recover, and a
restoration that produces detail the truth does not contain can be caught.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


WIDTH = 256
HEIGHT = 192


def truth(seed: int = 0) -> np.ndarray:
    """A scene with detail at every scale, including text sized structure.

    A smooth gradient would let any blur pass unnoticed and a noise field would
    let any denoise claim a win. This has hard edges, fine bars near the
    resolution limit, and a plate like block of high contrast glyphs, which is
    the thing these operators exist to make readable.
    """
    image = np.zeros((HEIGHT, WIDTH), dtype=np.float64)
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float64)

    image += 40.0 + 60.0 * (xx / WIDTH)
    image[40:110, 20:110] = 150.0                      # a flat panel
    image[130:150, :] = 90.0 + 70.0 * np.sin(xx[130:150, :] / 3.0)  # bars near the limit
    image[20:35, 150:240] = 210.0                       # a bright sign

    # A plate: alternating dark glyph blocks on a light ground.
    plate = np.full((26, 108), 225.0)
    for i in range(6):
        plate[5:21, 6 + i * 17 : 6 + i * 17 + 11] = 35.0
        plate[9:13, 6 + i * 17 : 6 + i * 17 + 11] = 225.0  # a horizontal bar in each
    image[155:181, 130:238] = plate

    rng = np.random.default_rng(seed)
    image += rng.normal(0.0, 1.5, image.shape)  # a little grain, as any sensor has
    return np.clip(image, 0, 255)


def motion_psf(length: int, angle_deg: float) -> np.ndarray:
    """A linear motion blur kernel, normalised."""
    kernel = np.zeros((length, length), dtype=np.float64)
    centre = (length - 1) / 2.0
    radians = np.deg2rad(angle_deg)
    for t in np.linspace(-centre, centre, length * 8):
        y = int(round(centre + t * np.sin(radians)))
        x = int(round(centre + t * np.cos(radians)))
        if 0 <= y < length and 0 <= x < length:
            kernel[y, x] += 1.0
    total = kernel.sum()
    return kernel / total if total else kernel


def defocus_psf(radius: int) -> np.ndarray:
    """A disc, which is what an out of focus point becomes."""
    size = radius * 2 + 1
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64) - radius
    disc = ((xx**2 + yy**2) <= radius**2).astype(np.float64)
    return disc / disc.sum()


def convolve(image: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """Explicit, so the corpus does not depend on a library's edge handling."""
    kh, kw = kernel.shape
    padded = np.pad(image, ((kh // 2, kh // 2), (kw // 2, kw // 2)), mode="reflect")
    out = np.zeros_like(image)
    for dy in range(kh):
        for dx in range(kw):
            weight = kernel[dy, dx]
            if weight != 0.0:
                out += padded[dy : dy + image.shape[0], dx : dx + image.shape[1]] * weight
    return out


@dataclass(frozen=True)
class Degradation:
    name: str
    detail: str
    kind: str
    params: dict


DEGRADATIONS = [
    Degradation("noisy", "heavy sensor noise, nothing else wrong", "noise", {"sigma": 18.0}),
    Degradation("motion_blur", "linear motion, 9 px at 15 degrees", "motion", {"length": 9, "angle": 15.0, "sigma": 3.0}),
    Degradation("defocus", "out of focus by a 4 px disc", "defocus", {"radius": 4, "sigma": 3.0}),
    Degradation("low_contrast", "hazy, compressed into the middle of the range", "contrast", {"gain": 0.35, "lift": 90.0}),
    Degradation("shifted_stack", "a run of frames with sub pixel jitter, as a tripod has", "stack", {"frames": 12, "sigma": 14.0, "shift": 0.9}),
]


def shift(image: np.ndarray, dy: float, dx: float) -> np.ndarray:
    """Sub pixel translation by bilinear resampling, which is what jitter is."""
    y0, x0 = int(np.floor(dy)), int(np.floor(dx))
    fy, fx = dy - y0, dx - x0
    rolled = np.roll(np.roll(image, y0, axis=0), x0, axis=1)
    down = np.roll(rolled, 1, axis=0)
    right = np.roll(rolled, 1, axis=1)
    both = np.roll(down, 1, axis=1)
    return (
        rolled * (1 - fy) * (1 - fx)
        + down * fy * (1 - fx)
        + right * (1 - fy) * fx
        + both * fy * fx
    )


def build(out_dir: Path) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    clean = truth()
    np.save(out_dir / "truth.npy", clean)

    manifest: list[dict] = []
    for degradation in DEGRADATIONS:
        rng = np.random.default_rng(abs(hash(degradation.name)) % 9973)
        params = degradation.params

        if degradation.kind == "noise":
            frames = [clean + rng.normal(0.0, params["sigma"], clean.shape)]
        elif degradation.kind == "motion":
            blurred = convolve(clean, motion_psf(params["length"], params["angle"]))
            frames = [blurred + rng.normal(0.0, params["sigma"], clean.shape)]
        elif degradation.kind == "defocus":
            blurred = convolve(clean, defocus_psf(params["radius"]))
            frames = [blurred + rng.normal(0.0, params["sigma"], clean.shape)]
        elif degradation.kind == "contrast":
            frames = [clean * params["gain"] + params["lift"] + rng.normal(0.0, 2.0, clean.shape)]
        else:
            frames = []
            shifts = []
            for i in range(params["frames"]):
                dy = float(rng.normal(0.0, params["shift"]))
                dx = float(rng.normal(0.0, params["shift"]))
                shifts.append([round(dy, 4), round(dx, 4)])
                frames.append(shift(clean, dy, dx) + rng.normal(0.0, params["sigma"], clean.shape))
            params = {**params, "shifts": shifts}

        stack = np.clip(np.stack(frames), 0, 255)
        np.save(out_dir / f"{degradation.name}.npy", stack)

        manifest.append(
            {
                "name": degradation.name,
                "file": f"{degradation.name}.npy",
                "detail": degradation.detail,
                "kind": degradation.kind,
                # The true shifts travel with the corpus. Without them the
                # alignment step can only be graded by its effect, and an
                # alignment that is wrong in a way that happens to help is not
                # an alignment.
                "params": params,
                "frames": int(stack.shape[0]),
                "size": [WIDTH, HEIGHT],
            }
        )
        print(f"{degradation.name:<16} {stack.shape[0]:>3} frame(s)  {degradation.detail}")

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


if __name__ == "__main__":
    import sys

    build(Path(sys.argv[1] if len(sys.argv) > 1 else "fis/corpora/out/clarify"))
