/**
 * Child-process plumbing for the demo: bring up OPA and the Temporal dev
 * server if they are not already listening, and tear down only what we
 * started. Nothing here is demo logic — it just makes `npm run demo` a
 * single command on a clean machine.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

interface Managed {
  child: ChildProcess;
  /**
   * Long-lived infrastructure (OPA, the Temporal dev server) is deliberately
   * NOT killed when the demo exits — temporal-trace.png is captured by hand
   * from the Temporal Web UI *after* the run finishes. Killing it would take
   * the evidence down with it. `npm run stop` tears these down explicitly.
   */
  keepAlive: boolean;
}

const started: Managed[] = [];

export function portOpen(port: number, host = '127.0.0.1', timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host });
    const done = (ok: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** Dual-stack: a server may bind only ::1 or only 127.0.0.1. Accept either. */
export async function anyPortOpen(port: number): Promise<boolean> {
  return (await portOpen(port, '127.0.0.1')) || (await portOpen(port, '::1'));
}

export async function waitForPort(port: number, label: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await anyPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} never started listening on port ${port}`);
}

function logFile(name: string): number {
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  return openSync(join(ROOT, 'data', `${name}.log`), 'a');
}

/** `opa run --server` with the policy bundle + data.json loaded. */
export async function ensureOpa(): Promise<'reused' | 'started'> {
  if (await portOpen(8181)) return 'reused';
  const fd = logFile('opa');
  const child = spawn('opa', ['run', '--server', '--addr', '127.0.0.1:8181', '--log-level', 'error', 'policy/'], {
    cwd: ROOT,
    stdio: ['ignore', fd, fd],
    detached: false,
  });
  child.on('error', (e) => {
    throw new Error(`Failed to start OPA — is it on PATH? (${e.message})`);
  });
  started.push({ child, keepAlive: true });
  await waitForPort(8181, 'OPA', 30_000);
  return 'started';
}

/** `temporal server start-dev` — no Docker, ships with the Temporal CLI. */
export async function ensureTemporal(): Promise<'reused' | 'started'> {
  if (await portOpen(7233)) return 'reused';
  const fd = logFile('temporal');
  mkdirSync(join(ROOT, '.temporal'), { recursive: true });
  const child = spawn(
    'temporal',
    [
      'server',
      'start-dev',
      '--ui-port',
      '8233',
      '--db-filename',
      join(ROOT, '.temporal', 'demo.db'),
      '--log-level',
      'error',
    ],
    { cwd: ROOT, stdio: ['ignore', fd, fd], detached: false },
  );
  child.on('error', (e) => {
    throw new Error(`Failed to start the Temporal dev server — is \`temporal\` on PATH? (${e.message})`);
  });
  started.push({ child, keepAlive: true });
  await waitForPort(7233, 'Temporal dev server', 90_000);
  await waitForPort(8233, 'Temporal Web UI', 90_000);
  return 'started';
}

export function spawnNode(script: string, args: string[], name: string, env: NodeJS.ProcessEnv = {}): ChildProcess {
  const fd = logFile(name);
  const child = spawn(process.execPath, [require.resolve('tsx/cli'), script, ...args], {
    cwd: ROOT,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, ...env },
  });
  started.push({ child, keepAlive: false });
  return child;
}

export function spawnRaw(cmd: string, args: string[], name: string, env: NodeJS.ProcessEnv = {}): ChildProcess {
  const fd = logFile(name);
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', fd, fd], env: { ...process.env, ...env } });
  started.push({ child, keepAlive: false });
  return child;
}

/** Tears down demo-scoped processes only. OPA + Temporal survive on purpose. */
export function shutdown(): void {
  const survivors: Managed[] = [];
  for (const m of started) {
    if (m.keepAlive) {
      survivors.push(m);
      continue;
    }
    if (!m.child.killed) {
      try {
        m.child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  started.length = 0;
  started.push(...survivors);
}

/** `npm run stop` — tears down everything, including OPA and Temporal. */
export function stopAll(): void {
  for (const m of started) {
    try {
      m.child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  started.length = 0;
}

let hooked = false;
export function hookExit(): void {
  if (hooked) return;
  hooked = true;
  const bye = () => {
    shutdown();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  process.on('exit', shutdown);
}
