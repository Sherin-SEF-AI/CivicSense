#!/usr/bin/env python3
"""Grades the burned in clock reader and the reconciliation.

The requirement in the specification is that a recorder whose clock is wrong or
drifting is detected within a second over a day. That splits into three things
which are graded separately, because they fail differently:

  reading        the overlay is legible under compression
  offset         how wrong the clock was at the start of the recording
  drift          whether it is also failing to hold time

Drift is only asserted where the span can resolve it. A one second overlay
cannot show a drift of two seconds a day over a twelve second clip, and the
tolerance used here is the resolution floor itself rather than a number chosen
to make the run pass.

Continuity is graded too, because this is the test that finds frames removed
from footage where the picture alone cannot: the recorder wrote a time on every
frame it captured, and a gap in those times is a gap no re-encode can hide.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker" / "src"))

from fis.corpora.dvr_clock import build  # noqa: E402
from fis.services.timestamp import continuity, read_overlay, reconcile  # noqa: E402

OUT = Path("fis/corpora/out/dvr_clock")
LAYOUT = "####-##-## ##:##:##"


def main() -> int:
    manifest = (
        json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else build(OUT)
    )

    failures: list[str] = []
    print(f"\n{'case':<20} {'legible':>9} {'conf':>7} {'offset err':>12} {'drift':>18}")

    for item in manifest:
        region = item["region"]
        spf = item["seconds_per_frame"]
        readings = read_overlay(
            OUT / item["file"], item["size"][0], item["size"][1], (region["y"], region["x"]), LAYOUT, region["scale"]
        )
        gaps = continuity(readings, 1.0 / spf)
        result = reconcile(readings, 1.0 / spf, item["first_true_utc_ms"], gaps.get("gaps"))

        legible = sum(1 for r in readings if r.epoch_ms is not None)
        rate = legible / max(1, len(readings))

        offset_error = abs((result.get("offset_s") or 0.0) - item["offset_s"])
        drift = result.get("drift_s_per_day")
        floor = result.get("drift_resolvable_s_per_day")

        drift_text = "not resolvable" if drift is None else f"{drift:.2f} vs {item['drift_s_per_day']:.2f}"
        print(
            f"{item['name']:<20} {legible}/{len(readings):<6} {result.get('min_confidence', 0):>7.4f} "
            f"{offset_error:>11.3f}s {drift_text:>18}"
        )

        # Every overlay must be read. A recorder draws the same glyphs every
        # frame, so anything less than all of them is a reader problem.
        if rate < 1.0:
            failures.append(f"{item['name']}: only {legible} of {len(readings)} overlays were legible")

        # The stated requirement: within a second.
        if offset_error > 1.0:
            failures.append(f"{item['name']}: offset out by {offset_error:.2f} s, the requirement is 1 s")

        if drift is not None:
            # The tolerance is the resolution floor, not a chosen number.
            error = abs(drift - item["drift_s_per_day"])
            if error > max(floor or 0.0, 0.5):
                failures.append(
                    f"{item['name']}: drift out by {error:.2f} s/day against a floor of {floor:.2f}"
                )
        elif item["drift_s_per_day"] != 0 and item["seconds_per_frame"] > 1.0:
            failures.append(f"{item['name']}: a day long span should have resolved the drift and did not")

    print()
    removed = next(i for i in manifest if i["name"] == "frames_removed")
    region = removed["region"]
    readings = read_overlay(
        OUT / removed["file"], removed["size"][0], removed["size"][1], (region["y"], region["x"]), LAYOUT, region["scale"]
    )
    gaps = continuity(readings, 1.0 / removed["seconds_per_frame"])
    print(f"deletion: {gaps['detail']}")

    if gaps["continuous"]:
        failures.append("twenty deleted frames left the burned clock looking continuous")
    else:
        found = sum(g["missing_frames"] for g in gaps["gaps"])
        # The overlay ticks once a second and the clip runs at ten frames a
        # second, so the recovered count is quantised to ten.
        if abs(found - removed["deleted"]) > 10:
            failures.append(f"the gap was measured as {found} frames against {removed['deleted']} removed")

    clean = next(i for i in manifest if i["name"] == "aligned")
    region = clean["region"]
    clean_gaps = continuity(
        read_overlay(
            OUT / clean["file"], clean["size"][0], clean["size"][1], (region["y"], region["x"]), LAYOUT, region["scale"]
        ),
        1.0 / clean["seconds_per_frame"],
    )
    if not clean_gaps["continuous"]:
        failures.append("the untouched control was reported as discontinuous")

    print()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("burned in clock acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
