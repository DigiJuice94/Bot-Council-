import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const mappings = [
  ['page.tsx', 'app/page.tsx'],
  ['layout.tsx', 'app/layout.tsx'],
  ['globals.css', 'app/globals.css'],
  ['WarRoomDashboard.tsx', 'components/WarRoomDashboard.tsx'],
  ['chains.ts', 'lib/chains.ts'],
  ['engine.ts', 'lib/engine.ts'],
  ['execution.ts', 'lib/execution.ts'],
  ['experiments.ts', 'lib/experiments.ts'],
  ['mock-market.ts', 'lib/mock-market.ts'],
  ['risk.ts', 'lib/risk.ts'],
  ['types.ts', 'lib/types.ts'],
  ['route.ts', 'app/api/cycle/route.ts'],
  ['route (1).ts', 'app/api/paper/route.ts'],
  ['route (2).ts', 'app/api/experiments/route.ts'],
];

let restored = 0;
for (const [sourceRel, destRel] of mappings) {
  const source = resolve(root, sourceRel);
  const dest = resolve(root, destRel);
  if (!existsSync(dest) && existsSync(source)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    restored += 1;
    console.log(`[structure] restored ${destRel}`);
  }
}

if (!existsSync(resolve(root, 'app/page.tsx')) || !existsSync(resolve(root, 'app/layout.tsx'))) {
  console.error('[structure] Next.js app directory could not be restored. Upload the full repo structure.');
  process.exit(1);
}

console.log(`[structure] ready (${restored} file${restored === 1 ? '' : 's'} restored)`);
