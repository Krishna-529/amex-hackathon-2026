/**
 * Telegram Bot API.
 *
 * Chosen as the primary demo channel for one unglamorous reason: it is the only
 * free push-to-a-real-phone path with no registration gate. Indian transactional
 * SMS needs DLT template registration (days, and a registered entity), and the
 * promotional route that skips it is aggressively spam-filtered — neither is
 * something to discover on demo morning. Telegram needs a bot token and a chat
 * id, both obtainable in minutes, and delivers as a real heads-up notification.
 *
 * Setup: message @BotFather → /newbot → TELEGRAM_BOT_TOKEN. Then message your
 * new bot once and read the chat id from
 * https://api.telegram.org/bot<TOKEN>/getUpdates → TELEGRAM_CHAT_ID.
 */
import type { ChannelResult, NotifyEvent } from './types';
import { linkFor } from './types';

const API = 'https://api.telegram.org';

export function isConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
}

export async function send(event: NotifyEvent): Promise<ChannelResult> {
  if (!isConfigured()) return { channel: 'telegram', ok: false, skipped: true };

  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  const url = linkFor(event.path);

  // HTML parse mode rather than Markdown: flight codes and fares routinely
  // contain characters Markdown treats as syntax, and a message that fails to
  // parse is a message the member never sees.
  const text = `<b>${escapeHtml(event.title)}</b>\n\n${escapeHtml(event.body)}`;

  // Inline buttons need an absolute https URL; with no APP_BASE_URL set (local
  // dev) Telegram would reject the whole message, so the link degrades into the
  // body text instead of costing us the notification.
  const absolute = /^https:\/\//.test(url);
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: absolute ? text : `${text}\n\n${url}`,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (absolute && event.actions?.length) {
    body.reply_markup = {
      inline_keyboard: [event.actions.map((a) => ({ text: a.label, url }))],
    };
  }

  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
    if (!res.ok || !json?.ok) {
      return { channel: 'telegram', ok: false, error: json?.description ?? `HTTP ${res.status}` };
    }
    return { channel: 'telegram', ok: true, ref: String(json.result?.message_id ?? '') };
  } catch (e) {
    return { channel: 'telegram', ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
