import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { driver, organization } from '@/core/db/schema';
import {
  createCrudService,
  createVersionedCrudService,
} from '@/core/services/crud-factory';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');
const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

type OrgInsert = typeof organization.$inferInsert;
type OrgSelect = typeof organization.$inferSelect;
type DriverInsert = typeof driver.$inferInsert;
type DriverSelect = typeof driver.$inferSelect;

const orgCleanup: string[] = [];
const driverCleanup: string[] = [];

afterAll(async () => {
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
  it('list / getById / create / update / remove round-trips', async () => {
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

    const list = await svc.list();
    expect(list.some((o) => o.id === created.id)).toBe(true);

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

  it('list and getById still work on versioned service', async () => {
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

    const all = await svc.list();
    expect(all.some((d) => d.id === created.id)).toBe(true);
  });
});
