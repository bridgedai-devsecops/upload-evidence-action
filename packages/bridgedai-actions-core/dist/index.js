"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadGenericEvidence = exports.uploadAttestation = exports.uploadSbom = exports.BridgedHttpClient = exports.BridgedApiError = void 0;
exports.readWorkflowInput = readWorkflowInput;
exports.normalizeBaseUrl = normalizeBaseUrl;
exports.redactSecrets = redactSecrets;
exports.parseBoolean = parseBoolean;
exports.evaluateReleaseGate = evaluateReleaseGate;
exports.ingestSbom = ingestSbom;
exports.ingestAttestation = ingestAttestation;
exports.getCapabilities = getCapabilities;
exports.resolveBuild = resolveBuild;
exports.extractBuildIdFromResolveResponse = extractBuildIdFromResolveResponse;
exports.ingestEvidence = ingestEvidence;
exports.verifyArtifactSupplyChain = verifyArtifactSupplyChain;
exports.getBuildSupplyChainVerification = getBuildSupplyChainVerification;
exports.getCurrentUserMe = getCurrentUserMe;
exports.sha256HexOfBuffer = sha256HexOfBuffer;
exports.sha256HexOfFile = sha256HexOfFile;
exports.listFilesUnderDirectory = listFilesUnderDirectory;
exports.computeDirectoryManifestSha256 = computeDirectoryManifestSha256;
const crypto_1 = require("crypto");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Reads workflow `with:` inputs the same way the GitHub Actions runner does:
 * `INPUT_` + uppercased name with `-` and spaces converted to `_`.
 * (`@actions/core` getInput only replaces spaces, so kebab-case inputs are broken off-runner.)
 */
