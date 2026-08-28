#!/usr/bin/env python3
"""Static checks on class E operators.

The determinism harness is the proof, but it takes minutes and it only tells you
that something diverged, not what. This runs in about a second and names the
line. Most determinism regressions are one of a small set of mistakes, and all of
them are visible in the syntax tree.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "worker" / "src" / "fis" / "operators"

# Attribute chains that make an operator's output depend on something other than
# its declared inputs and parameters.
BANNED_CALLS = {
    "time.time": "reads the clock",
    "time.time_ns": "reads the clock",
    "time.monotonic": "reads the clock",
    "datetime.now": "reads the clock",
    "datetime.utcnow": "reads the clock",
    "uuid.uuid1": "derives from the clock and the mac address",
    "uuid.uuid4": "random",
    "random.random": "random without a declared seed",
    "random.randint": "random without a declared seed",
    "random.choice": "random without a declared seed",
    "np.random.rand": "random without a declared seed",
    "np.random.randn": "random without a declared seed",
    "np.random.random": "random without a declared seed",
    "np.random.randint": "random without a declared seed",
    "cv2.setNumThreads": "thread control belongs to OpCtx, not to an operator",
    "cv2.ocl.setUseOpenCL": "the opencl path belongs to OpCtx, not to an operator",
    "os.getenv": "reads ambient configuration",
    "os.environ.get": "reads ambient configuration",
}

BANNED_IMPORTS = {
    "threading": "concurrency reorders reductions",
    "multiprocessing": "concurrency reorders reductions",
    "concurrent.futures": "concurrency reorders reductions",
    "torch": "gpu tensors are not reproducible across drivers; class E is cpu only",
    "secrets": "random",
}

# Iterative solvers must stop on a fixed count. A tolerance turns a one-ulp
# difference into a whole extra iteration and a visibly different image.
EPS_TERMS = {"TERM_CRITERIA_EPS"}


class Checker(ast.NodeVisitor):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.findings: list[str] = []

    def _at(self, node: ast.AST, message: str) -> None:
        self.findings.append(f"{self.path.name}:{getattr(node, 'lineno', 0)} {message}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root in BANNED_IMPORTS:
                self._at(node, f"imports {alias.name}: {BANNED_IMPORTS[root]}")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        root = (node.module or "").split(".")[0]
        if root in BANNED_IMPORTS:
            self._at(node, f"imports from {node.module}: {BANNED_IMPORTS[root]}")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        name = _dotted(node.func)
        if name in BANNED_CALLS:
            self._at(node, f"calls {name}: {BANNED_CALLS[name]}")
        # sorted() over a set feeding a reduction is order dependent before the
        # sort and often the sort key is the bug.
        if name == "sorted" and node.args and isinstance(node.args[0], ast.Set):
            self._at(node, "sorts a set literal; declare the order explicitly")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in EPS_TERMS:
            self._at(node, f"uses {node.attr}: iterate a fixed number of times, never to a tolerance")
        self.generic_visit(node)


def _dotted(node: ast.AST) -> str:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def is_class_e(tree: ast.Module) -> bool:
    """True if any operator declared in this module is class E."""
    for node in ast.walk(tree):
        if isinstance(node, ast.keyword) and node.arg == "cls":
            if _dotted(node.value) in {"Class.E"}:
                return True
    return False


def main() -> int:
    findings: list[str] = []
    checked = 0

    for path in sorted(ROOT.rglob("*.py")):
        if path.name in {"contract.py", "registry.py", "recipe.py", "execute.py", "__init__.py"}:
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        if not is_class_e(tree):
            continue
        checked += 1
        checker = Checker(path)
        checker.visit(tree)
        findings.extend(checker.findings)

    for finding in findings:
        print(f"FAIL {finding}")

    if findings:
        print(f"\n{len(findings)} finding(s) in class E operator modules")
        return 1

    print(f"operator lint clean across {checked} module(s) declaring class E operators")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
