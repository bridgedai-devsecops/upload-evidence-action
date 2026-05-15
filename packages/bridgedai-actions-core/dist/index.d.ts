import * as fs from 'fs';
/**
 * Reads workflow `with:` inputs the same way the GitHub Actions runner does:
 * `INPUT_` + uppercased name with `-` and spaces converted to `_`.
 * (`@actions/core` getInput only replaces spaces, so kebab-case inputs are broken off-runner.)
 */
export declare function readWorkflowInput(name: string): string;
/** Normalize API base URL (no trailing slash). */
export declare function normalizeBaseUrl(raw: string, fieldName?: string): string;
export declare function redactSecrets(message: string, apiKey?: string): string;
export declare function parseBoolean(raw: string | undefined, defaultValue: boolean): boolean;
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
export declare class BridgedApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly detail?: string;
    readonly bodySnippet: string;
    constructor(opts: {
        status: number;
        message: string;
        code?: string;
        detail?: string;
        bodySnippet?: string;
    });
}
export declare class BridgedHttpClient {
    readonly baseUrl: string;
    private readonly apiKey;
    private readonly orgId;
    private readonly timeoutMs;
    private readonly preferAuthorizationApiKey;
    constructor(opts: BridgedHttpClientOptions);
    private authHeaders;
    requestJson<T>(opts: JsonRequestOptions): Promise<T>;
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
    findings: Array<{
        code: string;
        message: string;
        severity?: string;
    }>;
    evaluatedAt: string;
    policyId: string;
    buildId: string;
    artifactId?: string;
}
export declare function evaluateReleaseGate(client: BridgedHttpClient, body: ReleaseGateEvaluateRequest): Promise<ReleaseGateEvaluateResponse>;
export interface IngestSbomRequest {
    sbom: Record<string, unknown> | string;
    buildId?: string;
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
export declare function ingestSbom(client: BridgedHttpClient, body: IngestSbomRequest): Promise<IngestResult>;
export interface IngestAttestationRequest {
    attestation: Record<string, unknown> | string;
    buildId?: string;
    projectId?: string;
    artifactId?: string;
    publishToGuac?: boolean;
}
export declare function ingestAttestation(client: BridgedHttpClient, body: IngestAttestationRequest): Promise<IngestResult>;
/** Aliases for finalized CI naming (same endpoints as ingestSbom / ingestAttestation). */
export declare const uploadSbom: typeof ingestSbom;
export declare const uploadAttestation: typeof ingestAttestation;
/** GET /v1/actions/capabilities — shape is backend-defined; treat as generic JSON. */
export declare function getCapabilities(client: BridgedHttpClient): Promise<Record<string, unknown>>;
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
export declare function resolveBuild(client: BridgedHttpClient, body: BuildResolveRequest): Promise<BuildResolveResponse>;
/** Normalize POST /v1/builds/resolve JSON to a build id string. */
export declare function extractBuildIdFromResolveResponse(res: BuildResolveResponse | Record<string, unknown>): string;
export type EvidenceKind = 'sigstore_bundle' | 'sigstore_signature' | 'rekor_entry' | 'artifact_metadata';
/** POST /v1/ingest/evidence — body includes orgId, buildId, kind, and kind-specific fields. */
export declare function ingestEvidence(client: BridgedHttpClient, body: Record<string, unknown>): Promise<IngestResult>;
export declare const uploadGenericEvidence: typeof ingestEvidence;
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
    findings: Array<{
        code: string;
        title?: string;
        message: string;
        severity?: string;
        status?: string;
    }>;
    verifiedAt?: string;
    verifier?: string;
    metadata?: Record<string, unknown>;
}
export declare function verifyArtifactSupplyChain(client: BridgedHttpClient, artifactId: string, body: VerifySupplyChainBody): Promise<VerificationResult>;
export interface BuildSupplyChainVerificationResponse {
    buildId: string;
    evaluationId?: string;
    runs: unknown[];
    findings: unknown[];
    evaluatedAt?: string;
}
export declare function getBuildSupplyChainVerification(client: BridgedHttpClient, buildId: string): Promise<BuildSupplyChainVerificationResponse>;
/** GET /v1/users/me — optional credential probe (requires same auth as other v1 routes). */
export declare function getCurrentUserMe(client: BridgedHttpClient): Promise<Record<string, unknown>>;
export declare function sha256HexOfBuffer(buf: Buffer): string;
export declare function sha256HexOfFile(filePath: string, fsMod?: typeof fs): string;
/** Sorted recursive file list (relative POSIX paths). Skips `.git` directories. */
export declare function listFilesUnderDirectory(rootAbs: string, fsMod?: typeof fs): string[];
/**
 * Deterministic digest for a directory: sort files by relative path, hash each file as sha256,
 * then sha256 over lines `relativePath\\n<fileSha256>\\n` concatenated. Does not follow symlinks as files.
 */
export declare function computeDirectoryManifestSha256(rootAbs: string, fsMod?: typeof fs): string;
