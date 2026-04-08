import { registry } from './registry';

export type { AdapterType } from './registry';
export { AdapterRegistry, registry } from './registry';

export function getConfig() {
  return {
    adapters: registry.getRegisteredAdapters(),
    database: {
      url: process.env.DATABASE_URL ? '[set]' : '[missing]',
    },
    redis: {
      url: process.env.REDIS_URL ? '[set]' : '[missing]',
    },
  };
}
