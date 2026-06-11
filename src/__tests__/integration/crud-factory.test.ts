import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { driver, organization, user } from '@/core/db/schema';
import {
  createCrudService,
  createVersionedCrudService,
} from '@/core/services/crud-factory';
import { createOrganizationService } from '@/core/services/organization';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');
const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

type OrgInsert = typeof organization.$inferInsert;
type OrgSelect = typeof organization.$inferSelect;
type DriverInsert = typeof driver.$inferInsert;
type DriverSelect = typeof driver.$inferSelect;

const orgCleanup: string[] = [];
const userCleanup: string[] = [];
const driverCleanup: string[] = [];

afterAll(async () => {
  for (const id of userCleanup) {
    await db
      .delete(user)
      .where(eq(user.id, id))
      .catch(() => {});
  }
  for (const id of orgCleanup) {
    await db
      .delete(organization)
      .where(eq(organization.id, id))
      .catch(() => {});
  }
  for (const id of driverCleanup) {
    await db
      .delete(driver)
      .where(eq(driver.id, id))
      .catch(() => {});
  }
  await provider.close();
});

describe('createCrudService (non-versioned)', () => {
  it('getById / create / update / remove round-trips', async () => {
    const svc = createCrudService<OrgInsert, OrgSelect>(db, organization);
    const ts = Date.now();
    const created = await svc.create({
      name: `CRUD-TEST-${ts}`,
    });
    orgCleanup.push(created.id);

    const fetched = await svc.getById(created.id);
    expect(fetched?.id).toBe(created.id);

    const updated = await svc.update(created.id, { name: 'CRUD-RENAMED' });
    expect(updated?.name).toBe('CRUD-RENAMED');

    const removed = await svc.remove(created.id);
    expect(removed).toBe(true);

    const after = await svc.getById(created.id);
    expect(after).toBeNull();

    // remove again — should return false (no row matched)
    const removedAgain = await svc.remove(created.id);
    expect(removedAgain).toBe(false);

    // pop from cleanup array since already removed
    orgCleanup.pop();
  });

  it('unscoped list() throws — scoped overrides are the only list path', async () => {
    // FLX-276: the factory's `list()` is banned by contract — calling it must
    // throw immediately (cross-tenant leak guard), never return rows.
    const svc = createCrudService<OrgInsert, OrgSelect>(db, organization);
    await expect(svc.list()).rejects.toThrow(/scoped override/);
  });

  it('a service-level scoped override lists rows the factory refuses to', async () => {
    // The contract's other half: services built on the factory replace the
    // throwing `list()` with a tenant-scoped variant. Exercise the real
    // organization service's `listByUserId` against an owned fixture.
    const ts = Date.now();
    const orgSvc = createOrganizationService(db);

    const org = await orgSvc.create({ name: `CRUD-SCOPED-${ts}` });
    orgCleanup.push(org.id);
    const [usr] = await db
      .insert(user)
      .values({
        orgId: org.id,
        email: `crud-scoped-${ts}@test.local`,
        name: `CRUD-SCOPED-${ts}`,
      })
      .returning();
    userCleanup.push(usr.id);

    const scoped = await orgSvc.listByUserId(usr.id);
    expect(scoped.map((o) => o.id)).toEqual([org.id]);

    // The same service still exposes the factory's banned unscoped list().
    await expect(orgSvc.list()).rejects.toThrow(/scoped override/);
  });
});

describe('createVersionedCrudService', () => {
  it('updateWithVersion succeeds when version matches and bumps version', async () => {
    const svc = createVersionedCrudService<DriverInsert, DriverSelect>(
      db,
      driver
    );
    const ts = Date.now();
    const created = await svc.create({
      name: `driver-v-${ts}`,
      slug: `driver-v-${ts}`,
      binary: 'echo',
      contextLayout: { instructionsFile: 'TEST.md', contextFile: 'context.md' },
    });
    driverCleanup.push(created.id);
    expect(created.version).toBe(1);

    const updated = await svc.updateWithVersion(created.id, 1, {
      name: 'driver-v-renamed',
    });
    expect(updated).not.toBeNull();
    expect(updated?.version).toBe(2);
    expect(updated?.name).toBe('driver-v-renamed');
  });

  it('updateWithVersion returns null when version is stale', async () => {
    const svc = createVersionedCrudService<DriverInsert, DriverSelect>(
      db,
      driver
    );
    const ts = Date.now();
    const created = await svc.create({
      name: `driver-stale-${ts}`,
      slug: `driver-stale-${ts}`,
      binary: 'echo',
      contextLayout: { instructionsFile: 'TEST.md', contextFile: 'context.md' },
    });
    driverCleanup.push(created.id);

    // first update succeeds at v1 -> v2
    await svc.updateWithVersion(created.id, 1, { name: 'first-update' });
    // second update with the same (now stale) v1 should fail
    const stale = await svc.updateWithVersion(created.id, 1, {
      name: 'stale-update',
    });
    expect(stale).toBeNull();

    // row should still have the first-update value
    const current = await svc.getById(created.id);
    expect(current?.name).toBe('first-update');
    expect(current?.version).toBe(2);
  });

  it('deleteWithVersion succeeds when version matches', async () => {
    const svc = createVersionedCrudService<DriverInsert, DriverSelect>(
      db,
      driver
    );
    const ts = Date.now();
    const created = await svc.create({
      name: `driver-del-${ts}`,
      slug: `driver-del-${ts}`,
      binary: 'echo',
      contextLayout: { instructionsFile: 'TEST.md', contextFile: 'context.md' },
    });
    driverCleanup.push(created.id);

    const deleted = await svc.deleteWithVersion(created.id, 1);
    expect(deleted).toBe(true);

    const after = await svc.getById(created.id);
    expect(after).toBeNull();

    driverCleanup.pop();
  });

  it('deleteWithVersion returns false when version is stale', async () => {
    const svc = createVersionedCrudService<DriverInsert, DriverSelect>(
      db,
      driver
    );
    const ts = Date.now();
    const created = await svc.create({
      name: `driver-del-stale-${ts}`,
      slug: `driver-del-stale-${ts}`,
      binary: 'echo',
      contextLayout: { instructionsFile: 'TEST.md', contextFile: 'context.md' },
    });
    driverCleanup.push(created.id);

    // bump version first (v1 -> v2)
    await svc.updateWithVersion(created.id, 1, { name: 'bumped' });
    // delete with stale v1 should fail
    const stale = await svc.deleteWithVersion(created.id, 1);
    expect(stale).toBe(false);

    const still = await svc.getById(created.id);
    expect(still).not.toBeNull();
    expect(still?.version).toBe(2);
  });

  it('getById works and unscoped list() throws on versioned service', async () => {
    const svc = createVersionedCrudService<DriverInsert, DriverSelect>(
      db,
      driver
    );
    const ts = Date.now();
    const created = await svc.create({
      name: `driver-list-${ts}`,
      slug: `driver-list-${ts}`,
      binary: 'echo',
      contextLayout: { instructionsFile: 'TEST.md', contextFile: 'context.md' },
    });
    driverCleanup.push(created.id);

    const fetched = await svc.getById(created.id);
    expect(fetched?.id).toBe(created.id);

    // FLX-276: the versioned factory inherits the banned unscoped list() —
    // it must throw, same as the base factory.
    await expect(svc.list()).rejects.toThrow(/scoped override/);
  });
});
