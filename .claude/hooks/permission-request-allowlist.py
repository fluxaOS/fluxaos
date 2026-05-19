#!/usr/bin/env python3
"""PermissionRequest allowlist hook for $HOME/.claude/hooks/** auto-approval."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, TextIO


def load_input(stdin: TextIO) -> dict[str, Any] | None:
    """Return parsed hook input or None for empty/invalid input."""
    raw = stdin.read()
    if not raw.strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


def candidate_file_path(payload: dict[str, Any]) -> Path | None:
    """Extract and normalize tool_input.file_path for Edit/Write/MultiEdit."""
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return None
    raw_path = tool_input.get("file_path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        return None
    return Path(raw_path).expanduser().resolve(strict=False)


def allow_roots_from_env() -> list[Path]:
    """Return configured allow roots, defaulting to $HOME/.claude/hooks."""
    env_value = os.environ.get("FLUXAOS_CLAUDE_PERMISSION_ALLOW_ROOTS", "").strip()
    if env_value:
        roots = []
        for part in env_value.split(os.pathsep):
            part = part.strip()
            if part:
                roots.append(Path(part).expanduser().resolve(strict=False))
        if roots:
            return roots
    return [(Path.home() / ".claude" / "hooks").resolve(strict=False)]


def is_under(path: Path, root: Path) -> bool:
    """Return True when path is root or below root."""
    try:
        return path == root or path.is_relative_to(root)
    except AttributeError:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return path == root


def should_allow(payload: dict[str, Any]) -> bool:
    """Return True only for bypass PermissionRequest file edits under allow roots."""
    if payload.get("hook_event_name") != "PermissionRequest":
        return False
    if payload.get("permission_mode") != "bypassPermissions":
        return False
    if payload.get("tool_name") not in {"Edit", "Write", "MultiEdit"}:
        return False
    file_path = candidate_file_path(payload)
    if file_path is None:
        return False
    return any(is_under(file_path, root) for root in allow_roots_from_env())


def main() -> int:
    """Read hook JSON from stdin, emit PermissionRequest allow JSON when allowlisted."""
    payload = load_input(sys.stdin)
    if payload is None:
        return 0
    if should_allow(payload):
        decision = {
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {"behavior": "allow"},
            }
        }
        sys.stdout.write(json.dumps(decision))
    return 0


if __name__ == "__main__":
    sys.exit(main())
