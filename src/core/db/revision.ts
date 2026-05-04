/**
 * Shared helper for append-only revision tables.
 *
 * The `MAX(revision_number)+1` subquery appears in every entity that
 * records an edit history (skill, driver). Centralised here so the
 * atomicity contract lives in one place: the subquery is evaluated inside
 * the same INSERT statement, so concurrent saves on the same entity cannot
 * collide on the unique (entity_id, revision_number) index.
 */
import { sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

type WithRevisionNumberColumn = { revisionNumber: PgColumn };
type WithIdColumn = { id: PgColumn };

/**
 * Returns a Drizzle SQL expression that atomically computes the next
 * revision number for the given entity row.
 *
 * Usage:
 *   revisionNumber: nextRevisionNumber(revisionTable, revisionTable.entityId, entityId)
 */
export function nextRevisionNumber(
  revisionTable: PgTable & WithRevisionNumberColumn & WithIdColumn,
  entityIdColumn: PgColumn,
  entityId: string
) {
  return sql<number>`(
    SELECT COALESCE(MAX(${revisionTable.revisionNumber}), 0) + 1
    FROM ${revisionTable}
    WHERE ${entityIdColumn} = ${entityId}
  )`;
}
