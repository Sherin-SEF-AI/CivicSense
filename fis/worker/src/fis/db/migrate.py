"""Applies the FIS migrations, in order, once each.

Python owns this schema. Two writers with two migration histories is split brain,
and the one place that must never be ambiguous is the store holding the evidence
record.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from fis.db.pool import close, connection

def _migrations_dir() -> Path:
    """Where the schema lives, in the image and in the source tree.

    Checked rather than assumed. An earlier version pointed at a directory that
    did not exist inside the container, found no files, and reported that
    migrations were up to date. The first table a new migration added was then
    missing at runtime, which is the worst possible way to learn about it.
    """
    candidates = [
        Path("/opt/fis/db/migrations"),
        Path(__file__).resolve().parents[4] / "db" / "migrations",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    raise SystemExit(
        "no migrations directory found. looked in: " + ", ".join(str(c) for c in candidates)
    )


MIGRATIONS = None


def apply(directory: Path | None = None) -> list[str]:
    directory = directory or _migrations_dir()
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise SystemExit(f"{directory} contains no migrations, which cannot be right")

    applied: list[str] = []
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version    text PRIMARY KEY,
              applied_at timestamptz NOT NULL DEFAULT now(),
              checksum   text NOT NULL
            )
            """
        )
        conn.commit()

        cur.execute("SELECT version, checksum FROM schema_migrations")
        done = {row["version"]: row["checksum"] for row in cur.fetchall()}

        for path in files:
            sql = path.read_text()
            checksum = hashlib.sha256(sql.encode()).hexdigest()
            if path.stem in done:
                if done[path.stem] != checksum:
                    raise SystemExit(
                        f"{path.stem} was applied with a different checksum. "
                        "write a new migration rather than editing an applied one."
                    )
                continue
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)", (path.stem, checksum)
            )
            conn.commit()
            applied.append(path.stem)

    return applied


if __name__ == "__main__":
    for version in apply():
        print(f"applied {version}")
    print("migrations up to date", file=sys.stderr)
    close()
