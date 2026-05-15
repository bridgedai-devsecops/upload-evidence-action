# Security Policy

Report vulnerabilities privately to security@bridgedai.io. Do not open public issues for vulnerabilities.

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
