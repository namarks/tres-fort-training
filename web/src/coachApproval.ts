// Approving an AI app's connection on the web (/coach/authorize?request=…),
// the same request the iPhone app approves (CoachApprovalView.swift). The AI
// app's Très Fort sign-in page links here; the member signs in with Apple,
// reviews the request and allows or denies it, then returns to the AI app.

export const COACH_APPROVAL_PATH = '/coach/authorize';

/** What a connected AI app can read. Keep aligned with CoachSharing.sharedData in the iOS app. */
export const SHARED_DATA = [
  'Your display name and training profile: goal, activities and weekly activity context, experience, training days and session length, equipment, movements to avoid and lifts you reported',
  'Training plan, schedule and plan history, plus races, trips, training blocks and other coaching settings',
  'Workout history: sessions, sets, weights, reps, durations, effort and fatigue ratings',
  'Saved workout feedback and notes',
  'Activities imported from Apple Health or Intervals.icu, including heart-rate summaries, and planned Intervals.icu events',
  'Group activity and member names visible to you',
];

/** The request ID on this page, or null when the address isn't a valid request. */
export function coachRequestId(pathname: string, search: string): string | null {
  if (pathname !== COACH_APPROVAL_PATH) return null;
  const id = new URLSearchParams(search).get('request');
  return id !== null && /^[a-f0-9]{64}$/.test(id) ? id : null;
}

/** Where Sign in with Apple starts so it comes back to this request. */
export function signInHref(requestId: string): string {
  return `/auth/apple/start?return=${encodeURIComponent(`${COACH_APPROVAL_PATH}?request=${requestId}`)}`;
}

/** The AI app's return address, only when it's a plain HTTPS URL. */
export function httpsReturn(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Who receives the data, named from the return address the app registered,
 * never from its self-reported name. Mirrors recipientFor in src/oauth.ts and
 * CoachApprovalModel.recipient in the iOS app.
 */
export function recipientFor(redirectUri: string): string {
  const host = httpsReturn(redirectUri)?.hostname.toLowerCase() ?? '';
  const within = (domain: string) => host === domain || host.endsWith('.' + domain);
  if (within('claude.ai') || within('anthropic.com')) return 'Claude, operated by Anthropic';
  if (within('chatgpt.com') || within('openai.com')) return 'ChatGPT, operated by OpenAI';
  if (within('meta.ai') || within('meta.com')) return 'Meta AI, operated by Meta';
  return host ? `The app at ${host} and its configured model provider` : 'The connecting app and its configured model provider';
}
