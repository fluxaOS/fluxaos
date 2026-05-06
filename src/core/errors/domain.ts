/**
 * Domain-level error types for service-layer operations.
 *
 * These live in core so routers and other callers can import and instanceof-check
 * them without pulling in transport-layer packages (TRPCError etc.).
 */

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class VersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersionConflictError';
  }
}
