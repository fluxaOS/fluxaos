/**
 * Verification runner — runs all verify scripts and reports pass/fail.
 *
 * Usage: npx tsx tests/verify/run-all.ts
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

const scripts = [
  { name: 'seed-check', path: 'tests/verify/seed-check.ts' },
  { name: 'agnostic-core', path: 'src/scripts/verify-agnostic-core.ts' },
  {
    name: 'e2e-proof-gate-reconciliation',
    path: 'tests/verify/e2e-proof-gate-reconciliation.ts',
  },
];

const root = path.resolve(__dirname, '..', '..');
let passed = 0;
let failed = 0;

console.log('Running verification suite\n');

for (const script of scripts) {
  const fullPath = path.join(root, script.path);
  console.log(`--- ${script.name} ---`);
  try {
    execSync(`npx tsx ${fullPath}`, {
      cwd: root,
      stdio: 'inherit',
      timeout: 30_000,
    });
    passed++;
    console.log('');
  } catch {
    failed++;
    console.log('');
  }
}

console.log('---');
console.log(
  `${passed} passed, ${failed} failed out of ${scripts.length} suite(s)`
);

if (failed > 0) {
  process.exit(1);
}
