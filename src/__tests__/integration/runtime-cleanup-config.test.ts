/**
 * Integration tests for FLX-224 — `cleanup.*` config_entry rows as the
 * DB-backed source of truth for the cleanup scheduler thresholds and the
 * scheduler-enabled gate.
 *
 * Five accessors live in `src/core/services/runtime-config.ts`:
 *
 *   getCleanupSweepIntervalMin(db)            -> positive int
 *   getCleanupStaleDays(db)                   -> positive int
 *   getCleanupSessionRetentionDays(db)        -> positive int
 *   getCleanupArtifactsRetentionDays(db)      -> positive int
 *   getCleanupSchedulerEnabled(db)            -> boolean
 *
 * Unlike `runtime.workspace_root` / `runtime.artifacts_root`, the cleanup
 * keys have NO "use built-in layout" affordance — a missing row, a null
 * value, a non-integer, a zero, or a wrong-type value all throw. The
 * boolean key requires strictly true/false.
 *
 * Real Supabase. Mutations to the `config_entry` rows are restored to seed
 * defaults in `afterAll` so the rest of the suite (and the operator's
 * local DB) sees a stable state.
 */
import 'dotenv/config';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { GLOBAL_CONFIG_KEY } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  getCleanupArtifactsRetentionDays,
  getCleanupSchedulerEnabled,
  getCleanupSessionRetentionDays,
  getCleanupStaleDays,
  getCleanupSweepIntervalMin,
  InvalidGlobalConfigError,
  MissingGlobalConfigError,
} from '@/core/services/runtime-config';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

// The five keys this test owns. Tests mutate values + delete rows; afterAll
// restores them to the seed defaults defined in src/scripts/db/seed.ts.
const SEED_DEFAULTS: Record<string, unknown> = {
  [GLOBAL_CONFIG_KEY.cleanupSweepIntervalMin]: 10,
  [GLOBAL_CONFIG_KEY.cleanupStaleDays]: 7,
  [GLOBAL_CONFIG_KEY.cleanupSessionRetentionDays]: 30,
  [GLOBAL_CONFIG_KEY.cleanupArtifactsRetentionDays]: 30,
  [GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled]: false,
};

async function readRow(key: string): Promise<{ value: unknown } | null> {
  const [row] = await db
    .select({ value: schema.configEntry.value })
    .from(schema.configEntry)
    .where(
      and(
        eq(schema.configEntry.scope, 'global'),
        isNull(schema.configEntry.projectId),
        eq(schema.configEntry.key, key)
      )
    );
  return row ?? null;
}

async function setValue(key: string, value: unknown): Promise<void> {
  const literal = sql`${JSON.stringify(value)}::jsonb`;
  const existing = await readRow(key);
  if (existing) {
    await db
      .update(schema.configEntry)
      .set({ value: literal, updatedAt: new Date() })
      .where(
        and(
          eq(schema.configEntry.scope, 'global'),
          isNull(schema.configEntry.projectId),
          eq(schema.configEntry.key, key)
        )
      );
  } else {
    await db.insert(schema.configEntry).values({
      scope: 'global',
      projectId: null,
      key,
      value: literal,
    });
  }
}

async function deleteRow(key: string): Promise<void> {
  await db
    .delete(schema.configEntry)
    .where(
      and(
        eq(schema.configEntry.scope, 'global'),
        isNull(schema.configEntry.projectId),
        eq(schema.configEntry.key, key)
      )
    );
}

beforeAll(async () => {
  // Make sure all five rows exist with the seed defaults before any test
  // case mutates them — handles fresh DBs where seed has not yet run.
  for (const [key, value] of Object.entries(SEED_DEFAULTS)) {
    await setValue(key, value);
  }
}, 30_000);

afterAll(async () => {
  for (const [key, value] of Object.entries(SEED_DEFAULTS)) {
    await setValue(key, value);
  }
  await provider.close();
});

