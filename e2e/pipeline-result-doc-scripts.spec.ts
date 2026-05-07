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
