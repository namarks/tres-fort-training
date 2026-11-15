import { useEffect, useState } from 'react';
import {
  AccountChangedError,
  decideCoachRequest,
  fetchCoachRequest,
  fetchMe,
  SignedOutError,
  type CoachRequest,
  type Me,
} from './api';
import { AppleLogo } from './App';
import { httpsReturn, recipientFor, SHARED_DATA, signInHref } from './coachApproval';

type Step =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'review'; me: Me; request: CoachRequest }
  | { kind: 'sending' }
  | { kind: 'done'; allowed: boolean; returnTo: URL }
  | { kind: 'failed'; message: string };

const SIGNIN_PROBLEMS: Record<string, string> = {
  cancelled: 'Sign in was cancelled.',
  failed: 'Sign in didn’t work. Please try again.',
  unavailable: 'This account can’t be used right now.',
};

const EXPIRED = 'This connection request has expired or was already answered. Start connecting again in your AI app.';

/** Approve an AI app's connection to your training: /coach/authorize?request=… */
export function CoachApprovalPage({ requestId }: { requestId: string }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    Promise.all([fetchMe(), fetchCoachRequest(requestId)])
      .then(([me, request]) => {
        if (!live) return;
        if (!request || !httpsReturn(request.redirect_uri) || request.expires_at <= Date.now()) {
          setStep({ kind: 'failed', message: EXPIRED });
        } else {
          setStep({ kind: 'review', me, request });
        }
      })
      .catch((error: unknown) => {
        if (!live) return;
        if (error instanceof SignedOutError) setStep({ kind: 'signed_out' });
        else setStep({ kind: 'failed', message: 'This request couldn’t be loaded. Refresh to try again.' });
      });
    return () => { live = false; };
  }, [requestId]);

  async function decide(allow: boolean) {
    if (step.kind !== 'review') return;
    if (step.request.expires_at <= Date.now()) {
      setStep({ kind: 'failed', message: EXPIRED });
      return;
    }
    const account = step.me.id;
    setStep({ kind: 'sending' }); // One decision per request: no second click while saving.
    try {
      const decision = await decideCoachRequest(requestId, allow, account);
      if (!decision) {
        setStep({ kind: 'failed', message: EXPIRED });
        return;
      }
      const returnTo = httpsReturn(decision.redirect_uri);
      if (!returnTo) {
        setStep({ kind: 'failed', message: 'Your decision was saved, but the return link is unavailable. Go back to your AI app to reconnect.' });
        return;
      }
      setStep({ kind: 'done', allowed: decision.allowed, returnTo });
      window.location.assign(returnTo.toString());
    } catch (error: unknown) {
      if (error instanceof AccountChangedError) {
        // Nothing was decided, so the request is still open for the new account to review.
        setStep({ kind: 'failed', message: 'You signed in to a different account in another tab. Refresh to review this request for that account.' });
        return;
      }
      if (error instanceof SignedOutError) {
        setStep({ kind: 'signed_out' });
        return;
      }
      // An uncertain response may already have committed: never repeat it.
      setStep({ kind: 'failed', message: 'Your decision couldn’t be confirmed. Start a new connection in your AI app. You can disconnect AI apps in the Très Fort app’s Profile to stop access.' });
    }
  }

  if (step.kind === 'loading') return <main className="centered" aria-busy="true"><p className="muted">Loading the request…</p></main>;
  if (step.kind === 'sending') return <main className="centered" aria-busy="true"><p className="muted">Saving your decision…</p></main>;
  if (step.kind === 'failed') return <main className="centered"><p role="alert">{step.message}</p></main>;
  if (step.kind === 'done') {
    return (
      <main className="centered">
        <h1>{step.allowed ? 'Access allowed' : 'Access denied'}</h1>
        <p className="muted">Taking you back to your AI app…</p>
        <a className="coach-continue" href={step.returnTo.toString()}>Continue to your AI app</a>
      </main>
    );
  }
  if (step.kind === 'signed_out') {
    const problem = new URLSearchParams(window.location.search).get('signin');
    return (
      <main className="signin">
        <div className="signin-card">
          <img src="/assets/app-icon.png" alt="" width={72} height={72} />
          <h1>Connect your AI app</h1>
          <p className="muted">Sign in to review this request. Use the same Apple account as the Très Fort app on your iPhone.</p>
          {problem && SIGNIN_PROBLEMS[problem] && <p role="alert" className="problem">{SIGNIN_PROBLEMS[problem]}</p>}
          <a className="apple-button" href={signInHref(requestId)}><AppleLogo /> Sign in with Apple</a>
          <p className="fine">Nothing is shared until you choose Allow on the next screen.</p>
        </div>
      </main>
    );
  }

  const { me, request } = step;
  return (
    <main className="coach-approval">
      <h1>Connect {request.client_name || 'this AI app'} to Très Fort?</h1>
      <p className="muted">It will be able to see your training and update your plan.</p>
      <section>
        <h2>Who receives your data</h2>
        <p><strong>{recipientFor(request.redirect_uri)}</strong>. They process it under their own terms and privacy policy.</p>
        <p className="muted">Account: {me.display_name || me.email || 'your Très Fort account'}. App name supplied by the connecting app: {request.client_name || 'not given'}. Only allow access if you started this connection yourself.</p>
      </section>
      <section>
        <h2>What it can read</h2>
        <ul>{SHARED_DATA.map((item) => <li key={item}>{item}</li>)}</ul>
        <p className="muted">Apple Health group sharing doesn’t limit your own coach’s access.</p>
      </section>
      <section>
        <h2>What it can change</h2>
        <p>Your training plan and training records. Every change is saved to your plan history.</p>
        <p className="muted">Disconnect AI apps in the Très Fort app’s Profile to stop future access. That doesn’t delete what’s already in your AI conversations. See the <a href="https://tresfort.app/privacy">privacy policy</a>.</p>
      </section>
      <div className="coach-actions">
        <button type="button" className="primary" onClick={() => void decide(true)}>Allow access</button>
        <button type="button" onClick={() => void decide(false)}>Deny</button>
      </div>
    </main>
  );
}
