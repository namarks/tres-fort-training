import { useEffect, type ReactNode } from 'react';
import { EFFORT_SCALE } from '../../src/trainingLoad';
import {
  HIGHLIGHT_WINDOW_DAYS,
  RECENT_RECORD_DAYS,
  RECENT_RECORD_MIN_EARLIER,
  SHORTEST_PACE_RUN_METERS,
} from './activity';
import { FATIGUE_DAYS, FITNESS_DAYS, MOST_GROUPS, MOST_WEEKLY_BARS } from './analysis';
import { ESTIMATE_DAYS, RIEGEL_EXPONENT, WEEKS_SHOWN } from './event';

/** The page's sections, in order; each one opens at #analysis/methodology/<id>. */
export const METHOD_SECTIONS = [
  { id: 'sessions', title: 'Sessions, time and distance' },
  { id: 'comparing', title: 'Ranges and comparisons' },
  { id: 'lifting', title: 'Lifting' },
  { id: 'load', title: 'Training load' },
  { id: 'fitness', title: 'Fitness, fatigue and form' },
  { id: 'records', title: 'Records and highlights' },
  { id: 'event', title: 'Your event' },
  { id: 'laps', title: 'Planned run laps' },
  { id: 'sources', title: 'Where the data comes from' },
  { id: 'research', title: 'Research' },
] as const;

export type MethodSection = (typeof METHOD_SECTIONS)[number]['id'];

/** Where a section of this page opens. */
export const methodologyHref = (section?: MethodSection) =>
  section ? `#analysis/methodology/${section}` : '#analysis/methodology';

export const isMethodSection = (value: string | null): value is MethodSection =>
  METHOD_SECTIONS.some((s) => s.id === value);

const REFERENCES: { text: string; doi?: string }[] = [
  { text: 'Banister EW, Calvert TW, Savage MV, Bach T. A systems model of training for athletic performance. Australian Journal of Sports Medicine 7:57–61, 1975.' },
  { text: 'Morton RH, Fitz-Clarke JR, Banister EW. Modeling human performance in running. Journal of Applied Physiology 69(3):1171–1177, 1990.', doi: '10.1152/jappl.1990.69.3.1171' },
  { text: 'Clarke DC, Skiba PF. Rationale and resources for teaching the mathematical modeling of athletic training and performance. Advances in Physiology Education 37(2):134–152, 2013.', doi: '10.1152/advan.00078.2011' },
  { text: 'Riegel PS. Athletic records and human endurance. American Scientist 69(3):285–290, 1981.' },
  { text: 'Hellard P, Avalos M, Lacoste L, Barale F, Chatard JC, Millet GP. Assessing the limitations of the Banister model in monitoring training. Journal of Sports Sciences 24(5):509–520, 2006.', doi: '10.1080/02640410500244697' },
];

const mileOrMore = `about a mile (${(SHORTEST_PACE_RUN_METERS / 1000).toFixed(1)} km)`;

/**
 * How every number Très Fort works out from your training is calculated, for
 * the Analysis pages, the Activity page and the calendar alike. Readings a
 * device or app measured (distance, heart rate, power, calories, climb) are
 * shown as they arrive and aren't described here.
 */
