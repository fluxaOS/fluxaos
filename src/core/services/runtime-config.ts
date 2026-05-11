/**
 * Runtime-config reader — DB-backed accessors for global operational config
 * that previously lived in environment variables.
 *
 * Each accessor reads `config_entry` for scope=`'global'`, project_id=NULL on
 * every call (no module-level cache). This matches the spec for operator
 * edits via the Settings UI: a change in the DB takes effect on the next
 * read, with no daemon restart required.
 *
 * The DB row is the contract. A missing row throws `MissingGlobalConfigError`;
 * the project's "no fallbacks ever" rule forbids substituting any default.
 * A row whose `value` is the jsonb literal `null` is the explicit
 * "use the adapter's built-in layout" choice — the accessor returns
 * `undefined` to the caller in that case, mirroring the optional semantics
 * that the env var carried before this migration.
 *
 * Migration order (see docs/superpowers/specs/2026-05-11-config-classification-design.md):
 *   - FLX-222 (`runtime.workspace_root`) — done. Lands the pattern.
 *   - FLX-223 (`runtime.artifacts_root`) — done. Mirrors the FLX-222 shape.
 *   - FLX-224 (`cleanup.*`) — next. Reuses the same accessors.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { GLOBAL_CONFIG_KEY } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { configEntry } from '@/core/db/schema';

export class MissingGlobalConfigError extends Error {
  constructor(key: string) {
    super(
      `Missing global config_entry row for key '${key}'. ` +
        'Run `npm run db:seed` to insert the default row, then set the value ' +
        'in Settings → System (or with `UPDATE config_entry SET value = ...`). ' +
        'Per ARCHITECTURAL_STANDARDS.md §2 (no fallbacks), the DB row must ' +
        'exist before this code path runs.'
    );
    this.name = 'MissingGlobalConfigError';
  }
}

export class InvalidGlobalConfigError extends Error {
  constructor(key: string, expected: string, actual: string) {
    super(
      `config_entry '${key}' has invalid value type. Expected ${expected}, ` +
        `got ${actual}. Fix in Settings → System.`
    );
    this.name = 'InvalidGlobalConfigError';
  }
}

/**
 * Read a single global (`scope='global'`, `project_id=NULL`) config_entry row.
 * Throws when the row is missing — the caller has no business deciding what a
 * missing row "means" because there's no fallback policy.
 *
 * Returns the raw jsonb value (which may be `null`).
 */
async function readGlobalConfigValue(
  db: Database,
  key: string
): Promise<unknown> {
  const [row] = await db
    .select({ value: configEntry.value })
    .from(configEntry)
    .where(
      and(
        eq(configEntry.scope, 'global'),
        isNull(configEntry.projectId),
        eq(configEntry.key, key)
      )
    );

  if (!row) {
    throw new MissingGlobalConfigError(key);
  }

  return row.value;
}

/**
 * Read the `runtime.workspace_root` override.
 *
 * Returns:
 *   - `undefined` when the row's value is jsonb `null` — meaning "use the
 *     adapter's built-in in-project layout" (the optional-env semantics that
 *     this DB row replaced in FLX-222).
 *   - the absolute path string when the row's value is a JSON string.
 *
 * Throws:
 *   - `MissingGlobalConfigError` when the row itself is missing — the seed
 *     has not been run and the system is misconfigured.
 *   - `InvalidGlobalConfigError` when the value is present but not a string
 *     (e.g. number, array) — a Settings UI bug or a manual SQL typo.
 */
export async function getRuntimeWorkspaceRoot(
  db: Database
): Promise<string | undefined> {
  const value = await readGlobalConfigValue(
    db,
    GLOBAL_CONFIG_KEY.runtimeWorkspaceRoot
  );

  if (value === null) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidGlobalConfigError(
      GLOBAL_CONFIG_KEY.runtimeWorkspaceRoot,
      'string or jsonb null',
      typeof value
    );
  }
  return value;
}

/**
 * Read the `runtime.artifacts_root` override.
 *
 * Returns:
 *   - `undefined` when the row's value is jsonb `null` — meaning "use the
 *     adapter's built-in in-project `<repo>/.fluxaos-artifacts/` layout" (the
 *     optional-env semantics that this DB row replaced in FLX-223).
 *   - the absolute path string when the row's value is a JSON string.
 *
 * Throws:
 *   - `MissingGlobalConfigError` when the row itself is missing — the seed
 *     has not been run and the system is misconfigured.
 *   - `InvalidGlobalConfigError` when the value is present but not a string
 *     (e.g. number, array) — a Settings UI bug or a manual SQL typo.
 */
export async function getRuntimeArtifactsRoot(
  db: Database
): Promise<string | undefined> {
  const value = await readGlobalConfigValue(
    db,
    GLOBAL_CONFIG_KEY.runtimeArtifactsRoot
  );

  if (value === null) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidGlobalConfigError(
      GLOBAL_CONFIG_KEY.runtimeArtifactsRoot,
      'string or jsonb null',
      typeof value
    );
  }
  return value;
}
