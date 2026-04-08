import { eq } from 'drizzle-orm';
import { db, pool } from './index';
import {
  organization,
  persona,
  pipeline,
  pipelineStage,
  project,
} from './schema';

async function seed() {
  // Organization
  const existingOrg = await db
    .select()
    .from(organization)
    .where(eq(organization.slug, 'default'))
    .limit(1);

  let orgId: string;
  if (existingOrg.length > 0) {
    orgId = existingOrg[0].id;
    console.log("Organization 'Default' already exists, skipping");
  } else {
    const [org] = await db
      .insert(organization)
      .values({ name: 'Default', slug: 'default' })
      .returning();
    orgId = org.id;
    console.log('Created organization: Default');
  }

  // Project
  const existingProject = await db
    .select()
    .from(project)
    .where(eq(project.slug, 'fluxaos'))
    .limit(1);

  let projectId: string;
  if (existingProject.length > 0) {
    projectId = existingProject[0].id;
    console.log("Project 'fluxaos' already exists, skipping");
  } else {
    const [proj] = await db
      .insert(project)
      .values({ orgId, name: 'fluxaos', slug: 'fluxaos' })
      .returning();
    projectId = proj.id;
    console.log('Created project: fluxaos');
  }

  // Pipeline
  const existingPipeline = await db
    .select()
    .from(pipeline)
    .where(eq(pipeline.name, 'Standard Dev'))
    .limit(1);

  let pipelineId: string;
  if (existingPipeline.length > 0) {
    pipelineId = existingPipeline[0].id;
    console.log("Pipeline 'Standard Dev' already exists, skipping");
  } else {
    const [pipe] = await db
      .insert(pipeline)
      .values({
        projectId,
        name: 'Standard Dev',
        isDefault: true,
      })
      .returning();
    pipelineId = pipe.id;
    console.log('Created pipeline: Standard Dev');
  }

  // Pipeline Stages
  const existingStages = await db
    .select()
    .from(pipelineStage)
    .where(eq(pipelineStage.pipelineId, pipelineId));

  if (existingStages.length > 0) {
    console.log(
      `Pipeline stages already exist (${existingStages.length}), skipping`
    );
  } else {
    const stages = [
      { pipelineId, name: 'research', sortOrder: 1, gateMode: 'auto' },
      { pipelineId, name: 'implement', sortOrder: 2, gateMode: 'auto' },
      { pipelineId, name: 'review', sortOrder: 3, gateMode: 'rules' },
      { pipelineId, name: 'deploy', sortOrder: 4, gateMode: 'hold' },
    ] as const;

    await db.insert(pipelineStage).values([...stages]);
    console.log(
      'Created 4 pipeline stages: research, implement, review, deploy'
    );
  }

  // Default Personas
  const existingPersonas = await db
    .select()
    .from(persona)
    .where(eq(persona.scope, 'global'))
    .limit(1);

  if (existingPersonas.length > 0) {
    console.log('Global personas already exist, skipping');
  } else {
    const defaultPersonas = [
      {
        name: 'Researcher',
        scope: 'global' as const,
        soul: 'A thorough researcher who investigates problems deeply before proposing solutions. Reads documentation, explores codebases, and synthesizes findings into clear analysis.',
        identity: {
          role: 'research',
          style: 'analytical',
          depth: 'thorough',
        },
      },
      {
        name: 'Implementer',
        scope: 'global' as const,
        soul: 'A skilled developer who writes clean, well-tested code. Follows established patterns, handles edge cases, and keeps changes focused and minimal.',
        identity: {
          role: 'implementation',
          style: 'pragmatic',
          quality: 'production',
        },
      },
      {
        name: 'Reviewer',
        scope: 'global' as const,
        soul: 'A meticulous code reviewer who checks for correctness, security, performance, and maintainability. Provides specific, actionable feedback.',
        identity: {
          role: 'review',
          style: 'critical',
          focus: 'quality',
        },
      },
      {
        name: 'Deployer',
        scope: 'global' as const,
        soul: 'A cautious deployment specialist who verifies builds, runs final checks, and handles release mechanics. Prioritizes safety and rollback capability.',
        identity: {
          role: 'deployment',
          style: 'cautious',
          priority: 'safety',
        },
      },
    ];

    await db.insert(persona).values(defaultPersonas);
    console.log(
      'Created 4 default personas: Researcher, Implementer, Reviewer, Deployer'
    );
  }

  console.log(
    '\nSeed complete: 1 org, 1 project, 1 pipeline, 4 stages, 4 personas'
  );

  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  pool.end();
  process.exit(1);
});
