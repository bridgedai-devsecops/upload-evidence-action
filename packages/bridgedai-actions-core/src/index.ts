import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Reads workflow `with:` inputs the same way the GitHub Actions runner does:
 * `INPUT_` + uppercased name with `-` and spaces converted to `_`.
 * (`@actions/core` getInput only replaces spaces, so kebab-case inputs are broken off-runner.)
 */
export function readWorkflowInput(name: string): string {
  const key = `INPUT_${name.replace(/\s+/g, '_').replace(/-/g, '_').toUpperCase()}`;
  return String(process.env[key] ?? '').trim();
}

/** Normalize API base URL (no trailing slash). */
export function normalizeBaseUrl(raw: string, fieldName = 'api-base'): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new Error(`Missing ${fieldName}`);
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error(`Invalid ${fieldName}: ${trimmed}`);
  }
  const host = u.hostname.toLowerCase();
  const isLocalHttp =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (u.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(`${fieldName} must use https:// unless targeting localhost`);
  }
  return u.toString().replace(/\/+$/, '');
}

const API_KEY_PATTERN = /brdg_[a-z0-9]+_sk_[a-z0-9_]+/gi;

export function redactSecrets(message: string, apiKey?: string): string {
  let out = String(message ?? '');
  if (apiKey && apiKey.length > 8) {
    const esc = apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      out = out.replace(new RegExp(esc, 'g'), '[REDACTED_API_KEY]');
    } catch {
      /* ignore */
    }
  }
  out = out.replace(API_KEY_PATTERN, '[REDACTED_API_KEY]');
  return out;
}

export function parseBoolean(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(v)) return false;
  throw new Error(`Invalid boolean: ${raw}`);
}

export interface BridgedHttpClientOptions {
  baseUrl: string;
  apiKey: string;
  orgId: string;
  /** Total request timeout in ms */
  timeoutMs?: number;
  /** Use Authorization: ApiKey … instead of x-api-key (both are accepted by BridgedAI) */
  preferAuthorizationApiKey?: boolean;
}

export interface JsonRequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** When false, no automatic retries (safe default for POSTs that trigger side effects). */
  allowRetry?: boolean;
}

export class BridgedApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: string;
  readonly bodySnippet: string;

  constructor(opts: { status: number; message: string; code?: string; detail?: string; bodySnippet?: string }) {
    super(opts.message);
    this.name = 'BridgedApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
    this.bodySnippet = opts.bodySnippet ?? '';
  }
}

