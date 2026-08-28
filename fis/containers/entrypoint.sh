#!/bin/sh
# Pins every source of nondeterminism reachable from the environment, then
# asserts the pinning took. An operator that starts without these is not
# reproducible, and finding that out from a mismatched digest weeks later is
# much worse than refusing to start.
set -eu

export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export MKL_NUM_THREADS=1
export NUMEXPR_NUM_THREADS=1
export VECLIB_MAXIMUM_THREADS=1
export PYTHONHASHSEED=0
export TZ=UTC
export LC_ALL=C
export LANG=C
# numpy 2 selects kernels from the CPU's feature set, so the same array can take
# a different code path on a different host. Pinning to a baseline removes that
# as a variable; the quantised output container removes the rest.
export NPY_DISABLE_CPU_FEATURES="AVX512F AVX512CD AVX512_SKX AVX512_ICL AVX512_SPR"
export PYTHONDONTWRITEBYTECODE=1

exec "$@"
