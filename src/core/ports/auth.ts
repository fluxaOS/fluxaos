export type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";

export type Unsubscribe = () => void;

export interface User {
	id: string;
	email: string;
	metadata?: Record<string, unknown>;
}

export interface Session {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	user: User;
}

export interface AuthResult {
	success: boolean;
	user?: User;
	session?: Session;
	error?: string;
}

export interface AuthProvider {
	signIn(credentials: {
		email: string;
		password: string;
	}): Promise<AuthResult>;

	signUp(credentials: {
		email: string;
		password: string;
		metadata?: Record<string, unknown>;
	}): Promise<AuthResult>;

	signOut(): Promise<void>;

	getSession(): Promise<Session | null>;

	getUser(): Promise<User | null>;

	onAuthStateChange(
		callback: (event: AuthEvent, session: Session | null) => void,
	): Unsubscribe;
}
