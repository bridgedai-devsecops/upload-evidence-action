# Security Policy

Report security vulnerabilities via [GitHub Security Advisories](https://github.com/bridgedai-devsecops/bridgedai-github-actions/security/advisories/new) on the ecosystem repository. Do not open public issues for undisclosed vulnerabilities.

## Supported versions

| Version | Supported |
| --- | --- |
| v1 | yes |

## Security commitments

- No hardcoded secrets.
- OIDC-first authentication.
- Least-privilege permissions in examples.
- No deprecated `set-output` usage.
- Mock behavior must be explicit.
- Production paths fail closed.