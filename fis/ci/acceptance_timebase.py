#!/usr/bin/env python3
"""Grades the clock model.

Four properties, and the first is what the whole thing exists for.

  1. coverage. the true error must fall inside the stated uncertainty at least
     95 percent of the time, at every distance from the observations. an
     interval that does not cover is worse than none
  2. a stepped clock is split into segments rather than fitted across. a reboot
     is not a drift rate
  3. uncertainty grows with extrapolation, and a source last observed a day ago
     is refused rather than answered
  4. a pair whose combined uncertainty exceeds the threshold is order only, and
     cross source measurement between them is refused

The corpus is generated here from stated clock behaviours, so the truth is known
exactly and the estimator can be shown to be wrong.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker" / "src"))

import numpy as np  # noqa: E402

from fis.services.timebase import (  # noqa: E402
    ORDER_ONLY_MS,
    Observation,
    Resolved,
    pair_sigma,
    resolve,
    segment,
)

BASE = 1_700_000_000_000


@dataclass(frozen=True)
class Clock:
    name: str
    detail: str
    offset_ms: float
    drift_ppm: float
    # A step partway through, as (fraction of the span, milliseconds moved).
    step: tuple[float, float] | None = None


CLOCKS = [
    Clock("gnss_disciplined", "pulse per second, essentially right", 2.0, 0.5),
    Clock("ntp_hub", "network disciplined, a little fast", 250.0, 30.0),
    Clock("free_running_dvr", "no discipline, gains two seconds a day", 4_100.0, 23.0),
    Clock("rebooted", "reset by hand partway through", 800.0, 12.0, step=(0.55, -1_450.0)),
    Clock("ntp_stepped", "corrected by a step when the daemon caught up", 3_000.0, 18.0, step=(0.6, -2_950.0)),
]


def true_error_ms(clock: Clock, elapsed_s: float, span_s: float) -> float:
    error = clock.offset_ms + clock.drift_ppm / 1000.0 * elapsed_s
    if clock.step and elapsed_s >= clock.step[0] * span_s:
        error += clock.step[1]
    return error


def observe(clock: Clock, count: int, interval_s: float, sigma_ms: float, seed: int) -> tuple[list[Observation], float]:
    rng = np.random.default_rng(seed)
    span_s = count * interval_s
    observations = []
    for i in range(count):
        elapsed_s = i * interval_s
        t_source = BASE + elapsed_s * 1000.0
        error = true_error_ms(clock, elapsed_s, span_s)
        observations.append(
            Observation(
                t_source_ms=t_source,
                t_utc_ms=t_source + error + float(rng.normal(0.0, sigma_ms)),
                sigma_ms=sigma_ms,
                method="ntp",
            )
        )
    return observations, span_s


def main() -> int:
    failures: list[str] = []

    print(f"{'clock':<20} {'segs':>5} {'offset':>18} {'drift ppm':>18} {'residual':>9}")
    models = {}
    for clock in CLOCKS:
        observations, span_s = observe(clock, 24, 600.0, 6.0, seed=hash(clock.name) % 9973)
        segments = segment(observations)
        models[clock.name] = (segments, span_s)

        first = segments[0]
        expected_segments = 2 if clock.step else 1
        print(
            f"{clock.name:<20} {len(segments):>5} "
            f"{first.offset_ms:>9.1f} / {clock.offset_ms:<6.0f} "
            f"{first.drift_ppm:>9.1f} / {clock.drift_ppm:<6.0f} {first.residual_ms:>8.2f}"
        )

        if len(segments) != expected_segments:
            failures.append(
                f"{clock.name}: {len(segments)} segment(s), expected {expected_segments}. "
                + ("a step was fitted through rather than split at" if clock.step else "a smooth clock was split")
            )

        if abs(first.offset_ms - clock.offset_ms) > 4.0 * first.offset_se_ms + 3.0:
            failures.append(f"{clock.name}: offset {first.offset_ms:.1f} against a true {clock.offset_ms:.0f}")

        if first.drift_measurable and abs(first.drift_ppm - clock.drift_ppm) > max(4.0 * first.drift_se_ppm, 3.0):
            failures.append(f"{clock.name}: drift {first.drift_ppm:.1f} ppm against a true {clock.drift_ppm:.0f}")

    # Coverage, which is the assertion that matters. Sampled inside the observed
    # span and at increasing distances beyond it.
    print(f"\n{'distance past last obs':<26} {'checks':>7} {'covered':>9} {'median sigma':>14} {'refused':>9}")
    for label, offset_s in [("inside the span", None), ("+10 minutes", 600), ("+1 hour", 3600), ("+6 hours", 21600), ("+1 day", 86400)]:
        checks = covered = refused = 0
        sigmas = []
        for clock in CLOCKS:
            segments, span_s = models[clock.name]
            last = segments[-1]
            for fraction in (0.1, 0.35, 0.6, 0.85):
                if offset_s is None:
                    t_source = last.t_from_ms + fraction * (last.t_to_ms - last.t_from_ms)
                else:
                    t_source = last.t_to_ms + offset_s * 1000.0

                result: Resolved = resolve(segments, t_source)
                checks += 1
                if result.refused:
                    refused += 1
                    continue

                elapsed_s = (t_source - BASE) / 1000.0
                truth = BASE + elapsed_s * 1000.0 + true_error_ms(clock, elapsed_s, span_s)
                error = abs(result.t_utc_ms - truth)
                sigmas.append(result.sigma_ms)
                if error <= 1.96 * result.sigma_ms:
                    covered += 1

                if offset_s is not None:
                    break  # one sample per clock beyond the span is enough

        answered = checks - refused
        rate = covered / answered if answered else 1.0
        median = float(np.median(sigmas)) if sigmas else float("nan")
        print(f"{label:<26} {checks:>7} {rate*100:>8.1f}% {median:>13.1f}ms {refused:>9}")

        if answered and rate < 0.95:
            failures.append(f"{label}: the stated uncertainty covered the truth {rate*100:.0f} percent of the time")

    # A source last observed a day ago must not be answered.
    day_out = [resolve(models[c.name][0], models[c.name][0][-1].t_to_ms + 86_400_000) for c in CLOCKS]
    if not all(r.refused for r in day_out):
        failures.append("a source unobserved for a day was still given a time rather than refused")

    # The pair ladder.
    print()
    tight = Resolved(0, 8.0, "fitted", "A", 0.0)
    loose = Resolved(0, 120.0, "fitted", "C", 0.0)
    hopeless = Resolved(0, 900.0, "fitted", "D", 0.0)
    for name, a, b, expected in [
        ("two good sources", tight, tight, "simultaneous"),
        ("good and mediocre", tight, loose, "widened"),
        ("anything with a bad one", tight, hopeless, "order_only"),
    ]:
        got = pair_sigma(a, b)
        print(f"{name:<26} {got['mode']:<14} {got['detail'][:64]}")
        if got["mode"] != expected:
            failures.append(f"{name}: pair mode {got['mode']}, expected {expected}")
    if pair_sigma(tight, hopeless)["usable"]:
        failures.append("a pair above the order only threshold was still reported usable")

    print()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("timebase acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
