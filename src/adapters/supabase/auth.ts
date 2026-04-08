import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
	AuthEvent,
	AuthProvider,
	AuthResult,
	Session,
	Unsubscribe,
	User,
} from "@/core/ports";

function mapUser(supabaseUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }): User {
	return {
		id: supabaseUser.id,
		email: supabaseUser.email ?? "",
		metadata: supabaseUser.user_metadata,
	};
}

function mapSession(session: {
	access_token: string;
	refresh_token: string;
	expires_at?: number;
	user: { id: string; email?: string; user_metadata?: Record<string, unknown> };
}): Session {
	return {
		accessToken: session.access_token,
		refreshToken: session.refresh_token,
		expiresAt: session.expires_at ?? 0,
		user: mapUser(session.user),
	};
}

const AUTH_EVENT_MAP: Record<string, AuthEvent> = {
	SIGNED_IN: "SIGNED_IN",
	SIGNED_OUT: "SIGNED_OUT",
	TOKEN_REFRESHED: "TOKEN_REFRESHED",
};

export class SupabaseAuthProvider implements AuthProvider {
	private client: SupabaseClient;

	constructor(config: { supabaseUrl: string; supabaseAnonKey: string }) {
		this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
	}

	async signIn(credentials: { email: string; password: string }): Promise<AuthResult> {
		const { data, error } = await this.client.auth.signInWithPassword({
			email: credentials.email,
			password: credentials.password,
		});

		if (error || !data.user || !data.session) {
			return { success: false, error: error?.message ?? "Sign in failed" };
		}

		return {
			success: true,
			user: mapUser(data.user),
			session: mapSession(data.session),
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
			options: credentials.metadata ? { data: credentials.metadata } : undefined,
		});

		if (error || !data.user) {
			return { success: false, error: error?.message ?? "Sign up failed" };
		}

		return {
			success: true,
			user: mapUser(data.user),
			session: data.session ? mapSession(data.session) : undefined,
		};
	}

	async signOut(): Promise<void> {
		const { error } = await this.client.auth.signOut();
		if (error) throw new Error(error.message);
	}

	async getSession(): Promise<Session | null> {
		const { data, error } = await this.client.auth.getSession();
		if (error || !data.session) return null;
		return mapSession(data.session);
	}

	async getUser(): Promise<User | null> {
		const { data, error } = await this.client.auth.getUser();
		if (error || !data.user) return null;
		return mapUser(data.user);
	}

	onAuthStateChange(
		callback: (event: AuthEvent, session: Session | null) => void,
	): Unsubscribe {
		const { data } = this.client.auth.onAuthStateChange((event, session) => {
			const mappedEvent = AUTH_EVENT_MAP[event];
			if (mappedEvent) {
				callback(mappedEvent, session ? mapSession(session) : null);
			}
		});

		return () => data.subscription.unsubscribe();
	}
}
