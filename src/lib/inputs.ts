import * as core from '@actions/core';

export function getTrimmedInput(name: string): string {
  return String(core.getInput(name) ?? '').trim();
}

export function getBooleanInput(name: string, defaultValue: boolean): boolean {
  const raw = String(core.getInput(name) ?? '').trim();
  if (!raw) return defaultValue;
  const v = raw.toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(v)) return false;
  throw new Error(`Invalid boolean for ${name}: ${raw}`);
}
