import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CrewDayLog, Id, SimEvent } from '@/simulation';
import { clockLabel, crewStateAt, dayEndClock, dayFeed, type CrewPlayState, type FeedKind } from '@/services/playback';
import { money, signedMoney } from '@/services/format';
import { Button, Segmented, cx } from './ui';

/**
 * Tiny external clock shared by the controls and the map markers. The markers move by
 * writing SVG attributes directly, so scrubbing and playing never re-render the map.
 */
export interface PlaybackClock {
  t: number;
  set: (t: number) => void;
  subscribe: (fn: (t: number) => void) => () => void;
}

export function createPlaybackClock(): PlaybackClock {
  const subs = new Set<(t: number) => void>();
  const clock: PlaybackClock = {
    t: 0,
    set(t) {
      clock.t = t;
      subs.forEach((fn) => fn(t));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
  return clock;
}

export const STATE_LABEL: Record<CrewPlayState, string> = {
  traveling: 'Travelling',
  working: 'Working',
  returning: 'Returning',
  idle: 'Idle at depot',
  off: 'Not deployed',
};

const SPEEDS = [
  { value: 0.5, label: '0.5 h/s' },
  { value: 1, label: '1 h/s' },
  { value: 2, label: '2 h/s' },
  { value: 4, label: '4 h/s' },
];

const SHIFT_START = 7;

interface Props {
  clock: PlaybackClock;
  logs: CrewDayLog[];
  /** Fallback upper bound (shift hours) when no crew ran. */
  shiftHours: number;
  /** Changes whenever the day or scenario changes: playback pauses and rewinds. */
  resetKey: string;
  crewColor: (id: Id) => string;
  crewName: (id: Id) => string;
}

export const PlaybackControls = memo(function PlaybackControls({ clock, logs, shiftHours, resetKey, crewColor, crewName }: Props) {
  const maxT = useMemo(() => dayEndClock(logs, shiftHours), [logs, shiftHours]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const tRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const apply = useCallback(
    (v: number) => {
      tRef.current = v;
      clock.set(v);
      setT(v);
    },
    [clock],
  );

  // New day or scenario: rewind and pause.
  useEffect(() => {
    setPlaying(false);
    apply(0);
  }, [resetKey, apply]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = Math.min(maxT, tRef.current + dt * speedRef.current);
      apply(next);
      if (next >= maxT) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, maxT, apply]);

  const togglePlay = () => {
    if (!playing && tRef.current >= maxT) apply(0);
    setPlaying((p) => !p);
  };

  const active = logs.filter((l) => l.deployed);

  return (
    <div className="space-y-2" aria-label="Time of day playback">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="primary" onClick={togglePlay} ariaLabel={playing ? 'Pause playback' : 'Play the day'} className="w-[4.5rem]">
          {playing ? 'Pause' : 'Play'}
        </Button>
        <span className="num w-12 text-[15px] font-semibold text-ink" aria-live="off">
          {clockLabel(t, SHIFT_START)}
        </span>
        <input
          type="range"
          min={0}
          max={maxT}
          step={0.01}
          value={t}
          onChange={(e) => {
            setPlaying(false);
            apply(Number(e.target.value));
          }}
          aria-label="Time of day"
          aria-valuetext={clockLabel(t, SHIFT_START)}
          className="h-6 min-w-[8rem] flex-1 accent-accent"
        />
        <Segmented ariaLabel="Playback speed" size="sm" value={speed} onChange={setSpeed} options={SPEEDS} />
      </div>
      {active.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" aria-label="Crew status at this time">
          {active.map((l) => {
            const s = crewStateAt(l, t);
            return (
              <li key={l.crewId} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: crewColor(l.crewId) }} />
                <span className="text-ink">{crewName(l.crewId)}</span>
                <span className="text-muted">{STATE_LABEL[s.state]}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted">No crew was deployed on this day.</p>
      )}
    </div>
  );
});

const KIND_DOT: Record<FeedKind, string> = {
  breakdown: 'bg-bad',
  absence: 'bg-warn',
  quit: 'bg-bad',
  hire: 'bg-good',
  action: 'bg-accent',
  rejected: 'bg-warn',
  shortfall: 'bg-bad',
  rule: 'bg-accent',
  'shock-start': 'bg-warn',
  'shock-end': 'bg-good',
  'asset-disposed': 'bg-muted',
  distribution: 'bg-muted',
  other: 'bg-faint',
};

export function DayFeed({
  day,
  events,
  logs,
  nameOf,
}: {
  day: number;
  events: readonly SimEvent[];
  logs: readonly CrewDayLog[];
  nameOf: (id: Id) => string;
}) {
  const items = useMemo(() => dayFeed(day, events, logs, nameOf), [day, events, logs, nameOf]);
  if (items.length === 0) return <p className="text-[13px] text-muted">Nothing notable was recorded on this day.</p>;
  return (
    <ul className="divide-y divide-line text-[13px]">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 py-1.5">
          <span className={cx('mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full', KIND_DOT[it.kind])} aria-hidden />
          <span className="min-w-0 flex-1 text-ink">{it.text}</span>
          {it.money !== undefined && (
            <span className={cx('num shrink-0', it.money < 0 ? 'text-bad' : 'text-good')} title={money(Math.abs(it.money))}>
              {signedMoney(it.money)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
