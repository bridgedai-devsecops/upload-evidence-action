import * as fs from 'fs';

export async function appendJobSummary(markdown: string): Promise<void> {
  const p = process.env.GITHUB_STEP_SUMMARY;
  if (!p) return;
  await fs.promises.appendFile(p, `${markdown}\n`, { encoding: 'utf8' });
}

export function escapeCell(s: string): string {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
