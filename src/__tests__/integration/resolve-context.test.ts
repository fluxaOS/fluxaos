import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  MissingSessionError,
  ProjectAccessDeniedError,
  resolveProjectContext,
} from '@/lib/resolve-context';
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

/** Run `fn` with FLUXAOS_LAN_AUTH_BYPASS forced to `value` (undefined = unset). */
async function withBypass(
  value: string | undefined,
  fn: () => Promise<void>
): Promise<void> {
  const prior = process.env.FLUXAOS_LAN_AUTH_BYPASS;
  if (value === undefined) {
    delete process.env.FLUXAOS_LAN_AUTH_BYPASS;
  } else {
    process.env.FLUXAOS_LAN_AUTH_BYPASS = value;
  }
  try {
    await fn();
  } finally {
    if (prior === undefined) {
      delete process.env.FLUXAOS_LAN_AUTH_BYPASS;
    } else {
      process.env.FLUXAOS_LAN_AUTH_BYPASS = prior;
    }
  }
}

beforeAll(async () => {
  const [org] = await db
    .insert(schema.organization)
    .values({
      name: `rctx-org-${RUN}`,
      slug: `rctx-org-${RUN}`,
    })
    .returning();
  orgId = org.id;

  const [team] = await db
    .insert(schema.team)
    .values({
      orgId,
      name: `rctx-team-${RUN}`,
    })
    .returning();

  const [directUser] = await db
    .insert(schema.user)
    .values({
      orgId,
      email: `rctx-direct-${RUN}@test.local`,
      name: 'Direct User',
      slug: `rctx-direct-${RUN}`,
    })
    .returning();
  directUserId = directUser.id;

  const [teamUser] = await db
    .insert(schema.user)
    .values({
      orgId,
      email: `rctx-team-${RUN}@test.local`,
      name: 'Team User',
      slug: `rctx-team-${RUN}`,
    })
    .returning();
  teamUserId = teamUser.id;

  const [outsider] = await db
    .insert(schema.user)
    .values({
      orgId,
      email: `rctx-outsider-${RUN}@test.local`,
      name: 'Outsider',
      slug: `rctx-outsider-${RUN}`,
    })
    .returning();
  outsiderUserId = outsider.id;

  const [project] = await db
    .insert(schema.project)
    .values({
      orgId,
      teamId: team.id,
      name: `rctx-project-${RUN}`,
      slug: `rctx-project-${RUN}`,
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

describe('resolveProjectContext', () => {
  it('passes through under the LAN auth bypass with a null session user', async () => {
    await withBypass('1', async () => {
      const ctx = await resolveProjectContext(db, projectId, null);
      expect(ctx.projectId).toBe(projectId);
      expect(ctx.orgId).toBe(orgId);
      expect(ctx.project.id).toBe(projectId);
      expect(ctx.currentUserId).toBeNull();
      expect(() => ctx.assertProjectAccess()).not.toThrow();
    });
  });

  it('resolves for a session user with direct project membership', async () => {
    await withBypass(undefined, async () => {
      const ctx = await resolveProjectContext(db, projectId, directUserId);
      expect(ctx.projectId).toBe(projectId);
      expect(ctx.currentUserId).toBe(directUserId);
      expect(() => ctx.assertProjectAccess()).not.toThrow();
    });
  });

  it('resolves for a session user with team membership on the owning team', async () => {
    await withBypass(undefined, async () => {
      const ctx = await resolveProjectContext(db, projectId, teamUserId);
      expect(ctx.projectId).toBe(projectId);
      expect(ctx.currentUserId).toBe(teamUserId);
      expect(() => ctx.assertProjectAccess()).not.toThrow();
    });
  });

  it('throws ProjectAccessDeniedError for a session user without membership', async () => {
    await withBypass(undefined, async () => {
      await expect(
        resolveProjectContext(db, projectId, outsiderUserId)
      ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    });
  });

  it('throws ProjectAccessDeniedError for non-members even when the bypass flag is set', async () => {
    // The bypass only applies to a null session user (no session cookie);
    // an authenticated user is always membership-checked.
    await withBypass('1', async () => {
      await expect(
        resolveProjectContext(db, projectId, outsiderUserId)
      ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    });
  });

  it('throws MissingSessionError when there is no session and no bypass', async () => {
    await withBypass(undefined, async () => {
      await expect(
        resolveProjectContext(db, projectId, null)
      ).rejects.toBeInstanceOf(MissingSessionError);
    });
  });

  it('renders not-found for an unknown project uuid before any auth check', async () => {
    await withBypass('1', async () => {
      // next/navigation notFound() throws its framework control-flow error.
      await expect(
        resolveProjectContext(db, '00000000-0000-0000-0000-000000000000', null)
      ).rejects.toThrow();
    });
  });
});