function readWorkflowInput(name) {
    const key = `INPUT_${name.replace(/\s+/g, '_').replace(/-/g, '_').toUpperCase()}`;
    return String(process.env[key] ?? '').trim();
}
/** Normalize API base URL (no trailing slash). */
function normalizeBaseUrl(raw, fieldName = 'api-base') {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed)
        throw new Error(`Missing ${fieldName}`);
    let u;
    try {
        u = new URL(trimmed);
    }
    catch {
        throw new Error(`Invalid ${fieldName}: ${trimmed}`);
    }
    const host = u.hostname.toLowerCase();
    const isLocalHttp = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    if (u.protocol !== 'https:' && !isLocalHttp) {
        throw new Error(`${fieldName} must use https:// unless targeting localhost`);
    }
    return u.toString().replace(/\/+$/, '');
}
const API_KEY_PATTERN = /brdg_[a-z0-9]+_sk_[a-z0-9_]+/gi;
function redactSecrets(message, apiKey) {
    let out = String(message ?? '');
    if (apiKey && apiKey.length > 8) {
        const esc = apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try {
            out = out.replace(new RegExp(esc, 'g'), '[REDACTED_API_KEY]');
        }
        catch {
            /* ignore */
        }
    }
    out = out.replace(API_KEY_PATTERN, '[REDACTED_API_KEY]');
    return out;
}
function parseBoolean(raw, defaultValue) {
    if (raw === undefined || raw === null || String(raw).trim() === '')
        return defaultValue;
    const v = String(raw).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(v))
        return true;
    if (['false', '0', 'no', 'n', 'off'].includes(v))
        return false;
    throw new Error(`Invalid boolean: ${raw}`);
}
class BridgedApiError extends Error {
    status;
    code;
    detail;
    bodySnippet;
    constructor(opts) {
        super(opts.message);
        this.name = 'BridgedApiError';
        this.status = opts.status;
        this.code = opts.code;
        this.detail = opts.detail;
        this.bodySnippet = opts.bodySnippet ?? '';
    }
}
exports.BridgedApiError = BridgedApiError;
function problemMessage(status, body, rawText) {
    if (body && typeof body === 'object') {
        const o = body;
        const detail = typeof o.detail === 'string' ? o.detail : typeof o.message === 'string' ? o.message : undefined;
        const title = typeof o.title === 'string' ? o.title : undefined;
        const code = typeof o.code === 'string' ? o.code : typeof o.error === 'string' ? o.error : undefined;
        const msg = [title, detail].filter(Boolean).join(': ') || `HTTP ${status}`;
        return { msg, code, detail };
    }
    const t = rawText.length > 2000 ? `${rawText.slice(0, 2000)}…` : rawText;
    return { msg: t || `HTTP ${status}` };
}
async function sleep(ms) {
    await new Promise((r) => setTimeout(r, ms));
}
class BridgedHttpClient {
    baseUrl;
    apiKey;
    orgId;
    timeoutMs;
    preferAuthorizationApiKey;
    constructor(opts) {
        this.baseUrl = normalizeBaseUrl(opts.baseUrl);
        this.apiKey = String(opts.apiKey ?? '').trim();
        this.orgId = String(opts.orgId ?? '').trim();
        this.timeoutMs = opts.timeoutMs ?? 30_000;
        this.preferAuthorizationApiKey = opts.preferAuthorizationApiKey ?? false;
        if (!this.apiKey)
            throw new Error('Missing BridgedAI API key');
        if (!this.orgId)
            throw new Error('Missing BridgedAI organization id');
    }
    authHeaders() {
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
    async requestJson(opts) {
        const url = `${this.baseUrl}${opts.path.startsWith('/') ? opts.path : `/${opts.path}`}`;
        const allowRetry = opts.allowRetry ?? opts.method === 'GET';
        const maxAttempts = allowRetry ? 3 : 1;
        let lastErr;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                const headers = {
                    accept: 'application/json',
                    ...this.authHeaders(),
                };
                const init = { method: opts.method, headers, signal: controller.signal };
                if (opts.body !== undefined && opts.method === 'POST') {
                    headers['content-type'] = 'application/json';
                    init.body = JSON.stringify(opts.body);
                }
                const res = await fetch(url, init);
                const text = await res.text();
                let parsed = undefined;
                if (text) {
                    try {
                        parsed = JSON.parse(text);
                    }
                    catch {
                        parsed = { raw: text };
                    }
                }
                if (res.ok)
                    return parsed;
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
            }
            catch (e) {
                lastErr = e;
                if (e instanceof BridgedApiError)
                    throw e;
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
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }
}
exports.BridgedHttpClient = BridgedHttpClient;
async function evaluateReleaseGate(client, body) {
    return client.requestJson({
        method: 'POST',
        path: '/v1/enforcement/release-gate/evaluate',
        body,
        allowRetry: false,
    });
}
async function ingestSbom(client, body) {
    return client.requestJson({
        method: 'POST',
        path: '/v1/ingest/sbom',
        body,
        allowRetry: false,
    });
}
async function ingestAttestation(client, body) {
    return client.requestJson({
        method: 'POST',
        path: '/v1/ingest/attestation',
        body,
        allowRetry: false,
    });
}
/** Aliases for finalized CI naming (same endpoints as ingestSbom / ingestAttestation). */
exports.uploadSbom = ingestSbom;
exports.uploadAttestation = ingestAttestation;
/** GET /v1/actions/capabilities — shape is backend-defined; treat as generic JSON. */
async function getCapabilities(client) {
    return client.requestJson({
        method: 'GET',
        path: '/v1/actions/capabilities',
        allowRetry: true,
    });
}
async function resolveBuild(client, body) {
    return client.requestJson({
        method: 'POST',
        path: '/v1/builds/resolve',
        body,
        allowRetry: false,
    });
}
/** Normalize POST /v1/builds/resolve JSON to a build id string. */
function extractBuildIdFromResolveResponse(res) {
    if (!res || typeof res !== 'object')
        return '';
    const o = res;
    if (typeof o.buildId === 'string' && o.buildId)
        return o.buildId;
    if (typeof o.build_id === 'string' && o.build_id)
        return o.build_id;
    const b = o.build;
    if (b && typeof b === 'object') {
        const id = b.id;
        if (typeof id === 'string' && id)
            return id;
    }
    return '';
}
/** POST /v1/ingest/evidence — body includes orgId, buildId, kind, and kind-specific fields. */
async function ingestEvidence(client, body) {
    return client.requestJson({
        method: 'POST',
        path: '/v1/ingest/evidence',
        body,
        allowRetry: false,
    });
}
exports.uploadGenericEvidence = ingestEvidence;
async function verifyArtifactSupplyChain(client, artifactId, body) {
    const urlPath = `/v1/artifacts/${encodeURIComponent(artifactId)}/verify-supply-chain`;
    return client.requestJson({
        method: 'POST',
        path: urlPath,
        body,
        allowRetry: false,
    });
}
async function getBuildSupplyChainVerification(client, buildId) {
    const urlPath = `/v1/builds/${encodeURIComponent(buildId)}/supply-chain-verification`;
    return client.requestJson({
        method: 'GET',
        path: urlPath,
        allowRetry: true,
    });
}
/** GET /v1/users/me — optional credential probe (requires same auth as other v1 routes). */
async function getCurrentUserMe(client) {
    return client.requestJson({
        method: 'GET',
        path: '/v1/users/me',
        allowRetry: true,
    });
}
function sha256HexOfBuffer(buf) {
    return (0, crypto_1.createHash)('sha256').update(buf).digest('hex');
}
function sha256HexOfFile(filePath, fsMod = fs) {
    return sha256HexOfBuffer(fsMod.readFileSync(filePath));
}
/** Sorted recursive file list (relative POSIX paths). Skips `.git` directories. */
function listFilesUnderDirectory(rootAbs, fsMod = fs) {
    const root = path.resolve(rootAbs);
    const files = [];
    const walk = (dir) => {
        for (const ent of fsMod.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name === '.git' && ent.isDirectory())
                continue;
            const abs = path.join(dir, ent.name);
            if (ent.isDirectory())
                walk(abs);
            else if (ent.isFile())
                files.push(abs);
        }
    };
    walk(root);
    return files.sort((a, b) => a.localeCompare(b));
}
/**
 * Deterministic digest for a directory: sort files by relative path, hash each file as sha256,
 * then sha256 over lines `relativePath\\n<fileSha256>\\n` concatenated. Does not follow symlinks as files.
 */
function computeDirectoryManifestSha256(rootAbs, fsMod = fs) {
    const root = path.resolve(rootAbs);
    const h = (0, crypto_1.createHash)('sha256');
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
