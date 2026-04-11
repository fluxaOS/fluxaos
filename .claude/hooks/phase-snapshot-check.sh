#!/usr/bin/env bash
# Compare current file state against the pre-phase snapshot.
# Run this after /implement, before /review.
# Reports removed files, significantly shrunk files, and lost exports.
set -euo pipefail

SNAPSHOT=".phase-snapshot.json"

if [[ ! -f "$SNAPSHOT" ]]; then
  echo "No phase snapshot found at $SNAPSHOT — skipping check."
  echo "Run .claude/hooks/phase-snapshot.sh before implementing."
  exit 0
fi

ISSUES=0

while IFS= read -r line; do
  FILE=$(echo "$line" | jq -r '.key')
  OLD_LINES=$(echo "$line" | jq -r '.value.lines')
  OLD_EXPORTS=$(echo "$line" | jq -r '.value.exports')

  if [[ ! -f "$FILE" ]]; then
    echo "REMOVED: $FILE (had $OLD_LINES lines, $OLD_EXPORTS exports)"
    ISSUES=$((ISSUES + 1))
    continue
  fi

  NEW_LINES=$(wc -l < "$FILE")
  # fallback-allowed: grep -c returns 1 when no matches found, 0 is the correct count
  NEW_EXPORTS=$(grep -c "^export " "$FILE" 2>/dev/null || echo 0)

  if [[ "$OLD_LINES" -gt 0 ]]; then
    LOSS=$(( (OLD_LINES - NEW_LINES) * 100 / OLD_LINES ))
    if [[ "$LOSS" -gt 20 ]]; then
      echo "SHRUNK: $FILE lost ${LOSS}% of lines ($OLD_LINES -> $NEW_LINES)"
      ISSUES=$((ISSUES + 1))
    fi
  fi

  EXPORT_LOSS=$((OLD_EXPORTS - NEW_EXPORTS))
  if [[ "$EXPORT_LOSS" -gt 0 ]]; then
    echo "EXPORTS REMOVED: $FILE lost $EXPORT_LOSS exports ($OLD_EXPORTS -> $NEW_EXPORTS)"
    ISSUES=$((ISSUES + 1))
  fi
done < <(jq -c 'to_entries[]' "$SNAPSHOT")

if [[ "$ISSUES" -gt 0 ]]; then
  echo ""
  echo "WARNING: $ISSUES potential regressions detected. Review each before approving."
  exit 1
else
  echo "Snapshot check passed — no regressions detected."
  exit 0
fi
