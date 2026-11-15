import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CoachApprovalPage } from './CoachApprovalPage';
import { coachRequestId } from './coachApproval';
import './styles.css';

// An AI app's connection request opens its own page instead of the planner.
const coachRequest = coachRequestId(window.location.pathname, window.location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {coachRequest ? <CoachApprovalPage requestId={coachRequest} /> : <App />}
  </StrictMode>,
);
