import { ConfigurationError } from './errors';

export function assertNonEmpty(name: string, value: string | undefined | null): string {
  const v = String(value ?? '').trim();
  if (!v) throw new ConfigurationError(`Missing required value for ${name}`);
  return v;
}

export function parseEnum<T extends string>(name: string, raw: string, allowed: readonly T[]): T {
  const v = String(raw ?? '').trim();
  if (!v) throw new ConfigurationError(`Missing ${name}`);
  const found = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  if (!found) {
    throw new ConfigurationError(`${name} must be one of: ${allowed.join(', ')} (got: ${raw})`);
  }
  return found;
}

export function normalizeApiBaseUrl(raw: string, field = 'api-url'): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new ConfigurationError(`Missing ${field}`);
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new ConfigurationError(`Invalid ${field}: ${trimmed}`);
  }
  const host = u.hostname.toLowerCase();
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (u.protocol !== 'https:' && !isLocal) {
    throw new ConfigurationError(`${field} must use https:// unless targeting localhost`);
  }
  return u.toString().replace(/\/+$/, '');
}
