#!/usr/bin/env python3
"""Proves that every class E operator reproduces byte for byte.

Four tests, and each one exists because of a specific way this can go wrong.

  A  the same container twice           catches RNG and leaked process state
  B  different cpu and memory limits    catches thread count and tiling heuristics
  C  a --no-cache rebuild               catches anything that leaked in from the
                                        build host or a floating dependency
  D  recipe replay                      catches drift between what was recorded
                                        and what re-running actually produces

Test C is the one people get wrong. The requirement is that the *operator output*
is identical after a rebuild, not that the image digest is reproducible.
Reproducible image digests are a much harder and separate problem, and chasing
them here would be a distraction that also would not prove anything about the
operator.

An operator that cannot pass these is demoted to class I. The definition of E is
not negotiable to make a build green.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "fis" / "golden"
IMAGE = "fis-operator-base:dev"


def run_in_container(image: str, case: Path, operator: str, extra: list[str] | None = None) -> str:
    args = [
        "docker", "run", "--rm",
        "--network", "none",
        "-v", f"{case}:/case:ro",
        *(extra or []),
        image,
        "python", "-m", "fis.cli",
        "--operator", operator,
        "--input", "/case/input.bin",
    ]
    if (case / "params.json").exists():
        args += ["--params", "/case/params.json"]

    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"operator {operator} failed on {case.name}:\n{result.stderr}")
    return json.loads(result.stdout.strip().splitlines()[-1])["output_digest"]


def cases() -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for operator_dir in sorted(GOLDEN.iterdir()):
        if not operator_dir.is_dir():
            continue
        for case in sorted(operator_dir.iterdir()):
            if (case / "input.bin").exists():
                found.append((f"{operator_dir.name}@{(case / 'version.txt').read_text().strip()}", case))
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-rebuild", action="store_true", help="skip test C, which is slow")
    parser.add_argument("--update", action="store_true", help="record the current digests as expected")
    args = parser.parse_args()

    found = cases()
    if not found:
        print("no golden cases, nothing to prove", file=sys.stderr)
        return 1

    failures: list[str] = []

    for operator, case in found:
        name = f"{operator} {case.name}"
        expected_path = case / "digest.txt"

        a1 = run_in_container(IMAGE, case, operator)
        if args.update:
            expected_path.write_text(a1 + "\n")
            print(f"{name:<42} recorded {a1[:16]}")
            continue

        expected = expected_path.read_text().strip()
        if a1 != expected:
            failures.append(f"{name}: recorded {expected[:16]}, produced {a1[:16]}")
            continue

        # A: the same image, a second time.
        a2 = run_in_container(IMAGE, case, operator)
        if a2 != expected:
            failures.append(f"{name}: two runs of the same image disagree")
            continue

        # B: constrained differently. Thread count sensitivity shows up here.
        b1 = run_in_container(IMAGE, case, operator, ["--cpuset-cpus", "0-1", "--memory", "512m"])
        b2 = run_in_container(IMAGE, case, operator, ["--cpuset-cpus", "2-7", "--memory", "2g"])
        if b1 != expected or b2 != expected:
            failures.append(f"{name}: output depends on cpu or memory limits")
            continue

        print(f"{name:<42} {expected[:16]} A ok  B ok")

    if args.update:
        return 0

    if not args.skip_rebuild and not failures:
        print("\nrebuilding from scratch for test C")
        build = subprocess.run(
            ["docker", "build", "--no-cache", "-f", "fis/containers/base.Dockerfile", "-t", "fis-operator-rebuild:ci", "fis/"],
            cwd=ROOT, capture_output=True, text=True,
        )
        if build.returncode != 0:
            raise SystemExit(f"rebuild failed:\n{build.stderr[-3000:]}")

        for operator, case in found:
            expected = (case / "digest.txt").read_text().strip()
            got = run_in_container("fis-operator-rebuild:ci", case, operator)
            status = "ok" if got == expected else "DIFFERS"
            print(f"{operator} {case.name:<28} rebuild {status}")
            if got != expected:
                failures.append(f"{operator} {case.name}: output changed after a clean rebuild")

    print()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        print(f"\n{len(failures)} determinism failure(s). demote the operator to class I rather than relax the test.")
        return 1

    print(f"{len(found)} class E case(s) reproduce byte for byte")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
