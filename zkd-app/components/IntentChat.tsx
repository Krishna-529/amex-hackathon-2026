'use client';

import { useEffect, useRef, useState } from 'react';
import type { IntentResponse, IntentHistoryTurn } from '@/lib/apiTypes';

/**
 * "Tell us what matters", as a conversation instead of a one-shot textarea.
 *
 * Lives inside the "If this one goes" card rather than as its own panel —
 * the member is already looking at the options this chat exists to re-order,
 * so asking them to scroll to a separate box to change them was the wrong
 * shape. Collapsed by default: this is a member reaching for more control,
 * not something demanding attention on every flight.
 *
 * Still exactly the same contract as the box it replaces: nothing here is
 * applied to anything until the member confirms via "Yes — do this if it
 * cancels" (server/preferences/intent.ts's header explains why). This
 * component's only job is turning a back-and-forth into the same
 * `PreferenceOverride` preview that used to come from a single sentence —
 * `onResult` is called with the identical shape `ask()` used to produce, so
 * the parent page's re-ranking logic is completely unchanged.
 *
 * The one real addition is conversation memory: `history` is rebuilt from
 * this component's own message list and sent back on every turn (the server
 * stays stateless — see intent.ts), so "avoid Air India" in one message and
 * "also nothing before 6am" in the next combine instead of the second
 * silently forgetting the first. A model that genuinely cannot tell what a
 * member means can now ask — `clarifying_question` — without that costing
 * the member whatever else they said clearly in the same breath.
 */

type ChatMessage = {
  id: string;
  role: 'member' | 'assistant';
  text: string;
  isError?: boolean;
  result?: IntentResponse;
};

let seq = 0;
const nextId = () => `intent-msg-${++seq}`;

function assistantTextFor(result: IntentResponse): string {
  if (!result.understood) return result.message ?? 'We could not read that.';
  const parts = [result.restated, result.diff?.clarifyingQuestion].filter(
    (s): s is string => !!s && s.trim().length > 0,
  );
  return parts.length ? parts.join('\n\n') : 'Got it — updated your options above.';
}

/** The same three-part breakdown the old single-shot panel showed, scoped to
 *  one message so a multi-turn chat can show it after each turn rather than
 *  only the latest. */
function ResultDetail({ result }: { result: IntentResponse }) {
  if (!result.understood) return null;
  const { diff } = result;
  if (!diff) return null;
  const hasAny = diff.changes.length || diff.clamped.length || diff.unsupported.length || result.removed?.length;
  if (!hasAny) return null;
  return (
    <div className="intent-chat-detail">
      {!!diff.changes.length && (
        <>
          <div className="lbl">What we&apos;ll do</div>
          <ul>{diff.changes.map((c) => <li key={c}>{c}</li>)}</ul>
        </>
      )}
      {!!diff.clamped.length && (
        <>
          <div className="lbl">What we adjusted</div>
          <ul className="muted">{diff.clamped.map((c) => <li key={c}>{c}</li>)}</ul>
        </>
      )}
      {!!diff.unsupported.length && (
        <>
          <div className="lbl">What we can&apos;t do</div>
          <ul className="warn">{diff.unsupported.map((u) => <li key={u.asked}>{u.asked} — {u.why}</li>)}</ul>
        </>
      )}
      {!!result.removed?.length && (
        <>
          <div className="lbl">Ruled out by what you told us</div>
          <ul className="muted">{result.removed.map((r) => <li key={r.id}>{r.code} — {r.rule}</li>)}</ul>
        </>
      )}
    </div>
  );
}