function problemMessage(status: number, body: unknown, rawText: string): { msg: string; code?: string; detail?: string } {
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const detail = typeof o.detail === 'string' ? o.detail : typeof o.message === 'string' ? o.message : undefined;
    const title = typeof o.title === 'string' ? o.title : undefined;
    const code = typeof o.code === 'string' ? o.code : typeof o.error === 'string' ? o.error : undefined;
    const msg = [title, detail].filter(Boolean).join(': ') || `HTTP ${status}`;
    return { msg, code, detail };
  }
  const t = rawText.length > 2000 ? `${rawText.slice(0, 2000)}…` : rawText;
  return { msg: t || `HTTP ${status}` };
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export class BridgedHttpClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly orgId: string;
  private readonly timeoutMs: number;
  private readonly preferAuthorizationApiKey: boolean;

  constructor(opts: BridgedHttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = String(opts.apiKey ?? '').trim();
    this.orgId = String(opts.orgId ?? '').trim();
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.preferAuthorizationApiKey = opts.preferAuthorizationApiKey ?? false;
    if (!this.apiKey) throw new Error('Missing BridgedAI API key');
    if (!this.orgId) throw new Error('Missing BridgedAI organization id');
  }

  private authHeaders(): Record<string, string> {
    if (this.preferAuthorizationApiKey) {
      return {
        Authorization: `ApiKey ${this.apiKey}`,
        'x-org-id': this.orgId,
      };
    }
    return {
      'x-api-key': this.apiKey,
      'x-org-id': this.orgId,
    };
  }

  async requestJson<T>(opts: JsonRequestOptions): Promise<T> {
    const url = `${this.baseUrl}${opts.path.startsWith('/') ? opts.path : `/${opts.path}`}`;
    const allowRetry = opts.allowRetry ?? opts.method === 'GET';
    const maxAttempts = allowRetry ? 3 : 1;
    let lastErr: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers: Record<string, string> = {
          accept: 'application/json',
          ...this.authHeaders(),
        };
        const init: RequestInit = { method: opts.method, headers, signal: controller.signal };
        if (opts.body !== undefined && opts.method === 'POST') {
          headers['content-type'] = 'application/json';
          init.body = JSON.stringify(opts.body);
        }

        const res = await fetch(url, init);
        const text = await res.text();
        let parsed: unknown = undefined;
        if (text) {
          try {
            parsed = JSON.parse(text) as unknown;
          } catch {
            parsed = { raw: text };
          }
        }

        if (res.ok) return parsed as T;

        const { msg, code, detail } = problemMessage(res.status, parsed, text);
        const snippet = redactSecrets(text.slice(0, 800), this.apiKey);
        let userMsg = redactSecrets(msg, this.apiKey);
        if (res.status === 422) {
          userMsg += ' (Unprocessable entity — verify JSON body matches the public CI API contract.)';
        }

        const retryable = res.status === 502 || res.status === 503 || res.status === 504;
        if (allowRetry && retryable && attempt < maxAttempts - 1) {
          await sleep(250 * 2 ** attempt);
          continue;
        }

        throw new BridgedApiError({
          status: res.status,
          message: `BridgedAI API ${res.status}: ${userMsg}`,
          code,
          detail,
          bodySnippet: snippet,
        });
      } catch (e) {
        lastErr = e;
        if (e instanceof BridgedApiError) throw e;
        const aborted = e instanceof Error && e.name === 'AbortError';
        if (allowRetry && aborted && attempt < maxAttempts - 1) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        if (aborted) {
          throw new BridgedApiError({
            status: 0,
            message: `BridgedAI request timed out after ${this.timeoutMs}ms (${opts.method} ${opts.path})`,
          });
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

/** POST /v1/enforcement/release-gate/evaluate */
export interface ReleaseGateEvaluateRequest {
  orgId: string;
  buildId?: string;
  repoFullName?: string;
  workflowRunId?: string;
  commitSha?: string;
  projectId?: string;
  artifactId?: string;
  artifactDigest?: string;
  branch?: string;
  environment?: string;
  policyId?: string;
}

export interface ReleaseGateEvaluateResponse {
  decision: 'allow' | 'warn' | 'block';
  decisionId: string;
  trustScore?: number;
  reasons: string[];
  findings: Array<{ code: string; message: string; severity?: string }>;
  evaluatedAt: string;
  policyId: string;
  buildId: string;
  artifactId?: string;
}

export async function evaluateReleaseGate(
  client: BridgedHttpClient,
  body: ReleaseGateEvaluateRequest,
): Promise<ReleaseGateEvaluateResponse> {
  return client.requestJson<ReleaseGateEvaluateResponse>({
    method: 'POST',
    path: '/v1/enforcement/release-gate/evaluate',
    body,
    allowRetry: false,
  });
}

export interface IngestSbomRequest {
  sbom: Record<string, unknown> | string;
  buildId?: string;
  /** CI provenance, e.g. `github-actions`. When set with `linkEvidence`, backend may require `buildId`. */
  source?: string;
  /** When true with `buildId`, links SBOM to the resolved build for CI evidence. */
  linkEvidence?: boolean;
  repoId?: string;
  repoFullName?: string;
  publishToGuac?: boolean;
}

export interface IngestResult {
  ok: boolean;
  parsed: boolean;
  guacPublished?: boolean;
  graphWritten?: boolean;
  evidenceEmitted?: number;
  error?: string;
  status: string;
}

export async function ingestSbom(client: BridgedHttpClient, body: IngestSbomRequest): Promise<IngestResult> {
  return client.requestJson<IngestResult>({
    method: 'POST',
    path: '/v1/ingest/sbom',
    body,
    allowRetry: false,
  });
}

export interface IngestAttestationRequest {
  attestation: Record<string, unknown> | string;
  buildId?: string;
  projectId?: string;
  artifactId?: string;
  publishToGuac?: boolean;
}

export async function ingestAttestation(client: BridgedHttpClient, body: IngestAttestationRequest): Promise<IngestResult> {
  return client.requestJson<IngestResult>({
    method: 'POST',
    path: '/v1/ingest/attestation',
    body,
    allowRetry: false,
  });
}

/** Aliases for finalized CI naming (same endpoints as ingestSbom / ingestAttestation). */
export const uploadSbom = ingestSbom;
export const uploadAttestation = ingestAttestation;

/** GET /v1/actions/capabilities — shape is backend-defined; treat as generic JSON. */
export async function getCapabilities(client: BridgedHttpClient): Promise<Record<string, unknown>> {
  return client.requestJson<Record<string, unknown>>({
    method: 'GET',
    path: '/v1/actions/capabilities',
    allowRetry: true,
  });
}

/** POST /v1/builds/resolve */
export interface BuildResolveRequest {
  orgId: string;
  buildId?: string;
  repoFullName?: string;
  workflowRunId?: string;
  commitSha?: string;
  branch?: string;
}

export interface BuildResolveResponse {
  buildId?: string;
  projectId?: string;
  repoFullName?: string;
  workflowRunId?: string;
  commitSha?: string;
  branch?: string;
  resolved?: boolean;
  [key: string]: unknown;
}

export async function resolveBuild(client: BridgedHttpClient, body: BuildResolveRequest): Promise<BuildResolveResponse> {
  return client.requestJson<BuildResolveResponse>({
    method: 'POST',
    path: '/v1/builds/resolve',
    body,
    allowRetry: false,
  });
}

/** Normalize POST /v1/builds/resolve JSON to a build id string. */
export function extractBuildIdFromResolveResponse(res: BuildResolveResponse | Record<string, unknown>): string {
  if (!res || typeof res !== 'object') return '';
  const o = res as Record<string, unknown>;
  if (typeof o.buildId === 'string' && o.buildId) return o.buildId;
  if (typeof o.build_id === 'string' && o.build_id) return o.build_id;
  const b = o.build;
  if (b && typeof b === 'object') {
    const id = (b as Record<string, unknown>).id;
    if (typeof id === 'string' && id) return id;
  }
  return '';
}

export type EvidenceKind = 'sigstore_bundle' | 'sigstore_signature' | 'rekor_entry' | 'artifact_metadata';

/** POST /v1/ingest/evidence — body includes orgId, buildId, kind, and kind-specific fields. */
export async function ingestEvidence(client: BridgedHttpClient, body: Record<string, unknown>): Promise<IngestResult> {
  return client.requestJson<IngestResult>({
    method: 'POST',
    path: '/v1/ingest/evidence',
    body,
    allowRetry: false,
  });
}

export const uploadGenericEvidence = ingestEvidence;

export interface VerifySupplyChainBody {
  policyId?: string;
  offline?: boolean;
}

export type VerificationStatus = 'verified' | 'failed' | 'warning' | 'unsupported' | 'not_present';

export interface VerificationResult {
  artifactId?: string;
  buildId?: string;
  status: VerificationStatus;
  verified: boolean;
  findings: Array<{ code: string; title?: string; message: string; severity?: string; status?: string }>;
  verifiedAt?: string;
  verifier?: string;
  metadata?: Record<string, unknown>;
}

export async function verifyArtifactSupplyChain(
  client: BridgedHttpClient,
  artifactId: string,
  body: VerifySupplyChainBody,
): Promise<VerificationResult> {
  const urlPath = `/v1/artifacts/${encodeURIComponent(artifactId)}/verify-supply-chain`;
  return client.requestJson<VerificationResult>({
    method: 'POST',
    path: urlPath,
    body,
    allowRetry: false,
  });
}

export interface BuildSupplyChainVerificationResponse {
  buildId: string;
  evaluationId?: string;
  runs: unknown[];
  findings: unknown[];
  evaluatedAt?: string;
}

export async function getBuildSupplyChainVerification(
  client: BridgedHttpClient,
  buildId: string,
): Promise<BuildSupplyChainVerificationResponse> {
  const urlPath = `/v1/builds/${encodeURIComponent(buildId)}/supply-chain-verification`;
  return client.requestJson<BuildSupplyChainVerificationResponse>({
    method: 'GET',
    path: urlPath,
    allowRetry: true,
  });
}

/** GET /v1/users/me — optional credential probe (requires same auth as other v1 routes). */
export async function getCurrentUserMe(client: BridgedHttpClient): Promise<Record<string, unknown>> {
  return client.requestJson<Record<string, unknown>>({
    method: 'GET',
    path: '/v1/users/me',
    allowRetry: true,
  });
}

export function sha256HexOfBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256HexOfFile(filePath: string, fsMod: typeof fs = fs): string {
  return sha256HexOfBuffer(fsMod.readFileSync(filePath));
}

/** Sorted recursive file list (relative POSIX paths). Skips `.git` directories. */
export function listFilesUnderDirectory(rootAbs: string, fsMod: typeof fs = fs): string[] {
  const root = path.resolve(rootAbs);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fsMod.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' && ent.isDirectory()) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) files.push(abs);
    }
  };
  walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Deterministic digest for a directory: sort files by relative path, hash each file as sha256,
 * then sha256 over lines `relativePath\\n<fileSha256>\\n` concatenated. Does not follow symlinks as files.
 */
export function computeDirectoryManifestSha256(rootAbs: string, fsMod: typeof fs = fs): string {
  const root = path.resolve(rootAbs);
  const h = createHash('sha256');
  const files = listFilesUnderDirectory(root, fsMod);
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const fileHash = sha256HexOfFile(abs, fsMod);
    h.update(rel);
    h.update('\n');
    h.update(fileHash);
    h.update('\n');
  }
  return h.digest('hex');
}
