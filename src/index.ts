import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import {
  BridgedHttpClient,
  BridgedApiError,
  extractBuildIdFromResolveResponse,
  ingestAttestation,
  ingestEvidence,
  ingestSbom,
  parseBoolean,
  readWorkflowInput,
  redactSecrets,
  resolveBuild,
  type IngestResult,
  type IngestSbomRequest,
} from '@bridgedai/actions-core';
import { buildSigstoreEvidenceStatement } from './sigstore-evidence';

function getRequired(name: string, envName: string): string {
  const v = readWorkflowInput(name);
  if (v) return v;
  const fromEnv = String(process.env[envName] ?? '').trim();
  if (fromEnv) return fromEnv;
  throw new Error(`Missing required ${name} input or ${envName} environment variable`);
}

function readTextMaybe(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) throw new Error(`Path not found: ${abs}`);
  return fs.readFileSync(abs, 'utf8');
}

function looksLikePem(s: string): boolean {
  return s.includes('-----BEGIN');
}

function collectEvidenceIds(res: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v) ids.push(v);
  };
  push(res.evidenceId);
  push(res.ingestionId);
  push(res.id);
  if (Array.isArray(res.evidenceIds)) {
    for (const x of res.evidenceIds) push(x);
  }
  return ids;
}

async function resolveEffectiveBuildId(
  client: BridgedHttpClient,
  orgId: string,
  needsBuild: boolean,
): Promise<string> {
  const explicit = readWorkflowInput('build-id').trim();
  if (explicit) return explicit;
  const doResolve = parseBoolean(readWorkflowInput('resolve-build'), true);
  if (!needsBuild) return '';
  if (!doResolve) {
    throw new Error(
      'BridgedAI CI evidence upload requires build-id, or set resolve-build=true to call POST /v1/builds/resolve with repo/run metadata.',
    );
  }
  const repoFullName = readWorkflowInput('repo-full-name').trim() || String(process.env.GITHUB_REPOSITORY ?? '').trim();
  const workflowRunId = readWorkflowInput('workflow-run-id').trim() || String(process.env.GITHUB_RUN_ID ?? '').trim();
  const commitSha = readWorkflowInput('commit-sha').trim() || String(process.env.GITHUB_SHA ?? '').trim();
  const branch = readWorkflowInput('branch').trim() || String(process.env.GITHUB_REF_NAME ?? '').trim();
  if (!repoFullName || (!workflowRunId && !commitSha)) {
    throw new Error(
      'resolve-build=true requires repo-full-name and (workflow-run-id or commit-sha) for POST /v1/builds/resolve.',
    );
  }
  const res = await resolveBuild(client, {
    orgId,
    repoFullName,
    workflowRunId: workflowRunId || undefined,
    commitSha: commitSha || undefined,
    branch: branch || undefined,
  });
  const bid = extractBuildIdFromResolveResponse(res);
  if (!bid) throw new Error('POST /v1/builds/resolve did not return a build id.');
  core.info(`Resolved build id: ${bid}`);
  return bid;
}

