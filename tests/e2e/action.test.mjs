import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('upload-evidence-action runs successfully in safe/mock path', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-evidence-action-'));
  const output = path.join(cwd, 'out.txt');
  fs.mkdirSync('.tmp/evidence',{recursive:true}); fs.writeFileSync('.tmp/evidence/context.json', JSON.stringify({ok:true}));
  const env = { ...process.env, ...{"INPUT_MODE": "mock", "INPUT_EVIDENCE-DIR": ".tmp/evidence"}, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: path.join(cwd, 'summary.md') };
  const result = spawnSync(process.execPath, [path.resolve('dist/index.js')], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(output), true);
  const out = fs.readFileSync(output, 'utf8');
  assert.match(out, /=/);
});
