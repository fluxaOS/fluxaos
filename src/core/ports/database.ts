import type { Database } from "@/core/db";

export interface DatabaseProvider {
	getConnection(): Database;

	healthCheck(): Promise<boolean>;
}
