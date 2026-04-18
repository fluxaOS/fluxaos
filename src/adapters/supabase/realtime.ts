/**
 * Supabase RealtimeProvider adapter.
 *
 * Implements the RealtimeProvider port using @supabase/supabase-js
 * Realtime channels. Resolved via the registry — never imported directly.
 */
import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import type {
  RealtimeProvider,
  RealtimeTableEvent,
} from '@/core/ports/realtime';
import type { Unsubscribe } from '@/core/ports/auth';

export class SupabaseRealtimeProvider implements RealtimeProvider {
  private client: SupabaseClient;

  constructor(config: { supabaseUrl: string; supabaseKey: string }) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey);
  }

  subscribe<T>(
    channel: string,
    event: string,
    callback: (payload: T) => void,
  ): Unsubscribe {
    const ch: RealtimeChannel = this.client
      .channel(channel)
      .on('broadcast', { event }, ({ payload }) => callback(payload as T))
      .subscribe();
    return () => { ch.unsubscribe(); };
  }

  subscribeToTable<T>(
    channelName: string,
    table: string,
    event: 'INSERT' | 'UPDATE' | '*',
    callback: (payload: RealtimeTableEvent<T>) => void,
  ): Unsubscribe {
    const ch: RealtimeChannel = this.client
      .channel(channelName)
      .on(
        'postgres_changes' as never,
        { event, schema: 'public', table } as never,
        (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: T; old: T | null }) => {
          callback({
            eventType: payload.eventType,
            new: payload.new,
            old: payload.old,
          });
        },
      )
      .subscribe();
    return () => { ch.unsubscribe(); };
  }

  async broadcast<T>(channel: string, event: string, payload: T): Promise<void> {
    const ch = this.client.channel(channel);
    await ch.send({ type: 'broadcast', event, payload });
    await ch.unsubscribe();
  }
}
