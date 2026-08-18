import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Nothing is ever held.
 *
 * Speculative holds were removed from the design on 2026-08-17: a passenger
 * cannot hold two tickets, a carrier's auditors cancel duplicates (sometimes
 * cancelling the original), and most Indian LCCs offer no free hold at all.
 * Options are kept FRESH by the refresh loop instead.
 *
 * server/notify/templates.ts already had a test for this, and the claim showed
 * up anyway on /flights/[id] ("We're already holding 5 alternatives") — because
 * that test only covered notification copy, not the screens. This one reads the
 * member-facing pages themselves.
 *
 * Scoped to JSX text, deliberately: `holdHotel`, `holdGate`, `firstHoldable`
 * and `PipelineState.HOLD_PENDING` are all legitimate identifiers, and a naive
 * grep for "hold" would fail on every one of them.
 */
const MEMBER_PAGES = ['app/flights', 'app/prepare', 'app/recovery', 'app/profile', 'app/settings'];

/**
 * Member-facing copy that is written on the SERVER, not in a page.
 *
 * The first two versions of this guard both scanned pages only, and both were
 * caught out the same way — by copy living somewhere they did not look. On
 * 2026-08-19 it was `server/engine/simulation.ts`, which set four separate
 * `task.note` strings ending "Your seats are still held." Those notes are
 * rendered verbatim on /recovery, so the claim reached members for as long as
 * the guard existed while passing it cleanly every time.
 *
 * The lesson is not "add simulation.ts". It is that the guard has to follow the
 * copy rather than the file type, so these are the modules that write prose a
 * member will read.
 */
const MEMBER_COPY_MODULES = [
  'server/engine/simulation.ts',
  'server/notify/templates.ts',
  'server/pipeline/narrate.ts',
  'server/pipeline/fallbackNote.ts',
];

/**
 * Claims of a reservation, in prose rather than in code.
 *
 * Widened after the first version missed "…check your policy, hold the seats…"
 * on /settings: it only matched the possessive forms ("we're holding", "held
 * for you") and not the bare verb phrase. Any "hold/holding/reserve the seat(s)"
 * is a claim we cannot honour, whoever the subject is.
 */
const FORBIDDEN = new RegExp(
  [
    String.raw`we(?:'re| are|&apos;re)\s+(?:already\s+)?holding`,
    String.raw`we(?:'ve| have|&apos;ve)\s+(?:already\s+)?(?:held|reserved)`,
    String.raw`held for you`,
    String.raw`reserved for you`,
    // bare verb + the thing being held, in either order of article
    String.raw`\b(?:hold|holds|holding|reserve|reserves|reserving)\s+(?:the\s+|your\s+|a\s+)?(?:seat|seats|room|rooms|option|options|alternative|alternatives|booking|bookings)\b`,
  ].join('|'),
  'i',
);

async function tsxFilesUnder(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await tsxFilesUnder(full, out);
    else if (e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

async function offendersIn(file: string): Promise<string[]> {
  const out: string[] = [];
  let src: string;
  try {
    src = await readFile(file, 'utf-8');
  } catch {
    return out;
  }
  src.split('\n').forEach((line, i) => {
    // Skip comments — several of these files explain the rule in prose, and
    // quoting the forbidden phrase in an explanation of why it is forbidden
    // must not fail the check that enforces it.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (FORBIDDEN.test(line)) out.push(`${file}:${i + 1}  ${trimmed.slice(0, 90)}`);
  });
  return out;
}

describe('member-facing copy never claims an option is held', () => {
  it('finds no reservation language on any member page', async () => {
    const offenders: string[] = [];
    for (const dir of MEMBER_PAGES) {
      for (const file of await tsxFilesUnder(dir)) {
        const src = await readFile(file, 'utf-8');
        src.split('\n').forEach((line, i) => {
          // Skip comments — this file's own explanation quotes the phrase.
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
          if (FORBIDDEN.test(line)) offenders.push(`${file}:${i + 1}  ${trimmed.slice(0, 90)}`);
        });
      }
    }
    expect(offenders, `Copy claiming a hold:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('finds no reservation language in server-authored member copy', async () => {
    const offenders: string[] = [];
    for (const file of MEMBER_COPY_MODULES) {
      offenders.push(...(await offendersIn(file)));
    }
    expect(offenders, `Copy claiming a hold:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('actually catches the phrasing it is meant to catch', async () => {
    // A guard that matches nothing would pass silently forever.
    expect(FORBIDDEN.test("We're already holding 5 alternatives")).toBe(true);
    expect(FORBIDDEN.test('Two seats are held for you')).toBe(true);
    expect(FORBIDDEN.test('held for you until 18:40')).toBe(true);
    expect(FORBIDDEN.test("We've reserved your seat")).toBe(true);
    // Not a claim of a hold: describing what we deliberately do NOT do.
    expect(FORBIDDEN.test('Nothing is reserved until you say go')).toBe(false);
    expect(FORBIDDEN.test('kept fresh and ready to book in one tap')).toBe(false);
    // Legitimate identifiers must NOT trip it.
    expect(FORBIDDEN.test('const hold = await holdHotel(offer)')).toBe(false);
    expect(FORBIDDEN.test("band === 'hold-gate'")).toBe(false);
    // The phrasing that slipped through the first version of this guard.
    expect(FORBIDDEN.test('check your policy, hold the seats — then stop')).toBe(true);
    expect(FORBIDDEN.test('we reserve a room for you')).toBe(true);
    // Still must not fire on identifiers or on describing what we do NOT do.
    expect(FORBIDDEN.test('firstHoldable(offers)')).toBe(false);
    expect(FORBIDDEN.test('HOLD_PENDING')).toBe(false);
  });
});
