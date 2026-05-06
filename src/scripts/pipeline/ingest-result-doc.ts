import { readFileSync, writeFileSync } from 'fs';
import { type ResultDoc, validateResultDoc } from '@/core/pipeline/result-doc';

async function main() {
  const args = process.argv.slice(2);
  const stageRunIdIdx = args.indexOf('--stage-run-id');
  const resultDocIdx = args.indexOf('--result-doc');

  if (stageRunIdIdx === -1 || resultDocIdx === -1) {
    console.error(
      'Usage: ingest-result-doc.ts --stage-run-id <uuid> --result-doc <path>'
    );
    process.exit(1);
  }

  const resultDocPath = args[resultDocIdx + 1];

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resultDocPath, 'utf-8'));
  } catch {
    console.error(
      `result doc not readable at ${resultDocPath} — treating as invalid`
    );
    console.log(JSON.stringify({ valid: false, reason: 'unreadable' }));
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
    console.log(
      JSON.stringify({
        valid: false,
        reason: 'schema_invalid',
        raw,
        errors: validation.error.issues,
      })
    );
    process.exit(0);
  }

  const doc: ResultDoc = validation.data;

  // Update the file with timing-filled doc
  writeFileSync(resultDocPath, JSON.stringify(doc, null, 2));

  // Emit validated doc for orchestrator to parse from stdout
  console.log(JSON.stringify({ valid: true, doc }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
