"""What a source's clock reading means in true time, and how well it is known.

Every device has its own clock and every one of them is wrong. A forensic record
cannot answer "what did the timestamp say", which is trivial and useless; it has
to answer "what true time was that, and within what". Those are different
questions and only the second can be cross examined.

Three commitments shape this.

Raw timestamps are never edited. An observation records the relationship between
a source's clock and true time at a moment, and models are fitted from those. A
correction stays visible and reversible, and a later, better observation improves
the answer instead of compounding an earlier adjustment.

A model holds over a span and no further. A reboot, a manual set or an NTP step
ends one segment and begins another, because fitting across such a break gives a
drift rate that describes the step rather than the oscillator.

Uncertainty grows with distance from the evidence. A source last observed six
hours ago is not known to five milliseconds, however good that observation was,
and a model that says otherwise is the most dangerous kind of wrong: precise and
unjustified.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

# Above this two sources cannot be placed on one timeline at all. The answer is
# a refusal rather than a very wide number, because a wide number invites a
# reader to take its midpoint.
ORDER_ONLY_MS = 500.0
# Below this the pair can be treated as simultaneous for anything this system
# measures.
TIGHT_MS = 50.0

# How far a fitted model is trusted beyond its own observations before its
# uncertainty is dominated by the extrapolation. A cheap oscillator wanders by
# roughly this much per second of unobserved time.
FREE_RUNNING_PPM = 20.0


@dataclass(frozen=True)
class Observation:
    t_source_ms: float
    t_utc_ms: float
    sigma_ms: float
    method: str = "manual"


@dataclass
class Segment:
    seq: int
    t_from_ms: float
    t_to_ms: float
    offset_ms: float
    drift_ppm: float
    offset_se_ms: float
    drift_se_ppm: float
    n_obs: int
    residual_ms: float
    drift_measurable: bool
    # Parameter covariance, kept so a prediction can carry its own uncertainty
    # rather than being compared against the residual alone.
    covariance: Any = None


@dataclass
class Resolved:
    t_utc_ms: float
    sigma_ms: float
    method: str
    grade: str
    extrapolated_s: float
    refused: str | None = None


def _fit_one(observations: list[Observation], seq: int) -> Segment:
    """Weighted least squares of true time against source time.

    The independent variable is the source's own clock reading and the
    dependent one is the error, so the intercept is the offset at the segment's
    start and the slope is the drift rate. Weights are the inverse variance of
    each observation, which is what lets a single GNSS fix outweigh a hundred
    guesses.
    """
    t_source = np.array([o.t_source_ms for o in observations], dtype=np.float64)
    error = np.array([o.t_utc_ms - o.t_source_ms for o in observations], dtype=np.float64)
    sigma = np.array([o.sigma_ms for o in observations], dtype=np.float64)

    origin = float(t_source[0])
    x = (t_source - origin) / 1000.0  # seconds, so the slope is a rate
    w = 1.0 / np.maximum(sigma, 1e-6) ** 2

    if x.size < 2 or float(np.ptp(x)) < 1e-9:
        # One observation, or several at the same instant. An offset can be
        # measured; a rate cannot.
        offset = float(np.sum(w * error) / np.sum(w))
        se = float(np.sqrt(1.0 / np.sum(w)))
        return Segment(
            seq, origin, float(t_source[-1]), offset, 0.0, se, 0.0, len(observations), 0.0, False,
            np.array([[se**2, 0.0], [0.0, 0.0]]),
        )

    design = np.stack([np.ones_like(x), x], axis=1)
    wd = design * w[:, None]
    normal = design.T @ wd
    try:
        covariance = np.linalg.inv(normal)
    except np.linalg.LinAlgError:
        covariance = np.linalg.pinv(normal)
    beta = covariance @ (wd.T @ error)

    predicted = design @ beta
    residual = float(np.sqrt(np.mean((error - predicted) ** 2)))

    offset_se = float(np.sqrt(max(covariance[0, 0], 0.0)))
    # The slope is milliseconds of error per second of elapsed time, which is
    # parts per thousand; ppm is the conventional unit.
    drift_ppm = float(beta[1]) * 1000.0
    drift_se_ppm = float(np.sqrt(max(covariance[1, 1], 0.0))) * 1000.0

    # A rate is only claimed when the span is long enough for it to show above
    # the noise of the observations it was fitted from.
    span_s = float(x[-1] - x[0])
    resolvable_ppm = (2.0 * float(np.median(sigma)) / max(span_s, 1e-9)) * 1000.0
    measurable = abs(drift_ppm) > max(resolvable_ppm, 2.0 * drift_se_ppm)

    return Segment(
        seq=seq,
        t_from_ms=origin,
        t_to_ms=float(t_source[-1]),
        offset_ms=float(beta[0]),
        drift_ppm=drift_ppm if measurable else 0.0,
        offset_se_ms=offset_se,
        drift_se_ppm=drift_se_ppm,
        n_obs=len(observations),
        residual_ms=residual,
        drift_measurable=measurable,
        covariance=covariance,
    )


# How many observations a fit needs before it is trusted to predict the next
# one. Three points determine a line exactly, so their fit has no residual and
# extrapolates confidently in the wrong direction; using it to judge a break
# split a perfectly smooth clock in two.
MIN_FOR_BREAK_TEST = 6

# How many standard deviations of prediction error count as a step. A reboot or
# a manual set moves a clock by orders of magnitude more than this, so the exact
# value is not delicate; what matters is that the deviation is measured against
# the prediction's own uncertainty rather than against a fixed millisecond count.
BREAK_SIGMAS = 6.0


def segment(observations: list[Observation]) -> list[Segment]:
    """Splits the history wherever the clock was stepped, then fits each part.

    Detection compares each observation against what the model fitted so far
    predicts for it, in units of that prediction's own uncertainty. That last
    part is the whole difficulty. A fit from a handful of noisy points has a
    slope known only vaguely, so it extrapolates badly, and judging a break by
    the residual alone reads that as a step: an earlier version split a clock
    that never jumped and found five breaks in a clock that jumped once.

    A reboot or a manual set moves a clock by far more than any prediction
    uncertainty. An oscillator drifting does not. That is the distinction, and
    measuring it in the right units is what separates them.
    """
    if not observations:
        return []

    ordered = sorted(observations, key=lambda o: o.t_source_ms)
    segments: list[Segment] = []
    current: list[Observation] = []

    for observation in ordered:
        if len(current) < MIN_FOR_BREAK_TEST:
            current.append(observation)
            continue

        provisional = _fit_one(current, len(segments))
        elapsed_s = (observation.t_source_ms - provisional.t_from_ms) / 1000.0
        predicted = provisional.offset_ms + provisional.drift_ppm / 1000.0 * elapsed_s
        actual = observation.t_utc_ms - observation.t_source_ms

        # The variance of the prediction itself at this point, from the fit's
        # parameter covariance, plus the new observation's own uncertainty and
        # the scatter the segment already shows.
        basis = np.array([1.0, elapsed_s])
        prediction_var = float(basis @ provisional.covariance @ basis) if provisional.covariance is not None else 0.0
        scale = float(np.sqrt(prediction_var + observation.sigma_ms**2 + provisional.residual_ms**2))

        if abs(actual - predicted) > BREAK_SIGMAS * max(scale, 1e-6):
            segments.append(provisional)
            current = [observation]
        else:
            current.append(observation)

    if current:
        if segments and len(current) < 3:
            # A tail too short to fit is kept with the segment before it rather
            # than becoming a model of its own with no evidence behind it.
            merged = segments.pop()
            segments.append(_fit_one(current, merged.seq))
        else:
            segments.append(_fit_one(current, len(segments)))
    return segments


def resolve(segments: list[Segment], t_source_ms: float) -> Resolved:
    """Maps a source clock reading to true time, with the uncertainty it earns."""
    if not segments:
        return Resolved(t_source_ms, float("inf"), "none", "D", 0.0, refused="no_clock_model")

    # The segment covering this time, or the nearest one if it falls outside all
    # of them, which is the ordinary case for a reading taken after the last
    # sync observation.
    inside = [s for s in segments if s.t_from_ms <= t_source_ms <= s.t_to_ms]
    chosen = inside[0] if inside else min(segments, key=lambda s: min(abs(t_source_ms - s.t_from_ms), abs(t_source_ms - s.t_to_ms)))

    elapsed_s = (t_source_ms - chosen.t_from_ms) / 1000.0
    correction = chosen.offset_ms + chosen.drift_ppm / 1000.0 * elapsed_s

    # How far outside the fitted span this reading sits. Everything inside is
    # interpolation and cheap; everything outside is extrapolation and is not.
    if chosen.t_from_ms <= t_source_ms <= chosen.t_to_ms:
        extrapolated_s = 0.0
    else:
        extrapolated_s = (
            abs(t_source_ms - chosen.t_to_ms) if t_source_ms > chosen.t_to_ms else abs(chosen.t_from_ms - t_source_ms)
        ) / 1000.0

    # Three contributions. The fit's own standard error; the drift term's error
    # multiplied by however long it has been applied for; and, past the end of
    # the observations, the oscillator running free.
    from_fit = chosen.offset_se_ms
    from_drift = chosen.drift_se_ppm / 1000.0 * abs(elapsed_s)
    from_free_running = FREE_RUNNING_PPM / 1000.0 * extrapolated_s

    sigma = float(np.sqrt(from_fit**2 + from_drift**2 + from_free_running**2 + chosen.residual_ms**2))

    grade = "A" if sigma <= 20 else "B" if sigma <= TIGHT_MS else "C" if sigma <= ORDER_ONLY_MS else "D"
    refused = "timebase_sigma_exceeded" if sigma > ORDER_ONLY_MS else None

    return Resolved(
        t_utc_ms=t_source_ms + correction,
        sigma_ms=sigma,
        method="fitted",
        grade=grade,
        extrapolated_s=round(extrapolated_s, 3),
        refused=refused,
    )


def pair_sigma(a: Resolved, b: Resolved) -> dict[str, Any]:
    """Whether two sources can be placed on one timeline, and how tightly.

    The degradation ladder is enforced here rather than displayed. Above the
    threshold the answer is that the pair can only be ordered, and any cross
    source measurement between them is refused: a very wide interval would be
    quoted by its midpoint.
    """
    if a.refused or b.refused:
        return {
            "usable": False,
            "mode": "refused",
            "sigma_ms": None,
            "detail": f"one of the sources has no usable clock model ({a.refused or b.refused})",
        }

    combined = float(np.hypot(a.sigma_ms, b.sigma_ms))

    if combined <= TIGHT_MS:
        mode, detail = "simultaneous", "the pair can be treated as simultaneous for anything measured here"
    elif combined <= ORDER_ONLY_MS:
        mode, detail = (
            "widened",
            "the pair is usable, and every time derived interval between them is widened by this amount",
        )
    else:
        return {
            "usable": False,
            "mode": "order_only",
            "sigma_ms": round(combined, 2),
            "detail": (
                f"combined clock uncertainty is {combined:.0f} ms, so these two sources can only be put in order. "
                "cross source kinematics between them is refused rather than reported with an interval "
                "wide enough to be quoted by its midpoint."
            ),
        }

    return {"usable": True, "mode": mode, "sigma_ms": round(combined, 2), "detail": detail}
