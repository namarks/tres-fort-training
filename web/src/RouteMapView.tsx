import { useEffect, useRef, useState } from 'react';
import { fetchActivityRoute } from './api';
import { accentColor, drawRoute, loadMapKit, onMapKitFailure, prefersReducedMotion, replayRoute } from './mapkit';
import { drawableSegments, recoveryText, routeOutline, routeOutlineEnds, type LatLon } from './routeMap';
import { lapRows, type LapRow } from './runLaps';

/**
 * A run's route under its card: Apple Maps when the site has a MapKit JS
 * token, otherwise (or when the map can't load) the route's shape on its
 * own, then a planned run's laps. Shows nothing for an activity without a
 * route, or while intervals.icu can't send its track.
 */
export function RouteMap({ activityId, label, miles }: { activityId: string; label: string; miles: boolean }) {
  const [loaded, setLoaded] = useState<{
    id: string; segments: LatLon[][]; recovery: string | null; laps: LapRow[];
  } | null>(null);

  useEffect(() => {
    let live = true;
    fetchActivityRoute(activityId)
      .then((found) => {
        if (live) {
          setLoaded({
            id: activityId,
            segments: found ? drawableSegments(found.route) : [],
            recovery: recoveryText(found?.heart_rate_recovery),
            laps: lapRows(found?.laps, miles),
          });
        }
      })
      .catch(() => {
        if (live) setLoaded({ id: activityId, segments: [], recovery: null, laps: [] });
      });
    return () => {
      live = false;
    };
  }, [activityId, miles]);

  const current = loaded?.id === activityId ? loaded : null;
  const segments = current?.segments ?? [];
  const recovery = current?.recovery ?? null;
  const laps = current?.laps ?? [];
  if (segments.length === 0 && recovery === null && laps.length === 0) return null;
  return (
    <>
      {recovery !== null ? <p className="route-recovery">Heart rate recovery: {recovery}</p> : null}
      {segments.length > 0 ? <RouteView key={activityId} replayKey={activityId} segments={segments} label={label} /> : null}
      {laps.length > 0 ? <LapList laps={laps} /> : null}
    </>
  );
}

/** A planned run's laps: each step as it was run, against its target. */
function LapList({ laps }: { laps: LapRow[] }) {
  return (
    <section className="run-laps" aria-label="Laps">
      <h4>Laps</h4>
      <ol>
        {laps.map((lap, i) => (
          <li key={i} className={`run-lap ${lap.kind ?? 'after'}`}>
            <div className="run-lap-title">
              {lap.title}
              {lap.note ? <span className="muted"> · {lap.note}</span> : null}
            </div>
            <div className="run-lap-figures">{lap.figures}</div>
            {lap.target ? <div className={`run-lap-target${lap.verdict === 'on_target' ? ' on-target' : ''}`}>{lap.target}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Activities whose route has replayed during this visit: each plays once,
 * the first time it is opened. */
const replayed = new Set<string>();

function RouteView({ segments, label, replayKey }: { segments: LatLon[][]; label: string; replayKey: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [lineOnly, setLineOnly] = useState(false);

  useEffect(() => {
    const parent = element.current;
    if (lineOnly || !parent) return;
    let cancelled = false;
    let drawn: ReturnType<typeof drawRoute> | null = null;
    let stopReplay: (() => void) | null = null;
    const stopWatching = onMapKitFailure(() => setLineOnly(true));
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const recolor = () => {
      for (const style of drawn?.styles ?? []) style.strokeColor = accentColor(parent);
    };
    media.addEventListener('change', recolor);
    loadMapKit()
      .then((mapkit) => {
        if (cancelled) return;
        drawn = drawRoute(mapkit, parent, segments);
        if (!replayed.has(replayKey) && !prefersReducedMotion()) {
          replayed.add(replayKey);
          stopReplay = replayRoute(mapkit, drawn, segments);
        }
      })
      .catch(() => {
        if (!cancelled) setLineOnly(true);
      });
    return () => {
      cancelled = true;
      stopWatching();
      media.removeEventListener('change', recolor);
      stopReplay?.();
      drawn?.map.destroy();
    };
  }, [segments, lineOnly, replayKey]);

  if (lineOnly) return <RouteOutline segments={segments} label={label} />;
  return <div ref={element} className="route-map" role="group" aria-label={label} />;
}

const OUTLINE_WIDTH = 320;
const OUTLINE_HEIGHT = 200;

function RouteOutline({ segments, label }: { segments: LatLon[][]; label: string }) {
  const paths = routeOutline(segments, OUTLINE_WIDTH, OUTLINE_HEIGHT);
  const ends = routeOutlineEnds(segments, OUTLINE_WIDTH, OUTLINE_HEIGHT);
  return (
    <div className="route-map outline">
      <svg viewBox={`0 0 ${OUTLINE_WIDTH} ${OUTLINE_HEIGHT}`} role="img" aria-label={label}>
        {paths.map((d, i) => <path key={i} d={d} className="route-line" />)}
        {ends ? <circle className="route-end finish" cx={ends.end[0]} cy={ends.end[1]} r={6} /> : null}
        {ends ? <circle className="route-end start" cx={ends.start[0]} cy={ends.start[1]} r={6} /> : null}
      </svg>
    </div>
  );
}
