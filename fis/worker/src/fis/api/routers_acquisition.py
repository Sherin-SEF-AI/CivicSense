"""Acquisition of material a normal demuxer refuses."""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, UploadFile

from fis.services.acquisition import acquire, decode_integrity, detect

router = APIRouter(prefix="/v1/acquire", tags=["acquire"])

# Bounded, because this walks the whole file in memory and an unbounded upload
# is a way to take the tier down.
MAX_BYTES = 512 * 1024 * 1024


@router.post("")
async def acquisition(
    file: UploadFile = File(...),
    integrity: bool = Form(default=True),
) -> dict[str, Any]:
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return {"opened": False, "refused": "too_large", "detail": f"the limit for this path is {MAX_BYTES} bytes"}

    original_digest = hashlib.sha256(data).hexdigest()
    result = acquire(data)

    report: dict[str, Any] = {
        **result.report(),
        "original_sha256": original_digest,
        "original_bytes": len(data),
        "detected_as": detect(data),
    }

    if result.opened and result.normalised_bytes is not None:
        report["normalised_sha256"] = hashlib.sha256(result.normalised_bytes).hexdigest()
        report["normalised_bytes"] = len(result.normalised_bytes)
        # The original is the record. The master is a derivative of it, and the
        # digest of each is stated so the relationship is checkable.
        report["relationship"] = (
            "the original bytes are unmodified. the master is a derivative produced by the steps in this report."
        )

        if integrity and result.width and result.height:
            with tempfile.TemporaryDirectory() as tmp:
                report["decode_integrity"] = decode_integrity(
                    result.normalised_bytes, result.width, result.height, Path(tmp)
                )

    return report
