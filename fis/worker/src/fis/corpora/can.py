"""Vehicle trajectories with a truth channel.

The console currently derives speed by dividing the distance between two
reported positions by the time between them. That is correct arithmetic on
perfect inputs and it amplifies noise on real ones: a track jittering by a metre
at 10 Hz produces a speed jittering by 36 km/h, and no amount of care in the
interval calculation makes that number useful.

This generates the material to prove that. A vehicle drives a stated profile,
the track a camera would report is derived from it with realistic position and
timing noise, and a CAN log records what the vehicle actually did. An estimator
is then graded on whether its interval contains the truth, which is the property
that matters: an interval that does not cover is worse than no interval, because
someone will rely on it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class Profile:
    name: str
    detail: str
    # Piecewise constant acceleration, as (duration_s, accel_m_s2).
    segments: tuple[tuple[float, float], ...]
    initial_speed_ms: float


PROFILES = [
    Profile("cruise", "steady approach at 45 km/h", ((8.0, 0.0),), 12.5),
    Profile(
        "hard_braking",
        "approach at 60 km/h then brake at 5 m/s2",
        ((3.0, 0.0), (3.4, -5.0), (2.0, 0.0)),
        16.7,
    ),
    Profile(
        "accelerating",
        "pull away from rest",
        ((1.0, 0.0), (6.0, 2.2), (2.0, 0.0)),
        0.0,
    ),
    Profile(
        "stop_start",
        "decelerate to a stop, wait, pull away",
        ((2.0, 0.0), (2.5, -4.0), (2.0, 0.0), (3.0, 2.5)),
        10.0,
    ),
]


@dataclass(frozen=True)
class Site:
    name: str
    # Ground position error the calibration record claims, in metres.
    residual_m: float
    # Clock error, which is what the sync grade encodes.
    sync_sigma_ms: float
    sample_hz: float


SITES = [
    Site("well_calibrated_grade_a", 0.20, 10.0, 10.0),
    Site("typical_grade_b", 0.60, 40.0, 10.0),
    Site("poor_grade_d", 2.40, 600.0, 5.0),
]


def _truth(profile: Profile, hz: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Exact time, speed and distance along the path.

    Speed is piecewise linear because acceleration is piecewise constant, so
    trapezoid integration of it is exact rather than approximate. An earlier
    version integrated each segment in closed form and divided by the
    acceleration, which is a division by zero on any segment at constant speed.
    """
    total = sum(duration for duration, _ in profile.segments)
    t = np.arange(0.0, total, 1.0 / hz)
    speed = np.zeros_like(t)

    current_speed = profile.initial_speed_ms
    elapsed = 0.0
    for duration, accel in profile.segments:
        mask = (t >= elapsed) & (t < elapsed + duration)
        local = t[mask] - elapsed
        # Clamped at zero: a braking vehicle stops, it does not reverse.
        speed[mask] = np.maximum(current_speed + accel * local, 0.0)
        current_speed = max(0.0, current_speed + accel * duration)
        elapsed += duration

    distance = np.zeros_like(t)
    if t.size > 1:
        step = np.diff(t)
        distance[1:] = np.cumsum(0.5 * (speed[:-1] + speed[1:]) * step)

    return t, speed, distance


def _rng(seed: int) -> np.random.Generator:
    """A stated seed, so the corpus is the same corpus every time it is built."""
    return np.random.default_rng(seed)


def build(out_dir: Path, runs_per_case: int = 10) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    cases: list[dict] = []
    seed = 0

    for site in SITES:
        for profile in PROFILES:
            for run in range(runs_per_case):
                seed += 1
                rng = _rng(seed)
                t, speed, distance = _truth(profile, site.sample_hz)

                # The camera reports where the vehicle was on the ground plane,
                # displaced by the calibration residual, at times displaced by
                # the clock error. Both are what the source record claims about
                # itself, which is what an estimator has to work from.
                heading = np.deg2rad(28.0)
                x = distance * np.cos(heading) + rng.normal(0.0, site.residual_m, t.size)
                y = distance * np.sin(heading) + rng.normal(0.0, site.residual_m, t.size)
                reported_t = t + rng.normal(0.0, site.sync_sigma_ms / 1000.0, t.size)

                # A wheel speed sensor reads slightly high and is quantised.
                can_speed = speed * 1.015
                can_speed = np.round(can_speed / 0.05) * 0.05

                cases.append(
                    {
                        "case_id": f"{site.name}__{profile.name}__{run}",
                        "site": site.name,
                        "profile": profile.name,
                        "detail": profile.detail,
                        "residual_m": site.residual_m,
                        "sync_sigma_ms": site.sync_sigma_ms,
                        "sample_hz": site.sample_hz,
                        "track": {
                            "t_ms": [round(float(v) * 1000, 3) for v in reported_t],
                            "x_m": [round(float(v), 4) for v in x],
                            "y_m": [round(float(v), 4) for v in y],
                        },
                        "can": {
                            "t_ms": [round(float(v) * 1000, 3) for v in t],
                            "speed_kmh": [round(float(v) * 3.6, 3) for v in can_speed],
                            # The scale error is stated so a validation harness
                            # can regress it out rather than being surprised.
                            "wheel_scale_error": 0.015,
                        },
                        "truth": {
                            "peak_speed_kmh": round(float(speed.max() * 3.6), 3),
                            "mean_speed_kmh": round(float(speed.mean() * 3.6), 3),
                            "braking": any(a < -1.0 for _, a in profile.segments),
                        },
                    }
                )

    (out_dir / "cases.json").write_text(json.dumps(cases, indent=1, sort_keys=True) + "\n")
    print(f"{len(cases)} runs across {len(SITES)} sites and {len(PROFILES)} profiles")
    return cases


if __name__ == "__main__":
    import sys

    build(Path(sys.argv[1] if len(sys.argv) > 1 else "fis/corpora/out/can"))