async function run(): Promise<void> {
  const apiBase = getRequired('api-base', 'BRIDGED_API_BASE');
  const apiKey = getRequired('api-key', 'BRIDGED_API_KEY');
  const orgId = getRequired('org-id', 'BRIDGED_ORG_ID');
  core.setSecret(apiKey);

  const sbomPath = readWorkflowInput('sbom-path');
  const attPath = readWorkflowInput('attestation-path');
  const signaturePath = readWorkflowInput('signature-path');
  const certificatePath = readWorkflowInput('certificate-path');
  const bundlePath = readWorkflowInput('bundle-path');
  const rekorPath = readWorkflowInput('rekor-metadata-path');

  const hasSigstorePaths = !!(signaturePath || certificatePath || bundlePath || rekorPath);
  if (!sbomPath && !attPath && !hasSigstorePaths) {
    throw new Error(
      'Provide at least one of sbom-path, attestation-path, or sigstore evidence paths (signature/certificate/bundle/rekor-metadata).',
    );
  }

  const timeoutMs = parseInt(readWorkflowInput('timeout-ms') || '120000', 10);
  const client = new BridgedHttpClient({ baseUrl: apiBase, apiKey, orgId, timeoutMs });

  const projectId = readWorkflowInput('project-id') || undefined;
  const artifactId = readWorkflowInput('artifact-id') || undefined;
  const artifactName = readWorkflowInput('artifact-name') || undefined;
  const artifactDigest = readWorkflowInput('artifact-digest') || undefined;
  const repoFullName = readWorkflowInput('repo-full-name') || undefined;
  const publishToGuac = parseBoolean(readWorkflowInput('publish-to-guac'), true);
  const failOnUnsupported = parseBoolean(readWorkflowInput('fail-on-unsupported-evidence'), false);
  const useLegacySigstore = parseBoolean(readWorkflowInput('use-legacy-sigstore-attestation-ingest'), false);
  const ingestSourceInput = readWorkflowInput('ingest-source').trim();
  const ingestSourceKey = ingestSourceInput.toLowerCase();
  const omitSource = ingestSourceKey === 'omit' || ingestSourceKey === 'none';
  const linkEvidence = parseBoolean(readWorkflowInput('link-evidence'), true);
  /** Default empty input → treat as `github-actions` for CI SBOM linking. */
  const usesGithubActionsSource = !omitSource && (ingestSourceInput === '' || ingestSourceKey === 'github-actions');

  const needsBuild = !!(sbomPath || attPath || hasSigstorePaths);
  let effectiveBuildId = '';
  try {
    effectiveBuildId = await resolveEffectiveBuildId(client, orgId, needsBuild);
  } catch (e) {
    if (e instanceof BridgedApiError) {
      core.error(redactSecrets(e.message, apiKey));
      if (e.status === 404) {
        core.error(
          'Build not found. Wait for BridgedAI workflow_run ingestion or verify repo/run identifiers for POST /v1/builds/resolve.',
        );
      }
      if (e.status === 409 || e.code === 'BUILD_AMBIGUOUS_COMMIT') {
        core.error('Ambiguous commit: pass workflow-run-id or an explicit build-id.');
      }
    }
    throw e;
  }

  const summary: {
    sbom?: unknown;
    attestation?: unknown;
    sigstore?: unknown[];
  } = { sigstore: [] };

  const evidenceIds: string[] = [];

  let sbomOk = false;
  let attOk = false;
  let sigOk = false;
  let bundleUploaded = false;
  let signatureUploaded = false;
  let rekorUploaded = false;
  let artifactMetaUploaded = false;

  const permHint403 = () => {
    core.error(
      'Evidence ingest requires evidence:upload on the API key. Prefer evidence:upload for new CI keys; projects:update is legacy-only.',
    );
  };

  if (sbomPath) {
    if (!effectiveBuildId && (linkEvidence || usesGithubActionsSource)) {
      throw new Error(
        'SBOM ingest with source=github-actions (default) or link-evidence=true requires build-id (pass build-id, or keep resolve-build=true so POST /v1/builds/resolve runs). For legacy SBOM without a build, set ingest-source=omit and link-evidence=false.',
      );
    }
    const abs = path.resolve(sbomPath);
    if (!fs.existsSync(abs)) throw new Error(`sbom-path not found: ${abs}`);
    const raw = fs.readFileSync(abs, 'utf8');
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('sbom-path must contain JSON');
    }
    try {
      const sbomReq: IngestSbomRequest = {
        sbom: doc,
        buildId: effectiveBuildId || undefined,
        repoFullName,
        publishToGuac,
      };
      if (!omitSource) {
        sbomReq.source =
          ingestSourceInput === '' || ingestSourceKey === 'github-actions' ? 'github-actions' : ingestSourceInput;
      }
      if (effectiveBuildId && linkEvidence) {
        sbomReq.linkEvidence = true;
      }
      const res = await ingestSbom(client, sbomReq);
      summary.sbom = res;
      sbomOk = !!res.ok;
      evidenceIds.push(...collectEvidenceIds(res as unknown as Record<string, unknown>));
      if (!res.ok) throw new Error(`SBOM ingest rejected: ${res.error ?? res.status}`);
      core.info(`SBOM ingest (/v1/ingest/sbom): status=${res.status} parsed=${res.parsed}`);
    } catch (e) {
      if (e instanceof BridgedApiError) {
        core.error(redactSecrets(e.message, apiKey));
        if (e.status === 403) permHint403();
      }
      throw e;
    }
  }

  if (attPath) {
    const abs = path.resolve(attPath);
    if (!fs.existsSync(abs)) throw new Error(`attestation-path not found: ${abs}`);
    const raw = fs.readFileSync(abs, 'utf8');
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('attestation-path must contain JSON');
    }
    try {
      const res = await ingestAttestation(client, {
        attestation: doc,
        buildId: effectiveBuildId,
        projectId,
        artifactId,
        publishToGuac,
      });
      summary.attestation = res;
      attOk = !!res.ok;
      evidenceIds.push(...collectEvidenceIds(res as unknown as Record<string, unknown>));
      if (!res.ok) throw new Error(`Attestation ingest rejected: ${res.error ?? res.status}`);
      core.info(`Attestation ingest (/v1/ingest/attestation): status=${res.status} parsed=${res.parsed}`);
    } catch (e) {
      if (e instanceof BridgedApiError) {
        core.error(redactSecrets(e.message, apiKey));
        if (e.status === 403) permHint403();
      }
      throw e;
    }
  }

  if (hasSigstorePaths) {
    const sigText = readTextMaybe(signaturePath);
    const certText = readTextMaybe(certificatePath);
    const bundleRaw = readTextMaybe(bundlePath);
    const rekorRaw = readTextMaybe(rekorPath);

    let bundleJson: unknown = undefined;
    if (bundleRaw !== undefined) {
      try {
        bundleJson = JSON.parse(bundleRaw) as unknown;
      } catch {
        if (failOnUnsupported) throw new Error('bundle-path must contain JSON for /v1/ingest/evidence');
        core.error('bundle-path is not valid JSON; skipping bundle upload.');
      }
    }

    let rekorMeta: unknown = undefined;
    if (rekorRaw !== undefined) {
      try {
        rekorMeta = JSON.parse(rekorRaw) as unknown;
      } catch {
        if (failOnUnsupported) throw new Error('rekor-metadata-path must be JSON');
        core.warning('rekor-metadata-path is not JSON; skipping.');
      }
    }

    let signaturePem: string | undefined;
    let certificatePem: string | undefined;
    let sigPathProvidedJson = false;
    if (sigText !== undefined) {
      if (looksLikePem(sigText)) {
        signaturePem = sigText;
      } else {
        try {
          const j = JSON.parse(sigText) as unknown;
          bundleJson = bundleJson ?? j;
          sigPathProvidedJson = true;
        } catch {
          if (failOnUnsupported) throw new Error('signature-path must be PEM or JSON');
          core.error('signature-path is neither PEM nor JSON; skipping.');
        }
      }
    }
    if (certText !== undefined) {
      if (looksLikePem(certText)) {
        certificatePem = certText;
      } else {
        if (failOnUnsupported) throw new Error('certificate-path must be PEM for Sigstore evidence');
        core.warning('certificate-path is not PEM; skipping.');
      }
    }

    const digestHex = artifactDigest?.replace(/^sha256:/i, '');
    const canSubject = !!(artifactName && digestHex && /^[a-f0-9]{64}$/i.test(digestHex));

    const pushEv = (res: IngestResult) => {
      summary.sigstore!.push(res);
      evidenceIds.push(...collectEvidenceIds(res as unknown as Record<string, unknown>));
      if (!res.ok) throw new Error(`Evidence ingest rejected: ${res.error ?? res.status}`);
    };

    if (useLegacySigstore) {
      const hasPayload =
        !!signaturePem || !!certificatePem || bundleJson !== undefined || rekorMeta !== undefined;
      if (!hasPayload) {
        core.info('No sigstore payload for legacy attestation ingest.');
      } else {
        const stmt = buildSigstoreEvidenceStatement({
          artifactName: canSubject ? artifactName : undefined,
          digestHex: canSubject ? digestHex : undefined,
          signaturePem,
          certificatePem,
          bundleJson,
          rekorMetadata: rekorMeta,
        });
        try {
          const res = await ingestAttestation(client, {
            attestation: stmt,
            buildId: effectiveBuildId,
            projectId,
            artifactId,
            publishToGuac,
          });
          sigOk = !!res.ok;
          evidenceIds.push(...collectEvidenceIds(res as unknown as Record<string, unknown>));
          if (!res.ok) throw new Error(`Legacy Sigstore attestation ingest rejected: ${res.error ?? res.status}`);
          core.warning(
            'use-legacy-sigstore-attestation-ingest=true: wrapped Sigstore material posted to /v1/ingest/attestation (not /v1/ingest/evidence).',
          );
          bundleUploaded = bundleJson !== undefined;
          signatureUploaded = !!(signaturePem || certificatePem || sigPathProvidedJson);
          rekorUploaded = rekorMeta !== undefined;
        } catch (e) {
          if (e instanceof BridgedApiError) {
            core.error(redactSecrets(e.message, apiKey));
            if (e.status === 403) permHint403();
          }
          throw e;
        }
      }
    } else {
      const postEv = async (kind: 'sigstore_bundle' | 'sigstore_signature' | 'rekor_entry' | 'artifact_metadata', extra: Record<string, unknown>) => {
        const res = await ingestEvidence(client, {
          orgId,
          buildId: effectiveBuildId,
          kind,
          projectId,
          artifactId,
          ...extra,
        });
        pushEv(res);
        core.info(`Evidence ingest (/v1/ingest/evidence kind=${kind}): status=${res.status}`);
      };

      try {
        if (bundleJson !== undefined) {
          await postEv('sigstore_bundle', { bundle: bundleJson });
          bundleUploaded = true;
          sigOk = true;
        }
        if (signaturePem || certificatePem) {
          await postEv('sigstore_signature', {
            signaturePem: signaturePem ?? '',
            certificatePem: certificatePem ?? '',
          });
          signatureUploaded = true;
          sigOk = true;
        }
        if (rekorMeta !== undefined) {
          await postEv('rekor_entry', { rekor: rekorMeta });
          rekorUploaded = true;
          sigOk = true;
        }
        if (canSubject && (bundleJson !== undefined || signaturePem || certificatePem || rekorMeta !== undefined)) {
          await postEv('artifact_metadata', {
            artifactName,
            artifactDigest,
          });
          artifactMetaUploaded = true;
          sigOk = true;
        }
      } catch (e) {
        if (e instanceof BridgedApiError) {
          core.error(redactSecrets(e.message, apiKey));
          if (e.status === 403) permHint403();
        }
        throw e;
      }
    }
  }

  const uploaded = sbomOk || attOk || sigOk;
  core.setOutput('uploaded', String(uploaded));
  core.setOutput('sbom-uploaded', String(sbomPath ? sbomOk : false));
  core.setOutput('attestation-uploaded', String(attPath ? attOk : false));
  core.setOutput('signature-uploaded', String(signatureUploaded));
  core.setOutput('bundle-uploaded', String(bundleUploaded));
  core.setOutput('rekor-uploaded', String(rekorUploaded));
  core.setOutput('artifact-metadata-uploaded', String(artifactMetaUploaded));
  core.setOutput('build-id', effectiveBuildId);
  core.setOutput('evidence-ids-json', JSON.stringify([...new Set(evidenceIds)]));
  core.setOutput('evidence-summary-json', JSON.stringify(summary));
}

run().catch((e) => {
  core.setFailed(redactSecrets(e instanceof Error ? e.message : String(e), process.env.BRIDGED_API_KEY));
});