describe('FLX-224 — runtime-config cleanup.* accessors', () => {
  describe('happy path: rows exist with valid values', () => {
    it('returns the positive integer in each threshold row', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupSweepIntervalMin, 11);
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 14);
      await setValue(GLOBAL_CONFIG_KEY.cleanupSessionRetentionDays, 21);
      await setValue(GLOBAL_CONFIG_KEY.cleanupArtifactsRetentionDays, 45);

      expect(await getCleanupSweepIntervalMin(db)).toBe(11);
      expect(await getCleanupStaleDays(db)).toBe(14);
      expect(await getCleanupSessionRetentionDays(db)).toBe(21);
      expect(await getCleanupArtifactsRetentionDays(db)).toBe(45);
    });

    it('returns the boolean true/false for the scheduler-enabled row', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled, true);
      expect(await getCleanupSchedulerEnabled(db)).toBe(true);

      await setValue(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled, false);
      expect(await getCleanupSchedulerEnabled(db)).toBe(false);
    });

    it('re-reads on each call (no cache)', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 5);
      expect(await getCleanupStaleDays(db)).toBe(5);
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 9);
      expect(await getCleanupStaleDays(db)).toBe(9);
    });
  });

  describe('missing-row path: each accessor throws MissingGlobalConfigError', () => {
    it('getCleanupSweepIntervalMin throws when row missing', async () => {
      await deleteRow(GLOBAL_CONFIG_KEY.cleanupSweepIntervalMin);
      await expect(getCleanupSweepIntervalMin(db)).rejects.toBeInstanceOf(
        MissingGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupSweepIntervalMin, 10);
    });

    it('getCleanupStaleDays throws when row missing', async () => {
      await deleteRow(GLOBAL_CONFIG_KEY.cleanupStaleDays);
      await expect(getCleanupStaleDays(db)).rejects.toBeInstanceOf(
        MissingGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 7);
    });

    it('getCleanupSessionRetentionDays throws when row missing', async () => {
      await deleteRow(GLOBAL_CONFIG_KEY.cleanupSessionRetentionDays);
      await expect(getCleanupSessionRetentionDays(db)).rejects.toBeInstanceOf(
        MissingGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupSessionRetentionDays, 30);
    });

    it('getCleanupArtifactsRetentionDays throws when row missing', async () => {
      await deleteRow(GLOBAL_CONFIG_KEY.cleanupArtifactsRetentionDays);
      await expect(getCleanupArtifactsRetentionDays(db)).rejects.toBeInstanceOf(
        MissingGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupArtifactsRetentionDays, 30);
    });

    it('getCleanupSchedulerEnabled throws when row missing', async () => {
      await deleteRow(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled);
      await expect(getCleanupSchedulerEnabled(db)).rejects.toBeInstanceOf(
        MissingGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled, false);
    });
  });

  describe('invalid-value path: each accessor throws InvalidGlobalConfigError', () => {
    // NOTE on test choices: postgres-js + jsonb has a quirk where a JS string
    // value that happens to be valid JSON (e.g. '7', 'true', 'null') round-
    // trips through the cast as the parsed value, not the raw string. So we
    // can't use those values to test "wrong type in slot" — they'd
    // accidentally satisfy the slot's validator. Test with non-JSON-parseable
    // strings (e.g. 'seven') and out-of-range numerics instead.

    it('positive-int accessor throws on non-numeric string', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 'seven');
      await expect(getCleanupStaleDays(db)).rejects.toBeInstanceOf(
        InvalidGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 7);
    });

    it('positive-int accessor throws on zero', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 0);
      await expect(getCleanupStaleDays(db)).rejects.toBeInstanceOf(
        InvalidGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 7);
    });

    it('positive-int accessor throws on negative number', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, -3);
      await expect(getCleanupStaleDays(db)).rejects.toBeInstanceOf(
        InvalidGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 7);
    });

    it('positive-int accessor throws on non-integer number', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupSweepIntervalMin, 1.5);
      await expect(getCleanupSweepIntervalMin(db)).rejects.toBeInstanceOf(
        InvalidGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupSweepIntervalMin, 10);
    });

    it('positive-int accessor throws on jsonb null', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, null);
      await expect(getCleanupStaleDays(db)).rejects.toBeInstanceOf(
        InvalidGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupStaleDays, 7);
    });

    it('boolean accessor throws on integer', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled, 1);
      await expect(getCleanupSchedulerEnabled(db)).rejects.toBeInstanceOf(
        InvalidGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled, false);
    });

    it('boolean accessor throws on non-bool-parseable string', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled, 'yes');
      await expect(getCleanupSchedulerEnabled(db)).rejects.toBeInstanceOf(
        InvalidGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled, false);
    });

    it('boolean accessor throws on jsonb null', async () => {
      await setValue(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled, null);
      await expect(getCleanupSchedulerEnabled(db)).rejects.toBeInstanceOf(
        InvalidGlobalConfigError
      );
      await setValue(GLOBAL_CONFIG_KEY.cleanupSchedulerEnabled, false);
    });
  });
});
