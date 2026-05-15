import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGSTORE_PREDICATE, buildSigstoreEvidenceStatement } from '../src/sigstore-evidence';

test('wrapped sigstore statement uses real subject when digest provided', () => {
  const d = 'c'.repeat(64);
  const stmt = buildSigstoreEvidenceStatement({
    artifactName: 'widget',
    digestHex: d,
    signaturePem: '-----BEGIN SIGNATURE-----\nabc\n-----END SIGNATURE-----',
    bundleJson: { mock: true },
  });
  assert.equal(stmt.predicateType, SIGSTORE_PREDICATE);
  const sub = stmt.subject as Array<{ name: string; digest: { sha256: string } }>;
  assert.equal(sub[0].name, 'widget');
  assert.equal(sub[0].digest.sha256, d);
});
