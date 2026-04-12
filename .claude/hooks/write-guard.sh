#!/usr/bin/env bash
# Write Guard: blocks Write tool on existing UI files.
# Agents must use Edit for surgical changes to existing files.
# Write is only permitted for NEW files under protected paths.
FILE=$(echo "$CC_TOOL_INPUT" | jq -r '.file_path // empty')
if [[ -z "$FILE" ]]; then exit 0; fi

# Protected paths: src/app/, src/components/, src/server/
if [[ "$FILE" == */src/app/* || "$FILE" == */src/components/* || "$FILE" == */src/server/* ]]; then
  if [[ -f "$FILE" ]]; then
    echo "BLOCKED: Write used on existing file: $FILE"
    echo "Use Edit for surgical changes to existing files."
    echo "Write is only permitted for NEW files under src/app/, src/components/, and src/server/."
    echo "If you believe a full rewrite is necessary, explain why to the user first."
    exit 1
  fi
fi
exit 0
