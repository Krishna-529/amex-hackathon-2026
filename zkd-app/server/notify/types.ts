/**
 * Outbound member notification — the shapes shared by every channel.
 *
 * One event, many channels. The caller (server/engine/forecast.ts on a band
 * crossing, server/pipeline/saga.ts on a real booking outcome) describes WHAT
 * happened and never which transport carries it; server/notify/index.ts
 * decides that from whatever is configured. That split is why adding a fourth
 * channel later touches one file.
 */

export type NotifyChannel = 'whatsapp' | 'push' | 'sms';

/**
 * Why we are interrupting the member. `risk-threshold` is the only one that
 * fires BEFORE anything has actually happened — the rest report a fact.
 */
export type AlertKind =
  | 'risk-threshold'
  | 'cancelled'
  | 'about-to-book'
  | 'booked'
  | 'handed-over'
  | 'stood-down';

export type NotifyEvent = {
  kind: AlertKind;
  flightId: string;
  /** whose device/chat to reach. Undefined means every configured default. */
  passengerId?: string;
  title: string;
  /** plain text — channels that support markup add it themselves */
  body: string;
  /** in-app path this alert is about, e.g. `/prepare/f-abc`. Becomes a deep link. */
  path: string;
  /** the two or three actions the member can take, rendered as buttons where a
   *  channel supports them and ignored where it does not */
  actions?: { id: string; label: string }[];
  /** structured payload for the Android app's notification handler */
  data?: Record<string, string>;
};

export type ChannelResult = {
  channel: NotifyChannel;
  ok: boolean;
  /** provider-side id, when the provider returns one */
  ref?: string;
  error?: string;
  /** set when the channel is simply not configured — not a failure */
  skipped?: boolean;
};

/** Absolute URL for a deep link, or the bare path when no base URL is set. */
export function linkFor(path: string): string {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}
