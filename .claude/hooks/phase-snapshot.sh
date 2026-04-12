#!/usr/bin/env bash
# Generate a snapshot of current UI file state before a phase begins.
# Run this at the start of /implement. The snapshot is compared after
# implementation to detect unplanned file removals or shrinkage.
set -euo pipefail

SNAPSHOT=".phase-snapshot.json"
TEMP="${SNAPSHOT}.tmp"

echo '{}' > "$SNAPSHOT"

find src/app src/components src/server -name '*.tsx' -o -name '*.ts' 2>/dev/null | sort | while read -r f; do
  LINES=$(wc -l < "$f")
  # fallback-allowed: grep -c returns 1 when no matches found, 0 is the correct count
  EXPORTS=$(grep -c "^export " "$f" 2>/dev/null || echo 0)
  jq --arg f "$f" --argjson l "$LINES" --argjson e "$EXPORTS" \
    '. + {($f): {"lines": $l, "exports": $e}}' \
    "$SNAPSHOT" > "$TEMP" && mv "$TEMP" "$SNAPSHOT"
done

COUNT=$(jq 'length' "$SNAPSHOT")
echo "Phase snapshot saved to $SNAPSHOT ($COUNT files captured)"
