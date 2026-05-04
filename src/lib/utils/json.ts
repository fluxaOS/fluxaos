/**
 * JSON serialisation helpers for JSONB form fields.
 *
 * Shared across settings pages that accept JSON object values
 * (brands, config entries, etc.).
 */

export function stringifyJson(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return JSON.stringify(value, null, 2);
}

export function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
