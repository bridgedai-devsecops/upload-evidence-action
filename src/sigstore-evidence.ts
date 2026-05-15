import { createHash } from 'crypto';

export const SIGSTORE_PREDICATE = 'https://bridged.ai/github-actions/evidence/sigstore-artifacts@v1';

export function unboundSigstoreSubject(): { name: string; digest: { sha256: string } } {
  const h = createHash('sha256').update('bridged.ai/github-actions/unbound-sigstore-evidence', 'utf8').digest('hex');
  return { name: 'unbound-sigstore-evidence', digest: { sha256: h } };
}

export function buildSigstoreEvidenceStatement(opts: {
  artifactName?: string;
  digestHex?: string;
  signaturePem?: string;
  certificatePem?: string;
  bundleJson?: unknown;
  rekorMetadata?: unknown;
}): Record<string, unknown> {
  const digestHex = opts.digestHex?.replace(/^sha256:/i, '') ?? '';
  const subject =
    opts.artifactName && /^[a-f0-9]{64}$/i.test(digestHex)
      ? [{ name: opts.artifactName, digest: { sha256: digestHex.toLowerCase() } }]
      : [unboundSigstoreSubject()];

  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject,
    predicateType: SIGSTORE_PREDICATE,
    predicate: {
      signaturePem: opts.signaturePem,
      certificatePem: opts.certificatePem,
      bundle: opts.bundleJson,
      rekor: opts.rekorMetadata,
    },
  };
}
