import { AnthropicAIProvider } from '@/adapters/anthropic';
import { BullMQAdapter } from '@/adapters/bullmq';
import { NodeExecAdapter } from '@/adapters/node-exec';
import { OpenAIAIProvider } from '@/adapters/openai';
import { registry } from './registry';

export type { AdapterType } from './registry';
export { AdapterRegistry, registry } from './registry';

// Register adapter factories
registry.register('queue', 'bullmq', () => new BullMQAdapter());
registry.register('stage-executor', 'node-exec', () => new NodeExecAdapter());
registry.register('ai', 'anthropic', () => new AnthropicAIProvider());
registry.register('ai', 'openai', () => new OpenAIAIProvider());

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
