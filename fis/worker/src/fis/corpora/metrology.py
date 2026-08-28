"""A scene whose geometry is known exactly, so a measurement can be graded.

Real casework never comes with ground truth, which is exactly why a measurement
tool cannot be validated on it. This renders a street from stated intrinsics and
extrinsics, places objects at stated distances and heights, and writes down what
it did. A metrology operator is then asked to recover those numbers from the
image alone, and it can be wrong in a way that is visible.

Everything is projected through a full pinhole plus Brown-Conrady model, so the
corpus also exercises lens correction: a tool that ignores distortion measures a
1.80 m figure as something else at the edge of frame, and that error is real.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class Camera:
    """A camera looking down a street. Right handed, y down, z forward."""

    width: int
    height: int
    focal_px: float
    height_m: float          # above the ground plane
    tilt_deg: float          # downward from horizontal
    k1: float = 0.0
    k2: float = 0.0
    p1: float = 0.0
    p2: float = 0.0

    @property
    def cx(self) -> float:
        return (self.width - 1) / 2.0

    @property
    def cy(self) -> float:
        return (self.height - 1) / 2.0

    def rotation(self) -> np.ndarray:
        """Camera looks along +Z world with a downward tilt about the X axis."""
        t = np.deg2rad(self.tilt_deg)
        # World: X right, Y up, Z forward. Camera: x right, y down, z forward.
        return np.array(
            [
                [1.0, 0.0, 0.0],
                [0.0, -np.cos(t), -np.sin(t)],
                [0.0, -np.sin(t), np.cos(t)],
            ]
        )

    def project(self, world: np.ndarray) -> np.ndarray:
        """World metres to pixels, with distortion. Points behind the camera are nan."""
        points = np.atleast_2d(np.asarray(world, dtype=np.float64))
        centred = points - np.array([0.0, self.height_m, 0.0])
        camera = centred @ self.rotation().T

        out = np.full((points.shape[0], 2), np.nan)
        in_front = camera[:, 2] > 1e-6
        if not np.any(in_front):
            return out

        z = camera[in_front, 2]
        xn = camera[in_front, 0] / z
        yn = camera[in_front, 1] / z

        r2 = xn * xn + yn * yn
        radial = 1.0 + self.k1 * r2 + self.k2 * r2 * r2
        xd = xn * radial + 2.0 * self.p1 * xn * yn + self.p2 * (r2 + 2.0 * xn * xn)
        yd = yn * radial + self.p1 * (r2 + 2.0 * yn * yn) + 2.0 * self.p2 * xn * yn

        out[in_front, 0] = self.focal_px * xd + self.cx
        out[in_front, 1] = self.focal_px * yd + self.cy
        return out


@dataclass
class Placement:
    label: str
    kind: str
    distance_m: float
    height_m: float
    lateral_m: float


DEFAULT_PLACEMENTS = [
    Placement("reference-pole", "reference", 8.0, 1.800, -1.2),
    Placement("subject-near", "subject", 8.0, 1.755, 0.9),
    Placement("subject-mid", "subject", 15.0, 1.620, 0.4),
    Placement("subject-far", "subject", 25.0, 1.880, -0.5),
]

# Two painted stop lines exactly ten metres apart, for the two line speed check.
SPEED_LINES = (12.0, 22.0)


def render(camera: Camera, placements: list[Placement] | None = None) -> dict:
    """Projects the scene and returns image points beside the truth that made them."""
    placements = placements or DEFAULT_PLACEMENTS

    objects = []
    for placement in placements:
        base = camera.project(np.array([[placement.lateral_m, 0.0, placement.distance_m]]))[0]
        top = camera.project(np.array([[placement.lateral_m, placement.height_m, placement.distance_m]]))[0]
        objects.append(
            {
                "label": placement.label,
                "kind": placement.kind,
                "truth": {"height_m": placement.height_m, "distance_m": placement.distance_m},
                "base_px": [float(base[0]), float(base[1])],
                "top_px": [float(top[0]), float(top[1])],
            }
        )

    # Two sets of parallel ground lines. Their images meet at the two vanishing
    # points that define the horizon, which is what single view metrology needs.
    rails = []
    for lateral in (-3.0, 3.0):
        near = camera.project(np.array([[lateral, 0.0, 6.0]]))[0]
        far = camera.project(np.array([[lateral, 0.0, 60.0]]))[0]
        rails.append({"lateral_m": lateral, "near_px": near.tolist(), "far_px": far.tolist()})

    cross = []
    for distance in SPEED_LINES:
        left = camera.project(np.array([[-3.0, 0.0, distance]]))[0]
        right = camera.project(np.array([[3.0, 0.0, distance]]))[0]
        cross.append({"distance_m": distance, "left_px": left.tolist(), "right_px": right.tolist()})

    # The vertical vanishing point is the image of the direction (0,1,0).
    vertical = _direction_vanishing_point(camera, np.array([0.0, 1.0, 0.0]))

    return {
        "camera": asdict(camera),
        "objects": objects,
        "ground_rails": rails,
        "cross_lines": cross,
        "line_separation_m": SPEED_LINES[1] - SPEED_LINES[0],
        "vertical_vanishing_point_px": vertical,
    }


def _direction_vanishing_point(camera: Camera, direction: np.ndarray) -> list[float]:
    """Where parallel lines in this direction meet, undistorted.

    A vanishing point is the projection of a point at infinity, so distortion,
    which is defined on finite image points, does not apply to it.
    """
    d = camera.rotation() @ (direction / np.linalg.norm(direction))
    if abs(d[2]) < 1e-9:
        return [float("inf"), float("inf")]
    return [float(camera.focal_px * d[0] / d[2] + camera.cx), float(camera.focal_px * d[1] / d[2] + camera.cy)]


CONDITIONS = [
    ("wide_low", Camera(1920, 1080, 1200.0, 4.5, 12.0, k1=-0.14, k2=0.03)),
    ("wide_high", Camera(1920, 1080, 1400.0, 7.0, 18.0, k1=-0.09, k2=0.01)),
    ("tele_low", Camera(1280, 720, 1600.0, 5.0, 9.0, k1=-0.04)),
    ("rectilinear", Camera(1920, 1080, 1300.0, 6.0, 14.0)),
]


def main(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, camera in CONDITIONS:
        scene = render(camera)
        (out_dir / f"{name}.json").write_text(json.dumps(scene, indent=2, sort_keys=True) + "\n")
        print(f"{name}: {len(scene['objects'])} objects, vvp {scene['vertical_vanishing_point_px']}")


if __name__ == "__main__":
    import sys

    main(Path(sys.argv[1] if len(sys.argv) > 1 else "fis/corpora/out/metrology"))
