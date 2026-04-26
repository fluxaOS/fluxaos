import { and, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { user } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type UserInsert = typeof user.$inferInsert;
type UserSelect = typeof user.$inferSelect;

export function createUserService(db: Database) {
  const crud = createCrudService<UserInsert, UserSelect>(db, user);

  return {
    ...crud,

    async getBySlug(orgId: string, slug: string): Promise<UserSelect | null> {
      const [row] = await db
        .select()
        .from(user)
        .where(and(eq(user.orgId, orgId), eq(user.slug, slug)));
      return row ?? null;
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
