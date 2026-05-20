import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { assertProjectAccess } from '@/server/ownership';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const RUN = Date.now();

let orgId: string;
let directUserId: string;
let teamUserId: string;
let outsiderUserId: string;
let projectId: string;

beforeAll(async () => {
  const [org] = await db
    .insert(schema.organization)
    .values({
      name: `access-org-${RUN}`,
      slug: `access-org-${RUN}`,
    })
    .returning();
  orgId = org.id;

  const [team] = await db
    .insert(schema.team)
    .values({
      orgId,
      name: `access-team-${RUN}`,
    })
    .returning();

  const [directUser] = await db
    .insert(schema.user)
    .values({
      orgId,
      email: `direct-${RUN}@test.local`,
      name: 'Direct User',
      slug: `direct-${RUN}`,
    })
    .returning();
  directUserId = directUser.id;

  const [teamUser] = await db
    .insert(schema.user)
    .values({
      orgId,
      email: `team-${RUN}@test.local`,
      name: 'Team User',
      slug: `team-${RUN}`,
    })
    .returning();
  teamUserId = teamUser.id;

  const [outsider] = await db
    .insert(schema.user)
    .values({
      orgId,
      email: `outsider-${RUN}@test.local`,
      name: 'Outsider',
      slug: `outsider-${RUN}`,
    })
    .returning();
  outsiderUserId = outsider.id;

  const [project] = await db
    .insert(schema.project)
    .values({
      orgId,
      teamId: team.id,
      name: `access-project-${RUN}`,
      slug: `access-project-${RUN}`,
    })
    .returning();
  projectId = project.id;

  await db.insert(schema.projectMember).values({
    userId: directUserId,
    projectId,
  });
  await db.insert(schema.teamMember).values({
    userId: teamUserId,
    teamId: team.id,
  });
});

afterAll(async () => {
  if (orgId) await deleteOrgFixture(db, orgId);
  await provider.close();
});

describe('assertProjectAccess', () => {
  it('allows direct project members', async () => {
    await expect(
      assertProjectAccess(db, projectId, directUserId)
    ).resolves.toBeUndefined();
  });

  it('allows members of the project team', async () => {
    await expect(
      assertProjectAccess(db, projectId, teamUserId)
    ).resolves.toBeUndefined();
  });

  it('rejects users without project or team membership', async () => {
    await expect(
      assertProjectAccess(db, projectId, outsiderUserId, {
        notOwnedCode: 'FORBIDDEN',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('preserves LAN bypass when enabled', async () => {
    const prior = process.env.FLUXAOS_LAN_AUTH_BYPASS;
    process.env.FLUXAOS_LAN_AUTH_BYPASS = '1';
    try {
      await expect(
        assertProjectAccess(db, projectId, null)
      ).resolves.toBeUndefined();
    } finally {
      if (prior === undefined) {
        delete process.env.FLUXAOS_LAN_AUTH_BYPASS;
      } else {
        process.env.FLUXAOS_LAN_AUTH_BYPASS = prior;
      }
    }
  });
});
