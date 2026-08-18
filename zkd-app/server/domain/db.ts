/**
 * The shared Postgres client + migration runner. Everything in store.ts goes
 * through `db()` here rather than opening its own connection — one pool per
 * process, shared across every request the process handles.
 *
 * Local dev default is port 5433, not 5432: this machine already has an
 * unrelated project's Postgres bound to 5432 (see docker-compose stacks
 * elsewhere on this box), so zkd-app's own local Postgres runs on 5433 to
 * avoid colliding with it. Production sets DATABASE_URL explicitly (see
 * zkd-risk-model/infra/app.tf's `aws_db_instance.app` / `DATABASE_URL` env
 * wiring) and that always wins over this fallback.
 */
import postgres, { type Sql } from 'postgres';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://zkdapp:zkdapp@localhost:5433/zkdapp';

/**
 * `max: 10` matches a single Fargate task's expected concurrency for a demo
 * workload — this is not a high-throughput service, and a bigger pool just
 * means more idle connections against the single db.t3-class instance
 * app.tf provisions.
 *
 * `DATABASE_PASSWORD` is separate from `DATABASE_URL` in the AWS deployment
 * deliberately: zkd-risk-model/infra/app.tf's ECS task definition puts the
 * password through the `secrets` block (Secrets Manager) and the rest of
 * the connection string through plain `environment` — a real password never
 * sits in a plaintext env var or Terraform state's DATABASE_URL value. The
 * `postgres` client's options object accepts `password` separately from the
 * URL and fills in whatever the URL didn't specify; local dev's default
 * above already has the password embedded and DATABASE_PASSWORD is unset
 * there, so this is a no-op locally.
 */
export const sql = postgres(DATABASE_URL, {
  max: 10,
  /**
   * ── Without these two, connections leak until the server stops answering ──
   *
   * `max: 10` bounds ONE process. postgres.js defaults `idle_timeout` to 0,
   * meaning an idle connection is never handed back — so every process that
   * touches the store holds its pool open for as long as it lives, and in
   * development there are a lot of processes: each `npm run dev` restart, and
   * each parallel vitest worker that imports this module.
   *
   * Observed twice on 2026-08-17/18: 97 of Postgres' 100 slots held by idle
   * `zkdapp` backends, at which point every query fails with
   *   FATAL: remaining connection slots are reserved for roles with the
   *   SUPERUSER attribute
   * and the app surfaces that as a failed login — so it looks like a wrong
   * password, which is where the debugging time actually goes.
   *
   * 20s idle is comfortably longer than any request here and short enough that
   * a killed dev server's slots are reclaimed before the next one boots.
   * `max_lifetime` recycles long-lived connections so a process that stays up
   * for days cannot pin a slot against a server-side change.
   */
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  ...(process.env.DATABASE_PASSWORD ? { password: process.env.DATABASE_PASSWORD } : {}),
});

const MIGRATIONS_DIR = join(process.cwd(), 'server', 'domain', 'migrations');

/**
 * Two arbitrary, distinct 32-bit-safe advisory lock keys — one for schema
 * migrations (db.ts), one for the seed-data race (seed.ts). Postgres
 * advisory locks are a single global keyspace per database, so these must
 * never collide with each other or with anything else that might someday
 * take a lock in this database.
 */
export const MIGRATIONS_LOCK_KEY = 727_727_001;
export const SEED_LOCK_KEY = 727_727_002;

/**
 * Serializes `fn` across every process holding a connection to this
 * database — the mechanism that keeps two ECS tasks booting at once from
 * running migrations twice, or seeding demo data twice.
 *
 * `pg_advisory_lock`/`pg_advisory_unlock` are session-scoped: the unlock has
 * to run on the exact same connection that took the lock, or Postgres just
 * ignores it and the lock never releases. The plain `sql` client is a pool
 * (`postgres(url, { max: 10 })` above) that can hand a different pooled
 * connection to each tagged-template call, so `sql.reserve()` — one
 * connection pinned for this whole critical section — is required here, not
 * a nicety.
 */
export async function withAdvisoryLock<T>(key: number, fn: (reserved: Sql) => Promise<T>): Promise<T> {
  const reserved = await sql.reserve();
  try {
    await reserved`select pg_advisory_lock(${key})`;
    try {
      return await fn(reserved);
    } finally {
      await reserved`select pg_advisory_unlock(${key})`;
    }
  } finally {
    reserved.release();
  }
}

/**
 * Applies any `.sql` file under server/domain/migrations/ not yet recorded
 * in the `migrations` bookkeeping table, in filename order. No external
 * migration library — plain fs.readdirSync + a for loop, matching this
 * codebase's hand-written-SQL style (see server/decisionLedger.ts).
 *
 * Each file is sent to `sql.unsafe()` as one call, not split into
 * individual statements client-side first: `unsafe()` with no parameters
 * uses Postgres's simple query protocol, which natively supports multiple
 * `;`-separated statements in one string and correctly ignores `--`
 * comments — including a comment that happens to contain a literal `;`.
 * (An earlier version of this function split on `;` itself before sending
 * each piece, which broke exactly on a comment like "...concurrently; a
 * sequence's nextval()..." above: the naive split cut mid-comment and sent
 * a fragment starting with the bare token `a`, a real Postgres syntax
 * error. Letting the server parse the whole file is what actually works.)
 */
async function runMigrations(): Promise<void> {
  await withAdvisoryLock(MIGRATIONS_LOCK_KEY, async (q) => {
    await q`create table if not exists migrations (name text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set((await q<{ name: string }[]>`select name from migrations`).map((r) => r.name));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      await q.unsafe(text);
      await q`insert into migrations (name) values (${file})`;
      console.log(`[db] applied migration ${file}`);
    }
  });
}

let readyPromise: Promise<void> | null = null;

/**
 * Runs migrations exactly once per process, memoized — called lazily by
 * every store.ts function via `db()`, and eagerly (best-effort) from
 * instrumentation.ts at server startup so the first real request doesn't
 * pay the migration-check latency.
 */
export function ensureReady(): Promise<void> {
  if (!readyPromise) readyPromise = runMigrations();
  return readyPromise;
}
