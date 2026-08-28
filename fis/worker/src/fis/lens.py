"""The lens model.

Every measurement in this suite assumes a pinhole camera, and no real camera is
one. A wide lens moves a point near the edge of frame by tens of pixels, and a
metrology construction fed those pixels returns a confident, wrong number: in
testing, a 1.62 m subject measured as 1.68 m on a lens with k1 = -0.09, with an
interval that did not contain the truth. The interval was honest about the
marking error and silent about the lens, which is the worst combination.

So distortion is corrected before any construction, and an operator that is not
told the lens model says so on its own output rather than quietly assuming a
pinhole.

Brown-Conrady, radial to the third order plus tangential, which is the model
OpenCV calibration produces and therefore the one a deployment will actually
have.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Lens:
    focal_px: float
    cx: float
    cy: float
    k1: float = 0.0
    k2: float = 0.0
    k3: float = 0.0
    p1: float = 0.0
    p2: float = 0.0

    @property
    def is_pinhole(self) -> bool:
        return all(abs(c) < 1e-12 for c in (self.k1, self.k2, self.k3, self.p1, self.p2))


def distort(lens: Lens, normalised: np.ndarray) -> np.ndarray:
    """Applies the model to normalised image coordinates."""
    x = normalised[..., 0]
    y = normalised[..., 1]
    r2 = x * x + y * y
    radial = 1.0 + lens.k1 * r2 + lens.k2 * r2 * r2 + lens.k3 * r2 * r2 * r2
    xd = x * radial + 2.0 * lens.p1 * x * y + lens.p2 * (r2 + 2.0 * x * x)
    yd = y * radial + lens.p1 * (r2 + 2.0 * y * y) + 2.0 * lens.p2 * x * y
    return np.stack([xd, yd], axis=-1)


def undistort(lens: Lens, pixels: np.ndarray, iterations: int = 20) -> np.ndarray:
    """Recovers ideal pinhole pixels from distorted ones.

    The forward model has no closed form inverse, so this iterates. The count is
    fixed rather than driven by a tolerance: stopping on a threshold turns a
    difference in the last bit into a whole extra iteration and a different
    answer, which is exactly the nondeterminism a class E operator must not
    have. Twenty steps converges to well under a thousandth of a pixel for any
    coefficient a real lens has.
    """
    pixels = np.atleast_2d(np.asarray(pixels, dtype=np.float64))
    if lens.is_pinhole:
        return pixels.copy()

    normalised = np.stack(
        [(pixels[..., 0] - lens.cx) / lens.focal_px, (pixels[..., 1] - lens.cy) / lens.focal_px], axis=-1
    )

    # The model is a polynomial in the radius, so it diverges violently outside
    # the image. A caller that hands it a vanishing point, which lives far
    # outside the frame by construction, gets a clear refusal rather than an
    # overflow. Vanishing points are already ideal coordinates: they are the
    # images of points at infinity, and a distortion model defined on finite
    # image points does not apply to them.
    if np.max(np.abs(normalised)) > 8.0:
        raise ValueError(
            "a point more than eight focal lengths off axis was passed to undistort. "
            "vanishing points are already ideal and must not be undistorted."
        )

    guess = normalised.copy()
    for _ in range(iterations):
        guess = guess - (distort(lens, guess) - normalised)

    return np.stack([guess[..., 0] * lens.focal_px + lens.cx, guess[..., 1] * lens.focal_px + lens.cy], axis=-1)
