"""Clock observations, models, and what a timestamp means.

Observations are appended and never edited. Fitting is explicit rather than
implicit on read, so the model an answer came from is a stored row someone can
point at rather than something recomputed differently on each request.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from fis.db import pool as db
from fis.services.timebase import Observation, Segment, pair_sigma, resolve, segment

router = APIRouter(prefix="/v1/timebase", tags=["timebase"])

VALID_METHODS = {"ntp", "gnss", "burned_ocr", "pts_anchor", "gcc_phat", "visual_event", "manual"}


class ObservationIn(BaseModel):
    source_id: str
    t_source_ms: int
    t_utc_ms: int
    sigma_ms: float = Field(gt=0)
    method: str
    peer_source_id: str | None = None
    evidence_ref: str | None = None
    detail: str = ""


@router.post("/observations")
def add_observations(items: list[ObservationIn]) -> dict[str, Any]:
    for item in items:
        if item.method not in VALID_METHODS:
            raise HTTPException(status_code=400, detail=f"unknown sync method {item.method!r}")

    with db.connection() as conn, conn.cursor() as cur:
        for item in items:
            cur.execute(
                """
                INSERT INTO sync_observation
                  (source_id, t_source_ms, t_utc_ms, sigma_ms, method, peer_source_id, evidence_ref, detail)
                VALUES (%s, %s, %s, %s, %s::sync_method, %s, %s, %s)
                """,
                (
                    item.source_id, item.t_source_ms, item.t_utc_ms, item.sigma_ms,
                    item.method, item.peer_source_id, item.evidence_ref, item.detail,
                ),
            )
    return {"recorded": len(items), "sources": sorted({i.source_id for i in items})}


def _load(source_id: str) -> list[Observation]:
    rows = db.all_rows(
        "SELECT t_source_ms, t_utc_ms, sigma_ms, method::text AS method FROM sync_observation "
        "WHERE source_id = %s ORDER BY t_source_ms",
        (source_id,),
    )
    return [
        Observation(float(r["t_source_ms"]), float(r["t_utc_ms"]), float(r["sigma_ms"]), r["method"]) for r in rows
    ]


def _store(source_id: str, segments: list[Segment]) -> None:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM clock_segment WHERE source_id = %s", (source_id,))
        for s in segments:
            cur.execute(
                """
                INSERT INTO clock_segment
                  (source_id, seq, t_from_ms, t_to_ms, offset_ms, drift_ppm,
                   offset_se_ms, drift_se_ppm, n_obs, residual_ms, drift_measurable)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    source_id, s.seq, int(s.t_from_ms), int(s.t_to_ms), s.offset_ms, s.drift_ppm,
                    s.offset_se_ms, s.drift_se_ppm, s.n_obs, s.residual_ms, s.drift_measurable,
                ),
            )


def _segments(source_id: str) -> list[Segment]:
    rows = db.all_rows("SELECT * FROM clock_segment WHERE source_id = %s ORDER BY seq", (source_id,))
    return [
        Segment(
            seq=r["seq"], t_from_ms=float(r["t_from_ms"]), t_to_ms=float(r["t_to_ms"]),
            offset_ms=float(r["offset_ms"]), drift_ppm=float(r["drift_ppm"]),
            offset_se_ms=float(r["offset_se_ms"]), drift_se_ppm=float(r["drift_se_ppm"]),
            n_obs=r["n_obs"], residual_ms=float(r["residual_ms"]), drift_measurable=r["drift_measurable"],
        )
        for r in rows
    ]


@router.post("/{source_id}/fit")
def fit(source_id: str) -> dict[str, Any]:
    observations = _load(source_id)
    if len(observations) < 2:
        return {
            "source_id": source_id,
            "fitted": False,
            "observations": len(observations),
            "detail": "at least two observations are needed before a clock can be modelled",
        }

    segments = segment(observations)
    _store(source_id, segments)

    return {
        "source_id": source_id,
        "fitted": True,
        "observations": len(observations),
        "segments": [
            {
                "seq": s.seq,
                "from_ms": int(s.t_from_ms),
                "to_ms": int(s.t_to_ms),
                "offset_ms": round(s.offset_ms, 3),
                "drift_ppm": round(s.drift_ppm, 3) if s.drift_measurable else None,
                "drift_measurable": s.drift_measurable,
                "residual_ms": round(s.residual_ms, 3),
                "n_obs": s.n_obs,
            }
            for s in segments
        ],
        "detail": (
            f"{len(segments)} segment(s). a new segment begins wherever the clock was stepped, because fitting a rate "
            "across a reboot describes the reboot rather than the oscillator."
        ),
    }


@router.get("/{source_id}/resolve")
def resolve_time(source_id: str, t_source_ms: int) -> dict[str, Any]:
    segments = _segments(source_id)
    result = resolve(segments, float(t_source_ms))
    return {
        "source_id": source_id,
        "t_source_ms": t_source_ms,
        "t_utc_ms": None if result.refused else int(round(result.t_utc_ms)),
        "sigma_ms": None if result.sigma_ms == float("inf") else round(result.sigma_ms, 2),
        "grade": result.grade,
        "extrapolated_s": result.extrapolated_s,
        "refused": result.refused,
        "detail": (
            "no clock model exists for this source, so its timestamps cannot be placed in true time"
            if result.refused == "no_clock_model"
            else "the source has not been observed recently enough to place its timestamps within the threshold"
            if result.refused
            else f"resolved from a fitted model, {result.extrapolated_s:.0f} s beyond the last observation"
        ),
    }


@router.get("/pair")
def pair(a: str, b: str, t_a_ms: int, t_b_ms: int) -> dict[str, Any]:
    ra = resolve(_segments(a), float(t_a_ms))
    rb = resolve(_segments(b), float(t_b_ms))
    return {"a": a, "b": b, **pair_sigma(ra, rb)}
