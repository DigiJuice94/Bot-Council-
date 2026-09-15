import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();

for (const staleFile of ['smoke.ts', 'mock-market.ts']) {
  const target = resolve(root, staleFile);
  if (existsSync(target)) {
    rmSync(target, { force: true });
    console.log(`[structure] removed stale ${staleFile}`);
  }
}

for (const generatedDir of ['app', 'lib', 'components', 'tests']) {
  const target = resolve(root, generatedDir);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`[structure] removed stale ${generatedDir}/ tree`);
  }
}

const mappings = [
  ['page.tsx', 'app/page.tsx'],
  ['layout.tsx', 'app/layout.tsx'],
  ['globals.css', 'app/globals.css'],
  ['v213.css', 'app/v213.css'],
  ['v214.css', 'app/v214.css'],
  ['WarRoomDashboard.tsx', 'components/WarRoomDashboard.tsx'],
  ['DiagnosticsPanel.tsx', 'components/DiagnosticsPanel.tsx'],
  ['RunnerResearchPanel.tsx', 'components/RunnerResearchPanel.tsx'],
  ['bot-council-reference.png', 'public/bot-council-reference.png'],
  ['council-art.ts', 'lib/council-art.ts'],
  ['autopilot.ts', 'lib/autopilot.ts'],
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
  ['provider-waterfall.ts', 'lib/provider-waterfall.ts'],
  ['runner-research.ts', 'lib/runner-research.ts'],
  ['live-gate.ts', 'lib/live-gate.ts'],
  ['backtest.ts', 'lib/backtest.ts'],
  ['exit-strategy.ts', 'lib/exit-strategy.ts'],
  ['learning.ts', 'lib/learning.ts'],
  ['market-data.ts', 'lib/market-data.ts'],
  ['paper-wallet.ts', 'lib/paper-wallet.ts'],
  ['provider-health.ts', 'lib/provider-health.ts'],
  ['route-feasibility.ts', 'lib/route-feasibility.ts'],
  ['trade-journal.ts', 'lib/trade-journal.ts'],
  ['position-manager.ts', 'lib/position-manager.ts'],
  ['position-policy.ts', 'lib/position-policy.ts'],
  ['position-store.ts', 'lib/position-store.ts'],
  ['premeeting.ts', 'lib/premeeting.ts'],
  ['engine.ts', 'lib/engine.ts'],
  ['execution.ts', 'lib/execution.ts'],
  ['experiments.ts', 'lib/experiments.ts'],
  ['risk.ts', 'lib/risk.ts'],
  ['types.ts', 'lib/types.ts'],
  ['route.ts', 'app/api/cycle/route.ts'],
  ['route (1).ts', 'app/api/paper/route.ts'],
  ['route (2).ts', 'app/api/experiments/route.ts'],
  ['route (3).ts', 'app/api/positions/route.ts'],
  ['route (4).ts', 'app/api/benchmark/route.ts'],
  ['route (5).ts', 'app/api/learning/route.ts'],
  ['route (6).ts', 'app/api/autopilot/route.ts'],
  ['route (7).ts', 'app/api/journal/route.ts'],
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

if (!existsSync(resolve(root, 'app/page.tsx')) || !existsSync(resolve(root, 'app/layout.tsx'))) {
  console.error('[structure] Next.js app directory could not be restored. Upload the full repo structure.');
  process.exit(1);
}

console.log(`[structure] ready (${restored} file${restored === 1 ? "" : "s"} synced)`);
