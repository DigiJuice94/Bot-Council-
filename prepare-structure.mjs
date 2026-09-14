import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const mappings = [
  ['page.tsx', 'app/page.tsx'],
  ['layout.tsx', 'app/layout.tsx'],
  ['globals.css', 'app/globals.css'],
  ['WarRoomDashboard.tsx', 'components/WarRoomDashboard.tsx'],
  ['bot-council-reference.png', 'public/bot-council-reference.png'],
  ['chains.ts', 'lib/chains.ts'],
  ['debate.ts', 'lib/debate.ts'],
  ['alpha-engine.ts', 'lib/alpha-engine.ts'],
  ['regime.ts', 'lib/regime.ts'],
  ['meme-regime.ts', 'lib/meme-regime.ts'],
  ['launch-velocity.ts', 'lib/launch-velocity.ts'],
  ['learning-store.ts', 'lib/learning-store.ts'],
  ['profitability-store.ts', 'lib/profitability-store.ts'],
  ['reflection.ts', 'lib/reflection.ts'],
  ['discovery.ts', 'lib/discovery.ts'],
  ['backtest.ts', 'lib/backtest.ts'],
  ['exit-strategy.ts', 'lib/exit-strategy.ts'],
  ['learning.ts', 'lib/learning.ts'],
  ['market-data.ts', 'lib/market-data.ts'],
  ['position-manager.ts', 'lib/position-manager.ts'],
  ['position-policy.ts', 'lib/position-policy.ts'],
  ['position-store.ts', 'lib/position-store.ts'],
  ['premeeting.ts', 'lib/premeeting.ts'],
  ['engine.ts', 'lib/engine.ts'],
  ['execution.ts', 'lib/execution.ts'],
  ['experiments.ts', 'lib/experiments.ts'],
  ['mock-market.ts', 'lib/mock-market.ts'],
  ['risk.ts', 'lib/risk.ts'],
  ['types.ts', 'lib/types.ts'],
  ['route.ts', 'app/api/cycle/route.ts'],
  ['route (1).ts', 'app/api/paper/route.ts'],
  ['route (2).ts', 'app/api/experiments/route.ts'],
  ['route (3).ts', 'app/api/positions/route.ts'],
  ['route (4).ts', 'app/api/benchmark/route.ts'],
  ['route (5).ts', 'app/api/learning/route.ts'],
  ['smoke.ts', 'tests/smoke.ts'],
];

let restored = 0;
for (const [sourceRel, destRel] of mappings) {
  const source = resolve(root, sourceRel);
  const dest = resolve(root, destRel);
  if (existsSync(source)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(source, dest);
    restored += 1;
    console.log(`[structure] synced ${destRel}`);
  }
}

const flatSmoke = resolve(root, 'smoke.ts');
const structuredSmoke = resolve(root, 'tests/smoke.ts');
if (existsSync(flatSmoke) && existsSync(structuredSmoke)) {
  unlinkSync(flatSmoke);
  console.log('[structure] removed flattened smoke.ts duplicate');
}

if (!existsSync(resolve(root, 'app/page.tsx')) || !existsSync(resolve(root, 'app/layout.tsx'))) {
  console.error('[structure] Next.js app directory could not be restored. Upload the full repo structure.');
  process.exit(1);
}

console.log(`[structure] ready (${restored} file${restored === 1 ? "" : "s"} synced)`);
