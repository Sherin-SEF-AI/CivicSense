"""Turning whatever arrived into something that opens, or saying why it cannot.

The rule that governs all of it: the original bytes are never modified and never
discarded. What this produces is a normalised master alongside them, plus a
report of everything that had to be done to get there. An examiner who wants to
know whether the picture they are looking at is the picture that was recorded
can read that report and see every step.

The other rule is that nothing is invented. A stream missing its parameter sets
is refused, not repaired with a set from a similar recorder, because the
parameter set determines the picture that comes out and a picture produced from
a substituted one is not evidence of anything. A truncated final unit is dropped
rather than decoded partially. Where data is lost, the report says how much and
where.
"""

from __future__ import annotations

import struct
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fis import nal


@dataclass
class Acquisition:
    container: str
    opened: bool
    refused: str | None
    detail: str
    units: int = 0
    parameter_sets: int = 0
    keyframes: int = 0
    corrupt_units: int = 0
    dropped_units: int = 0
    leading_garbage_bytes: int = 0
    width: int | None = None
    height: int | None = None
    normalised_bytes: bytes | None = None
    notes: list[str] = field(default_factory=list)

    def report(self) -> dict[str, Any]:
        return {
            "container": self.container,
            "opened": self.opened,
            "refused": self.refused,
            "detail": self.detail,
            "units": self.units,
            "parameter_sets": self.parameter_sets,
            "keyframes": self.keyframes,
            "corrupt_units": self.corrupt_units,
            "dropped_units": self.dropped_units,
            "leading_garbage_bytes": self.leading_garbage_bytes,
            "width": self.width,
            "height": self.height,
            "notes": self.notes,
        }


# Proprietary wrappers this recognises. Each is a magic, the offset of a
# little endian length field, and the size of the header before the payload.
WRAPPERS = [
    ("dahua-dav", b"DHAV", 4, 32),
    ("hikvision", b"HIKV", 4, 16),
]


def detect(data: bytes) -> str:
    """What shape this file is, decided from its bytes rather than its name."""
    if len(data) >= 12 and data[4:8] in (b"ftyp", b"moov", b"mdat"):
        return "iso-bmff"
    if len(data) >= 4 and data[0] == 0x47 and len(data) > 188 and data[188] == 0x47:
        return "mpeg-ts"
    for name, magic, _, _ in WRAPPERS:
        if data[:4] == magic:
            return name

    units = nal.walk(data[: min(len(data), 1 << 20)])
    if any(u.is_parameter_set for u in units) or len(units) > 4:
        return "annexb"

    # Length prefixed units have no start codes at all, so the only way to tell
    # is that walking the lengths lands exactly on the end of the file.
    if _looks_length_prefixed(data):
        return "avcc"

    return "unknown"


def _looks_length_prefixed(data: bytes, prefix: int = 4) -> bool:
    offset = 0
    seen = 0
    while offset + prefix <= len(data):
        length = int.from_bytes(data[offset : offset + prefix], "big")
        if length == 0 or length > len(data):
            return False
        offset += prefix + length
        seen += 1
        if seen > 4 and offset == len(data):
            return True
    return offset == len(data) and seen > 1


def _unwrap(data: bytes, magic: bytes, length_at: int, header: int) -> tuple[bytes, int]:
    """Pulls the payload out of a proprietary frame wrapper."""
    out = bytearray()
    offset = 0
    frames = 0
    while offset + header <= len(data):
        if data[offset : offset + 4] != magic:
            # Resynchronise on the next magic rather than giving up: a recorder
            # export interrupted mid frame leaves exactly this.
            found = data.find(magic, offset + 1)
            if found < 0:
                break
            offset = found
            continue
        length = struct.unpack_from("<I", data, offset + length_at)[0]
        start = offset + header
        end = start + length
        if end > len(data):
            break
        out += data[start:end]
        frames += 1
        offset = end
    return bytes(out), frames


