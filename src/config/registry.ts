export type AdapterType =
  | 'auth'
  | 'git'
  | 'issue'
  | 'ai'
  | 'database'
  | 'queue'
  | 'realtime'
  | 'stage-executor'
  | 'notification'
  | 'storage';

const ENV_MAP: Record<AdapterType, { envVar: string; defaultValue: string }> = {
  auth: { envVar: 'FLUXAOS_AUTH_PROVIDER', defaultValue: 'supabase' },
  git: { envVar: 'FLUXAOS_GIT_PROVIDER', defaultValue: 'github' },
  issue: { envVar: 'FLUXAOS_ISSUE_PROVIDER', defaultValue: 'github' },
  ai: { envVar: 'FLUXAOS_AI_PROVIDERS', defaultValue: 'anthropic' },
  database: { envVar: 'FLUXAOS_DATABASE_PROVIDER', defaultValue: 'postgres' },
  queue: { envVar: 'FLUXAOS_QUEUE_PROVIDER', defaultValue: 'bullmq' },
  realtime: { envVar: 'FLUXAOS_REALTIME_PROVIDER', defaultValue: 'supabase' },
  'stage-executor': {
    envVar: 'FLUXAOS_STAGE_EXECUTOR',
    defaultValue: 'node-exec',
  },
  notification: {
    envVar: 'FLUXAOS_NOTIFICATION_PROVIDER',
    defaultValue: 'none',
  },
  storage: { envVar: 'FLUXAOS_STORAGE_PROVIDER', defaultValue: 'local' },
};

export class AdapterRegistry {
  private factories = new Map<string, () => unknown>();
  private instances = new Map<string, unknown>();

  register<T>(type: AdapterType, provider: string, factory: () => T): void {
    this.factories.set(`${type}:${provider}`, factory);
  }

  get<T>(type: AdapterType): T {
    const provider = this.getProvider(type);
    const key = `${type}:${provider}`;

    const cached = this.instances.get(key);
    if (cached) return cached as T;

    const factory = this.factories.get(key);
    if (!factory) {
      const registered = [...this.factories.keys()]
        .filter((k) => k.startsWith(`${type}:`))
        .map((k) => k.split(':')[1]);
      throw new Error(
        `No adapter registered for ${key}. Available for '${type}': [${registered.join(', ')}]`
      );
    }

    const instance = factory() as T;
    this.instances.set(key, instance);
    return instance;
  }

  getProvider(type: AdapterType): string {
    const config = ENV_MAP[type];
    return process.env[config.envVar] || config.defaultValue;
  }

  getRegisteredAdapters(): Record<AdapterType, string> {
    const result = {} as Record<AdapterType, string>;
    for (const type of Object.keys(ENV_MAP) as AdapterType[]) {
      result[type] = this.getProvider(type);
    }
    return result;
  }
}

export const registry = new AdapterRegistry();
