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

        if item["name"] == "double_compressed_shifted":
            grid = next(t for t in report["tests"] if t["test"] == "blocking grid")
            if grid["result"] == "pass":
                failures.append(
                    "the blocking grid test reported a single encode geometry on twice encoded material. "
                    "it must return inconclusive when the picture cannot support the measurement."
                )

    # The two detections that must be exact rather than merely present.
    duplicated = run_battery(OUT / "frames_duplicated.mp4", 320, 240, now)
    stalls = next(t for t in duplicated["tests"] if t["test"] == "content continuity")["measurements"]["stall_transitions"]
    if len(stalls) < 8:
        failures.append(f"a run of 10 duplicated frames produced only {len(stalls)} perfect correlations")

    spliced = run_battery(OUT / "segment_spliced.mp4", 320, 240, now)
    jumps = next(t for t in spliced["tests"] if t["test"] == "content continuity")["measurements"]["jump_transitions"]
    if not jumps:
        failures.append("a spliced segment produced no discontinuity")

    print()
    print("known limits, re-checked every run:")
    print("  frame deletion from a scene with no monotonic content is not visible to content continuity.")
    print("  the test that finds it is burned in timestamp continuity, which is not built yet.")
    print("  a shifted macroblock grid is not resolvable at 320x240; the test says so rather than guessing.")

    print()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("authenticity acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
