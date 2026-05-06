import type { Unsubscribe } from './auth';

export interface RealtimeTableEvent<T> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: T;
  old: T | null;
}

export interface RealtimeProvider {
  /** Subscribe to generic channel events. */
  subscribe<T>(
    channel: string,
    event: string,
    callback: (payload: T) => void
  ): Unsubscribe;

  /** Subscribe to INSERT/UPDATE/DELETE on a specific table. */
  subscribeToTable<T>(
    channelName: string,
    table: string,
    event: 'INSERT' | 'UPDATE' | '*',
    callback: (payload: RealtimeTableEvent<T>) => void,
    /** Supabase Realtime server-side filter, e.g. `'id=eq.abc'`. Optional. */
    filter?: string
  ): Unsubscribe;

  broadcast<T>(channel: string, event: string, payload: T): Promise<void>;
}
