/**
 * Adapter Registry — the ONLY way to resolve port implementations.
 *
 * Adapters register factories at startup. Consumers call registry.get<T>(name)
 * to resolve an instance. No direct imports of adapter files outside adapters/.
 *
 * Fails fast: get() throws if the adapter isn't registered.
 * Singleton per name: factory is called once, result is cached.
 */

type AdapterFactory<T> = () => T;

interface AdapterEntry<T = unknown> {
  factory: AdapterFactory<T>;
  instance: T | null;
}

class AdapterRegistry {
  private adapters = new Map<string, AdapterEntry>();

  /**
   * Register an adapter factory. Called once at startup per adapter.
   * Throws if the name is already registered (prevents silent overwrites).
   */
  register<T>(name: string, factory: AdapterFactory<T>): void {
    if (this.adapters.has(name)) {
      throw new Error(
        `Adapter "${name}" is already registered. Each adapter name must be unique.`,
      );
    }
    this.adapters.set(name, { factory, instance: null });
  }

  /**
   * Resolve an adapter by name. Lazy-initializes on first call.
   * Throws immediately if the adapter isn't registered — no fallbacks.
   */
  get<T>(name: string): T {
    const entry = this.adapters.get(name);
    if (!entry) {
      throw new Error(
        `Adapter "${name}" is not registered. ` +
          `Registered adapters: [${[...this.adapters.keys()].join(', ')}]. ` +
          `Check that bootstrap.ts registers all required adapters.`,
      );
    }
    if (entry.instance === null) {
      entry.instance = entry.factory();
    }
    return entry.instance as T;
  }

  /**
   * List all registered adapter names.
   */
  names(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * Validate that all required adapters are registered.
   * Call at startup after bootstrap. Fails fast with a clear message.
   */
  validate(required: string[]): void {
    const missing = required.filter((name) => !this.adapters.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Missing required adapters: [${missing.join(', ')}]. ` +
          `Registered: [${[...this.adapters.keys()].join(', ')}]. ` +
          `Check bootstrap.ts and environment variables.`,
      );
    }
  }
}

/** Singleton registry instance — import this everywhere. */
export const registry = new AdapterRegistry();
