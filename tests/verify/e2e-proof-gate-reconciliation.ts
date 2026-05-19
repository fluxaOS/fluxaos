import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');

const deploySpecs = [
  'e2e/r-runtime-deploy-journey.spec.ts',
  'e2e/r-smoke.spec.ts',
  'e2e/manual-stage-chain.spec.ts',
  'e2e/r-artifacts-chain.spec.ts',
];

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function assertContains(
  relativePath: string,
  haystack: string,
  needle: string
): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${relativePath} must contain: ${needle}`);
  }
}

function assertNearby(
  relativePath: string,
  haystack: string,
  anchor: string,
  needle: string,
  windowSize = 900
): void {
  let foundAnchor = false;
  for (
    let index = haystack.indexOf(anchor);
    index !== -1;
    index = haystack.indexOf(anchor, index + 1)
  ) {
    foundAnchor = true;
    const window = haystack.slice(index, index + windowSize);
    if (window.includes(needle)) {
      return;
    }
  }

  if (!foundAnchor) {
    throw new Error(`${relativePath} must contain anchor: ${anchor}`);
  }

  throw new Error(`${relativePath} must contain ${needle} near ${anchor}`);
}

const claude = read('CLAUDE.md');
assertContains(
  'CLAUDE.md',
  claude,
  'This journey is not deploy/PR proof by itself'
);
assertContains('CLAUDE.md', claude, 'e2e/r-runtime-deploy-journey.spec.ts');
assertContains('CLAUDE.md', claude, 'e2e/r-smoke.spec.ts');
assertContains('CLAUDE.md', claude, 'e2e/manual-stage-chain.spec.ts');
assertContains('CLAUDE.md', claude, 'e2e/r-artifacts-chain.spec.ts');
assertContains('CLAUDE.md', claude, 'legacy e2e fixture only');
assertContains('CLAUDE.md', claude, 'Not a runtime fallback');

for (const spec of deploySpecs) {
  const content = read(spec);
  assertNearby(spec, content, 'FLUXAOS_TARGET_REPO_PATH', 'legacy/test-only');
  assertNearby(
    spec,
    content,
    'FLUXAOS_TARGET_REPO_PATH',
    'project.target_repo_path'
  );
  assertNearby(spec, content, 'FLUXAOS_TARGET_REPO_PATH', 'DB-backed FLX-221');
  assertNearby(spec, content, 'legacy/test-only', 'runtime configuration');
}

console.log('E2E proof-gate reconciliation checks passed');