def _from_lengths(data: bytes, prefix: int = 4) -> bytes:
    out = bytearray()
    offset = 0
    while offset + prefix <= len(data):
        length = int.from_bytes(data[offset : offset + prefix], "big")
        start = offset + prefix
        if length == 0 or start + length > len(data):
            break
        out += b"\x00\x00\x00\x01" + data[start : start + length]
        offset = start + length
    return bytes(out)


def acquire(data: bytes) -> Acquisition:
    """Normalises what arrived into an Annex B master, or refuses with a reason."""
    container = detect(data)
    notes: list[str] = []
    leading = 0

    if container in ("dahua-dav", "hikvision"):
        _, magic, length_at, header = next(w for w in WRAPPERS if w[0] == container)
        stream, frames = _unwrap(data, magic, length_at, header)
        notes.append(f"{frames} proprietary frame header(s) removed, payload kept byte for byte")
    elif container == "avcc":
        stream = _from_lengths(data)
        notes.append("length prefixes replaced with annex b start codes, payload unchanged")
    elif container in ("iso-bmff", "mpeg-ts"):
        return Acquisition(
            container=container,
            opened=False,
            refused="use_a_demuxer",
            detail=f"{container} is a standard container and is demuxed rather than walked. this path is for material a demuxer refuses.",
        )
    else:
        stream = data

    units = nal.walk(stream)
    if not units:
        return Acquisition(
            container=container, opened=False, refused="no_nal_units",
            detail="no h.264 units were found, so this is not an elementary stream this can open",
        )

    # Anything before the first start code is a header nobody documented. It is
    # measured and set aside, never parsed.
    first = units[0].offset - units[0].start_code_len
    if first > 0:
        leading = first
        notes.append(f"{first} bytes before the first start code set aside as an undocumented header")

    sps_units = [u for u in units if u.nal_type == nal.NAL_SPS]
    pps_units = [u for u in units if u.nal_type == nal.NAL_PPS]
    keyframes = [u for u in units if u.is_keyframe]
    corrupt = [u for u in units if u.corrupt]

    if not sps_units or not pps_units:
        return Acquisition(
            container=container, opened=False, refused="missing_parameter_sets",
            detail=(
                "the stream carries no "
                + (" and no ".join(x for x in (["sps"] if not sps_units else []) + (["pps"] if not pps_units else [])))
                + ". a parameter set determines the picture that comes out, so one is not substituted from elsewhere: "
                "a picture decoded with someone else's parameter set is not evidence of anything."
            ),
            units=len(units), keyframes=len(keyframes), leading_garbage_bytes=leading, notes=notes,
        )

    geometry = None
    try:
        geometry = nal.parse_sps(stream[sps_units[0].offset : sps_units[0].offset + sps_units[0].length])
    except (ValueError, EOFError, IndexError) as error:
        notes.append(f"the sequence parameter set did not parse ({error}), so the picture size is unknown")

    # A unit that runs to the end of the file may have been cut short. It is
    # dropped rather than handed to a decoder, which would produce a partial
    # picture indistinguishable from a real one.
    dropped = 0
    tail = units[-1]
    if tail.offset + tail.length >= len(stream) and tail.nal_type in (nal.NAL_SLICE, nal.NAL_IDR):
        expected = sorted(u.length for u in units if u.nal_type == tail.nal_type)
        median = expected[len(expected) // 2] if expected else 0
        if median and tail.length < median * 0.5:
            units = units[:-1]
            dropped = 1
            notes.append(
                f"the final unit is {tail.length} bytes against a typical {median}, so the copy was interrupted. "
                "it is dropped rather than decoded partially."
            )

    # Decoding can only begin at a keyframe. Units before the first one
    # reference pictures the file does not contain.
    first_keyframe = next((i for i, u in enumerate(units) if u.is_keyframe), None)
    unrecoverable = 0
    if first_keyframe is None:
        return Acquisition(
            container=container, opened=False, refused="no_keyframe",
            detail="there is no keyframe anywhere in the stream, so no picture can be decoded from it",
            units=len(units), parameter_sets=len(sps_units) + len(pps_units),
            leading_garbage_bytes=leading, notes=notes,
        )

    leading_slices = [u for u in units[:first_keyframe] if u.nal_type == nal.NAL_SLICE]
    if leading_slices:
        unrecoverable = len(leading_slices)
        notes.append(
            f"{unrecoverable} slice(s) precede the first keyframe and reference pictures that are not in the file. "
            "decoding begins at the keyframe; those frames are unrecoverable rather than approximated."
        )

    # The master: parameter sets first, then everything from the first keyframe.
    keep = [u for u in units if u.is_parameter_set] + [
        u for i, u in enumerate(units) if i >= first_keyframe and not u.is_parameter_set
    ]
    master = b"".join(b"\x00\x00\x00\x01" + stream[u.offset : u.offset + u.length] for u in keep)

    return Acquisition(
        container=container,
        opened=True,
        refused=None,
        detail=f"normalised {len(keep)} unit(s) into an annex b master",
        units=len(units),
        parameter_sets=len(sps_units) + len(pps_units),
        keyframes=len(keyframes),
        corrupt_units=len(corrupt),
        dropped_units=dropped + unrecoverable,
        leading_garbage_bytes=leading,
        width=geometry.width if geometry else None,
        height=geometry.height if geometry else None,
        normalised_bytes=master,
        notes=notes,
    )


def decode_integrity(master: bytes, width: int, height: int, workdir: Path) -> dict[str, Any]:
    """Decodes with concealment off, and reports where the picture is invented.

    With error concealment on, a decoder fills a damaged region with something
    plausible from its neighbours. That is right for watching and wrong for
    measuring: a motion estimator run over concealed pixels reports the
    concealment as movement. Decoding twice, once with concealment and once
    without, shows exactly which frames differ and therefore which regions a
    measurement must not be taken from.
    """
    source = workdir / "master.264"
    source.write_bytes(master)

    def decode(conceal: bool) -> bytes:
        result = subprocess.run(
            [
                "ffmpeg", "-v", "error", "-flags", "+bitexact", "-threads", "1",
                *([] if conceal else ["-ec", "0"]),
                "-i", str(source), "-f", "rawvideo", "-pix_fmt", "gray", "-",
            ],
            capture_output=True,
        )
        return result.stdout

    import numpy as np

    concealed = decode(True)
    raw = decode(False)

    frame_bytes = width * height
    n = min(len(concealed), len(raw)) // frame_bytes
    if n == 0:
        return {"frames": 0, "damaged_frames": [], "detail": "nothing decoded from this stream"}

    a = np.frombuffer(concealed[: n * frame_bytes], dtype=np.uint8).reshape(n, height, width)
    b = np.frombuffer(raw[: n * frame_bytes], dtype=np.uint8).reshape(n, height, width)

    difference = np.abs(a.astype(np.int16) - b.astype(np.int16))
    per_frame = difference.mean(axis=(1, 2))
    damaged = [int(i) for i in np.flatnonzero(per_frame > 0.5)]

    # Which macroblocks differ, so a measurement can mask them rather than
    # avoiding the whole frame.
    blocks: dict[str, list[list[int]]] = {}
    for index in damaged[:24]:
        mb = difference[index].reshape(height // 16, 16, width // 16, 16).mean(axis=(1, 3))
        rows, cols = np.nonzero(mb > 1.0)
        blocks[str(index)] = [[int(r), int(c)] for r, c in zip(rows[:64], cols[:64])]

    return {
        "frames": n,
        "damaged_frames": damaged,
        "damaged_macroblocks": blocks,
        "max_difference": round(float(per_frame.max()), 3),
        "detail": (
            "no frame differs between a concealed and an unconcealed decode, so nothing in this stream is invented"
            if not damaged
            else f"{len(damaged)} frame(s) differ between a concealed and an unconcealed decode. "
            "the marked macroblocks are decoder invention and must not be measured."
        ),
    }