export function Methodology({ section }: { section: MethodSection | null }) {
  useEffect(() => {
    const target = section ? document.getElementById(`method-${section}`) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
  }, [section]);

  return (
    <>
      <div className="analysis-head">
        <div>
          <h1>Methodology</h1>
          <p className="muted analysis-sub">How Très Fort works out every figure it derives from your training</p>
        </div>
      </div>

      <section className="analysis-card methodology">
        <p>
          Distance, heart rate, power, calories and climb are shown as your watch, phone or app recorded them. Everything else on the Analysis and Activity pages and the calendar is worked out from those readings and your logged sets, as described below. Nothing is filled in by AI, and a figure that can’t be worked out is left blank rather than guessed.
        </p>
        <nav aria-label="On this page">
          <ol className="methodology-contents">
            {METHOD_SECTIONS.map((s) => (
              <li key={s.id}><a href={methodologyHref(s.id)}>{s.title}</a></li>
            ))}
          </ol>
        </nav>
      </section>

      <Section id="sessions">
        <p>A session is anything the Activity page lists: a workout finished in Très Fort, a run, ride, swim or other activity from a connected source, or an activity you logged by hand. When two sources report the same workout (Apple Health and intervals.icu, say), it is counted once.</p>
        <p>Time is moving time for an activity, so stops at lights don’t count, and start to finish for a workout. Pace is moving time divided by distance, per mile or kilometre as your browser’s region prefers; a ride shows speed instead, and a swim shows pace per 100 yards or metres. Distance totals are kept per kind, so a ride’s miles never add to running distance; the distance shown for a period is the kind you spent the most time on, swims included.</p>
        <p>Training time by week stacks each week’s time by lifting, endurance and sports. A range longer than {MOST_WEEKLY_BARS} weeks is shown by month instead. “Where the time went” groups sessions by what they were (running, soccer, lifting), and when there are more than {MOST_GROUPS} groups, the {MOST_GROUPS - 1} biggest are named and the rest are added together as “Everything else”.</p>
      </Section>

      <Section id="comparing">
        <p>A range ends today and starts on a Monday, so 4W is the current week plus the three whole weeks before it, and All starts on the Monday of your first session. Weeks run Monday to Sunday.</p>
        <p>With the comparison on, the period before has the same number of days, ending on the same weekday, so a week still in progress is compared with the same days of earlier weeks rather than with whole weeks. A change is shown as a percentage of the earlier period, rounded to a whole percent, and only when the earlier period had something to compare with. Load is compared only when both periods have one; otherwise you see how many sessions in each were scored.</p>
        <p>On the Activity page, this week’s time is compared with the same days of last week, and a difference under a minute reads as the same.</p>
      </Section>

      <Section id="lifting">
        <p>Working sets leave out warm-ups and deleted sets. A workout’s best set for an exercise is its heaviest working set, with more reps breaking a tie; a timed hold shows its longest time instead.</p>
        <p>Loads keep the unit they were logged in. To compare a kilogram set with a pound set, both are converted at 2.20462 lb per kg, and two loads that are the same weight in different units (a 24 kg kettlebell logged once as 53 lb) count as the same load, not a heavier one.</p>
        <p>Lifting has no training load yet. Rather than guess one, Très Fort counts a lifting workout toward time, sessions and working sets but leaves it out of load and of fitness, fatigue and form.</p>
      </Section>

      <Section id="load">
        <p>Training load puts a number on how hard a run, ride or sport was. Every method is scaled so that one hour at your threshold scores 100, which is the same scale intervals.icu and TrainingPeaks use. Your thresholds (FTP, threshold heart rate, threshold pace) are the ones you set in the iPhone app, under Profile, then Training thresholds, as they stood on the day of the session.</p>
        <p>Each session uses the first of these that it has data for:</p>
        <ol className="methodology-steps">
          <li><strong>The source’s own load</strong>, when it supplies one, as intervals.icu does.</li>
          <li><strong>Power</strong>, from normalized power (a 30-second rolling average, raised to the fourth power, averaged, then the fourth root):
            <span className="mono">load = hours × (normalized power ÷ FTP)² × 100</span></li>
          <li><strong>Heart rate</strong>, second by second through the session (or from its average when that’s all there is):
            <span className="mono">load = hours × (heart rate ÷ threshold heart rate)² × 100</span></li>
          <li><strong>Pace</strong>, for runs:
            <span className="mono">load = hours × (threshold pace ÷ pace)² × 100</span></li>
          <li><strong>Your effort rating</strong>, when nothing was measured: the 1 to 10 you give a session, with {EFFORT_SCALE.threshold} counting as threshold.
            <span className="mono">load = hours × (effort ÷ {EFFORT_SCALE.threshold}) × 100</span>
            It is always labeled an estimate. Without your rating, Apple Watch’s own 1 to 10 effort score for the workout is used the same way, and labeled as Apple Watch’s.</li>
        </ol>
        <p>A heart-rate or power recording that covers less than four fifths of the moving time isn’t used, since stretching it over the gaps would misstate the effort. Sports other than runs and rides are scored by heart rate only, against your running or riding threshold heart rate, whichever suits the sport; swims are not scored by heart rate, so only an effort rating or score gives one a load. Each session’s detail on the Activity page says which method scored it.</p>
      </Section>

      <Section id="fitness">
        <p>These follow the fitness–fatigue model first described by Banister and colleagues, in which each day’s training adds to a slow-fading fitness and a fast-fading fatigue. Like intervals.icu and TrainingPeaks, Très Fort uses fixed time constants of {FITNESS_DAYS} days for fitness and {FATIGUE_DAYS} days for fatigue rather than fitting them to you. A day’s load is the sum of that day’s sessions.</p>
        <ul className="methodology-formulas">
          <li><span className="mono">fitness<sub>today</sub> = fitness<sub>yesterday</sub> + (load<sub>today</sub> − fitness<sub>yesterday</sub>) × (1 − e<sup>−1/{FITNESS_DAYS}</sup>)</span></li>
          <li><span className="mono">fatigue<sub>today</sub> = fatigue<sub>yesterday</sub> + (load<sub>today</sub> − fatigue<sub>yesterday</sub>) × (1 − e<sup>−1/{FATIGUE_DAYS}</sup>)</span></li>
          <li><span className="mono">form = fitness − fatigue</span></li>
        </ul>
        <p>Both start at zero on your first day with a load, so fitness needs about six weeks of history to settle. Form above 5 reads as fresh, −10 to 5 as steady, −30 to −10 as building, and below −30 as a heavy load. When researchers fit the time constants to individual athletes, the values come out uncertain and differ from person to person (Hellard and colleagues, 2006), so treat these lines as a guide to trends in your own training, not as a prediction of how you will perform.</p>
      </Section>

      <Section id="records">
        <p>A badge marks a record as it stood on the session’s own date, so an old run that was your longest at the time keeps its badge. Your first session of a kind has nothing to beat and earns none.</p>
        <ul className="methodology-list">
          <li><strong>Longest yet</strong>: farther than every earlier run, ride, walk, hike or swim of that kind.</li>
          <li><strong>Fastest run yet</strong>: a faster average pace than every earlier run. Only runs of {mileOrMore} or more count, so a sprint or a GPS blip can’t win.</li>
          <li><strong>Longest or fastest in {RECENT_RECORD_DAYS} days</strong>: the best of the last {RECENT_RECORD_DAYS} days, when there were at least {RECENT_RECORD_MIN_EARLIER} earlier sessions of that kind in them.</li>
          <li><strong>PR</strong>: a working set heavier than any set of that exercise in an earlier workout. Bodyweight sets and timed holds don’t count.</li>
        </ul>
        <p>The Activity page’s highlights use the same rules over the last {HIGHLIGHT_WINDOW_DAYS} days: your fastest and longest runs, and your most recent new best lift.</p>
      </Section>

      <Section id="event">
        <p>Your event is the one race, ride, swim or day you set on the Event page, in the iPhone app or with your coach. The countdown counts calendar days from today. The block week and training phase are read from your plan for today’s date, the same way the calendar reads them.</p>
        <p>The sessions that train for an event are the ones of its kind: runs for a running event, rides for cycling, swims for swimming, and all three for a triathlon (runs and rides for a duathlon). For another kind of event, such as a biathlon, Très Fort can’t tell which sessions count, so it shows only your plan and fitness.</p>
        <p>Goal pace is the goal time divided by the distance; a ride shows the average speed it needs instead.</p>
        <p>The finish estimate carries each recent session to the event distance. Runs and swims use Riegel’s formula, which fits world records and everyday race results from a few minutes to a few hours:</p>
        <ul className="methodology-formulas">
          <li><span className="mono">estimate = session time × (event distance ÷ session distance)<sup>{RIEGEL_EXPONENT}</sup></span></li>
        </ul>
        <p>A ride is held at its average speed, since speed on a bike depends more on the course and the wind than on distance. Only sessions long enough to say something count: at least a quarter of the event distance for runs and swims (and at least a mile for runs) and half of it for rides. The estimate shown is the best one from the last {ESTIMATE_DAYS / 7} weeks, and the chart shows each week’s best over the last {WEEKS_SHOWN} weeks. Training sessions are rarely all-out, so the estimate is usually slower than you would race, and it is least reliable far from the session’s own distance.</p>
        <p>Distance by week adds up the sessions of the event’s kind each week, with a dot for the week’s longest one beside the event distance. A multisport event shows time in each sport instead, since a swim’s yards and a ride’s miles don’t add up. Fitness and form are the same as on Overview.</p>
      </Section>

      <Section id="laps">
        <p>A run you recorded from a plan in the iPhone app keeps one lap per step, plus a lap for anything run after the plan ended. A lap is on target when its average pace, to the second, or its average heart rate falls inside the step’s range, and otherwise faster or slower, above or below.</p>
      </Section>

      <Section id="sources">
        <p>Each figure says where its data came from: a session’s detail names its source, and the Analysis pages list the sources behind their totals and lines. Data from Garmin is labeled with the Garmin device that recorded it. Your routes, heart-rate charts and laps are private to you and never shown to your groups.</p>
      </Section>

      <Section id="research">
        <ol className="methodology-refs">
          {REFERENCES.map((ref) => (
            <li key={ref.text}>
              {ref.text}
              {ref.doi && <> <a href={`https://doi.org/${ref.doi}`} target="_blank" rel="noopener noreferrer">doi:{ref.doi}</a></>}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

function Section({ id, children }: { id: MethodSection; children: ReactNode }) {
  const title = METHOD_SECTIONS.find((s) => s.id === id)!.title;
  return (
    <section className="analysis-card methodology" id={`method-${id}`} aria-labelledby={`method-${id}-title`}>
      <h2 id={`method-${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}
