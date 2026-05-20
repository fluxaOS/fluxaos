import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import type { Database } from '@/core/db/connection';

export type ScopeContext = {
  projectId?: string | null;
  userId?: string | null;
  teamId?: string | null;
  orgId?: string | null;
};

type WaterfallKind = 'catalog' | 'org' | 'team' | 'user' | 'project';

type ScopedRow = {
  kind: string;
  orgId: string | null;
  teamId: string | null;
  userId: string | null;
  projectId: string | null;
};

type ScopedTable = AnyPgTable & {
  orgId: AnyPgColumn;
  teamId: AnyPgColumn;
  userId: AnyPgColumn;
  projectId: AnyPgColumn;
  kind: AnyPgColumn;
  [key: string]: unknown;
};

type ScopedDatabase = Database & {
  selectDistinctOn: Database['select'];
};

const scopeKeys = ['orgId', 'teamId', 'userId', 'projectId', 'kind'] as const;

function assertScopedTable(table: AnyPgTable): asserts table is ScopedTable {
  for (const key of scopeKeys) {
    if (!(key in table)) {
      throw new Error(`resolveScoped table is missing required column: ${key}`);
    }
  }
}

function getColumn(table: ScopedTable, key: string): AnyPgColumn {
  const column = table[key];
  if (!column) {
    throw new Error(`resolveScoped dedupe key is not a table column: ${key}`);
  }
  return column as AnyPgColumn;
}

function catalogPredicate(table: ScopedTable): SQL {
  return and(
    isNull(table.orgId),
    isNull(table.teamId),
    isNull(table.userId),
    isNull(table.projectId),
    eq(table.kind, 'catalog')
  ) as SQL;
}

function scopedWhere(table: ScopedTable, ctx: ScopeContext, extraWhere?: SQL): SQL {
  const layerPredicates: SQL[] = [catalogPredicate(table)];

  if (ctx.orgId) {
    layerPredicates.push(and(eq(table.orgId, ctx.orgId), eq(table.kind, 'org')) as SQL);
  }
  if (ctx.teamId) {
    layerPredicates.push(
      and(eq(table.teamId, ctx.teamId), eq(table.kind, 'team')) as SQL
    );
  }
  if (ctx.userId) {
    layerPredicates.push(
      and(eq(table.userId, ctx.userId), eq(table.kind, 'user')) as SQL
    );
  }
  if (ctx.projectId) {
    layerPredicates.push(
      and(eq(table.projectId, ctx.projectId), eq(table.kind, 'project')) as SQL
    );
  }

  const scopePredicate = or(...layerPredicates) as SQL;
  return extraWhere ? (and(scopePredicate, extraWhere) as SQL) : scopePredicate;
}

function priorityExpression(table: ScopedTable, ctx: ScopeContext): SQL<number> {
  return sql<number>`case
    when ${table.projectId} = ${ctx.projectId ?? null} and ${table.kind} = 'project' then 1
    when ${table.userId} = ${ctx.userId ?? null} and ${table.kind} = 'user' then 2
    when ${table.teamId} = ${ctx.teamId ?? null} and ${table.kind} = 'team' then 3
    when ${table.orgId} = ${ctx.orgId ?? null} and ${table.kind} = 'org' then 4
    when ${table.orgId} is null
      and ${table.teamId} is null
      and ${table.userId} is null
      and ${table.projectId} is null
      and ${table.kind} = 'catalog' then 5
    else 99
  end`;
}

function assertValidScopedRow(row: ScopedRow): void {
  const setScopes = [row.orgId, row.teamId, row.userId, row.projectId].filter(
    (value) => value !== null
  ).length;

  const expectedKind: WaterfallKind | null =
    row.projectId !== null
      ? 'project'
      : row.userId !== null
        ? 'user'
        : row.teamId !== null
          ? 'team'
          : row.orgId !== null
            ? 'org'
            : setScopes === 0
              ? 'catalog'
              : null;

  if (setScopes > 1 || row.kind !== expectedKind) {
    throw new Error(
      `resolveScoped encountered invalid scoped row: kind=${row.kind}, scopes=${setScopes}`
    );
  }
}

function assertValidScopedRows<T extends ScopedRow>(rows: T[]): T[] {
  for (const row of rows) {
    assertValidScopedRow(row);
  }
  return rows;
}

export async function resolveScoped<T extends ScopedRow>(
  db: Database,
  table: AnyPgTable,
  ctx: ScopeContext,
  extraWhere?: SQL
): Promise<T | null> {
  assertScopedTable(table);

  const rows = (await db
    .select()
    .from(table)
    .where(scopedWhere(table, ctx, extraWhere))
    .orderBy(priorityExpression(table, ctx))
    .limit(1)) as T[];

  return assertValidScopedRows(rows)[0] ?? null;
}

export async function resolveScopedAll<T extends ScopedRow>(
  db: Database,
  table: AnyPgTable,
  ctx: ScopeContext,
  dedupeKey: keyof T,
  extraWhere?: SQL
): Promise<T[]> {
  assertScopedTable(table);
  const dedupeColumn = getColumn(table, String(dedupeKey));

  const rows = (await (db as ScopedDatabase)
    .selectDistinctOn([dedupeColumn])
    .from(table)
    .where(scopedWhere(table, ctx, extraWhere))
    .orderBy(dedupeColumn, priorityExpression(table, ctx))) as T[];

  return assertValidScopedRows(rows);
}
