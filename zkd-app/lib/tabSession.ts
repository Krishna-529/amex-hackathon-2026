/**
 * Per-tab identity, layered on top of the shared session cookie.
 *
 * See server/auth/session.ts's header for the bug this exists to fix: signing
 * in as a second member in a second tab silently breaks every other tab of
 * the same browser, because a cookie is one value per browser, not per tab.
 *
 * `sessionStorage` is the one browser-native store that is actually scoped
 * per tab — a new tab (or a fresh navigation typed into the address bar)
 * gets its own empty area, unlike `localStorage` or cookies, which every tab
 * of the same origin shares. Capturing the login response's token here and
 * replaying it as a header means a tab that has explicitly signed in keeps
 * acting as that passenger regardless of what any other tab's cookie now
 * says. A tab that never captured a token (a fresh session, or one opened
 * before this existed) simply has nothing to send, and the server falls
 * back to the shared cookie — today's exact behaviour, unchanged.
 *
 * This only covers client-side fetches, which is everything this app makes
 * after the first paint (see lib/usePoll.ts and every page's own fetch calls)
 * — it cannot and does not need to cover the very first server-rendered
 * request of a hard page load, before any client JS has run; that request
 * necessarily reflects the shared cookie, and this module's own patched
 * fetch corrects it within one client-side round trip right after hydration
 * (WorldProvider's GET /api/auth/me on mount).
 */

const STORAGE_KEY = 'zkd_tab_session';
export const SESSION_HEADER = 'x-zkd-session';

export function setTabSession(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Private browsing / storage disabled: the tab falls back to the shared
    // cookie, same as before this feature existed. Not fatal either way.
  }
}

export function clearTabSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage was never writable in the first place.
  }
}

function getTabSession(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    __zkdFetchPatched?: boolean;
  }
}

/**
 * Patches `window.fetch` once so every same-origin request this tab makes —
 * without touching each of the ~8 files that call `fetch()` directly, or
 * lib/usePoll.ts's poller — carries this tab's own captured identity.
 *
 * Idempotent (guarded on `window.__zkdFetchPatched`) so React Strict Mode's
 * double-invoke and Next.js dev-mode HMR re-importing this module can't
 * chain the patch onto itself twice. Must run at module-evaluation time, not
 * inside a `useEffect` — importing this file from WorldProvider.tsx (before
 * its own effects run) is what guarantees the very first `fetch('/api/auth/me')`
 * already carries the header.
 */
function patchFetchOnce(): void {
  if (typeof window === 'undefined' || window.__zkdFetchPatched) return;
  window.__zkdFetchPatched = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getTabSession();
    if (!token) return realFetch(input, init);

    // Same-origin only: this token authenticates as a member of THIS app,
    // and must never leak to a third-party request a page happens to make.
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const isSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
    if (!isSameOrigin) return realFetch(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(SESSION_HEADER, token);
    return realFetch(input, { ...init, headers });
  };
}

patchFetchOnce();
