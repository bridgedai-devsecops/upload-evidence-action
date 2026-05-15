import * as core from '@actions/core';
import { ConfigurationError } from './errors';

export function getRequiredInput(name: string): string {
  const v = String(core.getInput(name, { required: true }) ?? '').trim();
  if (!v) throw new ConfigurationError(`Missing required input: ${name}`);
  return v;
}

export function getOptionalInput(name: string): string {
  return String(core.getInput(name) ?? '').trim();
}

export function maskSecret(value: string): void {
  const v = String(value ?? '').trim();
  if (!v) return;
  core.setSecret(v);
}

export function fail(message: string | Error): never {
  const m = message instanceof Error ? message.message : message;
  core.setFailed(m);
  throw message instanceof Error ? message : new Error(m);
}
