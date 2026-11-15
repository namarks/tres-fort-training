/** Small pieces the Analysis pages' charts share. */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Entry } from './activity';

/** Where an entry opens on the Activity page. */
export const activityHref = (entry: Entry) => `#activity/${encodeURIComponent(entry.key)}`;


export function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** 1, 2, 2.5 or 5 times a power of ten, at or above the value. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * power >= value) return m * power;
  return 10 * power;
}

/** About `count` evenly spaced indexes, always keeping the ends apart. */
export function dateTicks(dates: string[], count: number): number[] {
  if (dates.length <= 1) return [0];
  const stepSize = Math.max(1, Math.round((dates.length - 1) / count));
  const out: number[] = [];
  for (let i = 0; i < dates.length - stepSize / 2; i += stepSize) out.push(i);
  return out;
}

export function civil(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function shortDate(date: string): string {
  return civil(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function longDate(date: string): string {
  return civil(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function monthLabel(date: string, long = false): string {
  return civil(date).toLocaleDateString(undefined, long ? { month: 'long', year: 'numeric' } : { month: 'short' });
}

export function rangeText(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const a = civil(from).toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  const b = civil(to).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${a} – ${b}`;
}

export function listText(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

