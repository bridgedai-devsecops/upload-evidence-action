import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('repository contract files exist', () => {
  for (const file of ['action.yml','src/index.ts','dist/index.js','README.md','SECURITY.md','CODEOWNERS','LICENSE','CHANGELOG.md']) {
    assert.equal(fs.existsSync(file), true, `${file} should exist`);
  }
});

test('action metadata uses node20 and dist entrypoint', () => {
  const yml = fs.readFileSync('action.yml','utf8');
  assert.match(yml, /using: 'node20'/);
  assert.match(yml, /main: 'dist\/index.js'/);
});
