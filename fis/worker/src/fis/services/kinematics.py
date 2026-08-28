"""Speed and acceleration from ground-plane positions.

The naive method is to divide the distance between consecutive positions by the
time between them. It is correct arithmetic and it is unusable on real tracks: a
position uncertain by 0.6 m sampled at 10 Hz gives a speed uncertain by roughly
30 km/h per sample, and the resulting series bears no relation to what the
vehicle did. Widening the interval to cover that honestly produces a number too
wide to say anything with.

A constant acceleration Kalman filter uses every sample to constrain every
other, so the position error averages down instead of being differentiated up.
Running a Rauch-Tung-Striebel smoother backwards over the result uses the future
as well as the past, which matters at exactly the moments that are interesting:
the speed at the instant of braking is constrained by what happened after it.

Two properties are treated as non-negotiable.

The covariance is carried from the source record, not chosen. Position noise
comes from the calibration residual the device reported, and timing noise from
the clock model, mapped into position through the current speed estimate. A site
that has not been calibrated gets wide intervals and says so.

The filter refuses rather than guessing. Above the sync threshold there is no
useful answer, and a very wide number is worse than a refusal because someone
will quote the midpoint of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

# Above this the timestamps cannot support a cross source measurement at all.
SYNC_REFUSAL_MS = 500.0

# How much a vehicle's acceleration is allowed to change per second. This is the
# process model, and it is a statement about vehicles rather than about maths: a
# car can go from cruising to emergency braking in well under a second, so the
# filter must not be so confident in constant acceleration that it lags through
# the one event anybody cares about.
JERK_SIGMA = 4.0


@dataclass
class Track:
    t_ms: np.ndarray
    x_m: np.ndarray
    y_m: np.ndarray
    residual_m: float
    sync_sigma_ms: float


@dataclass
class Estimate:
    t_ms: np.ndarray
    speed_kmh: np.ndarray
    speed_sigma_kmh: np.ndarray
    accel_ms2: np.ndarray
    accel_sigma_ms2: np.ndarray
    grade: str
    refused: str | None = None


def _matrices(dt: float) -> tuple[np.ndarray, np.ndarray]:
    """Constant acceleration transition, and the noise a change in jerk implies."""
    f = np.eye(6)
    f[0, 2] = f[1, 3] = dt
    f[0, 4] = f[1, 5] = 0.5 * dt * dt
    f[2, 4] = f[3, 5] = dt

    # Discrete white noise jerk, per axis. The block structure is the standard
    # integral of the continuous model and is written out so the assumption is
    # visible rather than hidden in a library call.
    q1 = np.array(
        [
            [dt**5 / 20.0, dt**4 / 8.0, dt**3 / 6.0],
            [dt**4 / 8.0, dt**3 / 3.0, dt**2 / 2.0],
            [dt**3 / 6.0, dt**2 / 2.0, dt],
        ]
    ) * (JERK_SIGMA**2)

    q = np.zeros((6, 6))
    for axis in range(2):
        index = [axis, 2 + axis, 4 + axis]
        for i, ri in enumerate(index):
            for j, rj in enumerate(index):
                q[ri, rj] = q1[i, j]
    return f, q


def estimate(track: Track) -> Estimate:
    n = track.t_ms.size
    if n < 4:
        return Estimate(
            track.t_ms, np.array([]), np.array([]), np.array([]), np.array([]), "D",
            refused="too_few_samples",
        )

    if track.sync_sigma_ms > SYNC_REFUSAL_MS:
        # Not a wide answer. No answer, with the reason.
        return Estimate(
            track.t_ms, np.array([]), np.array([]), np.array([]), np.array([]), "D",
            refused="timebase_sigma_exceeded",
        )

    order = np.argsort(track.t_ms)
    t = track.t_ms[order] / 1000.0
    z = np.stack([track.x_m[order], track.y_m[order]], axis=1)

    h = np.zeros((2, 6))
    h[0, 0] = h[1, 1] = 1.0

    # State is x, y, vx, vy, ax, ay. The initial guess comes from the first two
    # samples, with a covariance wide enough that it is not believed.
    state = np.zeros(6)
    state[0:2] = z[0]
    dt0 = max(1e-3, t[1] - t[0])
    state[2:4] = (z[1] - z[0]) / dt0

    covariance = np.diag([
        track.residual_m**2, track.residual_m**2,
        (2 * track.residual_m / dt0) ** 2, (2 * track.residual_m / dt0) ** 2,
        50.0, 50.0,
    ])

    filtered_states = np.zeros((n, 6))
    filtered_covs = np.zeros((n, 6, 6))
    predicted_states = np.zeros((n, 6))
    predicted_covs = np.zeros((n, 6, 6))
    transitions = np.zeros((n, 6, 6))

    for i in range(n):
        if i == 0:
            predicted_states[i] = state
            predicted_covs[i] = covariance
            transitions[i] = np.eye(6)
        else:
            dt = max(1e-3, t[i] - t[i - 1])
            f, q = _matrices(dt)
            transitions[i] = f
            state = f @ state
            covariance = f @ covariance @ f.T + q
            predicted_states[i] = state
            predicted_covs[i] = covariance

        # Measurement noise. The calibration residual is the position part; the
        # clock error becomes a position error through the current speed, which
        # is why a fast vehicle on a badly synced camera is less certain than a
        # slow one on the same camera.
        speed_now = float(np.hypot(state[2], state[3]))
        timing_position_sigma = speed_now * (track.sync_sigma_ms / 1000.0)
        r = np.eye(2) * (track.residual_m**2 + timing_position_sigma**2)

        innovation = z[i] - h @ state
        s = h @ covariance @ h.T + r
        gain = covariance @ h.T @ np.linalg.inv(s)
        state = state + gain @ innovation
        covariance = (np.eye(6) - gain @ h) @ covariance

        filtered_states[i] = state
        filtered_covs[i] = covariance

    # Rauch-Tung-Striebel: sweep backwards so every estimate uses the whole
    # track, not only its past.
    smoothed_states = filtered_states.copy()
    smoothed_covs = filtered_covs.copy()
    for i in range(n - 2, -1, -1):
        f = transitions[i + 1]
        predicted_cov = predicted_covs[i + 1]
        gain = filtered_covs[i] @ f.T @ np.linalg.pinv(predicted_cov)
        smoothed_states[i] = filtered_states[i] + gain @ (smoothed_states[i + 1] - predicted_states[i + 1])
        smoothed_covs[i] = filtered_covs[i] + gain @ (smoothed_covs[i + 1] - predicted_cov) @ gain.T

    vx, vy = smoothed_states[:, 2], smoothed_states[:, 3]
    speed_ms = np.hypot(vx, vy)

    # The variance of a magnitude, propagated through the direction the velocity
    # actually points. Summing the component variances would overstate it.
    speed_var = np.zeros(n)
    accel_var = np.zeros(n)
    for i in range(n):
        magnitude = max(speed_ms[i], 1e-6)
        jacobian = np.array([vx[i] / magnitude, vy[i] / magnitude])
        speed_var[i] = float(jacobian @ smoothed_covs[i][2:4, 2:4] @ jacobian)

        ax, ay = smoothed_states[i, 4], smoothed_states[i, 5]
        accel_magnitude = max(float(np.hypot(ax, ay)), 1e-6)
        aj = np.array([ax / accel_magnitude, ay / accel_magnitude])
        accel_var[i] = float(aj @ smoothed_covs[i][4:6, 4:6] @ aj)

    # Along-track acceleration, signed. The magnitude alone cannot distinguish
    # braking from accelerating, and braking is the thing being asked about.
    direction = np.stack([vx / np.maximum(speed_ms, 1e-6), vy / np.maximum(speed_ms, 1e-6)], axis=1)
    accel_along = np.sum(smoothed_states[:, 4:6] * direction, axis=1)

    grade = (
        "A" if track.sync_sigma_ms <= 20 and track.residual_m <= 0.3
        else "B" if track.sync_sigma_ms <= 50 and track.residual_m <= 1.0
        else "C" if track.sync_sigma_ms <= SYNC_REFUSAL_MS
        else "D"
    )

    return Estimate(
        t_ms=track.t_ms[order],
        speed_kmh=speed_ms * 3.6,
        speed_sigma_kmh=np.sqrt(np.maximum(speed_var, 0.0)) * 3.6,
        accel_ms2=accel_along,
        accel_sigma_ms2=np.sqrt(np.maximum(accel_var, 0.0)),
        grade=grade,
    )


def summarise(est: Estimate) -> dict[str, Any]:
    if est.refused:
        return {"refused": est.refused, "grade": est.grade}

    peak = int(np.argmax(est.speed_kmh))

    # Which sample is the peak is itself uncertain, and taking the maximum of a
    # noisy series biases high: the sample that happened to be perturbed upward
    # is the one selected. Reporting that sample's own interval understated the
    # uncertainty and the interval covered the truth in 92 percent of runs
    # rather than 95. The interval therefore spans every sample the peak could
    # plausibly be, which is every sample whose own interval reaches the peak.
    reachable = est.speed_kmh + 1.96 * est.speed_sigma_kmh >= est.speed_kmh[peak]
    peak_low = float(np.min((est.speed_kmh - 1.96 * est.speed_sigma_kmh)[reachable]))
    peak_high = float(np.max((est.speed_kmh + 1.96 * est.speed_sigma_kmh)[reachable]))

    # Braking onset is a sustained deceleration the measurement supports, not
    # the first negative sample. Requiring the interval itself to sit below the
    # threshold is what separates a brake application from the filter
    # overshooting at the end of an acceleration, which produced false braking
    # in about a third of runs that never braked.
    onset = None
    supported = est.accel_ms2 + 1.96 * est.accel_sigma_ms2 < -1.5
    run = 0
    for i in range(supported.size):
        run = run + 1 if supported[i] else 0
        if run >= 3:
            onset = int(est.t_ms[i - 2])
            break

    return {
        "grade": est.grade,
        "peak_speed_kmh": round(float(est.speed_kmh[peak]), 3),
        "peak_speed_sigma_kmh": round(float(est.speed_sigma_kmh[peak]), 3),
        "peak_speed_interval_95": [round(peak_low, 3), round(peak_high, 3)],
        "peak_candidates": int(np.count_nonzero(reachable)),
        "mean_speed_kmh": round(float(np.mean(est.speed_kmh)), 3),
        "min_accel_ms2": round(float(np.min(est.accel_ms2)), 3),
        "braking_onset_ms": onset,
        "samples": int(est.speed_kmh.size),
    }
