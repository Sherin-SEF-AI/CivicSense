"""The operator registry.

A module-level table keyed by operator id and version. It is dumped at container
build time and its digest becomes an image label, so a recipe step naming a
container digest also names exactly which operator definitions existed inside
it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from typing import Any, Callable

from pydantic import BaseModel

from fis.canonical import canonical
from fis.operators.contract import Class, Operator, OperatorFn, validate

_REGISTRY: dict[str, Operator] = {}


def operator(
    *,
    id: str,
    version: str,
    cls: Class,
    params: type[BaseModel],
    inputs: tuple[str, ...],
    outputs: tuple[str, ...],
    runtime: str,
    summary: str,
    gpu: bool = False,
    deterministic: bool | None = None,
    max_runtime_s: int = 300,
) -> Callable[[OperatorFn], OperatorFn]:
    def decorate(fn: OperatorFn) -> OperatorFn:
        record = Operator(
            operator_id=id,
            version=version,
            cls=cls,
            params_model=params,
            input_kinds=inputs,
            output_kinds=outputs,
            gpu=gpu,
            deterministic=cls is Class.E if deterministic is None else deterministic,
            runtime=runtime,
            max_runtime_s=max_runtime_s,
            summary=summary,
            fn=fn,
        )
        validate(record)
        if record.key in _REGISTRY:
            raise ValueError(f"{record.key} is registered twice")
        _REGISTRY[record.key] = record
        return fn

    return decorate


def get(operator_id: str, version: str) -> Operator:
    key = f"{operator_id}@{version}"
    if key not in _REGISTRY:
        raise KeyError(f"no operator {key}. registered: {', '.join(sorted(_REGISTRY)) or 'none'}")
    return _REGISTRY[key]


def all_operators() -> list[Operator]:
    return [_REGISTRY[k] for k in sorted(_REGISTRY)]


def dump() -> dict[str, Any]:
    return {"schema": "fis.registry/1", "operators": [op.contract() for op in all_operators()]}


def registry_digest() -> str:
    return hashlib.sha256(canonical(dump()).encode("utf-8")).hexdigest()


def load_all() -> None:
    """Imports every operator module so the registry is populated."""
    import importlib
    import pkgutil

    import fis.operators as package

    for module in pkgutil.walk_packages(package.__path__, f"{package.__name__}."):
        if module.name.rsplit(".", 1)[-1] in {"contract", "registry", "recipe", "execute"}:
            continue
        importlib.import_module(module.name)


def main() -> None:
    parser = argparse.ArgumentParser(description="dump the operator registry")
    parser.add_argument("--digest-only", action="store_true")
    args = parser.parse_args()
    load_all()
    if args.digest_only:
        print(registry_digest())
    else:
        print(json.dumps(dump(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
