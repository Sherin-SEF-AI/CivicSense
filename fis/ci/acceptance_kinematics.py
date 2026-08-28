#!/usr/bin/env python3
"""Grades the kinematics estimator against a truth channel.

Three assertions, and the first is the one that matters most.

  1. the 95 percent interval contains the CAN speed at least 95 percent of the
     time. an interval that does not cover is worse than no interval, because
     someone will rely on it
  2. a site whose clock error exceeds the threshold is refused, not answered
     widely. a very wide number invites a reader to quote its midpoint
  3. braking is found on the profiles that brake and not on the ones that do not

It also measures the method being replaced, so the improvement is a number
rather than an assertion.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker" / "src"))

import numpy as np  # noqa: E402

from fis.corpora.can import build  # noqa: E402
from fis.services.kinematics import Track, estimate, summarise  # noqa: E402

OUT = Path("fis/corpora/out/can")


def naive_peak(case: dict) -> float:
    """What the console does today: divide the gap by the interval.

    Kept here so the comparison is against the real previous behaviour rather
    than a strawman.
    """
    t = np.array(case["track"]["t_ms"]) / 1000.0
    x = np.array(case["track"]["x_m"])
    y = np.array(case["track"]["y_m"])
    dt = np.diff(t)
    step = np.hypot(np.diff(x), np.diff(y))
    speeds = np.where(dt > 1e-6, step / np.maximum(dt, 1e-6), 0.0) * 3.6
    return float(np.max(speeds))


def main() -> int:
    cases = (
        json.loads((OUT / "cases.json").read_text())
        if (OUT / "cases.json").exists()
        else build(OUT)
    )

    failures: list[str] = []
    by_site: dict[str, dict[str, list]] = {}

    for case in cases:
        site = case["site"]
        bucket = by_site.setdefault(site, {"covered": [], "error": [], "naive_error": [], "refused": 0, "braking": []})

        track = Track(
            t_ms=np.array(case["track"]["t_ms"]),
            x_m=np.array(case["track"]["x_m"]),
            y_m=np.array(case["track"]["y_m"]),
            residual_m=case["residual_m"],
            sync_sigma_ms=case["sync_sigma_ms"],
        )
        result = summarise(estimate(track))

        if "refused" in result:
            bucket["refused"] += 1
            continue

        truth = case["truth"]["peak_speed_kmh"]
        low, high = result["peak_speed_interval_95"]
        bucket["covered"].append(low <= truth <= high)
        bucket["error"].append(abs(result["peak_speed_kmh"] - truth))
        bucket["naive_error"].append(abs(naive_peak(case) - truth))
        bucket["braking"].append((case["truth"]["braking"], result["braking_onset_ms"] is not None))

    print(f"{'site':<26} {'runs':>5} {'refused':>8} {'coverage':>9} {'mean err':>10} {'naive err':>10}")
    for site, bucket in by_site.items():
        n = len(bucket["covered"])
        if n == 0:
            print(f"{site:<26} {bucket['refused']:>5} {bucket['refused']:>8} {'refused':>9} {'-':>10} {'-':>10}")
            continue
        coverage = float(np.mean(bucket["covered"]))
        error = float(np.mean(bucket["error"]))
        naive = float(np.mean(bucket["naive_error"]))
        print(f"{site:<26} {n:>5} {bucket['refused']:>8} {coverage*100:>8.1f}% {error:>9.2f} {naive:>9.2f}")

        if coverage < 0.95:
            failures.append(f"{site}: the interval covered the truth in {coverage*100:.1f} percent of runs, the requirement is 95")

        # The point of the replacement. Differentiating position noise is not a
        # near miss, it is a different order of magnitude.
        if naive <= error:
            failures.append(f"{site}: the estimator ({error:.2f}) is no better than dividing gaps ({naive:.2f})")

    poor = by_site.get("poor_grade_d", {})
    if poor.get("refused", 0) == 0:
        failures.append("a site whose clock error exceeds the threshold was answered rather than refused")

    print()
    for site, bucket in by_site.items():
        pairs = bucket["braking"]
        if not pairs:
            continue
        detected = sum(1 for actual, found in pairs if actual and found)
        total = sum(1 for actual, _ in pairs if actual)
        false_alarms = sum(1 for actual, found in pairs if not actual and found)
        print(f"{site:<26} braking found in {detected}/{total}, false alarms {false_alarms}/{len(pairs)-total}")
        if total and detected / total < 0.9:
            failures.append(f"{site}: braking detected in only {detected}/{total} runs that braked")
        if false_alarms:
            failures.append(f"{site}: braking reported in {false_alarms} runs that did not brake")

    print()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("kinematics acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
