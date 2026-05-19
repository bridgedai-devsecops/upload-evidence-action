# BridgedAI upload-evidence-action

Uploads CI evidence to BridgedAI using **public v1 routes only** (no collectors, no webhooks):

- `POST /v1/ingest/sbom`
- `POST /v1/ingest/attestation` (in-toto / SLSA-style JSON)
- `POST /v1/ingest/evidence` (Sigstore bundle, PEM signature/certificate, Rekor metadata, optional `artifact_metadata`)

## Build id resolution

When **`build-id`** is omitted and evidence requires a build (SBOM, attestation, or Sigstore paths), the action calls **`POST /v1/builds/resolve`** by default (`resolve-build` defaults to `true`) using **`repo-full-name`**, **`workflow-run-id`** (recommended), **`commit-sha`**, and **`branch`** (each defaults to the GitHub Actions context when unset).

Set **`resolve-build`** to `false` only if you pass an explicit **`build-id`**; otherwise the step fails with a clear error.

Optional **`use-legacy-sigstore-attestation-ingest=true`** wraps Sigstore material into a synthetic statement and posts to **`/v1/ingest/attestation`** instead of **`/v1/ingest/evidence`** (documented fallback only).

## Permissions

This action uses **BridgedAI API key authentication** (`api-key` / `BRIDGED_API_KEY` plus `org-id` / `BRIDGED_ORG_ID` and `api-base` / `BRIDGED_API_BASE`). It does **not** accept OIDC access tokens produced by `bridgedai-devsecops/auth-action`; keep policy evaluation on OIDC and evidence ingestion on API keys as separate steps unless your backend explicitly documents a shared bearer format.

Recommend API key scope **`evidence:upload`** for SBOM, attestation, and generic evidence ingest. **`projects:update`** may still work for backward compatibility but is not the recommended scope for new CI keys.

**`release-gates:evaluate`** is required for **`POST /v1/builds/resolve`** when the action resolves a build id (or use **`resolve-build-action`** in the workflow with the same scope).

## Claims

This action **does not** perform full live **Sigstore / Rekor cryptographic verification**; it forwards structured evidence. Whether the backend performs cryptographic checks depends on **`GET /v1/actions/capabilities`** (for example `sigstoreCrypto` when exposed).

## SBOM CI fields

For **`POST /v1/ingest/sbom`**, this action defaults to **`source: github-actions`** and **`linkEvidence: true`** when a **`build-id`** is present (from **`build-id`** input or **`POST /v1/builds/resolve`** with **`resolve-build: true`**). The backend treats **`source=github-actions`** or **`linkEvidence=true`** as requiring **`buildId`**.

For **legacy** SBOM upload without a resolved build, set **`ingest-source: omit`** and **`link-evidence: false`**.

## Inputs / outputs

See `action.yml`. Use **`artifact-name`** + **`artifact-digest`** (`sha256:` + 64 hex) so optional **`artifact_metadata`** correlation matches your subject.
