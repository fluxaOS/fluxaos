#!/usr/bin/env bash
# claude-md-gate.sh
#
# PostToolUse reminder hook for fluxaOS. Fires after Edit/Write tool calls and
# emits a reminder when the tool touched the project's CLAUDE.md, so the agent
# remembers to (1) run the claude-md-management:claude-md-improver skill,
# (2) iterate until the score is >= 90, and (3) include a `claude-md-score: NN`
# trailer in the commit message. The pre-commit hook is the mechanical gate;
# this hook prevents forgetting.
#
# Claude Code passes the tool invocation as JSON on stdin. We read it, look for
# a path that matches the project CLAUDE.md, and print to stderr (which the
# harness surfaces back into the agent transcript as a reminder).

set -euo pipefail

PROJECT_ROOT="/mnt/dev/fluxaos"
TARGET_PATH="${PROJECT_ROOT}/CLAUDE.md"

# Read the JSON payload from stdin (may be empty if no payload was piped).
PAYLOAD="$(cat || true)"

# Quick string scan: if the payload references the project CLAUDE.md, remind.
# We deliberately match on the absolute path so edits to other CLAUDE.md files
# (e.g., user-global ~/.claude/CLAUDE.md) don't trip this hook.
if printf '%s' "$PAYLOAD" | grep -Fq "$TARGET_PATH"; then
  cat >&2 <<'EOF'
[claude-md-gate] CLAUDE.md was edited.

Required follow-up before committing:
  1. Invoke the `claude-md-management:claude-md-improver` skill on /mnt/dev/fluxaos/CLAUDE.md.
  2. Apply suggested improvements until the skill scores the file >= 90.
  3. Append a `claude-md-score: NN` trailer to the commit message (NN = final score).

The pre-commit hook will block any commit that stages CLAUDE.md without that trailer.
EOF
fi

exit 0
