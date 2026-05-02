import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { readFileSync, writeFileSync } from 'fs';
import { stageRun } from '@/core/db/schema';
import { type ResultDoc, validateResultDoc } from '@/core/pipeline/result-doc';
import { close, db } from '@/scripts/db/connection';

async function main() {
  const args = process.argv.slice(2);
  const stageRunIdIdx = args.indexOf('--stage-run-id');
  const resultDocIdx = args.indexOf('--result-doc');

  if (stageRunIdIdx === -1 || resultDocIdx === -1) {
    console.error(
      'Usage: ingest-result-doc.ts --stage-run-id <uuid> --result-doc <path>'
    );
    await close();
    process.exit(1);
  }

  const stageRunId = args[stageRunIdIdx + 1];
  const resultDocPath = args[resultDocIdx + 1];

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resultDocPath, 'utf-8'));
  } catch {
    console.error(
      `result doc not readable at ${resultDocPath} — treating as invalid`
    );
    console.log(JSON.stringify({ valid: false, reason: 'unreadable' }));
    await close();
    process.exit(0);
  }

  // Fill endedAt and duration_sec
  const endedAt = new Date().toISOString();
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.timing && typeof r.timing === 'object') {
      const t = r.timing as Record<string, unknown>;
      t.endedAt = endedAt;
      if (t.startedAt && typeof t.startedAt === 'string') {
        t.duration_sec = Math.round(
          (Date.now() - new Date(t.startedAt).getTime()) / 1000
        );
      }
    }
  }

  const validation = validateResultDoc(raw);

  if (!validation.success) {
    // Write raw doc to DB for audit trail even if invalid
    await db
      .update(stageRun)
      .set({ resultDoc: raw as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(stageRun.id, stageRunId));
    console.log(
      JSON.stringify({
        valid: false,
        reason: 'schema_invalid',
        errors: validation.error.issues,
      })
    );
    await close();
    process.exit(0);
  }

  const doc: ResultDoc = validation.data;

  await db
    .update(stageRun)
    .set({
      resultDoc: doc as unknown as Record<string, unknown>,
      tokensIn: doc.meta?.input_tokens ?? 0,
      tokensOut: doc.meta?.output_tokens ?? 0,
      model: doc.meta?.model ?? null,
      completedAt: new Date(endedAt),
      updatedAt: new Date(),
    })
    .where(eq(stageRun.id, stageRunId));

  // Update the file with timing-filled doc
  writeFileSync(resultDocPath, JSON.stringify(doc, null, 2));

  // Emit validated doc for orchestrator to parse from stdout
  console.log(JSON.stringify({ valid: true, doc }));
  await close();
}

main().catch(async (err) => {
  console.error(err);
  await close();
  process.exit(1);
});
