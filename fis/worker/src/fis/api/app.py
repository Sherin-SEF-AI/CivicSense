"""The FIS API.

Next reaches FIS only through this service. It is not exposed to a browser and
it binds only to the compose network.

The reason it exists rather than letting Next query Postgres directly: the class
gate, the custody rules and the dual control checks have to live in the same
process as the data. If the console could select from `derivative`, a future
route could assemble a bundle without passing through the gate, and it would do
so by accident rather than by malice. Behind a service, there is one door.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel

from fis.config import CONFIG
from fis.db import pool as db
from fis.api.routers_acquisition import router as acquisition_router
from fis.api.routers_authenticity import router as authenticity_router
from fis.api.routers_kinematics import router as kinematics_router
from fis.api.routers_measure import router as measure_router
from fis.api.routers_timebase import router as timebase_router
from fis.operators.registry import all_operators, load_all, registry_digest

app = FastAPI(title="CivicSense FIS", version="0.1.0", docs_url=None, redoc_url=None)

load_all()
app.include_router(measure_router)
app.include_router(authenticity_router)
app.include_router(kinematics_router)
app.include_router(timebase_router)
app.include_router(acquisition_router)


class Actor(BaseModel):
    user_id: str
    name: str
    role: str
    capabilities: list[str] = []
    investigation_flag: bool = False


def actor_of(header: str | None, signature: str | None) -> Actor:
    """Trusts the console's identity assertion, but only if it is signed.

    FIS does not authenticate people; the console does, using the same session
    helpers every other route uses. What FIS checks is that the assertion came
    from the console and not from something else on the network.
    """
    if not header or not signature:
        raise HTTPException(status_code=401, detail="unsigned actor assertion")

    expected = hmac.new(CONFIG.service_secret.encode(), header.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="actor assertion signature does not verify")

    try:
        return Actor.model_validate_json(header.encode())
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"malformed actor assertion: {error}") from error


@app.get("/health")
def health() -> dict[str, Any]:
    started = time.monotonic()
    try:
        db.one_row("SELECT 1 AS ok")
        postgres = "up"
    except Exception as error:  # noqa: BLE001
        postgres = f"down: {error}"

    return {
        "service": "fis",
        "environment": CONFIG.environment,
        "postgres": postgres,
        "operators": len(all_operators()),
        "registry_digest": registry_digest(),
        "checked_in_ms": round((time.monotonic() - started) * 1000, 2),
    }


@app.get("/v1/operators")
def operators() -> dict[str, Any]:
    """The published contracts, which is what a workbench renders its forms from."""
    return {
        "registry_digest": registry_digest(),
        "items": [op.contract() for op in all_operators()],
    }


@app.get("/v1/incidents/{incident_id}/derivatives")
def derivatives(
    incident_id: str,
    x_fis_actor: str | None = Header(default=None),
    x_fis_sig: str | None = Header(default=None),
) -> dict[str, Any]:
    actor_of(x_fis_actor, x_fis_sig)
    rows = db.all_rows(
        """
        SELECT d.derivative_id, d.parent_sha256, d.recipe_digest, d.output_digest,
               d.output_kind, d.byte_len, d.class_floor, d.produced_by, d.produced_at
          FROM derivative d
         WHERE d.incident_id = %s
         ORDER BY d.produced_at DESC
        """,
        (incident_id,),
    )
    return {"items": rows}


@app.get("/v1/recipes/{recipe_digest}")
def recipe(recipe_digest: str) -> dict[str, Any]:
    head = db.one_row("SELECT * FROM recipe WHERE recipe_digest = %s", (recipe_digest,))
    if not head:
        raise HTTPException(status_code=404, detail="no such recipe")
    steps = db.all_rows(
        "SELECT * FROM recipe_step WHERE recipe_digest = %s ORDER BY i", (recipe_digest,)
    )
    return {"recipe": head, "steps": steps}
