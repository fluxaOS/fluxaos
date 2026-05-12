export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}

export function isNetworkError(err: unknown): err is NetworkError {
  return err instanceof NetworkError;
}
