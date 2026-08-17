/**
 * EXECUTE plane entrypoint. Connects to Temporal, registers the saga
 * workflow + its activities on the `execute` task queue (a physically
 * separate queue from anything PLAN could enqueue work onto — one of the
 * "three independent mechanisms" alongside separate IAM and separate
 * network egress, architecture diagram Part 03), and serves a bare-bones
 * health endpoint for the ECS target group / local compose healthcheck.
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'execute';
const HEALTH_PORT = Number(process.env.PORT ?? 8080);

async function main() {
  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows/recoverySaga.ts', import.meta.url)),
    activities,
  });

  let ready = false;
  const health = createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready, taskQueue: TASK_QUEUE }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  health.listen(HEALTH_PORT, () => {
    console.log(`[zkd-execute] health endpoint on :${HEALTH_PORT}`);
  });

  console.log(`[zkd-execute] worker starting — task queue "${TASK_QUEUE}" at ${TEMPORAL_ADDRESS}`);
  ready = true;
  await worker.run();
}

main().catch((err) => {
  console.error('[zkd-execute] fatal:', err);
  process.exit(1);
});
