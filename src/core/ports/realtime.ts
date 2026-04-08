import type { Unsubscribe } from "./auth";

export interface RealtimeProvider {
	subscribe<T>(
		channel: string,
		event: string,
		callback: (payload: T) => void,
	): Unsubscribe;

	broadcast<T>(
		channel: string,
		event: string,
		payload: T,
	): Promise<void>;
}
