/**
 * One command runs the whole thing.
 *
 *   npm run demo         success path  -> recovered itinerary + captured PNGs
 *   npm run demo:fail    failure path  -> LIFO rollback + escalation handoff
 *   --fast               collapse every simulated latency
 *   --no-capture         skip Playwright capture
 *
 * Boots OPA and the Temporal dev server if they aren't already up, runs an
 * in-process Temporal worker, executes the saga, then prints the demo beats.
 */

import { Worker, NativeConnection, Runtime, DefaultLogger } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import { join } from 'node:path';
import * as activities from '../worker/activities';
import * as procs from '../src/procs';
import * as ledger from '../src/ledger';
import * as vclock from '../src/clock';
import { waitForOpa } from '../src/opa';
import { TASK_QUEUE, TEMPORAL_ADDRESS, API_PORT, WEB_PORT } from '../src/scenario';
import * as report from '../src/report';
import type { RecoveryResult } from '../worker/types';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);

const MODE: 'success' | 'rollback' = has('--fail') ? 'rollback' : 'success';
const FAST = has('--fast');
const CAPTURE = !has('--no-capture') && MODE === 'success';

async function main(): Promise<void> {
  procs.hookExit();

  if (FAST) process.env.FAST = '1';
  if (MODE === 'rollback') process.env.FORCE_FAILURE = 'bookGround';
  else delete process.env.FORCE_FAILURE;

  const { C } = report;
  console.log('');
  console.log(`${C.bold}${C.blue}  Autonomous Travel-Disruption Concierge${C.reset}  ${C.grey}Amex Codestreet 2026${C.reset}`);
  console.log(`  ${C.grey}mode=${MODE}${FAST ? ' fast=on' : ''} · currency=INR · regulator=DGCA (India)${C.reset}`);

  // ---- infrastructure ---------------------------------------------------
  process.stdout.write(`  ${C.grey}booting OPA …${C.reset}`);
  const opa = await procs.ensureOpa();
  await waitForOpa();
  console.log(` ${C.green}ready${C.reset} ${C.grey}(${opa}, :8181)${C.reset}`);

  process.stdout.write(`  ${C.grey}booting Temporal dev server …${C.reset}`);
  const tmprl = await procs.ensureTemporal();
  console.log(` ${C.green}ready${C.reset} ${C.grey}(${tmprl}, :7233, UI :8233)${C.reset}`);

  // ---- clean slate ------------------------------------------------------
  vclock.reset();
  ledger.open();
  ledger.resetLedger();

  // ---- worker -----------------------------------------------------------
  // Quiet the workflow bundler's webpack stats — this console is on camera.
  Runtime.install({ logger: new DefaultLogger('WARN') });

  const nativeConnection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection: nativeConnection,
    namespace: 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: join(__dirname, '..', 'worker', 'workflows.ts'),
    activities,
  });
  const workerRun = worker.run();

  // ---- execute ----------------------------------------------------------
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: 'default' });
  const workflowId = `concierge-6JQ8XZ-${MODE}`;

  report.printDisruption();
  console.log('');
  console.log(`  ${C.grey}running saga … ${FAST ? '' : '(≈25s of deterministic supplier latency)'}${C.reset}`);

  const result: RecoveryResult = await client.workflow.execute('travelDisruptionRecovery', {
    taskQueue: TASK_QUEUE,
    workflowId,
    workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    args: [{ mode: MODE }],
  });

  worker.shutdown();
  await workerRun.catch(() => undefined);
  await connection.close();
  await nativeConnection.close();

  // ---- demo beats -------------------------------------------------------
  report.printPolicyGate(result);

  if (result.status === 'RECOVERED') {
    report.printItinerary(result);
    report.printDutyOfCare(result);
  } else {
    report.printRollback(result);
    report.printEscalation(result);
    report.printDutyOfCare(result);
  }

  const decisions = ledger.decisionsForRun(result.runId);
  console.log('');
  console.log(
    `  ${C.grey}decision_ledger: ${decisions.length} OPA decisions written ` +
      `(${decisions.filter((d) => d.allowed).length} allow / ${decisions.filter((d) => !d.allowed).length} deny)${C.reset}`,
  );

  report.printTemporalPointer(result);

  // ---- artefacts --------------------------------------------------------
  if (CAPTURE) {
    await captureArtifacts();
  } else if (MODE === 'rollback') {
    // Best effort: the URL above is printed either way so it can be retaken by hand.
    console.log('');
    try {
      const { captureTrace } = await import('./capture-trace');
      const path = await captureTrace();
      console.log(`  ${C.green}✓${C.reset} ${path.replace(process.cwd() + '/', '')}  ${C.grey}A1→A4 · CarrierUnavailableError · C4→C3→C2→C1${C.reset}`);
    } catch (err) {
      console.log(`  ${C.grey}Auto-capture unavailable (${(err as Error).message}) — grab it by hand from the URL above.${C.reset}`);
    }
    console.log(`  ${C.grey}Then run \`npm run demo\` for the dashboard and push artefacts.${C.reset}`);
  }

  procs.shutdown();
  process.exit(0);
}

async function captureArtifacts(): Promise<void> {
  const { C } = report;
  report.banner('CAPTURING ARTEFACTS', 'dashboard.png + push.png at 2× DPI');

  procs.spawnNode(join(__dirname, 'api-server.ts'), [], 'api');
  await procs.waitForPort(API_PORT, 'API server', 30_000);
  console.log(`  ${C.green}✓${C.reset} API on :${API_PORT} ${C.grey}(serves the decision ledger)${C.reset}`);

  procs.spawnRaw('npm', ['--prefix', 'web', 'run', 'dev', '--', '--port', String(WEB_PORT), '--strictPort'], 'web');
  await procs.waitForPort(WEB_PORT, 'web dev server', 60_000);
  console.log(`  ${C.green}✓${C.reset} Dashboard on :${WEB_PORT}`);

  const { capture } = await import('./capture');
  await capture();
}

main().catch((err) => {
  console.error('\n  Demo failed:\n', err);
  procs.shutdown();
  process.exit(1);
});
