"""Canonical JSON, RFC 8785.

Every digest in this system is taken over canonical JSON, never over whatever
`json.dumps` happened to produce. The default serialiser's key order, float
formatting and whitespace are all free to change between versions and between
call sites, and a digest that changes for one of those reasons is a digest that
means nothing.

JCS is small enough to implement here rather than take a dependency for, and
implementing it here means the rules are visible next to the thing that relies
on them.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Any


def _number(value: float | int) -> str:
    if isinstance(value, bool):  # bool is an int in Python, and must not be one here
        raise TypeError("booleans are not numbers in JCS")
    if isinstance(value, int):
        return str(value)
    if math.isnan(value) or math.isinf(value):
        raise ValueError("NaN and Infinity have no JSON representation")
    if value == 0:
        # JCS has no negative zero.
        return "0"
    # ECMAScript Number::toString, which is what JCS specifies. repr gives the
    # shortest round-tripping decimal in Python, which agrees for the range we
    # use; exponent formatting is normalised below.
    text = repr(float(value))
    if text.endswith(".0"):
        text = text[:-2]
    match = re.fullmatch(r"(-?)(\d+)(?:\.(\d+))?e([+-])(\d+)", text)
    if match:
        sign, whole, frac, exp_sign, exp = match.groups()
        mantissa = whole + (f".{frac}" if frac else "")
        text = f"{sign}{mantissa}e{exp_sign}{int(exp)}"
    return text


def _escape(text: str) -> str:
    out = ['"']
    for ch in text:
        code = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif code < 0x20:
            out.append(f"\\u{code:04x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def canonical(value: Any) -> str:
    """Serialises to RFC 8785 canonical JSON."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _escape(value)
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        # JCS orders by the UTF-16 code units of the key, which for the keys this
        # system uses is the same as ordering by code point.
        items = sorted(value.items(), key=lambda kv: _utf16_key(kv[0]))
        return "{" + ",".join(f"{_escape(k)}:{canonical(v)}" for k, v in items) + "}"
    raise TypeError(f"{type(value).__name__} has no canonical JSON form")


def _utf16_key(key: str) -> tuple[int, ...]:
    if not isinstance(key, str):
        raise TypeError("object keys must be strings")
    return tuple(key.encode("utf-16-be"))


def digest(value: Any) -> str:
    """The sha-256 of the canonical form. This is what every digest field holds."""
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()
