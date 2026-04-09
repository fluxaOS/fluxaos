/**
 * Seed script — populates Supabase with default org, project, and pipeline.
 *
 * Usage: npx tsx src/core/db/seed.ts
 * Requires: DATABASE_URL or DIRECT_URL set in .env
 */
import 'dotenv/config';
import { createDatabase } from './connection';
import { organization, project, pipeline, pipelineStage } from './schema';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DIRECT_URL or DATABASE_URL must be set.');
  process.exit(1);
}

const db = createDatabase(url);

async function seed() {
  console.log('Seeding fluxaOS database...');

  // Default organization
  const [org] = await db
    .insert(organization)
    .values({
      name: 'Default',
      slug: 'default',
      settings: {},
    })
    .onConflictDoNothing({ target: organization.slug })
    .returning();

  if (!org) {
    console.log('Organization "default" already exists, skipping seed.');
    process.exit(0);
  }

  console.log(`  Created organization: ${org.name} (${org.id})`);

  // Default project
  const [proj] = await db
    .insert(project)
    .values({
      orgId: org.id,
      name: 'fluxaOS',
      slug: 'fluxaos',
      repoUrl: 'https://github.com/fluxaOS/fluxaos',
    })
    .returning();

  console.log(`  Created project: ${proj.name} (${proj.id})`);

  // Default pipeline
  const [pipe] = await db
    .insert(pipeline)
    .values({
      projectId: proj.id,
      name: 'Standard Dev',
      description: 'Research → Implement → Review → Deploy',
      isDefault: true,
    })
    .returning();

  console.log(`  Created pipeline: ${pipe.name} (${pipe.id})`);

  // Default stages
  const stages = [
    { name: 'research', sortOrder: 1, gateMode: 'auto', harness: 'claude-code' },
    { name: 'implement', sortOrder: 2, gateMode: 'rules', harness: 'claude-code' },
    { name: 'review', sortOrder: 3, gateMode: 'hold', harness: 'claude-code' },
    { name: 'deploy', sortOrder: 4, gateMode: 'hold', harness: 'claude-code' },
  ];

  for (const stage of stages) {
    const [s] = await db
      .insert(pipelineStage)
      .values({
        pipelineId: pipe.id,
        name: stage.name,
        sortOrder: stage.sortOrder,
        gateMode: stage.gateMode,
        harness: stage.harness,
        timeoutSec: 300,
        maxRetries: 1,
        gateRules: [],
      })
      .returning();

    console.log(`    Created stage: ${s.name} (order: ${s.sortOrder})`);
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
