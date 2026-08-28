"""Projective geometry helpers, and a deterministic way to carry uncertainty.

The uncertainty part matters as much as the geometry. A height with no interval
is not a measurement, it is an assertion, and in this product an assertion
without its error bar is exactly the thing we refuse to produce.

Propagation is done with a fixed sigma point set rather than by sampling. Random
sampling would need a seed, would be flagged by the operator lint, and would put
a random number generator inside an evidentiary path for no benefit. A symmetric
sigma point set is deterministic, needs 2n+1 evaluations, and unlike a first
order Jacobian it survives the nonlinearity of a cross ratio near the horizon,
which is precisely where these measurements get hard.
"""

from __future__ import annotations

from typing import Callable

import numpy as np


def homogeneous(points: np.ndarray) -> np.ndarray:
    points = np.atleast_2d(np.asarray(points, dtype=np.float64))
    return np.hstack([points, np.ones((points.shape[0], 1))])


def line_through(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """The line joining two image points, as a homogeneous 3 vector."""
    return np.cross(np.append(np.asarray(a, dtype=np.float64), 1.0), np.append(np.asarray(b, dtype=np.float64), 1.0))


def intersect_h(l1: np.ndarray, l2: np.ndarray) -> np.ndarray:
    """Where two image lines meet, kept homogeneous and unit scaled.

    Homogeneous because the answer is often a point at infinity and that is not
    an error. Two lines painted across a road are parallel to each other on the
    ground, so their images meet at infinity whenever the camera has no roll,
    which is most fixed cameras. Dehomogenising there yields inf and poisons
    everything downstream: the horizon it helps define comes out wrong, and the
    error then cancels for any object at the reference's own distance and grows
    with the difference. That failure is invisible on a bench test where
    everything sits at one depth.
    """
    p = np.cross(l1, l2)
    norm = np.linalg.norm(p)
    if norm < 1e-12:
        raise ValueError("the two lines are the same line, so they do not define a point")
    return p / norm


def intersect(l1: np.ndarray, l2: np.ndarray) -> np.ndarray:
    """The affine intersection, for callers that need pixels. inf when at infinity."""
    p = intersect_h(l1, l2)
    if abs(p[2]) < 1e-12:
        return np.array([np.inf, np.inf])
    return np.array([p[0] / p[2], p[1] / p[2]])


def horizon_from_rails(rails: list[tuple[np.ndarray, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    """The ground plane's vanishing line from two or more sets of parallel lines.

    Returns the line and the vanishing point of the first set. With exactly two
    sets the line is determined; with more it is fitted, and the residual is
    what tells an examiner whether the construction is trustworthy.
    """
    if len(rails) < 2:
        raise ValueError("two sets of parallel ground lines are needed to fix the horizon")

    points = []
    for i in range(0, len(rails) - 1, 2):
        a = line_through(*rails[i])
        b = line_through(*rails[i + 1])
        points.append(intersect_h(a, b))

    if len(points) == 1:
        # One vanishing point alone does not fix a line. A horizontal horizon
        # through it is an assumption, and it is recorded as one.
        vp = points[0]
        affine = vp[:2] / vp[2] if abs(vp[2]) > 1e-12 else np.array([np.inf, np.inf])
        return np.array([0.0, 1.0, -affine[1]]), affine

    if len(points) == 2:
        # Exact, and it handles a vanishing point at infinity without a special
        # case, which the least squares path below does not.
        line = np.cross(points[0], points[1])
    else:
        _, _, vt = np.linalg.svd(np.array(points))
        line = vt[-1]

    line = line / np.linalg.norm(line[:2]) if np.linalg.norm(line[:2]) > 1e-12 else line
    first = points[0]
    affine = first[:2] / first[2] if abs(first[2]) > 1e-12 else np.array([np.inf, np.inf])
    return line, affine


# A symmetric sigma point set: the mean, then plus and minus one standard
# deviation along each input dimension, scaled so the set has the right second
# moment for an uncorrelated Gaussian.
def sigma_points(mean: np.ndarray, sigma: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    n = mean.size
    kappa = 3.0 - n
    scale = np.sqrt(max(n + kappa, 1e-9))

    points = np.zeros((2 * n + 1, n))
    weights = np.zeros(2 * n + 1)

    points[0] = mean
    weights[0] = kappa / (n + kappa) if (n + kappa) != 0 else 0.0
    for i in range(n):
        step = np.zeros(n)
        step[i] = scale * sigma[i]
        points[1 + i] = mean + step
        points[1 + n + i] = mean - step
        weights[1 + i] = weights[1 + n + i] = 1.0 / (2.0 * (n + kappa))

    weights /= weights.sum()
    return points, weights


def propagate(
    fn: Callable[[np.ndarray], float],
    mean: np.ndarray,
    sigma: np.ndarray,
) -> tuple[float, float]:
    """Pushes an input distribution through a scalar function.

    Returns the transformed mean and standard deviation. Evaluations that are not
    finite, which is what happens when a perturbation puts a construction point
    on the horizon, are dropped and their weight redistributed, because a single
    infinity would otherwise swallow the whole estimate.
    """
    points, weights = sigma_points(mean, sigma)
    values = np.array([fn(point) for point in points], dtype=np.float64)

    finite = np.isfinite(values)
    if not finite.any():
        return float("nan"), float("nan")

    w = weights[finite]
    w = w / w.sum()
    v = values[finite]

    mean_out = float(np.sum(w * v))
    variance = float(np.sum(w * (v - mean_out) ** 2))
    return mean_out, float(np.sqrt(max(variance, 0.0)))
