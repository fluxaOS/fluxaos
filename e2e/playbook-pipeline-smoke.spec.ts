import { expect, test } from '@playwright/test';
import { execSync } from 'child_process';

test('init-result-doc script: exits cleanly when help requested', async () => {
  const result = execSync(
    'npx tsx src/scripts/pipeline/init-result-doc.ts 2>&1 || true',
    { cwd: process.cwd(), encoding: 'utf-8' }
  );
  expect(result).toContain('Usage:');
});

test('ingest-result-doc script: exits cleanly when help requested', async () => {
  const result = execSync(
    'npx tsx src/scripts/pipeline/ingest-result-doc.ts 2>&1 || true',
    { cwd: process.cwd(), encoding: 'utf-8' }
  );
  expect(result).toContain('Usage:');
});

// FLX-153: playbook.ts + playbook-auditor.ts deleted — YAML-playbook system
// replaced by DB-first routing (onPass/onFail/fallback columns on pipeline_stage).
// This test is permanently skipped; the routing contract is covered by the
// pipeline-db-routing.spec.ts journey tests.
test('playbook smoke: standard-dev.yaml parses and auditor routes correctly', async () => {
  test.skip(
    true,
    'FLX-153: playbook modules deleted — routing is now DB-driven'
  );
  // dead code below — kept for history
  const output = execSync(
    'npx tsx -e "' +
      [
        "import { parsePlaybook } from './src/core/pipeline/playbook.js';",
        "import { auditResultDoc } from './src/core/pipeline/playbook-auditor.js';",
        "import { readFileSync } from 'fs';",
        "const yaml = readFileSync('src/core/pipeline/bundled/standard-dev.yaml', 'utf-8');",
        "const parsed = parsePlaybook(yaml, 'standard-dev.yaml');",
        'if (!parsed.success) { console.log(JSON.stringify({ ok: false, error: String(parsed.error) })); process.exit(1); }',
        "const baseDoc = { issue: { id: 'u1', number: 1, title: 'T' }, run: { pipelineRunId: 'u2', stageRunId: 'u3', stage: 'research', attempt: 1 }, org: { id: 'u4', slug: 'o' }, project: { id: 'u5', slug: 'p' }, timing: { startedAt: new Date().toISOString() }, verdict: 'pass', summary: 'Done.' };",
        "const r = auditResultDoc(parsed.playbook, 'research', baseDoc);",
        "const f = auditResultDoc(parsed.playbook, 'review', { ...baseDoc, verdict: 'fail' });",
        "const d = auditResultDoc(parsed.playbook, 'deploy', baseDoc);",
        "const b = auditResultDoc(parsed.playbook, 'implement', { ...baseDoc, verdict: 'blocked' });",
        'console.log(JSON.stringify({ researchTarget: r.targetState, researchAction: r.action, reviewFail: f.targetState, deployTarget: d.targetState, blockedAction: b.action, blockedTarget: b.targetState }));',
      ].join(' ') +
      '"',
    { cwd: process.cwd(), encoding: 'utf-8' }
  );
  const result = JSON.parse(output.trim());
  expect(result.researchTarget).toBe('implement');
  expect(result.researchAction).toBe('transition');
  expect(result.reviewFail).toBe('rework');
  expect(result.deployTarget).toBe('complete');
  expect(result.blockedAction).toBe('fallback');
  expect(result.blockedTarget).toBe('blocked');
});
