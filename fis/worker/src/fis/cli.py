"""Runs one operator, from files, with nothing else in the way.

This is what the determinism harness invokes inside a container. It reads the
input, runs the operator, writes the output and prints its digest. It does not
touch the database, the queue or the object store, because the property being
tested is a property of the operator alone.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from fis.operators.contract import OpCtx, OperatorError
from fis.operators.registry import get, load_all, registry_digest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fis-run", description="run one operator on one input")
    parser.add_argument("--operator", required=True, help="operator_id@version")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--params", type=Path, help="JSON file, defaults to the model defaults")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--input-name", default="raster")
    args = parser.parse_args(argv)

    load_all()
    operator_id, _, version = args.operator.partition("@")
    operator = get(operator_id, version)

    raw = json.loads(args.params.read_text()) if args.params else {}
    params = operator.params_model.model_validate(raw)

    payload = args.input.read_bytes()
    try:
        with OpCtx(job_id="cli", workdir=str(args.input.parent), deterministic=operator.deterministic) as ctx:
            result = operator.fn(ctx, {args.input_name: payload}, params)
    except OperatorError as error:
        print(json.dumps({"refused": error.reason, "detail": error.detail}), file=sys.stderr)
        return 2

    if not isinstance(result, (bytes, bytearray)):
        raise TypeError(f"{operator.key} returned {type(result).__name__}, operators return bytes")

    digest = hashlib.sha256(result).hexdigest()
    if args.output:
        args.output.write_bytes(result)

    print(
        json.dumps(
            {
                "operator": operator.key,
                "class": operator.cls.value,
                "registry_digest": registry_digest(),
                "output_digest": digest,
                "output_bytes": len(result),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
