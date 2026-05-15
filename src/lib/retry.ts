export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

const defaultRetry: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 4000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  opts: Partial<RetryOptions> = {},
): Promise<T> {
  const o = { ...defaultRetry, ...opts };
  let lastErr: unknown;
  for (let attempt = 1; attempt <= o.maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const retryable = isRetryable(e);
      if (!retryable || attempt === o.maxAttempts) throw e;
      const exp = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 120);
      await sleep(exp + jitter);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
