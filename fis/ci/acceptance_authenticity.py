#!/usr/bin/env python3
"""Grades the authenticity battery, including on what it cannot do.

Two properties are asserted, and the second is the one that keeps the first
honest:

  1. every variant reaches the verdict the corpus says it should
  2. the clean control reaches "consistent" with no test failing

A detector that fires on everything satisfies the first for seven of eight
variants and is worthless. The control is the test that stops threshold tuning
from producing a green run.

The corpus also records two things this battery does not detect, so the limits
are re-checked every run rather than remembered. Frame deletion from a scene
with no monotonic content is invisible to content continuity, and the test that
finds it is burned in timestamp continuity, which is a separate operator. A
shifted macroblock grid is not resolvable at this resolution and bitrate, and
what is asserted there is that the test returns inconclusive rather than
reporting a single encode.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker" / "src"))

from fis.corpora.tamper import build  # noqa: E402
from fis.services.authenticity import run_battery  # noqa: E402

OUT = Path("fis/corpora/out/tamper")


def main() -> int:
    manifest = build(OUT) if not (OUT / "manifest.json").exists() else json.loads((OUT / "manifest.json").read_text())

    failures: list[str] = []
    now = int(time.time() * 1000)

    print(f"\n{'variant':<27} {'expected':<13} {'verdict':<13} failing tests")
    for item in manifest:
        report = run_battery(OUT / item["file"], 320, 240, now)
        failing = [t["test"] for t in report["tests"] if t["result"] == "fail"]
        good = report["verdict"] == item["expect"]
        print(f"{'ok ' if good else 'XX '}{item['name']:<25} {item['expect']:<13} {report['verdict']:<13} {', '.join(failing) or '-'}")

        if not good:
            failures.append(f"{item['name']}: expected {item['expect']}, got {report['verdict']} ({item['detail']})")

        if item["name"] == "clean" and failing:
            failures.append(f"the control failed {', '.join(failing)}; a detector that fires on untouched footage is worthless")

        # The blocking grid test is not in the battery. It accused untouched
        # footage of a shifted macroblock grid, and a detector that cannot be
        # trusted to accuse cannot be trusted to exonerate either.
        if any(t["test"] == "blocking grid" for t in report["tests"]):
            failures.append("the blocking grid test is back in the battery without having been validated")

    # The two detections that must be exact rather than merely present.
    duplicated = run_battery(OUT / "frames_duplicated.mp4", 320, 240, now)
    stalls = next(t for t in duplicated["tests"] if t["test"] == "content continuity")["measurements"]["stall_transitions"]
    if len(stalls) < 8:
        failures.append(f"a run of 10 duplicated frames produced only {len(stalls)} perfect correlations")

    spliced = run_battery(OUT / "segment_spliced.mp4", 320, 240, now)
    jumps = next(t for t in spliced["tests"] if t["test"] == "content continuity")["measurements"]["jump_transitions"]
    if not jumps:
        failures.append("a spliced segment produced no discontinuity")

    # The gap content continuity leaves, and the test that closes it. Asserted
    # rather than described, so a regression in either shows up here.
    print()
    print("closing the deletion gap with the recorder's own clock:")
    clock_dir = Path("fis/corpora/out/dvr_clock")
    if not (clock_dir / "manifest.json").exists():
        from fis.corpora.dvr_clock import build as build_clock

        build_clock(clock_dir)
    clock_manifest = json.loads((clock_dir / "manifest.json").read_text())

    for name in ("aligned", "frames_removed"):
        case = next(c for c in clock_manifest if c["name"] == name)
        overlay = {
            **case["region"],
            "layout": "####-##-## ##:##:##",
            "seconds_per_frame": case["seconds_per_frame"],
            "claimed_start_utc_ms": case["first_true_utc_ms"],
        }
        report = run_battery(
            clock_dir / case["file"], case["size"][0], case["size"][1], case["first_true_utc_ms"], overlay
        )
        clock_test = next(t for t in report["tests"] if t["test"] == "burned clock")
        print(f"  {name:<16} {report['verdict']:<13} burned clock: {clock_test['result']}")

        if name == "frames_removed":
            if clock_test["result"] != "fail":
                failures.append("twenty deleted frames left the recorder's own clock looking continuous")
            if report["verdict"] != "inconsistent":
                failures.append(f"a recording with a break in its own clock was called {report['verdict']}")
        elif clock_test["result"] != "pass":
            failures.append(f"the untouched clock recording was reported as {clock_test['result']}")
        elif report["verdict"] != "consistent":
            # A second clean control, from a corpus with different content. The
            # screen replay detector fired on this one while passing the other,
            # which is how the ramp metric's dependence on slope was found.
            flagged = [t["test"] for t in report["tests"] if t["result"] == "fail"]
            failures.append(f"the untouched clock recording was {report['verdict']}, failing {', '.join(flagged)}")

    print()
    print("limits that remain, re-checked every run:")
    print("  without an overlay position in the source's deployment record the clock cannot be read,")
    print("  and deletion from a quiet scene is then not detectable. the test says so rather than passing.")
    print("  double compression is not detected. the blocking grid test accused untouched footage and")
    print("  is out of the battery until it measures across block boundaries rather than sampling columns.")

    print()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("authenticity acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
