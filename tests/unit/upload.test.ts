import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import * as core from '@actions/core';
import { run } from '../../src/index';

describe('upload-evidence-action', () => {
  it('mock mode', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdai-up-'));
    fs.writeFileSync(path.join(dir, 'evidence.txt'), 'hello');

    vi.spyOn(core, 'setOutput').mockImplementation(() => {});
    vi.spyOn(core, 'info').mockImplementation(() => {});
    vi.spyOn(core, 'getInput').mockImplementation((name: string) => {
      const m: Record<string, string> = {
        tenant: 't',
        'evidence-dir': dir,
        'artifact-digest': 'sha256:' + 'b'.repeat(64),
        mode: 'mock',
      };
      return m[name] ?? '';
    });
    await expect(run()).resolves.toBeUndefined();
  });
});
