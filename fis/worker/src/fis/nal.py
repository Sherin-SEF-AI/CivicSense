"""Walking an H.264 elementary stream by hand.

A container tells you where the frames are. Half of real casework arrives
without one: a `.dav` file with proprietary framing, a raw dump pulled off a
recorder's disk, a partial file recovered from unallocated space. For those the
only structure is the stream itself, and reading it means finding the NAL units
directly.

Nothing here decodes a picture. It finds the units, says what kind each one is,
and recovers the parameter sets a decoder needs, so that material a normal
demuxer refuses can be turned into something that opens. What it must never do
is guess: a stream missing its parameter sets is reported as missing them, not
handed a plausible set from somewhere else. Substituting a parameter set changes
the picture that comes out, and a picture that came out of a substituted
parameter set is not evidence of anything.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

# H.264 NAL unit types that matter here. The rest are passed through untouched.
NAL_SLICE = 1
NAL_IDR = 5
NAL_SEI = 6
NAL_SPS = 7
NAL_PPS = 8
NAL_AUD = 9

TYPE_NAMES = {
    1: "slice", 2: "slice-a", 3: "slice-b", 4: "slice-c", 5: "idr", 6: "sei",
    7: "sps", 8: "pps", 9: "aud", 10: "eoseq", 11: "eostream", 12: "filler",
}


@dataclass(frozen=True)
class Nal:
    offset: int          # where the payload starts, after the start code
    length: int          # payload length in bytes, excluding the start code
    start_code_len: int  # 3 or 4, which varies within a single real stream
    nal_type: int
    ref_idc: int
    corrupt: bool = False

    @property
    def name(self) -> str:
        return TYPE_NAMES.get(self.nal_type, f"type-{self.nal_type}")

    @property
    def is_parameter_set(self) -> bool:
        return self.nal_type in (NAL_SPS, NAL_PPS)

    @property
    def is_keyframe(self) -> bool:
        return self.nal_type == NAL_IDR


def find_start_codes(data: bytes) -> Iterator[tuple[int, int]]:
    """Yields (payload_offset, start_code_length) for every Annex B start code.

    Three and four byte start codes are both legal and both occur in the same
    file, because encoders emit four before parameter sets and three elsewhere.
    A scanner that assumes one length silently loses half the units.
    """
    i = 0
    n = len(data)
    while i < n - 3:
        if data[i] == 0 and data[i + 1] == 0:
            if data[i + 2] == 1:
                yield i + 3, 3
                i += 3
                continue
            if i + 3 < n and data[i + 2] == 0 and data[i + 3] == 1:
                yield i + 4, 4
                i += 4
                continue
        i += 1


def walk(data: bytes) -> list[Nal]:
    """Every NAL unit in an Annex B stream, in order."""
    starts = list(find_start_codes(data))
    units: list[Nal] = []

    for index, (offset, code_len) in enumerate(starts):
        end = starts[index + 1][0] - starts[index + 1][1] if index + 1 < len(starts) else len(data)
        length = end - offset
        if length <= 0:
            continue
        header = data[offset]
        # The forbidden_zero_bit must be zero. Set means the byte is not a NAL
        # header, which happens when a start code pattern occurs inside payload
        # that was not properly escaped, or when the data is damaged.
        corrupt = bool(header & 0x80)
        units.append(
            Nal(
                offset=offset,
                length=length,
                start_code_len=code_len,
                nal_type=header & 0x1F,
                ref_idc=(header >> 5) & 0x03,
                corrupt=corrupt,
            )
        )
    return units


def strip_emulation_prevention(payload: bytes) -> bytes:
    """Removes the 0x03 bytes an encoder inserts to protect start code patterns.

    Any occurrence of 00 00 00, 00 00 01, 00 00 02 or 00 00 03 in the raw
    payload would look like a start code to a scanner, so an encoder writes
    00 00 03 xx instead. Reading the bitstream without removing them gives
    wrong values in exactly the fields that describe the picture size.
    """
    out = bytearray()
    zeros = 0
    for byte in payload:
        if zeros == 2 and byte == 0x03:
            zeros = 0
            continue
        out.append(byte)
        zeros = zeros + 1 if byte == 0 else 0
    return bytes(out)


class BitReader:
    """Just enough of one to read a sequence parameter set."""

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    def bit(self) -> int:
        byte = self.pos >> 3
        if byte >= len(self.data):
            raise EOFError("ran off the end of the bitstream")
        value = (self.data[byte] >> (7 - (self.pos & 7))) & 1
        self.pos += 1
        return value

    def bits(self, count: int) -> int:
        value = 0
        for _ in range(count):
            value = (value << 1) | self.bit()
        return value

    def ue(self) -> int:
        """Unsigned exponential Golomb, which is how H.264 codes most fields."""
        leading = 0
        while self.bit() == 0:
            leading += 1
            if leading > 32:
                raise ValueError("exponential golomb code longer than 32 bits")
        if leading == 0:
            return 0
        return (1 << leading) - 1 + self.bits(leading)

    def se(self) -> int:
        value = self.ue()
        return (value + 1) // 2 if value % 2 else -(value // 2)


@dataclass(frozen=True)
class Sps:
    profile_idc: int
    level_idc: int
    seq_parameter_set_id: int
    width: int
    height: int
    frame_mbs_only: bool


def parse_sps(payload: bytes) -> Sps:
    """Reads picture geometry out of a sequence parameter set.

    Only far enough to recover the frame size, which is what a caller needs to
    decide whether a recovered stream is coherent and what a raw decode should
    be shaped as.
    """
    rbsp = strip_emulation_prevention(payload[1:])  # drop the NAL header byte
    reader = BitReader(rbsp)

    profile_idc = reader.bits(8)
    reader.bits(8)  # constraint flags and reserved
    level_idc = reader.bits(8)
    sps_id = reader.ue()

    chroma_format_idc = 1
    if profile_idc in (100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135):
        chroma_format_idc = reader.ue()
        if chroma_format_idc == 3:
            reader.bit()  # separate_colour_plane_flag
        reader.ue()  # bit_depth_luma_minus8
        reader.ue()  # bit_depth_chroma_minus8
        reader.bit()  # qpprime_y_zero_transform_bypass_flag
        if reader.bit():  # seq_scaling_matrix_present_flag
            for i in range(8 if chroma_format_idc != 3 else 12):
                if reader.bit():
                    size = 16 if i < 6 else 64
                    last = next_scale = 8
                    for _ in range(size):
                        if next_scale != 0:
                            next_scale = (last + reader.se() + 256) % 256
                        last = last if next_scale == 0 else next_scale

    reader.ue()  # log2_max_frame_num_minus4
    pic_order_cnt_type = reader.ue()
    if pic_order_cnt_type == 0:
        reader.ue()
    elif pic_order_cnt_type == 1:
        reader.bit()
        reader.se()
        reader.se()
        for _ in range(reader.ue()):
            reader.se()

    reader.ue()  # max_num_ref_frames
    reader.bit()  # gaps_in_frame_num_value_allowed_flag

    width_mbs = reader.ue() + 1
    height_map_units = reader.ue() + 1
    frame_mbs_only = bool(reader.bit())
    if not frame_mbs_only:
        reader.bit()  # mb_adaptive_frame_field_flag
    reader.bit()  # direct_8x8_inference_flag

    crop_left = crop_right = crop_top = crop_bottom = 0
    if reader.bit():  # frame_cropping_flag
        crop_left = reader.ue()
        crop_right = reader.ue()
        crop_top = reader.ue()
        crop_bottom = reader.ue()

    sub_width = 2 if chroma_format_idc in (1, 2) else 1
    sub_height = 2 if chroma_format_idc == 1 else 1
    if not frame_mbs_only:
        sub_height *= 2

    width = width_mbs * 16 - (crop_left + crop_right) * sub_width
    height = height_map_units * 16 * (1 if frame_mbs_only else 2) - (crop_top + crop_bottom) * sub_height

    return Sps(profile_idc, level_idc, sps_id, int(width), int(height), frame_mbs_only)
