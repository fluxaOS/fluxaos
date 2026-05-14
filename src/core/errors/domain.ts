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

/**
 * Caller-supplied input was invalid (maps to tRPC BAD_REQUEST). The
 * optional `detail` carries structured context (e.g., a ValidationResult)
 * for the router to forward.
 */
export class BadRequestError extends Error {
  constructor(
    message: string,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/**
 * An invariant the service relies on was violated — a wiring/DI bug,
 * not bad input (maps to tRPC INTERNAL_SERVER_ERROR).
 */
export class InternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalError';
  }
}
