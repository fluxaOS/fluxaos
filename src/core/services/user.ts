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

    async list(): Promise<UserSelect[]> {
      return db.select().from(user).orderBy(user.name);
    },

    async listByOrg(orgId: string): Promise<UserSelect[]> {
      return db
        .select()
        .from(user)
        .where(eq(user.orgId, orgId))
        .orderBy(user.name);
    },

    async getBySlug(orgId: string, slug: string): Promise<UserSelect | null> {
      const [row] = await db
        .select()
        .from(user)
        .where(and(eq(user.orgId, orgId), eq(user.slug, slug)));
      return row ?? null;
    },

    async updateWithVersion(
      id: string,
      version: number,
      data: Partial<UserInsert>
    ): Promise<UserSelect> {
      const [row] = await db
        .update(user)
        .set({ ...data, version: version + 1, updatedAt: new Date() })
        .where(and(eq(user.id, id), eq(user.version, version)))
        .returning();
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    },

    async deleteWithVersion(id: string, version: number): Promise<UserSelect> {
      const [row] = await db
        .delete(user)
        .where(and(eq(user.id, id), eq(user.version, version)))
        .returning();
      if (!row) {
        const [exists] = await db
          .select({ version: user.version })
          .from(user)
          .where(eq(user.id, id));
        if (!exists) throw new Error(`User not found: ${id}`);
        throw new Error('Optimistic concurrency conflict');
      }
      return row;
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
