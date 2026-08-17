/**
 * Tamper-evidence for the decision ledger. A plain JSONL append is missing
 * "prove nobody edited an old entry after the fact" — the exact objection a
 * financial-services audit raises first. Each entry gets a `hash` computed
 * over its own content plus the previous entry's hash (a classic hash
 * chain); changing or deleting any past line breaks every hash after it,
 * which is checkable by re-walking the file (see verifyChain below).
 *
 * Deliberately no external dependency — node:crypto's sha256 is enough for
 * "detect tampering", which is the actual requirement here, not
 * "cryptographically sign for legal non-repudiation".
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GENESIS_HASH = 'genesis';

export function computeHash(prevHash: string, entry: unknown): string {
  return createHash('sha256').update(prevHash).update(JSON.stringify(entry)).digest('hex');
}

/** Reads the last line of an existing ledger file to resume its hash chain
 *  across process restarts. Returns GENESIS_HASH for a missing/empty file —
 *  starting a new, honestly-labeled chain rather than pretending continuity
 *  with a file that was rotated or never existed. */
export function seedChainFromDisk(path: string): string {
  if (!existsSync(path)) return GENESIS_HASH;
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return GENESIS_HASH;
  try {
    const last = JSON.parse(lines[lines.length - 1]) as { hash?: unknown };
    return typeof last.hash === 'string' ? last.hash : GENESIS_HASH;
  } catch {
    return GENESIS_HASH;
  }
}

const lastHashByPath = new Map<string, string>();

/** Appends `entry` to `path` as the next link in that file's hash chain,
 *  seeding the in-memory chain state from disk on first use per path (so a
 *  process restart resumes the same chain instead of silently starting a
 *  new one). Returns the full chained record actually written, so callers
 *  can mirror the same bytes elsewhere (e.g. S3) without recomputing. */
export function appendChainedLine<T extends object>(
  path: string,
  entry: T,
): T & { prevHash: string; hash: string; loggedAt: number } {
  let prevHash = lastHashByPath.get(path);
  if (prevHash === undefined) {
    prevHash = seedChainFromDisk(path);
  }

  const record = { ...entry, prevHash, loggedAt: Date.now() };
  const hash = computeHash(prevHash, record);
  const chained = { ...record, hash };

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(path, JSON.stringify(chained) + '\n');
  lastHashByPath.set(path, hash);

  return chained;
}

export type ChainVerificationResult = { ok: true; entries: number } | { ok: false; brokenAtLine: number };

/** Re-walks a ledger file and confirms every entry's hash matches
 *  computeHash(prevHash, entryWithoutHashField). Used by tests and by an
 *  operator wanting to confirm the file wasn't edited out-of-band. */
export function verifyChain(path: string): ChainVerificationResult {
  if (!existsSync(path)) return { ok: true, entries: 0 };
  const lines = readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim().length > 0);
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < lines.length; i++) {
    let parsed: { hash?: unknown; prevHash?: unknown };
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return { ok: false, brokenAtLine: i };
    }
    const { hash, ...rest } = parsed as { hash: string } & Record<string, unknown>;
    if (rest.prevHash !== prevHash) return { ok: false, brokenAtLine: i };
    if (computeHash(prevHash, rest) !== hash) return { ok: false, brokenAtLine: i };
    prevHash = hash;
  }
  return { ok: true, entries: lines.length };
}
