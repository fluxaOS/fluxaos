#!/usr/bin/env node
/**
 * `fluxaos` bin shim.
 *
 * Spawns tsx to run src/cli/index.ts so the TypeScript source is the only
 * authoritative implementation — no separate dist build, no risk of the
 * compiled artifact drifting from source. tsx is already a top-level
 * devDependency used by every other CLI script in this repo (db:*,
 * verify:*, daemon, pipeline:*).
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const entry = resolve(repoRoot, 'src/cli/index.ts');
const tsxBin = resolve(repoRoot, 'node_modules/.bin/tsx');

const child = spawn(tsxBin, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: repoRoot,
  env: process.env,
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
