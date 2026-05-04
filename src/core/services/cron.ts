import { and, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { cronJob } from '@/core/db/schema';

type CronJobInsert = typeof cronJob.$inferInsert;
type CronJobSelect = typeof cronJob.$inferSelect;

export interface CreateCronInput {
  projectId: string;
  name: string;
  slug: string;
  cronExpression: string;
  actionType: string;
  actionPayload?: unknown;
  isEnabled?: boolean;
}

export interface UpdateCronInput {
  name?: string;
  slug?: string;
  cronExpression?: string;
  actionType?: string;
  actionPayload?: unknown;
  isEnabled?: boolean;
}

export function createCronService(db: Database) {
  return {
    async list(): Promise<CronJobSelect[]> {
      return db.select().from(cronJob).orderBy(cronJob.name);
    },

    async listByProject(projectId: string): Promise<CronJobSelect[]> {
      return db
        .select()
        .from(cronJob)
        .where(eq(cronJob.projectId, projectId))
        .orderBy(cronJob.name);
    },

    async getById(id: string): Promise<CronJobSelect | null> {
      const [row] = await db.select().from(cronJob).where(eq(cronJob.id, id));
      return row ?? null;
    },

    async create(data: CreateCronInput): Promise<CronJobSelect> {
      const [row] = await db
        .insert(cronJob)
        .values({
          projectId: data.projectId,
          name: data.name,
          slug: data.slug,
          cronExpression: data.cronExpression,
          actionType: data.actionType,
          actionPayload: (data.actionPayload ?? null) as never,
          isEnabled: data.isEnabled ?? true,
        } as CronJobInsert)
        .returning();
      return row;
    },

    async update(
      id: string,
      version: number,
      data: UpdateCronInput
    ): Promise<CronJobSelect> {
      const [row] = await db
        .update(cronJob)
        .set({
          ...(data as Record<string, unknown>),
          version: version + 1,
          updatedAt: new Date(),
        } as never)
        .where(and(eq(cronJob.id, id), eq(cronJob.version, version)))
        .returning();
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    },

    async delete(id: string, version: number): Promise<CronJobSelect> {
      const [row] = await db
        .delete(cronJob)
        .where(and(eq(cronJob.id, id), eq(cronJob.version, version)))
        .returning();
      if (!row) {
        const [exists] = await db
          .select({ version: cronJob.version })
          .from(cronJob)
          .where(eq(cronJob.id, id));
        if (!exists) throw new Error(`Cron job not found: ${id}`);
        throw new Error('Optimistic concurrency conflict');
      }
      return row;
    },
  };
}

export type CronService = ReturnType<typeof createCronService>;
