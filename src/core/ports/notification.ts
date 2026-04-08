export interface NotificationParams {
  channel: string;
  title: string;
  body: string;
  level: 'info' | 'warn' | 'error';
  metadata?: Record<string, unknown>;
}

export interface NotificationProvider {
  send(params: NotificationParams): Promise<void>;
}
