"""The shapes real recorder exports actually arrive in.

Two hundred vendor exports cannot be obtained, and a synthetic matrix does not
substitute for them: what this proves is parser robustness, not vendor coverage,
and any report built on it has to say so or it is a false claim in a courtroom.

What it does cover is the set of things that actually break parsers, which is
smaller and more predictable than the vendor list suggests. Proprietary framing
around an otherwise ordinary stream. Parameter sets missing because the export
started mid recording. Garbage before the first start code from a header nobody
documented. A truncated final unit from a copy that was interrupted. A flipped
bit from a failing disk. No leading keyframe, because the export began wherever
the operator dragged the handle.
"""

from __future__ import annotations

import json
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

from fis import nal

WIDTH = 320
HEIGHT = 240
FPS = 25


@dataclass(frozen=True)
class Variant:
    name: str
    detail: str
    # What an honest acquisition should manage with this.
    expect: str          # opened | opened_with_loss | refused
    expect_reason: str = ""


VARIANTS = [
    Variant("annexb_clean", "a plain elementary stream, start codes and all", "opened"),
    Variant("avcc_lengths", "length prefixed units with no start codes, as an mp4 track holds them", "opened"),
    Variant("dav_framed", "proprietary 32 byte frame headers wrapping annex b, which is what a .dav is", "opened"),
    Variant("hik_timestamped", "per frame vendor headers carrying a timestamp", "opened"),
    Variant("leading_garbage", "an undocumented file header before the first start code", "opened"),
    Variant("mixed_start_codes", "three and four byte start codes interleaved", "opened"),
    Variant(
        "no_leading_idr",
        "the export begins mid group of pictures, so the first frames reference pictures that are not present",
        "opened_with_loss",
        "decoding can only begin at the first keyframe, and everything before it is unrecoverable",
    ),
    Variant(
        "missing_parameter_sets",
        "no sps or pps anywhere, because the export started after them",
        "refused",
        "a stream with no parameter sets cannot be decoded, and substituting a set from elsewhere would change the picture",
    ),
    Variant(
        "truncated_tail",
        "the copy was interrupted partway through the last unit",
        "opened_with_loss",
        "the final unit is incomplete and is dropped rather than decoded partially",
    ),
    # Acquisition opens this and should: a flipped bit inside a slice leaves the
    # stream's structure entirely intact. The damage is in the coded data, so it
    # is the decode integrity map that finds it, and the two stages are graded
    # separately because they answer different questions.
    Variant(
        "bit_flip_in_slice",
        "a single bit flipped inside a slice, as a failing disk produces",
        "opened",
        "the structure is intact, so acquisition succeeds; the decode integrity map is what marks the damage",
    ),
]


def _source_stream(path: Path) -> bytes:
    """A real encoded stream to derive every variant from."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc2=size={WIDTH}x{HEIGHT}:rate={FPS}:duration=3",
            "-c:v", "libx264", "-crf", "24", "-g", "25", "-keyint_min", "25", "-sc_threshold", "0",
            "-bsf:v", "h264_mp4toannexb", "-f", "h264", str(path),
        ],
        check=True, capture_output=True,
    )
    return path.read_bytes()


def _units_with_payloads(data: bytes) -> list[tuple[nal.Nal, bytes]]:
    return [(unit, data[unit.offset : unit.offset + unit.length]) for unit in nal.walk(data)]


def _annexb(units: list[tuple[nal.Nal, bytes]], code_len: int = 4) -> bytes:
    prefix = b"\x00\x00\x00\x01" if code_len == 4 else b"\x00\x00\x01"
    return b"".join(prefix + payload for _, payload in units)


def build(out_dir: Path) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    source = _source_stream(out_dir / "_source.264")
    units = _units_with_payloads(source)
    (out_dir / "_source.264").unlink()

    manifest: list[dict] = []

    for variant in VARIANTS:
        path = out_dir / f"{variant.name}.bin"

        if variant.name == "annexb_clean":
            path.write_bytes(_annexb(units))

        elif variant.name == "avcc_lengths":
            # Four byte big endian length before each unit, no start codes.
            path.write_bytes(b"".join(struct.pack(">I", len(p)) + p for _, p in units))

        elif variant.name == "dav_framed":
            # A plausible proprietary wrapper: magic, length, frame index, then
            # the annex b unit. Real .dav differs in detail and not in kind.
            chunks = []
            for index, (_, payload) in enumerate(units):
                body = b"\x00\x00\x00\x01" + payload
                chunks.append(b"DHAV" + struct.pack("<II", len(body), index) + b"\x00" * 20 + body)
            path.write_bytes(b"".join(chunks))

        elif variant.name == "hik_timestamped":
            chunks = []
            for index, (_, payload) in enumerate(units):
                body = b"\x00\x00\x00\x01" + payload
                chunks.append(b"HIKV" + struct.pack("<IQ", len(body), 1_700_000_000_000 + index * 40) + body)
            path.write_bytes(b"".join(chunks))

        elif variant.name == "leading_garbage":
            path.write_bytes(b"RECORDER EXPORT v2.1\x00" + b"\xa5" * 173 + _annexb(units))

        elif variant.name == "mixed_start_codes":
            out = bytearray()
            for index, (_, payload) in enumerate(units):
                out += (b"\x00\x00\x00\x01" if index % 3 == 0 else b"\x00\x00\x01") + payload
            path.write_bytes(bytes(out))

        elif variant.name == "no_leading_idr":
            # Start after the first keyframe, so the opening slices reference
            # pictures the file does not contain.
            first_idr = next(i for i, (u, _) in enumerate(units) if u.is_keyframe)
            kept = [u for u in units if u[0].is_parameter_set] + units[first_idr + 3 :]
            path.write_bytes(_annexb(kept))

        elif variant.name == "missing_parameter_sets":
            path.write_bytes(_annexb([u for u in units if not u[0].is_parameter_set]))

        elif variant.name == "truncated_tail":
            complete = _annexb(units)
            path.write_bytes(complete[: len(complete) - max(64, len(units[-1][1]) // 2)])

        elif variant.name == "bit_flip_in_slice":
            data = bytearray(_annexb(units))
            slices = [u for u in nal.walk(bytes(data)) if u.nal_type == nal.NAL_SLICE]
            target = slices[len(slices) // 2]
            # Well inside the payload, so the header still parses and the damage
            # is in the coded data where a disk fault would put it.
            at = target.offset + target.length // 2
            data[at] ^= 0x40
            path.write_bytes(bytes(data))

        manifest.append(
            {
                "name": variant.name,
                "file": path.name,
                "detail": variant.detail,
                "expect": variant.expect,
                "expect_reason": variant.expect_reason,
                "bytes": path.stat().st_size,
                "size": [WIDTH, HEIGHT],
                "fps": FPS,
            }
        )
        print(f"{variant.name:<24} {variant.expect:<18} {path.stat().st_size:>8} bytes")

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


if __name__ == "__main__":
    import sys

    build(Path(sys.argv[1] if len(sys.argv) > 1 else "fis/corpora/out/dvr_format"))
