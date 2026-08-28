#!/usr/bin/env python3
"""Grades the metrology operators against a scene whose truth is known.

Three properties are asserted, and the third is the one that shows the
uncertainty is real rather than decorative:

  1. the reported interval contains the true height
  2. the interval is narrow enough to be useful close in, under 4 cm at 8 m
  3. the interval is *wider* further away

A tool that reported a constant 4 cm at every distance would pass the first two
and be lying. The construction genuinely loses precision toward the horizon, and
the number has to show it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker" / "src"))

import numpy as np  # noqa: E402

from fis.corpora.metrology import CONDITIONS, render  # noqa: E402
from fis.operators.contract import OpCtx  # noqa: E402
from fis.operators.registry import get, load_all  # noqa: E402
from fis.operators.video.metrology import SingleViewParams, TwoLineSpeedParams  # noqa: E402


def milli(point: list[float]) -> dict:
    return {"x_milli": int(round(point[0] * 1000)), "y_milli": int(round(point[1] * 1000))}


# Marking precision is the dominant term, and it is a property of the footage
# and the examiner rather than of the tool. Grading at one value would produce a
# single number that gets quoted without its conditions, which is exactly how an
# accuracy claim becomes misleading in a courtroom. Each operating point is
# named, and the report prints all of them.
OPERATING_POINTS = [
    ("sharp", 400, "a clean daylight frame, edges marked at sub pixel precision after zoom"),
    ("typical", 1_000, "a normal fixed camera frame, edges marked to about a pixel"),
    ("degraded", 3_000, "night or motion smeared, edges only locatable within a few pixels"),
]


def grade_heights() -> list[str]:
    load_all()
    operator = get("V-MET-1", "1.0.0")
    failures: list[str] = []
    widths: dict[tuple[str, float], list[float]] = {}

    for point_name, pixel_sigma_milli, description in OPERATING_POINTS:
      print(f"\n=== {point_name}: {description} ({pixel_sigma_milli/1000:.2f} px marking) ===")
      for name, camera in CONDITIONS:
        scene = render(camera)
        rails = scene["ground_rails"]
        cross = scene["cross_lines"]

        # Two sets of parallel ground lines: the rails run along the street, the
        # painted stop lines run across it.
        ground_rails = [
            {"a": milli(rails[0]["near_px"]), "b": milli(rails[0]["far_px"])},
            {"a": milli(rails[1]["near_px"]), "b": milli(rails[1]["far_px"])},
            {"a": milli(cross[0]["left_px"]), "b": milli(cross[0]["right_px"])},
            {"a": milli(cross[1]["left_px"]), "b": milli(cross[1]["right_px"])},
        ]

        reference = next(o for o in scene["objects"] if o["kind"] == "reference")

        for obj in scene["objects"]:
            if obj["kind"] != "subject":
                continue

            camera_dict = scene["camera"]
            lens = {
                "focal_milli_px": int(round(camera_dict["focal_px"] * 1000)),
                "cx_milli": int(round((camera_dict["width"] - 1) / 2 * 1000)),
                "cy_milli": int(round((camera_dict["height"] - 1) / 2 * 1000)),
                "k1_nano": int(round(camera_dict["k1"] * 1e9)),
                "k2_nano": int(round(camera_dict["k2"] * 1e9)),
                "p1_nano": int(round(camera_dict["p1"] * 1e9)),
                "p2_nano": int(round(camera_dict["p2"] * 1e9)),
            }

            params = SingleViewParams.model_validate(
                {
                    "lens": lens,
                    "ground_rails": ground_rails,
                    "vertical_vanishing_point": milli(scene["vertical_vanishing_point_px"]),
                    "reference_base": milli(reference["base_px"]),
                    "reference_top": milli(reference["top_px"]),
                    "reference_height_mm": int(round(reference["truth"]["height_m"] * 1000)),
                    "reference_tolerance_mm": 5,
                    "query_base": milli(obj["base_px"]),
                    "query_top": milli(obj["top_px"]),
                    "pixel_sigma_milli": pixel_sigma_milli,
                }
            )

            with OpCtx("acceptance", "/tmp") as ctx:
                result = json.loads(operator.fn(ctx, {}, params))

            truth = obj["truth"]["height_m"]
            distance = obj["truth"]["distance_m"]
            low, high = result["interval_95"]
            widths.setdefault((point_name, distance), []).append(result["interval_width"])

            covered = low <= truth <= high
            flag = "ok " if covered else "MISS"
            print(
                f"{name:<12} {obj['label']:<14} {distance:5.1f} m  truth {truth:.3f}  "
                f"got {result['value']:.3f}  [{low:.3f}, {high:.3f}]  width {result['interval_width']*100:5.1f} cm  {flag}"
            )
            if not covered:
                failures.append(
                    f"{point_name}/{name}/{obj['label']}: interval [{low:.3f},{high:.3f}] misses truth {truth:.3f}"
                )

    print("\n=== interval width by operating point ===")
    print(f"{'operating point':<12} {'marking':>9} {'8 m':>9} {'15 m':>9} {'25 m':>9}")
    for point_name, pixel_sigma_milli, _ in OPERATING_POINTS:
        row = [float(np.median(widths.get((point_name, d), [float('nan')]))) * 100 for d in (8.0, 15.0, 25.0)]
        print(
            f"{point_name:<12} {pixel_sigma_milli/1000:8.2f}px {row[0]:8.1f}cm {row[1]:8.1f}cm {row[2]:8.1f}cm"
        )

    # The stated requirement, met at the precision the requirement assumes. The
    # operating point is part of the claim and is printed above it.
    sharp_near = float(np.median(widths.get(("sharp", 8.0), [1e9])))
    if sharp_near > 0.04:
        failures.append(
            f"at the sharp operating point the interval at 8 m is {sharp_near*100:.1f} cm, "
            "the requirement is under 4 cm"
        )

    # The interval must track the geometry at every operating point, not just one.
    for point_name, _, _ in OPERATING_POINTS:
        near = float(np.median(widths.get((point_name, 8.0), [0.0])))
        far = float(np.median(widths.get((point_name, 25.0), [0.0])))
        if far <= near:
            failures.append(
                f"{point_name}: interval at 25 m ({far*100:.1f} cm) is not wider than at 8 m ({near*100:.1f} cm); "
                "the uncertainty is not tracking the geometry"
            )

    return failures


def grade_speed() -> list[str]:
    operator = get("V-MET-4", "1.0.0")
    failures: list[str] = []

    for true_kmh in (20.0, 45.0, 62.0):
        separation_m = 10.0
        elapsed_ms = int(round(separation_m / (true_kmh / 3.6) * 1000))
        params = TwoLineSpeedParams(
            separation_mm=int(separation_m * 1000),
            separation_tolerance_mm=30,
            first_crossing_ms=0,
            second_crossing_ms=elapsed_ms,
            timing_sigma_ms=40,
        )
        with OpCtx("acceptance", "/tmp") as ctx:
            result = json.loads(operator.fn(ctx, {}, params))

        low, high = result["interval_95"]
        error = abs(result["value"] - true_kmh) / true_kmh
        covered = low <= true_kmh <= high
        print(
            f"speed truth {true_kmh:5.1f} km/h  got {result['value']:6.2f}  "
            f"[{low:.2f}, {high:.2f}]  error {error*100:.2f}%  {'ok' if covered else 'MISS'}"
        )
        if not covered:
            failures.append(f"speed interval misses truth at {true_kmh} km/h")
        if error > 0.02:
            failures.append(f"speed error {error*100:.1f}% at {true_kmh} km/h exceeds 2%")

    return failures


def main() -> int:
    failures = grade_heights()
    print()
    failures += grade_speed()

    print()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("metrology acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
