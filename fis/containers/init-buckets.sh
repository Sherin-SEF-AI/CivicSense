#!/bin/sh
# Creates the vault buckets with Object Lock, once, correctly.
#
# Retention mode is chosen from FIS_ENV and asserted afterwards. COMPLIANCE
# retention cannot be shortened, overridden or deleted by anyone including the
# root account until it expires, so a wrong value here does not fail loudly, it
# fills the disk permanently. Dev and CI therefore get GOVERNANCE with one day,
# and only an explicitly named production environment gets COMPLIANCE.
set -eu

ALIAS=fis
mc alias set "$ALIAS" http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

case "${FIS_ENV:-dev}" in
  prod|production)
    MODE=COMPLIANCE
    DAYS=730
    ;;
  *)
    MODE=GOVERNANCE
    DAYS=1
    ;;
esac

echo "fis: environment ${FIS_ENV:-dev}, object lock ${MODE} for ${DAYS} day(s)"

for BUCKET in fis-vault fis-vault-restricted fis-derivatives; do
  if mc ls "$ALIAS/$BUCKET" >/dev/null 2>&1; then
    echo "fis: $BUCKET already exists, leaving it alone"
  else
    # --with-lock is create-time only. This is the line that matters.
    mc mb --with-lock "$ALIAS/$BUCKET"
    mc retention set --default "$MODE" "${DAYS}d" "$ALIAS/$BUCKET"
    echo "fis: created $BUCKET with $MODE retention"
  fi
done

# Assert rather than assume. A bucket without lock would accept writes and
# silently provide no retention at all.
for BUCKET in fis-vault fis-vault-restricted fis-derivatives; do
  if ! mc retention info --default "$ALIAS/$BUCKET" >/dev/null 2>&1; then
    echo "fis: FATAL $BUCKET has no default retention, object lock was not enabled at creation" >&2
    exit 1
  fi
done

echo "fis: buckets ready"
