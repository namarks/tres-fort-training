// Public setup guide for connecting an AI app to Très Fort. Connector
// directories link to it as the connector's documentation. Keep the shared
// data list aligned with CoachSharing.sharedData in
// ios/TresFort/Profile/CoachConnectView.swift and the privacy policy's AI section.
export const MCP_URL = 'https://tres-fort.nmarkspdx.workers.dev/mcp';

export const SHARED_DATA = [
  'Your display name and training profile: goal, activities and weekly activity context, experience, training days and session length, equipment, movements to avoid and lifts you reported',
  'Training plan, schedule and plan history, plus races, trips, training blocks and other coaching settings',
  'Workout history: sessions, sets, weights, reps, durations, effort and fatigue ratings',
  'Saved workout feedback and notes',
  'Activities imported from Apple Health or Intervals.icu, including heart-rate summaries, and planned Intervals.icu events',
  'Group activity and member names visible to you',
];

export const EXAMPLE_PROMPTS = [
  'Review my recent training and suggest next week’s workouts.',
  'What is planned for today, and how did my last workout go?',
  'Help me adapt my training around an upcoming trip.',
  'I only have 30 minutes today. Shorten today’s workout and tell me what you changed.',
];

// Shared by the long-form pages (this guide and /terms).
export const GUIDE_STYLE = `:root{color-scheme:light;--bg:#f2f6fb;--surface:#fdfdfe;--text:#0f1d2f;--muted:#525f6f;--line:#d3dce7;--accent:#23436c;--accent-hover:#15273e}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:1.0625rem/1.75 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}a{color:var(--accent);text-underline-offset:.25em;overflow-wrap:anywhere}a:hover{color:var(--accent-hover)}a:focus-visible{outline:3px solid var(--accent);outline-offset:5px}header,footer{border-bottom:1px solid var(--line);padding:1.5rem max(1.25rem,calc((100% - 1100px)/2))}header a{font-size:1.15rem;font-weight:750;letter-spacing:.06em;text-decoration:none}main{max-width:780px;margin:auto;padding:4rem 1.25rem}h1{font-size:clamp(2.5rem,8vw,4rem);line-height:1.1;margin:.7rem 0 1.2rem;letter-spacing:-.04em}h2{font-size:1.5rem;line-height:1.3;margin:2.7rem 0 1rem}h3{font-size:1.125rem;margin:1.7rem 0 .6rem}p{margin:0 0 1.2rem}li{margin:.65rem 0}ul,ol{padding-left:1.3rem}code{font:.95em ui-monospace,monospace;background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:.1em .35em;overflow-wrap:anywhere}.meta{color:var(--muted);font-size:.9375rem}.eyebrow{font:.875rem/1.6 ui-monospace,monospace;color:var(--accent);letter-spacing:.08em;text-transform:uppercase}.summary{border-left:3px solid var(--accent);background:var(--surface);padding:1.2rem 1.4rem;margin:2rem 0}.summary p:last-child{margin:0}nav{padding:1.2rem 0;border-block:1px solid var(--line)}nav ul{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;list-style:none;margin:0;padding:0;font-size:.9375rem}nav li{margin:0}footer{border-top:1px solid var(--line);border-bottom:0;font-size:.875rem;color:var(--muted)}footer p{margin:0}.skip{position:absolute;left:1rem;top:-100px;background:var(--bg);padding:1rem}.skip:focus{top:1rem}`;

