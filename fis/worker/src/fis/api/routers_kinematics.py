"""Kinematics over ground-plane tracks."""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

from fis.services.kinematics import Track, estimate, summarise

router = APIRouter(prefix="/v1/kinematics", tags=["kinematics"])


class Sample(BaseModel):
    t_ms: float
    lat: float
    lon: float


class TrackRequest(BaseModel):
    track_id: str
    entity_ref: str | None = None
    descriptor: str = ""
    residual_m: float
    sync_sigma_ms: float
    samples: list[Sample]


class KinematicsRequest(BaseModel):
    tracks: list[TrackRequest]


EARTH_M = 6_371_000.0


def _to_local(samples: list[Sample]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Latitude and longitude to metres in a local frame.

    Equirectangular about the track's own first point. Over the tens of metres a
    single camera covers the error is far below the calibration residual, and
    keeping the frame local means no projection choice leaks into the answer.
    """
    t = np.array([s.t_ms for s in samples], dtype=np.float64)
    lat = np.array([s.lat for s in samples], dtype=np.float64)
    lon = np.array([s.lon for s in samples], dtype=np.float64)
    lat0 = float(lat[0])
    x = np.deg2rad(lon - lon[0]) * np.cos(np.deg2rad(lat0)) * EARTH_M
    y = np.deg2rad(lat - lat0) * EARTH_M
    return t, x, y


@router.post("")
def kinematics(request: KinematicsRequest) -> dict[str, Any]:
    out = []
    for track in request.tracks:
        if len(track.samples) < 2:
            out.append({"track_id": track.track_id, "refused": "too_few_samples"})
            continue

        t, x, y = _to_local(sorted(track.samples, key=lambda s: s.t_ms))
        result = estimate(
            Track(t_ms=t, x_m=x, y_m=y, residual_m=track.residual_m, sync_sigma_ms=track.sync_sigma_ms)
        )
        summary = summarise(result)

        if "refused" in summary:
            out.append({"track_id": track.track_id, "entity_ref": track.entity_ref, **summary})
            continue

        out.append(
            {
                "track_id": track.track_id,
                "entity_ref": track.entity_ref,
                "descriptor": track.descriptor,
                "estimator": "constant acceleration kalman filter with rts smoothing",
                **summary,
                "series": [
                    {
                        "t": int(result.t_ms[i]),
                        "speed": round(float(result.speed_kmh[i]), 3),
                        "speed_lo": round(float(result.speed_kmh[i] - 1.96 * result.speed_sigma_kmh[i]), 3),
                        "speed_hi": round(float(result.speed_kmh[i] + 1.96 * result.speed_sigma_kmh[i]), 3),
                        "accel": round(float(result.accel_ms2[i]), 3),
                    }
                    for i in range(result.speed_kmh.size)
                ],
            }
        )

    return {"items": out}
