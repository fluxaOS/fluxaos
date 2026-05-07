/**
 * Diagnose IssueWatcher config_missing by replaying resolveOpenStatusId.
 * Run with: npx tsx src/scripts/db/diagnose-watcher.ts
 */
import { and, eq } from 'drizzle-orm';
import { CONFIG_KEY } from '@/core/constants';
import { configEntry, issueStatus } from '@/core/db/schema';
import { close, db } from '@/scripts/db/connection';

async function main() {
  // Get project_id from issue #1
  const [issueRow] = (await db.execute(
    'SELECT id, project_id FROM issue WHERE number = 1'
  )) as unknown as Array<{ id: string; project_id: string }>;

  if (!issueRow) {
    console.error('Issue 1 not found');
    await close();
    return;
  }
  const projectId = issueRow.project_id;
  console.log('Issue 1 project_id:', projectId);

  // Step 1: get config entry
  const configKey = CONFIG_KEY.issueStatusOnCreate;
  console.log('Looking up config key:', configKey);

  const [config] = await db
    .select({ value: configEntry.value })
    .from(configEntry)
    .where(
      and(eq(configEntry.projectId, projectId), eq(configEntry.key, configKey))
    );

  console.log('Config row:', config);
  console.log('typeof config.value:', typeof config?.value);

  if (!config || typeof config.value !== 'string') {
    console.log('FAIL: config missing or not a string');
    await close();
    return;
  }

  const statusKey = config.value.replace(/^"|"$/g, '');
  console.log('Status key after strip:', statusKey);

  // Step 2: look up issue_status
  const [status] = await db
    .select({ id: issueStatus.id, key: issueStatus.key })
    .from(issueStatus)
    .where(
      and(eq(issueStatus.projectId, projectId), eq(issueStatus.key, statusKey))
    );

  console.log('Status row:', status);
  console.log('openStatusId:', status?.id ?? null);

  await close();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
