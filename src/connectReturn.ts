// Where a provider connection (intervals.icu, WHOOP) hands the browser back.
//
// A connection started in the iPhone app returns through its tresfort://
// link, which closes the web sheet. One started on the web app returns to
// the web app's Settings → Connections page, with the completion secret (or
// the failure) in the URL fragment, which browsers never send to a server.
// The completion only activates for the same signed-in session that started
// the connection (POST /auth/<provider>/finish), as in the app.
//
// Which way an attempt returns is fixed when it starts, by marking its
// single-use state. The state is stored (or its digest is), so the marker
// can't be added or removed without the callback failing to find it.

export type ConnectProvider = 'intervals' | 'whoop';

/** Marks a state minted for a web sign-in. Never a valid first character of
 * the unmarked states (hex for intervals.icu, base64url for WHOOP). */
export const WEB_STATE_PREFIX = 'web.';

export function markWebState(state: string): string {
  return `${WEB_STATE_PREFIX}${state}`;
}

export function isWebState(state: string): boolean {
  return state.startsWith(WEB_STATE_PREFIX);
}

/** `https://app.tresfort.app` only: an origin with no path, query or fragment. */
export function webAppOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
    return url.origin === value.replace(/\/$/, '') ? url.origin : null;
  } catch {
    return null;
  }
}

/** The web app's Connections page, told how the connection went. */
export function webReturn(origin: string, provider: ConnectProvider, result: { completion: string } | { error: string }): string {
  const params = new URLSearchParams({ provider });
  if ('completion' in result) params.set('completion', result.completion);
  else params.set('error', result.error.slice(0, 64));
  return `${origin}/#settings/connections?${params.toString()}`;
}
