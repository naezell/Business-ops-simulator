import { useEffect, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EVENT_LANES, weeklySeries, type EventLane, type TimelineEvent } from '@/services/derive';
import type { SimulationResult } from '@/simulation';
import { MONTHS, num } from '@/services/format';
import { buildCalendar } from '@/simulation';

const AXIS_W = 52;
const LANE_COLOR: Record<EventLane, string> = {
  breakdown: '#c2662d',
  quit: '#a8322a',
  hired: '#1c7048',
  shortfall: '#7a4fa3',
};

interface Props {
  result: SimulationResult;
  startMonth: number;
  selectedDay: number;
  events: TimelineEvent[];
  onDay: (d: number) => void;
}

export function OpsTimeline({ result, startMonth, selectedDay, events, onDay }: Props) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 640);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const weeks = useMemo(() => weeklySeries(result), [result]);
  const cal = useMemo(() => buildCalendar(startMonth, result.horizonDays), [startMonth, result.horizonDays]);
  const data = useMemo(
    () =>
      weeks.map((w) => {
        const first = cal[w.startDay];
        // Label only the first week that starts in each new month.
        const prev = w.week > 0 ? cal[weeks[w.week - 1].startDay] : null;
        const newMonth = !prev || prev.month !== first.month;
        const label = newMonth && (!narrow || first.month % 3 === 0) ? MONTHS[first.month] : '';
        return { ...w, label, range: `${first.dayOfMonth} ${MONTHS[first.month]}` };
      }),
    [weeks, cal, narrow],
  );
  const n = data.length;
  const selectedWeek = Math.floor(selectedDay / 7);

  const markers = useMemo(() => {
    const out: { lane: EventLane; week: number; day: number; texts: string[] }[] = [];
    for (const e of events) {
      const week = Math.floor(e.day / 7);
      const hit = out.find((m) => m.lane === e.lane && m.week === week);
      if (hit) hit.texts.push(e.text);
      else out.push({ lane: e.lane, week, day: e.day, texts: [e.text] });
    }
    return out;
  }, [events]);

  const lanes = EVENT_LANES.filter((l) => markers.some((m) => m.lane === l.id));

  return (
    <div>
      <div className="h-[230px] w-full" data-testid="timeline-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
            onClick={(s) => {
              const idx = typeof s?.activeTooltipIndex === 'number' ? s.activeTooltipIndex : Number(s?.activeTooltipIndex);
              if (Number.isFinite(idx) && data[idx]) onDay(data[idx].startDay);
            }}
            style={{ cursor: 'pointer' }}
          >
            <CartesianGrid vertical={false} stroke="#ebe8de" />
            <XAxis dataKey="week" tickFormatter={(w: number) => data[w]?.label ?? ''} interval={0} tickLine={false} axisLine={{ stroke: '#cfcbbd' }} height={22} />
            <YAxis
              yAxisId="jobs"
              width={AXIS_W}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              label={{ value: 'Jobs completed per week', angle: -90, position: 'insideLeft', offset: 14, style: { fontSize: 11, fill: '#5f6a63', textAnchor: 'middle' } }}
            />
            <YAxis
              yAxisId="hours"
              orientation="right"
              width={AXIS_W}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              label={{ value: 'Backlog, labor hours', angle: 90, position: 'insideRight', offset: 14, style: { fontSize: 11, fill: '#5f6a63', textAnchor: 'middle' } }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(43,95,138,0.06)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] shadow-sm">
                    <div className="font-medium text-ink">Week of {p.range}</div>
                    <div className="num mt-1 text-muted">Jobs completed: <span className="text-ink">{num(p.jobsCompleted)}</span></div>
                    <div className="num text-muted">Backlog at week end: <span className="text-ink">{num(p.backlogHours, 1)} h ({num(p.backlogJobs)} jobs)</span></div>
                    <div className="mt-1 text-faint">Click to jump to this week</div>
                  </div>
                );
              }}
            />
            <Bar yAxisId="jobs" dataKey="jobsCompleted" fill="#8fb0cc" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Line yAxisId="hours" dataKey="backlogHours" stroke="#1d2420" strokeWidth={2} dot={false} isAnimationActive={false} />
            <ReferenceLine yAxisId="jobs" x={selectedWeek} stroke="#2b5f8a" strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-sm bg-[#8fb0cc]" /> Jobs completed (weekly)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-ink" /> Backlog hours at week end
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-accent" /> Selected day
        </span>
        {lanes.map((l) => (
          <span key={l.id} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: LANE_COLOR[l.id] }} /> {l.label} (rows below, click to jump)
          </span>
        ))}
      </div>

      {lanes.length > 0 && (
        <div className="mt-3 space-y-1" aria-label="Events">
          {lanes.map((lane) => (
            <div key={lane.id} className="flex items-center gap-2">
              <div className="relative h-5 flex-1">
                <div className="absolute inset-y-0 border-b border-dashed border-line" style={{ left: AXIS_W, right: AXIS_W, top: '50%' }} />
                {markers
                  .filter((m) => m.lane === lane.id)
                  .map((m) => (
                    <button
                      key={`${m.week}`}
                      type="button"
                      title={`${m.texts.join('; ')} (click to jump)`}
                      aria-label={`${lane.label}: ${m.texts.join('; ')}`}
                      onClick={() => onDay(m.day)}
                      className="absolute top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center"
                      style={{ left: `calc(${AXIS_W}px + (100% - ${AXIS_W * 2}px) * ${(m.week + 0.5) / n})` }}
                    >
                      <span className="block h-2.5 w-2.5 rotate-45 border border-white" style={{ background: LANE_COLOR[lane.id] }} />
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {lanes.length === 0 && <p className="mt-2 text-[12.5px] text-muted">No breakdowns, quits, hires or cash shortfalls in this period.</p>}
    </div>
  );
}
