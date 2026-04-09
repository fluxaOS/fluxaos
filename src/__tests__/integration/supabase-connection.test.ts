/**
 * Integration test: verifies real Supabase Postgres connection.
 * This test hits the actual database — not a mock.
 */
import 'dotenv/config';
import { describe, expect, it, afterAll } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { organization } from '@/core/db/schema';
import { eq } from 'drizzle-orm';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

describe('supabase postgres connection', () => {
  const testSlug = `test-${Date.now()}`;

  afterAll(async () => {
    // Clean up test data
    await db.delete(organization).where(eq(organization.slug, testSlug));
  });

  it('inserts and reads back a row from the organization table', async () => {
    const [inserted] = await db
      .insert(organization)
      .values({ name: 'Test Org', slug: testSlug, settings: {} })
      .returning();

    expect(inserted).toBeDefined();
    expect(inserted.name).toBe('Test Org');
    expect(inserted.slug).toBe(testSlug);
    expect(inserted.id).toBeTruthy();

    // Read it back
    const [found] = await db
      .select()
      .from(organization)
      .where(eq(organization.slug, testSlug));

    expect(found).toBeDefined();
    expect(found.id).toBe(inserted.id);
  });
});
