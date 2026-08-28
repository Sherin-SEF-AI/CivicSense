"""Measurement endpoints.

Thin: validate, run the operator, record what ran. The operator itself holds the
geometry and the uncertainty, and nothing here is allowed to reinterpret its
result. In particular a refusal is passed through as a refusal, never softened
into a very wide number, because a wide number invites someone to quote the
midpoint.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from fis.operators.contract import OpCtx, OperatorError
from fis.operators.registry import get, registry_digest
from fis.canonical import digest as canonical_digest

router = APIRouter(prefix="/v1/measure", tags=["measure"])


class MeasureRequest(BaseModel):
    operator: str
    version: str = "1.0.0"
    params: dict[str, Any]
    incident_id: str | None = None
    source_id: str | None = None


@router.post("")
def measure(request: MeasureRequest) -> dict[str, Any]:
    try:
        operator = get(request.operator, request.version)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    if not str(operator.operator_id).startswith("V-MET"):
        raise HTTPException(status_code=400, detail="this endpoint runs measurement operators only")

    try:
        params = operator.params_model.model_validate(request.params)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"parameters rejected: {error}") from error

    try:
        with OpCtx(job_id="measure", workdir="/tmp", deterministic=operator.deterministic) as ctx:
            raw = operator.fn(ctx, {}, params)
    except OperatorError as error:
        # A refusal is a result. It carries a reason a person can act on.
        return {
            "refused": error.reason,
            "detail": error.detail,
            "operator": operator.key,
            "class": operator.cls.value,
        }

    import json

    result = json.loads(raw)
    return {
        "operator": operator.key,
        "class": operator.cls.value,
        "registry_digest": registry_digest(),
        # The parameters are part of the measurement. Their digest is what makes
        # a reported number traceable to the marks that produced it.
        "params_digest": canonical_digest(params.model_dump(mode="json")),
        "result": result,
    }
