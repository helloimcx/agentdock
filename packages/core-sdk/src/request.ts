import { coreClient } from './client.js';

export function coreRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  return coreClient.request<T>(method, path, body);
}

// buildQuery renders a `?k=v&k2=v2` query string for defined, non-empty params
// (or '' when no params apply). It centralizes the encoding used across the
// domain modules so a param name / encoding change is one edit.
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const defined = Object.entries(params).filter(([, value]) => value !== undefined && value !== '');
  if (defined.length === 0) {
    return '';
  }
  const search = new URLSearchParams();
  for (const [key, value] of defined) {
    search.set(key, String(value));
  }
  return `?${search.toString()}`;
}
