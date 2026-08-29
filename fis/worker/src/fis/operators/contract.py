"""The operator contract.

Every tool in the suite is an operator, and an operator is defined by more than
its function body: its evidence class, whether it is deterministic, what it
accepts and produces, and the exact parameters it was given. Those travel with
every output, because an enhanced frame with no record of how it was enhanced is
not evidence of anything.

Three classes, and the difference is not a label:

  E  evidentiary. Deterministic, reproducible byte for byte, non-generative. It
     attenuates, aligns, integrates or measures. It never invents content.
  I  investigative. Produces leads, scores or candidates that a person has to
     adjudicate. May use learned models.
  D  demonstrative. Aids explanation. May be generative or lossy.

A chain is only as strong as its weakest step, and that is enforced in the
database rather than here, so that no code path can route around it.
"""

from __future__ import annotations

import enum
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from pydantic import BaseModel


class Class(str, enum.Enum):
    E = "E"
    I = "I"
    D = "D"

    @property
    def rank(self) -> int:
        return {"E": 3, "I": 2, "D": 1}[self.value]


def weaker(a: "Class", b: "Class") -> "Class":
    return a if a.rank <= b.rank else b


class OperatorError(Exception):
    """A refusal. Carries a machine-readable reason, never a silent fallback."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


@dataclass
class OpCtx:
    """Execution context, and the place determinism is enforced.

    Entering pins every source of nondeterminism this process can reach. It is
    not enough to set the environment in the container: OpenCV reads its thread
    count at call time and will happily use an OpenCL path that produces
    different results from its CPU path for the same call.
    """

    job_id: str
    workdir: str
    deterministic: bool = True
    _restore: dict[str, Any] = field(default_factory=dict)

    def __enter__(self) -> "OpCtx":
        if self.deterministic:
            import cv2
            import numpy as np

            self._restore["cv_threads"] = cv2.getNumThreads()
            self._restore["opencl"] = cv2.ocl.useOpenCL()
            cv2.setNumThreads(0)
            cv2.ocl.setUseOpenCL(False)
            np.seterr(all="raise")

            for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
                if os.environ.get(var) != "1":
                    raise OperatorError(
                        "thread_pinning_missing",
                        f"{var} is {os.environ.get(var)!r}, it must be 1 for a deterministic operator",
                    )
        return self

    def __exit__(self, *_exc: object) -> None:
        if self.deterministic and self._restore:
            import cv2

            cv2.setNumThreads(self._restore["cv_threads"])
            cv2.ocl.setUseOpenCL(self._restore["opencl"])


class OperatorFn(Protocol):
    """Returns bytes, or bytes with the measurements it made getting there.

    The second form matters for anything restorative. A deblur that reports how
    much ringing it introduced lets an examiner see over restoration; one that
    returns only a picture asks them to judge it by eye, which is exactly the
    thing that cannot be done reliably. The digest covers the bytes alone, so
    reporting measurements costs nothing in reproducibility.
    """

    def __call__(self, ctx: OpCtx, inputs: dict[str, Any], params: BaseModel) -> Any: ...


def split_result(result: Any) -> tuple[bytes, dict[str, Any]]:
    """Normalises either return shape."""
    if isinstance(result, tuple):
        payload, measurements = result
        if not isinstance(payload, (bytes, bytearray)):
            raise TypeError("an operator returns bytes, optionally with a measurements mapping")
        return bytes(payload), dict(measurements or {})
    if isinstance(result, (bytes, bytearray)):
        return bytes(result), {}
    raise TypeError(f"an operator returned {type(result).__name__}, operators return bytes")


@dataclass(frozen=True)
class Operator:
    operator_id: str
    version: str
    cls: Class
    params_model: type[BaseModel]
    input_kinds: tuple[str, ...]
    output_kinds: tuple[str, ...]
    gpu: bool
    deterministic: bool
    runtime: str
    max_runtime_s: int
    summary: str
    fn: OperatorFn

    @property
    def key(self) -> str:
        return f"{self.operator_id}@{self.version}"

    def contract(self) -> dict[str, Any]:
        """The published contract, and the thing the registry digest covers."""
        return {
            "operator_id": self.operator_id,
            "version": self.version,
            "class": self.cls.value,
            "params_schema": self.params_model.model_json_schema(),
            "input_kinds": list(self.input_kinds),
            "output_kinds": list(self.output_kinds),
            "gpu": self.gpu,
            "deterministic": self.deterministic,
            "runtime": self.runtime,
            "max_runtime_s": self.max_runtime_s,
            "summary": self.summary,
        }


def validate(operator: Operator) -> None:
    """Rules an operator must satisfy to be registered at all.

    The first is the important one. Byte-identical reproduction across container
    rebuilds and GPU execution are not compatible requirements: float reductions
    on a GPU depend on scheduling and on the driver, and this machine will get
    driver updates. Rather than weaken what class E means, class E is CPU only.
    Nothing evidentiary needs a GPU: learned super resolution is demonstrative,
    embeddings are investigative, and measurement is arithmetic.
    """
    if operator.cls is Class.E and operator.gpu:
        raise OperatorError(
            "class_e_cannot_be_gpu",
            f"{operator.key} declares class E and gpu. a gpu float reduction is not reproducible across drivers.",
        )
    if operator.cls is Class.E and not operator.deterministic:
        raise OperatorError("class_e_must_be_deterministic", operator.key)
    if not operator.input_kinds or not operator.output_kinds:
        raise OperatorError("operator_must_declare_kinds", operator.key)

    if operator.cls is Class.E:
        _reject_bare_floats(operator)


def _reject_bare_floats(operator: Operator) -> None:
    """Class E parameters are integers with a declared scale, never floats.

    A float in a params schema leaks nondeterminism twice: into the digest,
    because its textual form is not fixed across languages and versions, and into
    behaviour, because a parameter parsed from JSON may not be the value that was
    intended. Integers with a scale in the field name are unambiguous in both
    directions.
    """
    schema = operator.params_model.model_json_schema()
    for name, prop in (schema.get("properties") or {}).items():
        if prop.get("type") == "number":
            raise OperatorError(
                "class_e_params_must_be_integral",
                f"{operator.key} parameter {name!r} is a float. declare it as an integer with a scale, "
                f"for example {name}_milli, so the digest and the behaviour are both unambiguous.",
            )