const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`;

export function connectPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Très Fort — Connect your AI app</title><meta name="description" content="How to connect Claude, ChatGPT, Codex or another AI app to your Très Fort training plan, what it can see and change, and how to disconnect it.">
<meta name="theme-color" content="#f2f6fb"><style>${GUIDE_STYLE}</style></head><body><a class="skip" href="#main">Skip to the guide</a><header><a href="/">TRÈS FORT <span aria-hidden="true">↗</span></a></header>
<main id="main"><p class="eyebrow">Optional · Bring your own AI</p><h1>Connect your AI app</h1><p class="meta">Très Fort for iPhone and iPad · Last updated November 8, 2026</p>
<p>Every Très Fort feature works without AI. If you want a coach to chat with, you can connect an AI app you already use, such as Claude, ChatGPT or Codex. It reads the same plan and history you see in the app and can change your plan when you ask. Très Fort has no built-in AI and never asks for an AI key: the conversation happens in your AI app, on your own account with it.</p>
<div class="summary"><p><strong>The short version:</strong> in the Très Fort app, tap your picture to open Profile, then <strong>Coach → Set up your AI coach</strong>. Pick your AI app, allow sharing, and follow the steps. You approve the connection in Très Fort, and you can disconnect it at any time.</p></div>
<nav aria-label="On this page"><ul><li><a href="#before">Before you start</a></li><li><a href="#claude">Claude</a></li><li><a href="#chatgpt">ChatGPT</a></li><li><a href="#other-apps">Codex and other apps</a></li><li><a href="#approve">Approving access</a></li><li><a href="#try">Things to ask</a></li><li><a href="#access">What it can see and do</a></li><li><a href="#disconnect">Disconnecting</a></li><li><a href="#help">Troubleshooting</a></li></ul></nav>

<section id="before"><h2>Before you start</h2>${list([
  'A Très Fort account. Sign in once in the iPhone or iPad app.',
  'An AI app that can add a remote connector (an MCP server) with OAuth sign-in, such as Claude, ChatGPT or Codex. Usage limits depend on your plan with that app.',
  `The Très Fort connector address: <code>${MCP_URL}</code>`,
])}</section>

<section id="claude"><h2>Claude</h2>
<h3>From the Très Fort app (easiest on iPhone)</h3><ol><li>Open Profile, then <strong>Coach → Set up your AI coach</strong>, and choose <strong>Claude</strong>.</li><li>Read what is shared and tap <strong>Allow and connect Claude</strong>. Claude opens with Très Fort’s details filled in. Sign in if asked, then confirm the connector. (Earlier versions of the app ask you to tap <strong>Allow sharing with Claude</strong>, then <strong>Connect with Claude</strong>.)</li><li>Claude opens the Très Fort sign-in page. Approve the connection as described in <a href="#approve">Approving access</a>. In the app, allowing access takes you straight back to Claude.</li></ol>
<h3>From Claude</h3><ol><li>In Claude (claude.ai or the desktop app), open <strong>Customize → Connectors</strong>.</li><li>If Très Fort is listed in Claude’s connector directory, choose it and select <strong>Connect</strong>. Otherwise choose <strong>+ → Add custom connector</strong>, name it <strong>Très Fort</strong> and paste the connector address above.</li><li>Approve the connection on the Très Fort sign-in page.</li><li>In a chat, make sure Très Fort is turned on in the tools menu, then try one of the <a href="#try">things to ask</a>.</li></ol>
<h3 id="claude-approvals">When Claude asks before a step</h3><p>Claude asks before Très Fort changes your plan or records training, and only you can change that. Reading your training doesn’t need approval. If Claude asks before every step, even reads, your connector was added before Très Fort labeled its tools: remove it in <strong>Customize → Connectors</strong> and add it again. To stop the questions about changes too, open <strong>Customize → Connectors → Très Fort</strong> in Claude on the web or the desktop app and set those tools to <strong>Always allow</strong>, or choose <strong>Always allow</strong> when Claude asks in a chat. The setting belongs to your Claude account, so it carries over to Claude on your phone.</p></section>

<section id="chatgpt"><h2>ChatGPT</h2>
<p>Until Très Fort is listed in ChatGPT’s plugin directory, add it yourself as a custom MCP server. OpenAI may limit custom servers on some ChatGPT plans, for example to reading only.</p><ol><li>In ChatGPT on the web, open <a href="https://chatgpt.com/plugins">chatgpt.com/plugins</a>, choose <strong>Add</strong>, then <strong>Add custom MCP server</strong>.</li><li>Name it <strong>Très Fort</strong>, paste the connector address above and choose <strong>OAuth</strong>. Leave any client ID and secret blank.</li><li>ChatGPT opens the Très Fort sign-in page. Choose <strong>Continue with Apple</strong> and allow access (see <a href="#approve">Approving access</a>). Très Fort then appears under <strong>Personal</strong>.</li><li>In a new chat, try one of the <a href="#try">things to ask</a>.</li></ol></section>

<section id="other-apps"><h2>Codex and other apps</h2>
<p><strong>Codex:</strong> in Très Fort choose <strong>Codex</strong>, then <strong>Copy setup for Codex</strong> and paste it into Codex on your computer. Codex adds the connector and starts the sign-in. You can also add it yourself in Codex under <strong>Settings → MCP servers → Add server</strong>: choose Streamable HTTP, name it <code>tres-fort</code>, enter the connector address, save, then select <strong>Authenticate</strong>. The first sign-in has to happen in that computer’s browser, so use a connect code (below) when asked.</p>
<p><strong>Other apps:</strong> add a remote MCP server with the connector address, using Streamable HTTP and OAuth. Très Fort supports dynamic client registration, so leave any client ID and secret blank. Apps that accept only an API key or a fixed token can’t connect. Review that app’s privacy policy before you approve, because it receives your training data.</p></section>

<section id="approve"><h2>Approving access</h2><p>When your AI app opens the Très Fort sign-in page, it names the app that is asking. Approve it one of three ways:</p>${list([
  '<strong>Continue with Apple:</strong> works on any computer or phone. Sign in with the Apple account you use in Très Fort, check the request and choose <strong>Allow access</strong>. You return to your AI app.',
  '<strong>In the app:</strong> on an iPhone or iPad with Très Fort, choose <strong>Open Très Fort to review access</strong>, check the request and tap <strong>Allow and return to</strong> your AI app (<strong>Allow access</strong> in earlier versions).',
  '<strong>With a connect code:</strong> for apps that sign in from somewhere else, such as a cloud browser, or Codex on a computer. In Très Fort, open the setup screen and expand <strong>Use a connect code</strong> to make one. Paste it on the Très Fort sign-in page and choose <strong>Allow access</strong>. A code works once and expires after 10 minutes. Never paste it into a chat with the AI.',
])}<p>Each AI app gets its own connection to the same training account, so you can connect more than one.</p></section>

<section id="try"><h2>Things to ask</h2>${list(EXAMPLE_PROMPTS.map(p => `“${p}”`))}<p>Start a conversation with “Use Très Fort to load my coaching brief” if your AI app doesn’t pick it up on its own. Keep logging sets in the app: telling the AI “set two done” doesn’t log anything unless you ask it to.</p></section>

<section id="access"><h2>What it can see and do</h2><p>A connected AI app can read:</p>${list(SHARED_DATA)}<p>It can also change your training plan and record training updates when you ask. Every change is saved to your plan history, and you can ask your AI app what it changed or to put an earlier version of your plan back. You can also edit anything it changed yourself in the app.</p><p>It can’t see your Sign in with Apple email, passwords, connect codes or access tokens, the GPS routes and heart-rate readings of your runs, or your Apple Health weight. Information it reads is handled under your AI app’s own terms and privacy policy. See the <a href="/privacy">privacy policy</a> for details.</p></section>

<section id="disconnect"><h2>Disconnecting</h2><p>In Très Fort, open Profile and choose <strong>Disconnect all AI apps</strong>. That stops every AI connection right away and keeps your training data. Making a new connect code doesn’t disconnect anything. You can also remove the connector in your AI app; conversations already held there stay in that app until you delete them.</p></section>

<section id="help"><h2>Troubleshooting</h2>${list([
  '<strong>The AI says it’s connected but can’t load your plan:</strong> the sign-in didn’t finish. Remove the connector and connect again.',
  '<strong>“That code is invalid, expired or already used”:</strong> it was mistyped, already used or older than 10 minutes. Make a new one.',
  '<strong>The app asks for a client ID:</strong> it didn’t find dynamic registration. Point it to <code>https://tres-fort.nmarkspdx.workers.dev/.well-known/oauth-protected-resource</code> and try again.',
  '<strong>Claude opens without the setup form:</strong> go back to Très Fort, press and hold <strong>Allow and connect Claude</strong>, choose <strong>Allow and copy setup link</strong> and paste it into Safari. (On the next screen, or in earlier versions, press and hold <strong>Connect with Claude</strong> and choose <strong>Copy setup link</strong>.)',
  '<strong>A plan change doesn’t show up:</strong> go back to Today and pull to refresh.',
  '<strong>Claude asks before every step, even reads:</strong> remove Très Fort in <strong>Customize → Connectors</strong> and add it again. If you chose <strong>Always allow</strong> and Claude asks again later, set it again there: Claude sometimes puts it back to asking, and Très Fort can’t change that.',
])}<p>Still stuck? Email <a href="mailto:nick@tresfort.app">nick@tresfort.app</a> with what you saw. Don’t include connect codes.</p></section>
</main><footer><p>© 2026 Nicholas Marks · Très Fort · <a href="/privacy">Privacy policy</a> · <a href="/terms">Terms</a></p></footer></body></html>`;
}
