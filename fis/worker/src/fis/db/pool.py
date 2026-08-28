"""Postgres access.

A small connection pool and typed helpers. There is no ORM: the schema is the
contract, the triggers are the enforcement, and hiding either behind a mapper
would make it harder to see what is actually guaranteed.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from fis.config import CONFIG

_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(CONFIG.pg_dsn, min_size=1, max_size=8, kwargs={"row_factory": dict_row}, open=True)
    return _pool


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    with pool().connection() as conn:
        yield conn


def close() -> None:
    """Shuts the pool down explicitly.

    Python 3.14 finalisation will not join the pool's worker threads, so a
    script that exits without this prints a traceback that looks like a fault
    and is not one.
    """
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def all_rows(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def one_row(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def execute(sql: str, params: tuple[Any, ...] = ()) -> int:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount
