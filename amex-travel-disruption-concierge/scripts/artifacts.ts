/**
 * Re-captures dashboard.png and push.png from whatever is already in the
 * ledger, without re-running the saga. Useful while iterating on the UI.
 */

import { join } from 'node:path';
import * as procs from '../src/procs';
import { API_PORT, WEB_PORT } from '../src/scenario';
import { capture } from './capture';
import { banner, C } from '../src/report';

async function main() {
  procs.hookExit();
  banner('CAPTURING ARTEFACTS', 'from the existing decision ledger');

  if (!(await procs.portOpen(API_PORT))) {
    procs.spawnNode(join(__dirname, 'api-server.ts'), [], 'api');
    await procs.waitForPort(API_PORT, 'API server', 30_000);
  }
  console.log(`  ${C.green}✓${C.reset} API on :${API_PORT}`);

  if (!(await procs.portOpen(WEB_PORT))) {
    procs.spawnRaw('npm', ['--prefix', 'web', 'run', 'dev', '--', '--port', String(WEB_PORT), '--strictPort'], 'web');
    await procs.waitForPort(WEB_PORT, 'web dev server', 60_000);
  }
  console.log(`  ${C.green}✓${C.reset} Dashboard on :${WEB_PORT}`);

  await capture();
  procs.shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  procs.shutdown();
  process.exit(1);
});
