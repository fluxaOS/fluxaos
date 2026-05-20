import { count, desc, eq, or } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { brand, persona, project } from '@/core/db/schema';
import { createVersionedCrudService } from './crud-factory';
import {
  resolveProjectScopeContext,
  resolveScoped,
  resolveScopedAll,
  type ScopeContext,
} from './resolve-scoped';

type BrandInsert = typeof brand.$inferInsert;
type BrandSelect = typeof brand.$inferSelect;

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export function createBrandService(db: DbOrTx) {
  const crud = createVersionedCrudService<BrandInsert, BrandSelect>(
    db as Database,
    brand
  );

  return {
    ...crud,

    async create(data: BrandInsert): Promise<BrandSelect> {
      const scopedData =
        data.projectId !== undefined && data.projectId !== null
          ? {
              ...data,
              kind: 'project',
              orgId: null,
              teamId: null,
              userId: null,
            }
          : data.orgId !== undefined && data.orgId !== null
            ? {
                ...data,
                kind: 'org',
                teamId: null,
                userId: null,
                projectId: null,
              }
            : {
                ...data,
                kind: 'catalog',
                orgId: null,
                teamId: null,
                userId: null,
                projectId: null,
              };
      return crud.create(scopedData);
    },

    async countReferences(id: string): Promise<{ personas: number }> {
      const [p] = await db
        .select({ c: count() })
        .from(persona)
        .where(eq(persona.brandId, id));
      return { personas: Number(p?.c ?? 0) };
    },

    async listByOrg(orgId: string): Promise<BrandSelect[]> {
      const rows = await db
        .select({ brand })
        .from(brand)
        .leftJoin(project, eq(project.id, brand.projectId))
        .where(or(eq(brand.orgId, orgId), eq(project.orgId, orgId)))
        .orderBy(desc(brand.createdAt));
      return rows.map((row) => row.brand);
    },

    async listByProject(projectId: string): Promise<BrandSelect[]> {
      return db
        .select()
        .from(brand)
        .where(eq(brand.projectId, projectId))
        .orderBy(desc(brand.createdAt));
    },

    async listEffective(scope: ScopeContext): Promise<BrandSelect[]> {
      return resolveScopedAll<BrandSelect>(
        db as Database,
        brand,
        scope,
        'name'
      );
    },

    async resolveEffectiveById(
      id: string,
      scope: ScopeContext
    ): Promise<BrandSelect | null> {
      const base = await crud.getById(id);
      if (!base) return null;
      return resolveScoped<BrandSelect>(
        db as Database,
        brand,
        scope,
        eq(brand.name, base.name)
      );
    },

    async listVisibleToProject(
      orgId: string,
      projectId: string
    ): Promise<BrandSelect[]> {
      const scope = await resolveProjectScopeContext(db as Database, projectId);
      if (scope.orgId !== orgId) return [];
      return resolveScopedAll<BrandSelect>(
        db as Database,
        brand,
        scope,
        'name'
      );
    },
  };
}

export type BrandService = ReturnType<typeof createBrandService>;
