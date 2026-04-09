import type { Database } from '@/core/db/connection';

export interface DatabaseProvider {
  getConnection(): Database;

  healthCheck(): Promise<boolean>;
}
