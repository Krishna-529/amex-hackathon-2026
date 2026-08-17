import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeHash, seedChainFromDisk, verifyChain, appendChainedLine, GENESIS_HASH } from './hashChain';

describe('hashChain', () => {
  const dirs: string[] = [];
  const tmpFile = () => {
    const dir = mkdtempSync(join(tmpdir(), 'hashchain-test-'));
    dirs.push(dir);
    return join(dir, 'ledger.jsonl');
  };

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('seedChainFromDisk returns GENESIS_HASH for a missing file', () => {
    expect(seedChainFromDisk(join(tmpdir(), 'does-not-exist-12345.jsonl'))).toBe(GENESIS_HASH);
  });

  it('verifyChain accepts an untampered chain built with computeHash', () => {
    const path = tmpFile();
    let prevHash = GENESIS_HASH;
    const lines: string[] = [];
    for (const entry of [{ a: 1 }, { a: 2 }, { a: 3 }]) {
      const record = { ...entry, prevHash };
      const hash = computeHash(prevHash, record);
      lines.push(JSON.stringify({ ...record, hash }));
      prevHash = hash;
    }
    writeFileSync(path, lines.join('\n') + '\n');

    expect(verifyChain(path)).toEqual({ ok: true, entries: 3 });
    expect(seedChainFromDisk(path)).toBe(prevHash);
  });

  it('verifyChain detects a tampered middle entry', () => {
    const path = tmpFile();
    let prevHash = GENESIS_HASH;
    const lines: string[] = [];
    for (const entry of [{ a: 1 }, { a: 2 }, { a: 3 }]) {
      const record = { ...entry, prevHash };
      const hash = computeHash(prevHash, record);
      lines.push(JSON.stringify({ ...record, hash }));
      prevHash = hash;
    }
    // Tamper with the middle line's payload without recomputing its hash —
    // exactly what an after-the-fact edit would look like.
    const tampered = JSON.parse(lines[1]);
    tampered.a = 999;
    lines[1] = JSON.stringify(tampered);
    writeFileSync(path, lines.join('\n') + '\n');

    const result = verifyChain(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.brokenAtLine).toBe(1);
  });

  it('appendChainedLine produces a chain verifyChain accepts, and resumes it after a fresh module-level cache', () => {
    const path = tmpFile();
    appendChainedLine(path, { kind: 'a' });
    appendChainedLine(path, { kind: 'b' });
    const third = appendChainedLine(path, { kind: 'c' });

    expect(verifyChain(path)).toEqual({ ok: true, entries: 3 });
    // Simulates a process restart: seedChainFromDisk (not the in-memory
    // cache) must recover the same last hash appendChainedLine tracked.
    expect(seedChainFromDisk(path)).toBe(third.hash);
  });
});
