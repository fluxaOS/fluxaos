// src/__tests__/integration/driver-crud.test.ts
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { driver } from '@/core/db/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set');
const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

const createdIds: string[] = [];

afterAll(async () => {
  for (const id of createdIds.reverse()) {
    await db.delete(driver).where(eq(driver.id, id));
  }
  await provider.close();
});

describe('driver CRUD (integration)', () => {
  it('update increments version', async () => {
    const [created] = await db
      .insert(driver)
      .values({
        name: `test-driver-${Date.now()}`,
        slug: `test-driver-${Date.now()}`,
        binary: 'echo',
      })
      .returning();
    createdIds.push(created.id);

    const [updated] = await db
      .update(driver)
      .set({
        notes: 'updated',
        version: created.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(eq(driver.id, created.id), eq(driver.version, created.version))
      )
      .returning();

    expect(updated.version).toBe(created.version + 1);
    expect(updated.notes).toBe('updated');
  });

  it('stale-version update returns no rows', async () => {
    const [created] = await db
      .insert(driver)
      .values({
        name: `stale-driver-${Date.now()}`,
        slug: `stale-driver-${Date.now()}`,
        binary: 'echo',
      })
      .returning();
    createdIds.push(created.id);

    // Bump version once
    await db
      .update(driver)
      .set({ notes: 'v2', version: created.version + 1, updatedAt: new Date() })
      .where(
        and(eq(driver.id, created.id), eq(driver.version, created.version))
      );

    // Attempt with stale version
    const rows = await db
      .update(driver)
      .set({
        notes: 'stale',
        version: created.version + 2,
        updatedAt: new Date(),
      })
      .where(
        and(eq(driver.id, created.id), eq(driver.version, created.version))
      )
      .returning();

    expect(rows).toHaveLength(0);
  });

  it('toggle isEnabled via update', async () => {
    const [created] = await db
      .insert(driver)
      .values({
        name: `toggle-${Date.now()}`,
        slug: `toggle-${Date.now()}`,
        binary: 'echo',
        isEnabled: true,
      })
      .returning();
    createdIds.push(created.id);

    const [toggled] = await db
      .update(driver)
      .set({
        isEnabled: false,
        version: created.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(eq(driver.id, created.id), eq(driver.version, created.version))
      )
      .returning();

    expect(toggled.isEnabled).toBe(false);
  });
});
