import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
copyFileSync('src/index.ts', 'dist/index.js');
console.log('Bundled src/index.ts to dist/index.js (dependency-free action).');
