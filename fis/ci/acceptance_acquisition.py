#!/usr/bin/env python3
"""Grades acquisition and the decode integrity map.

The two stages answer different questions and are graded apart.

Acquisition asks whether the file can be turned into something a decoder will
open, and what had to be done to get there. Its failures are structural: a
proprietary wrapper, no parameter sets, a copy that stopped partway.

The integrity map asks which pixels a decoder invented. Error concealment fills
damaged regions with something plausible from the neighbours, which is right for
watching and wrong for measuring: a motion estimator run over concealed pixels
reports the concealment as movement. Decoding twice, with and without, shows
exactly where a measurement must not be taken.

The report this produces states what the corpus is and is not. It proves parser
robustness against the failure modes that actually occur. It does not prove
vendor coverage, and a report that implied otherwise would be a false claim.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker" / "src"))

from fis.corpora.dvr_format import build  # noqa: E402
from fis.services.acquisition import acquire, decode_integrity  # noqa: E402

OUT = Path("fis/corpora/out/dvr_format")


def main() -> int:
    manifest = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else build(OUT)

    failures: list[str] = []
    opened = 0

    print(f"{'variant':<26} {'expected':<18} {'got':<18} {'container':<12} {'geometry':>10} {'dropped':>8}")
    results = {}
    for item in manifest:
        acquisition = acquire((OUT / item["file"]).read_bytes())
        results[item["name"]] = acquisition

        got = "refused" if not acquisition.opened else ("opened_with_loss" if acquisition.dropped_units else "opened")
        geometry = f"{acquisition.width}x{acquisition.height}" if acquisition.width else "unknown"
        good = got == item["expect"]
        opened += acquisition.opened

        print(
            f"{'ok ' if good else 'XX '}{item['name']:<23} {item['expect']:<18} {got:<18} "
            f"{acquisition.container:<12} {geometry:>10} {acquisition.dropped_units:>8}"
        )
        if not good:
            failures.append(f"{item['name']}: expected {item['expect']}, got {got} ({acquisition.detail[:90]})")

        # Every opened stream must recover the true geometry from its own
        # parameter set. A wrong size means the bitstream was misread.
        if acquisition.opened and (acquisition.width, acquisition.height) != tuple(item["size"]):
            failures.append(
                f"{item['name']}: recovered {acquisition.width}x{acquisition.height} against a true "
                f"{item['size'][0]}x{item['size'][1]}"
            )

        # A refusal must name a reason a person can act on.
        if not acquisition.opened:
            if not acquisition.refused:
                failures.append(f"{item['name']}: refused without a reason")
            if len(acquisition.detail) < 40:
                failures.append(f"{item['name']}: the refusal does not explain itself")

    rate = opened / len(manifest)
    print(f"\n{opened} of {len(manifest)} opened ({rate*100:.0f} percent)")
    if rate < 0.9:
        failures.append(f"only {rate*100:.0f} percent of the matrix opened, the requirement is 90")

    # Nothing is ever repaired by substitution. This is the assertion that keeps
    # the open rate honest: it would be trivial to reach 100 percent by lending
    # a parameter set from another file.
    missing = results["missing_parameter_sets"]
    if missing.opened:
        failures.append("a stream with no parameter sets was opened, which means one was substituted from elsewhere")
    if "not evidence of anything" not in missing.detail:
        failures.append("the parameter set refusal does not say why substitution is not an option")

    print("\ndecode integrity, which is a separate question from whether it opens:")
    print(f"{'variant':<26} {'frames':>7} {'damaged':>8} {'macroblocks':>12}")
    for name in ("annexb_clean", "bit_flip_in_slice", "truncated_tail", "no_leading_idr"):
        acquisition = results[name]
        if not acquisition.opened or acquisition.width is None:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            integrity = decode_integrity(acquisition.normalised_bytes, acquisition.width, acquisition.height, Path(tmp))
        blocks = sum(len(v) for v in integrity.get("damaged_macroblocks", {}).values())
        print(f"{name:<26} {integrity['frames']:>7} {len(integrity['damaged_frames']):>8} {blocks:>12}")

        if name == "annexb_clean" and integrity["damaged_frames"]:
            failures.append("an undamaged stream was reported as containing decoder invention")
        if name == "bit_flip_in_slice":
            if not integrity["damaged_frames"]:
                failures.append("a flipped bit inside a slice left no trace in the integrity map")
            elif blocks == 0:
                failures.append("damaged frames were found but no macroblocks were marked, so nothing can be masked")

    print()
    print("what this corpus proves, and what it does not:")
    print("  it proves the parser survives the failure modes that actually occur: proprietary framing,")
    print("  missing parameter sets, undocumented headers, interrupted copies and disk level bit rot.")
    print("  it does not prove vendor coverage. a claim of vendor coverage needs vendor exports.")

    print()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("acquisition acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
