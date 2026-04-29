/**
 * Verifies the Claude Code PermissionRequest allowlist hook.
 *
 * This is a local hook contract check, not a browser journey: Claude Code's
 * approval UI is interactive, so the deterministic surface is the hook payload
 * and structured decision JSON.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const hookPath = path.join(
  root,
  '.claude',
  'hooks',
  'permission-request-allowlist.py'
);
const settingsPath = path.join(root, '.claude', 'settings.json');

type Payload = {
  hook_event_name: string;
  permission_mode: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
};

function runHook(payload: Payload, home: string, extraEnv = {}) {
  return spawnSync('python3', [hookPath], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, ...extraEnv },
  });
}

function basePayload(filePath: string): Payload {
  return {
    hook_event_name: 'PermissionRequest',
    permission_mode: 'bypassPermissions',
    tool_name: 'Edit',
    tool_input: { file_path: filePath },
  };
}

function assertAllowsHooksPath() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxaos-hook-home-'));
  const result = runHook(
    basePayload(path.join(home, '.claude', 'hooks', 'carl-hook.py')),
    home
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output, {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  });
}

function assertDoesNotAllowSettingsPath() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxaos-hook-home-'));
  const result = runHook(
    basePayload(path.join(home, '.claude', 'settings.json')),
    home
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

function assertRequiresBypassMode() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxaos-hook-home-'));
  const payload = basePayload(path.join(home, '.claude', 'hooks', 'x.py'));
  payload.permission_mode = 'default';
  const result = runHook(payload, home);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
}

function assertSettingsRegistration() {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const permissionRequest = settings.hooks?.PermissionRequest;

  assert.ok(Array.isArray(permissionRequest), 'PermissionRequest hook missing');
  assert.deepEqual(permissionRequest, [
    {
      matcher: 'Edit|Write|MultiEdit',
      hooks: [
        {
          type: 'command',
          command: 'python3 .claude/hooks/permission-request-allowlist.py',
        },
      ],
    },
  ]);
}

assertAllowsHooksPath();
assertDoesNotAllowSettingsPath();
assertRequiresBypassMode();
assertSettingsRegistration();

console.log('permission-request-allowlist verification passed');
