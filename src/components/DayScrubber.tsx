import { useEffect, useMemo, useRef, useState } from 'react';
import type { DailyRecord } from '@/simulation';
import { MONTHS, WEEKDAYS_LONG, dayLabel, num } from '@/services/format';
import { buildCalendarLabels } from './calendarLabels';
import { Button, Icon, cx } from './ui';

const DAYS_PER_SECOND = 4;

interface Props {
  days: DailyRecord[];
  startMonth: number;
  day: number;
  onDay: (d: number) => void;
}

const WEATHER = {
  clear: { label: 'Clear', Icon: Icon.Sun },
  partial: { label: 'Partial rain', Icon: Icon.PartlyCloudy },
  rainout: { label: 'Rainout', Icon: Icon.Rain },
} as const;

export function DayScrubber({ days, startMonth, day, onDay }: Props) {
  const [playing, setPlaying] = useState(false);
  const dayRef = useRef(day);
  dayRef.current = day;
  const last = days.length - 1;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = dayRef.current + 1;
      if (next > last) {
        setPlaying(false);
        return;
      }
      onDay(next);
    }, 1000 / DAYS_PER_SECOND);
    return () => window.clearInterval(id);
  }, [playing, last, onDay]);

  const rec = days[Math.min(day, last)];
  const w = WEATHER[rec.weather];
  const labels = useMemo(() => buildCalendarLabels(startMonth, days.length), [startMonth, days.length]);
  const n = days.length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          variant="primary"
          onClick={() => {
            if (!playing && day >= last) onDay(0);
            setPlaying(!playing);
          }}
          ariaLabel={playing ? 'Pause' : 'Play'}
          className="w-24"
        >
          {playing ? <Icon.Pause className="h-3.5 w-3.5" /> : <Icon.Play className="h-3.5 w-3.5" />}
          {playing ? 'Pause' : 'Play'}
        </Button>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" ariaLabel="Previous day" onClick={() => onDay(day - 1)} disabled={day <= 0}>
            Prev
          </Button>
          <Button size="sm" variant="secondary" ariaLabel="Next day" onClick={() => onDay(day + 1)} disabled={day >= last}>
            Next
          </Button>
        </div>
        <div className="min-w-0">
          <div className="text-[17px] font-semibold leading-tight text-ink" data-testid="day-label">
            {WEEKDAYS_LONG[rec.dayOfWeek]} {dayLabel(startMonth, day).split(' ').slice(1).join(' ')}
          </div>
          <div className="num text-[12.5px] text-muted">
            Day {num(day + 1)} of {num(n)}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <span
            className={cx(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1',
              rec.weather === 'rainout' ? 'border-[#b9cde0] bg-accent-soft text-accent' : 'border-line bg-sunken text-muted',
            )}
            data-testid="weather"
          >
            <w.Icon />
            {w.label}
          </span>
          {!rec.isWorkday && <span className="rounded-md border border-line bg-[#ece9e0] px-2 py-1 text-muted">Not a workday</span>}
        </div>
      </div>

      <div className="mt-3">
        <div className="relative h-4 overflow-hidden rounded-sm border border-line" aria-hidden>
          <svg viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {days.map((d) => (
              <rect
                key={d.day}
                x={d.day}
                y={0}
                width={1.02}
                height={1}
                fill={!d.isWorkday ? '#dedbd0' : d.weather === 'rainout' ? '#a9c3d9' : d.weather === 'partial' ? '#d4e1ec' : '#f7f6f1'}
              />
            ))}
            {labels.monthStarts.map((m) => (
              <rect key={m.day} x={m.day} y={0} width={0.6} height={1} fill="#b3ae9f" />
            ))}
            <rect x={day} y={0} width={Math.max(1.2, n / 180)} height={1} fill="#2b5f8a" />
          </svg>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={Math.min(day, last)}
          onChange={(e) => {
            setPlaying(false);
            onDay(Number(e.target.value));
          }}
          aria-label="Selected day"
          aria-valuetext={`${dayLabel(startMonth, day)}, day ${day + 1} of ${n}`}
          className="mt-0.5"
        />
        <div className="relative mt-0.5 h-4 text-[11px] text-faint" aria-hidden>
          {labels.monthStarts.map((m) => (
            <span key={m.day} className="absolute -translate-x-0 whitespace-nowrap" style={{ left: `${(m.day / n) * 100}%` }}>
              {MONTHS[m.month]}
            </span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-[#dedbd0]" /> Not a workday
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-[#d4e1ec]" /> Partial rain
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-[#a9c3d9]" /> Rainout
          </span>
        </div>
      </div>
    </div>
  );
}
