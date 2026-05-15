import { existsSync, readFileSync } from 'node:fs';
if (!existsSync('src/index.ts')) throw new Error('src/index.ts is missing');
const src = readFileSync('src/index.ts', 'utf8');
if (!src.includes('async function main')) throw new Error('src/index.ts must expose an async main function');
console.log('TypeScript source check passed.');
