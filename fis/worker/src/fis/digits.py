"""A fixed width digit font, and the templates a reader matches against.

DVR overlays are drawn by the recorder in a fixed bitmap font at a fixed
position, which is why per model templates work where general text recognition
struggles: the glyphs are identical every frame and the only thing that varies
is what the compression did to them.

The font is defined here rather than loaded, so the corpus and the reader agree
about what a digit is by construction, and the difficulty in the test comes from
the degradation rather than from a font mismatch.
"""

from __future__ import annotations

import numpy as np

# Five wide, seven tall, the shape almost every recorder overlay uses.
GLYPHS: dict[str, tuple[str, ...]] = {
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "3": ("11111", "00010", "00100", "00010", "00001", "10001", "01110"),
    "4": ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    "5": ("11111", "10000", "11110", "00001", "00001", "10001", "01110"),
    "6": ("00110", "01000", "10000", "11110", "10001", "10001", "01110"),
    "7": ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    "8": ("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
    "9": ("01110", "10001", "10001", "01111", "00001", "00010", "01100"),
    "-": ("00000", "00000", "00000", "01110", "00000", "00000", "00000"),
    ":": ("00000", "00100", "00000", "00000", "00000", "00100", "00000"),
    " ": ("00000", "00000", "00000", "00000", "00000", "00000", "00000"),
}

GLYPH_W = 5
GLYPH_H = 7


def glyph(character: str, scale: int = 2) -> np.ndarray:
    rows = GLYPHS[character]
    bitmap = np.array([[1.0 if c == "1" else 0.0 for c in row] for row in rows])
    return np.kron(bitmap, np.ones((scale, scale)))


def render(text: str, scale: int = 2, spacing: int = 1) -> np.ndarray:
    """A text strip as a float mask, ones where ink is."""
    parts = [glyph(c, scale) for c in text]
    gap = np.zeros((GLYPH_H * scale, spacing * scale))
    pieces: list[np.ndarray] = []
    for i, part in enumerate(parts):
        if i:
            pieces.append(gap)
        pieces.append(part)
    return np.hstack(pieces) if pieces else np.zeros((GLYPH_H * scale, 0))


def cell_width(scale: int, spacing: int = 1) -> int:
    return (GLYPH_W + spacing) * scale


def templates(scale: int = 2) -> dict[str, np.ndarray]:
    """What a reader matches against. Built from the same font a recorder uses."""
    return {c: glyph(c, scale) for c in "0123456789"}
