import { ProductionIntegrationError } from './errors';
import { isTransientHttpStatus, withRetry } from './retry';

export interface JsonRequestInit {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

function mergeHeaders(a: Record<string, string> | undefined, b: Record<string, string>): Record<string, string> {
  return { ...(a ?? {}), ...b };
}

export class HttpResponseError extends ProductionIntegrationError {
  readonly status: number;
  readonly bodySnippet: string;
  constructor(status: number, message: string, bodySnippet: string) {
    super(message);
    this.name = 'HttpResponseError';
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

export async function requestJson<T>(init: JsonRequestInit): Promise<T> {
  const timeoutMs = init.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = mergeHeaders(init.headers, {
      accept: 'application/json',
      'content-type': 'application/json',
    });
    const res = await fetch(init.url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
      throw new HttpResponseError(res.status, `HTTP ${res.status} from BridgedAI API`, snippet);
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProductionIntegrationError('BridgedAI API returned non-JSON response body');
    }
  } catch (e) {
    if (e instanceof HttpResponseError) throw e;
    if (e instanceof ProductionIntegrationError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ProductionIntegrationError(`Request timed out after ${timeoutMs}ms`);
    }
    throw new ProductionIntegrationError(`Network error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(t);
  }
}

export async function postJsonWithRetries<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 30_000,
): Promise<T> {
  return withRetry(
    () => requestJson<T>({ method: 'POST', url, body, headers, timeoutMs }),
    (err) => err instanceof HttpResponseError && isTransientHttpStatus(err.status),
  );
}
