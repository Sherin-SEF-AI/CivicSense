"""Measurement from images.

Three operators, all class E, all arithmetic. None of them invents anything: they
take points an examiner marked, a reference of stated size, and the geometry of
the scene, and they return a number with an interval and the construction that
produced it.

The interval is the product. A height reported as 1.78 m is worthless in a
proceeding; 1.78 m with a 95 percent interval of 1.74 to 1.82, derived from a
stated pixel localisation error and a stated reference tolerance, is a
measurement someone can cross examine.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

import numpy as np
from pydantic import BaseModel, Field

from fis import geometry
from fis.lens import Lens, undistort
from fis.operators.contract import Class, OpCtx, OperatorError
from fis.operators.registry import operator

Milli = Annotated[int, Field(ge=-100_000_000, le=100_000_000)]


class Point(BaseModel):
    """A marked image point, in thousandths of a pixel."""

    model_config = {"extra": "forbid"}
    x_milli: Milli
    y_milli: Milli

    def as_array(self) -> np.ndarray:
        return np.array([self.x_milli / 1000.0, self.y_milli / 1000.0])


class Segment(BaseModel):
    model_config = {"extra": "forbid"}
    a: Point
    b: Point


class LensModel(BaseModel):
    """The camera's distortion, in the units the calibration produced.

    Optional, and its absence is reported rather than assumed away. A wide lens
    displaces a point near the frame edge by tens of pixels, and a construction
    fed those pixels returns a confident wrong height with an interval that does
    not contain the truth.
    """

    model_config = {"extra": "forbid"}
    focal_milli_px: Annotated[int, Field(ge=1_000, le=100_000_000)]
    cx_milli: Milli
    cy_milli: Milli
    k1_nano: Annotated[int, Field(ge=-2_000_000_000, le=2_000_000_000)] = 0
    k2_nano: Annotated[int, Field(ge=-2_000_000_000, le=2_000_000_000)] = 0
    k3_nano: Annotated[int, Field(ge=-2_000_000_000, le=2_000_000_000)] = 0
    p1_nano: Annotated[int, Field(ge=-2_000_000_000, le=2_000_000_000)] = 0
    p2_nano: Annotated[int, Field(ge=-2_000_000_000, le=2_000_000_000)] = 0

    def as_lens(self) -> Lens:
        return Lens(
            focal_px=self.focal_milli_px / 1000.0,
            cx=self.cx_milli / 1000.0,
            cy=self.cy_milli / 1000.0,
            k1=self.k1_nano / 1e9,
            k2=self.k2_nano / 1e9,
            k3=self.k3_nano / 1e9,
            p1=self.p1_nano / 1e9,
            p2=self.p2_nano / 1e9,
        )


class SingleViewParams(BaseModel):
    """Everything the Criminisi construction needs, stated explicitly."""

    model_config = {"extra": "forbid"}
    # Two or more sets of parallel ground lines fix the vanishing line.
    ground_rails: Annotated[list[Segment], Field(min_length=2, max_length=8)]
    vertical_vanishing_point: Point
    reference_base: Point
    reference_top: Point
    reference_height_mm: Annotated[int, Field(ge=100, le=10_000)]
    # The tolerance on the reference itself. A doorway measured with a tape has
    # one; a "standard" doorway assumed from a building code has a much larger
    # one, and pretending otherwise is where single view metrology goes wrong.
    reference_tolerance_mm: Annotated[int, Field(ge=0, le=1000)] = 10
    query_base: Point
    query_top: Point
    # How well a person can place a click on this footage. Not a constant: a
    # sharp daylight frame is under a pixel, a smeared night frame is several.
    pixel_sigma_milli: Annotated[int, Field(ge=100, le=20_000)] = 1_500
    lens: LensModel | None = None


def _height_from_marks(state: np.ndarray, n_rails: int, reference_height_m: float) -> float:
    """The construction, evaluated end to end on one perturbed set of marks.

    The horizon and the vanishing point are rebuilt here rather than passed in,
    which is the whole point. An earlier version took the vanishing point as
    fixed and inflated its uncertainty by a made up multiplier. That is the same
    mistake as a magic divisor: a number with no derivation standing in for one
    that has a perfectly good derivation. Perturbing the marks and rebuilding
    the construction gives the vanishing point exactly the uncertainty its own
    inputs imply, no more and no less.
    """
    offset = 0
    qb, qt = state[0:2], state[2:4]
    rb, rt = state[4:6], state[6:8]
    offset = 8

    rails: list[tuple[np.ndarray, np.ndarray]] = []
    for _ in range(n_rails):
        rails.append((state[offset : offset + 2], state[offset + 2 : offset + 4]))
        offset += 4

    v = state[offset : offset + 2]

    try:
        line, _ = geometry.horizon_from_rails(rails)
    except (ValueError, np.linalg.LinAlgError):
        return float("nan")

    def scaled(base: np.ndarray, top: np.ndarray) -> float:
        b = np.append(base, 1.0)
        t = np.append(top, 1.0)
        vh = np.append(v, 1.0)
        denominator = float(np.dot(line, b)) * float(np.linalg.norm(np.cross(vh, t)))
        if abs(denominator) < 1e-12:
            return float("nan")
        return -float(np.linalg.norm(np.cross(b, t))) / denominator

    reference = scaled(rb, rt)
    query = scaled(qb, qt)
    if not np.isfinite(reference) or abs(reference) < 1e-12 or not np.isfinite(query):
        return float("nan")
    return reference_height_m * (query / reference)


@operator(
    id="V-MET-1",
    version="1.0.0",
    cls=Class.E,
    params=SingleViewParams,
    inputs=("marks/points",),
    outputs=("measurement/height",),
    runtime="operator-base",
    summary="height from a single view by vanishing line construction, with the interval and the figure",
)
def single_view_height(ctx: OpCtx, inputs: dict[str, Any], params: SingleViewParams) -> bytes:
    lens = params.lens.as_lens() if params.lens else None

    def mark(point: Point) -> np.ndarray:
        raw = point.as_array()
        return undistort(lens, raw[None, :])[0] if lens else raw

    reference_height_m = params.reference_height_mm / 1000.0
    pixel_sigma = params.pixel_sigma_milli / 1000.0

    marks = [mark(params.query_base), mark(params.query_top), mark(params.reference_base), mark(params.reference_top)]
    for segment in params.ground_rails:
        marks.extend([mark(segment.a), mark(segment.b)])
    # The vertical vanishing point is not corrected. It is the image of a point
    # at infinity, so it is already an ideal coordinate; putting it through a
    # distortion model defined on finite image points is meaningless, and on a
    # point thousands of pixels outside the frame the polynomial diverges.
    marks.append(params.vertical_vanishing_point.as_array())

    mean = np.concatenate(marks)
    # Every element of the state is a marked image point, so every element
    # carries the same marking error. No term needs a multiplier.
    sigma = np.full(mean.size, pixel_sigma)

    n_rails = len(params.ground_rails)
    value, spread = geometry.propagate(
        lambda state: _height_from_marks(state, n_rails, reference_height_m), mean, sigma
    )

    if not np.isfinite(value):
        raise OperatorError(
            "construction_degenerate",
            "the marked points put the construction on the horizon, so no height can be recovered from them",
        )

    reference_relative = params.reference_tolerance_mm / max(1.0, params.reference_height_mm)
    total = float(np.hypot(spread, abs(value) * reference_relative))

    line, _ = geometry.horizon_from_rails(
        [(mark(segment.a), mark(segment.b)) for segment in params.ground_rails]
    )

    caveats = [
        "the reference height and its tolerance are inputs, not measurements. an assumed reference makes this an estimate.",
        "the interval widens with distance because the construction is nearer the horizon there, which is a property of the geometry and not of the tool.",
    ]
    if lens is None:
        caveats.insert(
            0,
            "no lens model was supplied, so the marks were treated as ideal pinhole coordinates. "
            "on a wide lens this biases the result by more than the interval reports.",
        )

    result = {
        "quantity": "height",
        "unit": "m",
        "value": round(value, 4),
        "sigma": round(total, 4),
        "interval_95": [round(value - 1.96 * total, 4), round(value + 1.96 * total, 4)],
        "interval_width": round(2 * 1.96 * total, 4),
        "construction": {
            "method": "criminisi-reid-zisserman cross ratio",
            "vanishing_line": [round(float(c), 8) for c in line],
            "reference_height_m": reference_height_m,
            "reference_tolerance_m": params.reference_tolerance_mm / 1000.0,
            "pixel_sigma_px": pixel_sigma,
            "geometric_sigma_m": round(spread, 4),
            "reference_sigma_m": round(abs(value) * reference_relative, 4),
            "lens_corrected": lens is not None,
            "rails_used": n_rails,
        },
        "caveats": caveats,
    }
    return json.dumps(result, sort_keys=True, separators=(",", ":")).encode()


class TwoLineSpeedParams(BaseModel):
    """The manual cross check on the kinematics engine.

    It exists so that a person can verify an automated speed in front of a
    magistrate with arithmetic they can follow: two lines, a known separation,
    two crossing times.
    """

    model_config = {"extra": "forbid"}
    separation_mm: Annotated[int, Field(ge=500, le=1_000_000)]
    separation_tolerance_mm: Annotated[int, Field(ge=0, le=10_000)] = 50
    first_crossing_ms: Annotated[int, Field(ge=0)]
    second_crossing_ms: Annotated[int, Field(ge=0)]
    # One frame either side is the least a person can resolve by stepping.
    timing_sigma_ms: Annotated[int, Field(ge=1, le=5_000)] = 40


@operator(
    id="V-MET-4",
    version="1.0.0",
    cls=Class.E,
    params=TwoLineSpeedParams,
    inputs=("marks/crossings",),
    outputs=("measurement/speed",),
    runtime="operator-base",
    summary="speed between two marked lines of known separation, arithmetic a person can follow",
)
def two_line_speed(ctx: OpCtx, inputs: dict[str, Any], params: TwoLineSpeedParams) -> bytes:
    dt_ms = params.second_crossing_ms - params.first_crossing_ms
    if dt_ms <= 0:
        raise OperatorError("crossings_out_of_order", "the second crossing must be after the first")

    distance_m = params.separation_mm / 1000.0
    dt_s = dt_ms / 1000.0
    speed_ms = distance_m / dt_s

    # Two independent contributions: how well the lines were surveyed, and how
    # well the crossing frames were identified. Timing dominates at speed.
    distance_rel = params.separation_tolerance_mm / max(1.0, params.separation_mm)
    # Two crossings, each uncertain, so the interval on the difference is sqrt(2)
    # times the per-crossing sigma.
    timing_rel = (params.timing_sigma_ms * np.sqrt(2.0)) / dt_ms
    relative = float(np.hypot(distance_rel, timing_rel))

    kmh = speed_ms * 3.6
    sigma_kmh = kmh * relative

    result = {
        "quantity": "speed",
        "unit": "km/h",
        "value": round(kmh, 3),
        "sigma": round(sigma_kmh, 3),
        "interval_95": [round(kmh - 1.96 * sigma_kmh, 3), round(kmh + 1.96 * sigma_kmh, 3)],
        "working": {
            "separation_m": distance_m,
            "elapsed_s": round(dt_s, 4),
            "speed_m_s": round(speed_ms, 4),
            "distance_contribution": round(distance_rel, 6),
            "timing_contribution": round(timing_rel, 6),
        },
        "caveats": [
            "this measures the average speed between the two lines, not the speed at any instant within them.",
            "the timing term dominates at speed: at 60 km/h over 10 m the crossings are 600 ms apart, so a 40 ms frame ambiguity is about 9 percent.",
        ],
    }
    return json.dumps(result, sort_keys=True, separators=(",", ":")).encode()
