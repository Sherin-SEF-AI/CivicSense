"""Configuration, read once from the environment.

Every value that can change a result is here rather than scattered, so a run can
be described by its configuration and reproduced from it.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Config:
    pg_dsn: str
    redis_url: str
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_secure: bool
    vault_bucket: str
    restricted_bucket: str
    derivative_bucket: str
    legacy_evidence_dir: str
    service_secret: str
    environment: str

    @property
    def is_production(self) -> bool:
        return self.environment in {"prod", "production"}


def load() -> Config:
    return Config(
        pg_dsn=_env("FIS_PG_DSN", "postgresql://fis:fis-local-only@localhost:5433/fis"),
        redis_url=_env("FIS_REDIS_URL", "redis://localhost:6380/0"),
        minio_endpoint=_env("FIS_MINIO_ENDPOINT", "localhost:9010"),
        minio_access_key=_env("FIS_MINIO_USER", "fisadmin"),
        minio_secret_key=_env("FIS_MINIO_PASSWORD", "fis-local-only"),
        minio_secure=_env("FIS_MINIO_SECURE", "0") == "1",
        vault_bucket=_env("FIS_VAULT_BUCKET", "fis-vault"),
        restricted_bucket=_env("FIS_RESTRICTED_BUCKET", "fis-vault-restricted"),
        derivative_bucket=_env("FIS_DERIVATIVE_BUCKET", "fis-derivatives"),
        legacy_evidence_dir=_env("CIVICSENSE_EVIDENCE", "data/evidence"),
        service_secret=_env("FIS_SERVICE_SECRET", "fis-local-only-secret"),
        environment=_env("FIS_ENV", "dev"),
    )


CONFIG = load()