export function IntentChat({
  flightId,
  onResult,
  onReset,
}: {
  flightId: string;
  onResult: (result: IntentResponse) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;

    const history: IntentHistoryTurn[] = messages.map((m) => ({ role: m.role, text: m.text }));
    setMessages((cur) => [...cur, { id: nextId(), role: 'member', text }]);
    setInput('');
    setBusy(true);

    fetch(`/api/flights/${flightId}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, history }),
    })
      .then((r) => r.json())
      .then((result: IntentResponse) => {
        setMessages((cur) => [
          ...cur,
          { id: nextId(), role: 'assistant', text: assistantTextFor(result), isError: !result.understood, result },
        ]);
        onResult(result);
      })
      .catch(() => {
        setMessages((cur) => [
          ...cur,
          {
            id: nextId(),
            role: 'assistant',
            text: 'We could not reach that service. Your existing preferences are unchanged.',
            isError: true,
          },
        ]);
      })
      .finally(() => setBusy(false));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const startOver = () => {
    setMessages([]);
    setInput('');
    onReset();
  };

  // Closed, and never used this flight — just the entry point.
  if (!open && messages.length === 0) {
    return (
      <button type="button" className="intent-chat-trigger" onClick={() => setOpen(true)}>
        <span className="ic" aria-hidden="true">💬</span>
        Not quite right? Tell us what matters
        <span className="chev" aria-hidden="true">→</span>
      </button>
    );
  }

  // Closed, but there's a conversation underneath — collapse must not
  // discard it, only hide it.
  if (!open) {
    return (
      <button type="button" className="intent-chat-trigger intent-chat-trigger-resume" onClick={() => setOpen(true)}>
        <span className="ic" aria-hidden="true">💬</span>
        Continue the conversation — {messages.length} message{messages.length === 1 ? '' : 's'}
        <span className="chev" aria-hidden="true">→</span>
      </button>
    );
  }

  return (
    <div className="intent-chat">
      <div className="intent-chat-head">
        <div className="intent-chat-title">
          <span className="intent-chat-avatar" aria-hidden="true">✦</span>
          Tell us what matters
        </div>
        <div className="intent-chat-head-acts">
          {messages.length > 0 && (
            <button type="button" className="intent-chat-linkbtn" onClick={startOver}>Start over</button>
          )}
          <button
            type="button"
            className="intent-chat-linkbtn intent-chat-collapse"
            onClick={() => setOpen(false)}
            aria-label="Collapse chat"
            title="Collapse"
          >
            <span className="intent-chat-caret" aria-hidden="true" />
          </button>
        </div>
      </div>

      {messages.length === 0 && (
        <p className="intent-chat-hint">
          In your own words — a time you have to be there by, an airline you&apos;d rather not fly, how much
          of your own money you&apos;re willing to spend. Ask a follow-up any time; we&apos;ll remember what
          you&apos;ve already told us.
        </p>
      )}

      {messages.length > 0 && (
        <div className="intent-chat-thread" ref={threadRef} role="log" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`intent-chat-row ${m.role}`}>
              {m.role === 'assistant' && <span className="intent-chat-avatar" aria-hidden="true">✦</span>}
              <div className={`intent-chat-bubble ${m.role}${m.isError ? ' error' : ''}`}>
                {m.text.split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
                {m.result && <ResultDetail result={m.result} />}
              </div>
            </div>
          ))}
          {busy && (
            <div className="intent-chat-row assistant">
              <span className="intent-chat-avatar" aria-hidden="true">✦</span>
              <div className="intent-chat-bubble assistant intent-chat-typing" aria-label="Thinking">
                <span /><span /><span />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="intent-chat-composer">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={600}
          rows={messages.length === 0 ? 3 : 2}
          aria-label="What matters to you about this trip"
          placeholder={
            messages.length === 0
              ? "e.g. I have to be in Delhi before 9pm for my sister's wedding, and I'd rather not fly Air India"
              : 'Add more detail, or answer the question above…'
          }
          className="intent-box"
        />
        <button
          type="button"
          className="intent-chat-send"
          onClick={send}
          disabled={busy || !input.trim()}
          aria-label="Send"
        >
          {busy ? '…' : '↑'}
        </button>
      </div>
      {messages.length > 0 && (
        <p className="intent-chat-disclaimer">
          Nothing here is booked or saved until you confirm below — this only re-orders what you see.
        </p>
      )}
    </div>
  );
}
