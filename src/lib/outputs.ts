import * as core from '@actions/core';

export function setOutputs(map: Record<string, string>): void {
  for (const [k, v] of Object.entries(map)) {
    core.setOutput(k, v);
  }
}
