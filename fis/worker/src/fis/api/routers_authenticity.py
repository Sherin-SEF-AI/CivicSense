"""Authenticity over an object in the console's vault.

The console's evidence store is mounted read only. FIS reads the original bytes
and never writes to or deletes from it, so the tier can be removed entirely
without the record being any different.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from fis.services.authenticity import run_battery, verdict_of

router = APIRouter(prefix="/v1/authenticity", tags=["authenticity"])

# Read only stores the tier may look in. Configured, never taken from a request:
# a caller asks for an object by hash, not by path.
VAULT_ROOTS = [Path(p) for p in os.environ.get("FIS_VAULT_ROOTS", "/vault/legacy").split(":") if p]


class AuthenticityRequest(BaseModel):
    sha256: str
    width: int | None = None
    height: int | None = None
    claimed_capture_ms: int | None = None
    signature_verdict: str = "unverified"


def _locate(sha256: str) -> Path:
    if len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
        raise HTTPException(status_code=400, detail="an object is addressed by its sha-256 and nothing else")
    for root in VAULT_ROOTS:
        shard = root / sha256[:2]
        if not shard.is_dir():
            continue
        for candidate in sorted(shard.iterdir()):
            if candidate.name.startswith(sha256):
                return candidate
    raise HTTPException(status_code=404, detail=f"no object {sha256[:16]} in any configured vault")


@router.post("")
def authenticity(request: AuthenticityRequest) -> dict[str, Any]:
    path = _locate(request.sha256)

    # The digest is recomputed here rather than trusted from the caller. This
    # tier reads the bytes, so it is the tier that can say whether they are the
    # bytes the name claims.
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    recomputed = digest.hexdigest()

    if recomputed != request.sha256:
        return {
            "sha256": request.sha256,
            "verdict": "inconsistent",
            "tests": [
                {
                    "test": "content hash",
                    "result": "fail",
                    "detail": f"the stored bytes hash to {recomputed[:16]}, not to the name they are stored under",
                    "standard": "ISO/IEC 27037",
                    "mandatory": True,
                    "measurements": {"recomputed": recomputed},
                }
            ],
        }

    if request.width is None or request.height is None:
        # Without the frame size the picture tests cannot decode, and guessing
        # would produce measurements of noise.
        return {
            "sha256": request.sha256,
            "verdict": "consistent",
            "tests": [
                {
                    "test": "content hash",
                    "result": "pass",
                    "detail": f"the stored bytes recompute to {request.sha256[:16]}",
                    "standard": "ISO/IEC 27037",
                    "mandatory": True,
                    "measurements": {},
                },
                {
                    "test": "picture battery",
                    "result": "inconclusive",
                    "detail": "no frame size was recorded for this object, so the picture tests could not run on it",
                    "standard": None,
                    "mandatory": False,
                    "measurements": {},
                },
            ],
        }

    try:
        report = run_battery(path, request.width, request.height, request.claimed_capture_ms)
    except Exception as error:  # noqa: BLE001
        # A decode failure is a finding about the object, not a server fault.
        return {
            "sha256": request.sha256,
            "verdict": "inconsistent",
            "tests": [
                {
                    "test": "decode",
                    "result": "fail",
                    "detail": f"the object could not be decoded: {error}",
                    "standard": None,
                    "mandatory": True,
                    "measurements": {},
                }
            ],
        }

    report["tests"].insert(
        0,
        {
            "test": "content hash",
            "result": "pass",
            "detail": f"the stored bytes recompute to {request.sha256[:16]}",
            "standard": "ISO/IEC 27037",
            "mandatory": True,
            "measurements": {},
        },
    )
    from fis.services.authenticity import TestResult

    rebuilt = [
        TestResult(t["test"], t["result"], t["detail"], t["standard"], t["measurements"], t["mandatory"])
        for t in report["tests"]
    ]
    report["verdict"] = verdict_of(rebuilt, request.signature_verdict)
    report["sha256"] = request.sha256
    return report
