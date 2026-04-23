/**
 * Structural type for the adapter registry as consumed by the deploy bridge.
 *
 * Kept local to src/core/deploy to avoid importing `@/config/registry`
 * (which is an app-level wiring concern). Tests supply a minimal fake
 * registry that matches this shape.
 */

export interface AdapterRegistryLike {
  get<T>(name: string): T;
}
