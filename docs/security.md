# Security Guide for upload-evidence-action

## Threat model

This action runs inside a GitHub Actions runner. Treat all workflow context, inputs, pull request metadata, artifacts, and generated files as untrusted unless verified.

## Secret handling

Use OIDC instead of static secrets whenever possible. If a secret is unavoidable, store it in GitHub Secrets or environment secrets with required reviewers.

## Token permissions

Define workflow permissions explicitly. Do not rely on repository defaults.

## Pull request and fork risk

Do not expose production tokens to pull request workflows from forks. Use `pull_request` instead of `pull_request_target` unless a security review approves the design.

## Egress risk

Use StepSecurity Harden-Runner or equivalent egress monitoring if your organization requires runtime network controls.

## Attestation verification

Verify subject digest, predicate type, signer identity, certificate issuer, repository, and workflow path before trusting evidence.
