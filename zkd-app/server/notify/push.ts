/**
 * Remote push to the Android app, via Expo's push service.
 *
 * ── Why this exists when zkd-android already has notifications ─────────────
 *
 * `zkd-android/src/notify.ts` fires LOCAL notifications: the app notices a
 * state change it is already polling for and raises a banner itself. That
 * works only while the app is running. The alert this module sends is the one
 * that has to arrive when the phone is in a pocket and the app is closed —
 * which is the entire premise of warning someone early — and that requires a
 * real remote push.
 *
 * The Android side is already built for it: `notify.ts` defines the
 * `disruption` / `updates` channels and the `zkd.recovery` category with its
 * three action buttons, so a remote push that names them inherits the same
 * importance, sound and buttons as the local ones. Nothing there needs
 * changing except registering the token (see app/api/devices/route.ts).
 *
 * KNOWN DEMO RISK: remote push to a standalone APK needs FCM credentials
 * configured in the EAS project. Inside Expo Go it works with no setup. If the
 * APK on stage has not been rebuilt with credentials, this channel fails and
 * the local-notification path in the app remains the fallback — which is why
 * index.ts treats a dead channel as a logged failure, never an exception.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ChannelResult, NotifyEvent } from './types';

const EXPO_API = 'https://exp.host/--/api/v2/push/send';
const STATE_DIR = join(process.cwd(), 'server', '.state');
const DEVICES_PATH = join(STATE_DIR, 'devices.json');

/** Tokens registered without a passenger id — the demo phone, typically. */
const ANY = '__any__';

type DeviceStore = Record<string, string[]>;

function load(): DeviceStore {
  try {
    return JSON.parse(readFileSync(DEVICES_PATH, 'utf-8')) as DeviceStore;
  } catch {
    return {};
  }
}

function save(s: DeviceStore): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(DEVICES_PATH, JSON.stringify(s, null, 2));
}

/** Expo's own token shape. Rejecting anything else keeps junk out of the store. */
export function isExpoToken(t: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(t.trim());
}

export function registerDevice(token: string, passengerId?: string): void {
  const store = load();
  const key = passengerId ?? ANY;
  const existing = store[key] ?? [];
  if (!existing.includes(token)) store[key] = [...existing, token];
  save(store);
}

export function forgetDevice(token: string): void {
  const store = load();
  for (const key of Object.keys(store)) store[key] = store[key].filter((t) => t !== token);
  save(store);
}

/**
 * Tokens for this passenger plus any registered without one. A demo phone
 * registered before login should still receive the alert rather than silently
 * being addressed to nobody.
 */
function tokensFor(passengerId?: string): string[] {
  const store = load();
  const set = new Set([...(passengerId ? store[passengerId] ?? [] : []), ...(store[ANY] ?? [])]);
  return [...set];
}

export function isConfigured(passengerId?: string): boolean {
  return tokensFor(passengerId).length > 0;
}

export async function send(event: NotifyEvent): Promise<ChannelResult> {
  const tokens = tokensFor(event.passengerId);
  if (tokens.length === 0) return { channel: 'push', ok: false, skipped: true };

  // `disruption` is the MAX-importance channel the Android app configures; an
  // early warning has to interrupt or it is pointless, since its whole value is
  // the time it buys. Confirmations ride the calmer channel.
  const channelId = event.kind === 'booked' || event.kind === 'handed-over' ? 'updates' : 'disruption';

  const messages = tokens.map((to) => ({
    to,
    title: event.title,
    body: event.body,
    channelId,
    categoryId: 'zkd.recovery',
    priority: 'high',
    sound: 'default',
    data: { ...event.data, path: event.path, flightId: event.flightId },
  }));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  // Only required when the Expo project has enhanced push security enabled.
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  try {
    const res = await fetch(EXPO_API, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: { status: string; id?: string; message?: string; details?: { error?: string } }[] }
      | null;
    if (!res.ok || !json?.data) {
      return { channel: 'push', ok: false, error: `HTTP ${res.status}` };
    }

    // A token dies when the app is uninstalled. Expo tells us precisely; keeping
    // it would mean retrying a guaranteed failure on every future alert.
    json.data.forEach((r, i) => {
      if (r.details?.error === 'DeviceNotRegistered') forgetDevice(tokens[i]);
    });

    const okCount = json.data.filter((r) => r.status === 'ok').length;
    if (okCount === 0) {
      return { channel: 'push', ok: false, error: json.data[0]?.message ?? 'all tokens rejected' };
    }
    return { channel: 'push', ok: true, ref: `${okCount}/${tokens.length} delivered` };
  } catch (e) {
    return { channel: 'push', ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
