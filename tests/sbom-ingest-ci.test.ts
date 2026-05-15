import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BridgedHttpClient, ingestSbom } from '@bridgedai/actions-core';

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('addr'));
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((res, rej) => server.close((e) => (e ? rej(e) : res(undefined)))),
      });
    });
  });
}

test('ingestSbom forwards source, linkEvidence, buildId', async () => {
  let body: unknown;
  const { baseUrl, close } = await startServer((req, res) => {
    const pathOnly = (req.url || '').split('?')[0];
    if (pathOnly === '/v1/ingest/sbom' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, parsed: true, status: 'accepted' }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const client = new BridgedHttpClient({ baseUrl, apiKey: 'k', orgId: 'org', timeoutMs: 5000 });
  await ingestSbom(client, {
    sbom: { bomFormat: 'CycloneDX', specVersion: '1.5' },
    buildId: 'bld_1',
    source: 'github-actions',
    linkEvidence: true,
    repoFullName: 'o/r',
  });
  await close();
  const o = body as Record<string, unknown>;
  assert.equal(o.source, 'github-actions');
  assert.equal(o.linkEvidence, true);
  assert.equal(o.buildId, 'bld_1');
  assert.ok(o.sbom);
});
