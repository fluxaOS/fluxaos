/**
 * Supabase AuthProvider adapter.
 *
 * Implements the AuthProvider port using @supabase/supabase-js.
 * This adapter is resolved via the registry — never imported directly.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AuthProvider,
  AuthResult,
  Session,
  User,
  AuthEvent,
  Unsubscribe,
} from '@/core/ports/auth';

function mapUser(raw: { id: string; email?: string; user_metadata?: Record<string, unknown> }): User {
  return {
    id: raw.id,
    email: raw.email ?? '',
    metadata: raw.user_metadata,
  };
}

function mapSession(raw: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> };
}): Session {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: raw.expires_at ?? 0,
    user: mapUser(raw.user),
  };
}

export class SupabaseAuthProvider implements AuthProvider {
  private client: SupabaseClient;

  constructor(config: { supabaseUrl: string; supabaseKey: string }) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey);
  }

  async signIn(credentials: { email: string; password: string }): Promise<AuthResult> {
    const { data, error } = await this.client.auth.signInWithPassword(credentials);
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      user: data.user ? mapUser(data.user) : undefined,
      session: data.session ? mapSession(data.session) : undefined,
    };
  }

  async signUp(credentials: {
    email: string;
    password: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuthResult> {
    const { data, error } = await this.client.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: { data: credentials.metadata },
    });
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      user: data.user ? mapUser(data.user) : undefined,
      session: data.session ? mapSession(data.session) : undefined,
    };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    return data.session ? mapSession(data.session) : null;
  }

  async getUser(): Promise<User | null> {
    const { data } = await this.client.auth.getUser();
    return data.user ? mapUser(data.user) : null;
  }

  onAuthStateChange(
    callback: (event: AuthEvent, session: Session | null) => void,
  ): Unsubscribe {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      const mapped = event.toUpperCase() as AuthEvent;
      callback(mapped, session ? mapSession(session) : null);
    });
    return () => data.subscription.unsubscribe();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await this.client.auth.getSession();
      return !error;
    } catch {
      return false;
    }
  }
}
