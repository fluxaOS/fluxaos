import { and, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { project, projectMember } from '@/core/db/schema';
import { BadRequestError, InternalError } from '@/core/errors/domain';
import { createCrudService } from './crud-factory';
import { FK_VALIDATORS } from './project-fk-validators';

type ProjectInsert = typeof project.$inferInsert;
type ProjectSelect = typeof project.$inferSelect;

/**
 * Minimal port for the repoUrl validator the service needs. Decouples
 * the service from `@/adapters/git-router/*` (DI rule: zero vendor
 * imports in `src/core/`).
 */
export interface RepoUrlValidatorPort {
  validate(
    url: string
  ): Promise<
    | { ok: true; provider: string; coords: { owner: string; repo: string } }
    | { ok: false; provider: string | null; reason: string; detail?: string }
  >;
}

export function createProjectService(
  db: Database,
  deps?: { repoUrlValidator?: RepoUrlValidatorPort }
) {
  const crud = createCrudService<ProjectInsert, ProjectSelect>(db, project);

  return {
    ...crud,

    /**
     * FLX-228 / FLX-229: walk FK_VALIDATORS for every key in the patch
     * so FK scope is enforced in one place. FLX-227: when `repoUrl` is
     * in the patch and non-null, re-validate via the injected port.
     * The server is authoritative; the form's "Validate" button is a
     * UX hint, not a save gate.
     */
    async update(id: string, patch: Partial<ProjectInsert>) {
      for (const key of Object.keys(patch)) {
        const validator = FK_VALIDATORS[key];
        if (validator) {
          await validator(db, id, (patch as Record<string, unknown>)[key]);
        }
      }

      if ('repoUrl' in patch && patch.repoUrl != null) {
        if (!deps?.repoUrlValidator) {
          throw new InternalError('REPO_URL_VALIDATOR_NOT_INJECTED');
        }
        const result = await deps.repoUrlValidator.validate(
          patch.repoUrl as string
        );
        if (!result.ok) {
          throw new BadRequestError(`REPO_URL_${result.reason}`, result);
        }
      }

      return crud.update(id, patch);
    },

    async listByOrg(orgId: string): Promise<ProjectSelect[]> {
      return db.select().from(project).where(eq(project.orgId, orgId));
    },

    async listByUser(userId: string): Promise<ProjectSelect[]> {
      const rows = await db
        .select({ project })
        .from(project)
        .innerJoin(projectMember, eq(projectMember.projectId, project.id))
        .where(eq(projectMember.userId, userId));
      return rows.map((row) => row.project);
    },

    async getBySlug(
      orgId: string,
      slug: string
    ): Promise<ProjectSelect | null> {
      const [row] = await db
        .select()
        .from(project)
        .where(and(eq(project.orgId, orgId), eq(project.slug, slug)));
      return row ?? null;
    },

    async getFirstBySlug(slug: string): Promise<ProjectSelect | null> {
      const [row] = await db
        .select()
        .from(project)
        .where(eq(project.slug, slug))
        .limit(1);
      return row ?? null;
    },

    async getByUserSlug(
      userId: string,
      slug: string
    ): Promise<ProjectSelect | null> {
      const [row] = await db
        .select({ project })
        .from(project)
        .innerJoin(projectMember, eq(projectMember.projectId, project.id))
        .where(
          and(eq(projectMember.userId, userId), eq(project.slug, slug))
        );
      return row?.project ?? null;
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
