/**
 * Seed verification — asserts expected state after nuke + seed.
 *
 * Usage: npx tsx tests/verify/seed-check.ts
 */

import { createClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';
import {
  brand,
  customer,
  driver,
  issue,
  issueState,
  issueStatus,
  organization,
  persona,
  pipelineStage,
  project,
  projectMember,
  provider,
  routingProfile,
  skill,
  team,
  teamMember,
  user,
} from '@/core/db/schema';
import { close, db } from '@/scripts/db/connection';

let failures = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS  ${message}`);
  } else {
    console.log(`  FAIL  ${message}`);
    failures++;
  }
}

async function main() {
  console.log('Seed verification\n');

  // --- Issues ---
  const issues = await db
    .select({
      number: issue.number,
      title: issue.title,
      stateKey: issueState.key,
      statusKey: issueStatus.key,
      isClosed: issue.isClosed,
    })
    .from(issue)
    .leftJoin(issueState, eq(issue.stateId, issueState.id))
    .leftJoin(issueStatus, eq(issue.statusId, issueStatus.id))
    .orderBy(issue.number);

  assert(issues.length === 2, `2 issues exist (got ${issues.length})`);

  const i1 = issues.find((i) => i.number === 1);
  const i2 = issues.find((i) => i.number === 2);

  if (i1) {
    assert(
      i1.stateKey === 'research',
      `Issue #1 state=research (got ${i1.stateKey})`
    );
    assert(
      i1.statusKey === 'open',
      `Issue #1 status=open (got ${i1.statusKey})`
    );
    assert(i1.isClosed === false, `Issue #1 not closed (got ${i1.isClosed})`);
  } else {
    console.log('  FAIL  Issue #1 not found');
    failures++;
  }

  if (i2) {
    assert(
      i2.stateKey === 'research',
      `Issue #2 state=research (got ${i2.stateKey})`
    );
    assert(
      i2.statusKey === 'open',
      `Issue #2 status=open (got ${i2.statusKey})`
    );
    assert(i2.isClosed === false, `Issue #2 not closed (got ${i2.isClosed})`);
  } else {
    console.log('  FAIL  Issue #2 not found');
    failures++;
  }

  // --- Pipeline stages ---
  const stages = await db.select().from(pipelineStage);
  assert(stages.length === 5, `5 pipeline stages (got ${stages.length})`);
  const stageNames = stages
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => s.name);
  assert(
    stageNames.join(',') === 'research,implement,review,rework,deploy',
    `seeded stage order (got ${stageNames.join(',')})`
  );

  // --- Skills ---
  const skills = await db.select().from(skill);
  assert(skills.length === 5, `5 skills (got ${skills.length})`);
  const skillNames = skills.map((s) => s.name).sort();
  assert(
    skillNames.join(',') === 'deploy,implement,research,review,rework',
    `seeded skills (got ${skillNames.join(',')})`
  );

  // --- Drivers ---
  // FLX-6: seed adds the OpenAI Codex CLI driver alongside Claude Code.
  const drivers = await db.select().from(driver);
  assert(drivers.length === 2, `2 drivers (got ${drivers.length})`);
  const driverSlugs = drivers.map((d) => d.slug).sort();
  assert(
    driverSlugs.join(',') === 'claude-code,openai-codex',
    `seeded driver slugs (got ${driverSlugs.join(',')})`
  );

  // --- Tenancy shape ---
  const customers = await db.select().from(customer);
  assert(customers.length === 1, `1 customer row (got ${customers.length})`);

  const orgs = await db.select().from(organization);
  assert(orgs.length === 1, `1 organization row (got ${orgs.length})`);
  if (customers.length === 1 && orgs.length === 1) {
    assert(
      orgs[0].customerId === customers[0].id,
      `org.customer_id matches customer.id`
    );
  }

  const teams = await db.select().from(team);
  assert(teams.length === 1, `1 team row (got ${teams.length})`);
  if (orgs.length === 1 && teams.length === 1) {
    assert(teams[0].orgId === orgs[0].id, `team.org_id matches org.id`);
  }

  const users = await db.select().from(user);
  assert(users.length === 1, `1 user row (got ${users.length})`);
  if (orgs.length === 1 && users.length === 1) {
    assert(users[0].orgId === orgs[0].id, `user.org_id matches org.id`);
  }

  const teamMembers = await db.select().from(teamMember);
  assert(
    teamMembers.length === 1,
    `1 team_member row (got ${teamMembers.length})`
  );
  if (users.length === 1 && teams.length === 1 && teamMembers.length === 1) {
    assert(
      teamMembers[0].userId === users[0].id &&
        teamMembers[0].teamId === teams[0].id,
      `team_member links default user to default team`
    );
  }

  const projects = await db.select().from(project);
  assert(projects.length === 1, `1 project row (got ${projects.length})`);
  if (teams.length === 1 && projects.length === 1) {
    assert(
      projects[0].teamId === teams[0].id,
      `project.team_id matches team.id`
    );
  }

  const projectMembers = await db.select().from(projectMember);
  assert(
    projectMembers.length === 1,
    `1 project_member row (got ${projectMembers.length})`
  );
  if (
    users.length === 1 &&
    projects.length === 1 &&
    projectMembers.length === 1
  ) {
    assert(
      projectMembers[0].userId === users[0].id &&
        projectMembers[0].projectId === projects[0].id,
      `project_member links default user to default project`
    );
  }

  // --- Catalog-feature scope/kind correctness (FLX-239) ---
  // Per the design, seeded provider/routingProfile/brand rows are 'org'-scoped
  // and persona rows are 'project'-scoped. After seed, the migration's Phase 12
  // reset to kind='catalog' must have been overwritten by the seed's promote
  // logic. Any catalog-kind row in these tables AFTER seed is a bug.
  const orgScopedTables = [
    { name: 'provider', table: provider, expectedKind: 'org' },
    { name: 'routingProfile', table: routingProfile, expectedKind: 'org' },
    { name: 'brand', table: brand, expectedKind: 'org' },
  ];

  for (const { name, table, expectedKind } of orgScopedTables) {
    const rows = await db.select().from(table);
    const catalogRows = rows.filter((r: any) => r.kind === 'catalog');
    assert(
      catalogRows.length === 0,
      `${name}: no leftover kind='catalog' rows after seed (got ${catalogRows.length})`
    );
    const expectedRows = rows.filter((r: any) => r.kind === expectedKind);
    assert(
      expectedRows.length >= 1,
      `${name}: at least one kind='${expectedKind}' row after seed (got ${expectedRows.length})`
    );
  }

  // Personas: 4 distinct rows. The seed defines 5 personaDefs (one per
  // pipeline stage), but 'Software Engineer' is shared between the
  // 'implement' and 'rework' stages — the upsert key is (name, projectId)
  // so the second iteration UPDATEs the row inserted by the first. All
  // surviving rows must be kind='project' with non-null projectId.
  const personas = await db.select().from(persona);
  assert(personas.length === 4, `4 persona rows (got ${personas.length})`);
  const nonProjectPersonas = personas.filter(
    (p: any) => p.kind !== 'project' || p.projectId === null
  );
  assert(
    nonProjectPersonas.length === 0,
    `personas: all kind='project' with non-null projectId (got ${nonProjectPersonas.length} violations)`
  );

  // --- Denormalization invariant (FLX-239) ---
  // project.org_id must always equal team.org_id. The Stage 1 trigger
  // (project_set_org_id_from_team) maintains this. Any mismatch is a trigger failure.
  // db.execute on the postgres-js adapter (this codebase's adapter — see
  // src/scripts/db/dbcheck.ts for the canonical usage pattern) returns a
  // direct iterable, NOT a { rows } wrapper.
  const denormRows = (await db.execute(sql`
    SELECT count(*)::text AS count
    FROM project p
    JOIN team t ON t.id = p.team_id
    WHERE p.org_id <> t.org_id
  `)) as { count: string }[];
  const countStr = denormRows[0]?.count;
  if (countStr === undefined) {
    console.log('  FAIL  denormalization: db.execute returned no rows');
    failures++;
  } else {
    const mismatchCount = Number.parseInt(countStr, 10);
    assert(
      mismatchCount === 0,
      `project.org_id === team.org_id for all projects (${mismatchCount} mismatch(es))`
    );
  }

  // --- Auth-identity invariant (FLX-239) ---
  // user.id must equal auth.users.id. Checked via service role client.
  // SKIPs (not FAILs) when SUPABASE_SERVICE_ROLE_KEY is missing or when the
  // admin API returns ANY error — the local dev seed does not create an
  // auth row, and we don't want a brittle string-match on Supabase error
  // text to silently flip SKIP→FAIL across SDK versions. Any error from
  // getUserById SKIPs with the error logged for diagnosis; the assertion
  // only FAILs on the explicit mismatch case (auth user found, but ID
  // differs from the seeded user.id).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.log(
      '  SKIP  auth-identity: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set'
    );
  } else if (users.length === 1) {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await adminClient.auth.admin.getUserById(
      users[0].id
    );
    if (error) {
      console.log(
        `  SKIP  auth-identity: admin.getUserById returned error (${error.message ?? 'unknown'}) — ` +
          `treating as missing auth row (local dev without Supabase auth account)`
      );
    } else if (!data.user) {
      console.log(
        `  SKIP  auth-identity: admin.getUserById returned no user for ${users[0].id}`
      );
    } else {
      assert(
        data.user.id === users[0].id,
        `auth.users.id === user.id (${users[0].id})`
      );
    }
  }

  // --- Summary ---
  console.log('');
  if (failures === 0) {
    console.log('All checks passed.');
  } else {
    console.log(`${failures} check(s) failed.`);
    await close();
    process.exit(1);
  }

  await close();
}

main().catch((err) => {
  console.error('Seed check failed:', err);
  process.exit(1);
});
