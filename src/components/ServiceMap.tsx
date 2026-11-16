import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CrewDayLog, CustomerSnapshot, Id, RouteStop } from '@/simulation';
import { hours, money, num } from '@/services/format';
import { crewStateAt, type CrewPlayState } from '@/services/playback';
import type { PlaybackClock } from './PlaybackControls';
import { cx } from './ui';

export const CREW_COLORS = ['#2b5f8a', '#c2662d', '#7a4fa3', '#2a8c7f', '#b0407f', '#8a7a1f', '#4a6b2a', '#a8322a'];

interface Props {
  customers: CustomerSnapshot[];
  logs: CrewDayLog[];
  day: number;
  crewColor: (crewId: Id) => string;
  crewName: (crewId: Id) => string;
  jobTypeName: (id: Id) => string;
  planIds: Id[];
  planName: (id: Id) => string;
  /** When given, crew markers follow this clock (time-of-day playback). */
  clock?: PlaybackClock;
}

const PLAN_FILLS = ['#51675b', '#9fb5a8', '#6d6a8c'];

interface ActiveStop {
  crewId: Id;
  index: number;
  stop: RouteStop;
}

export const ServiceMap = memo(function ServiceMap({ customers, logs, day, crewColor, crewName, jobTypeName, planIds, planName, clock }: Props) {
  const [active, setActive] = useState<ActiveStop | null>(null);

  // Fixed extent from every customer ever present, so the picture does not jump while scrubbing.
  const view = useMemo(() => {
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const c of customers) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    const pad = Math.max(1, Math.max(maxX - minX, maxY - minY) * 0.06);
    const x0 = minX - pad;
    const x1 = maxX + pad;
    const y0 = minY - pad;
    const y1 = maxY + pad;
    const w = x1 - x0;
    const h = y1 - y0;
    return { x0, y0, w, h, unit: Math.max(w, h) / 100 };
  }, [customers]);

  const r = view.unit * 0.62;
  // North is up: SVG y grows downwards, so flip.
  const px = (x: number) => x - view.x0;
  const py = (y: number) => view.y0 + view.h - y;

  const planColor = (id: Id | null): string => {
    if (id === null) return 'transparent';
    const i = planIds.indexOf(id);
    return PLAN_FILLS[(i < 0 ? 0 : i) % PLAN_FILLS.length];
  };

  const deployed = logs.filter((l) => l.stops.length > 0);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${view.w} ${view.h}`}
        className="block w-full rounded-md border border-line bg-[#fbfaf6]"
        style={{ aspectRatio: `${view.w} / ${view.h}`, maxHeight: '72vh' }}
        role="img"
        aria-label="Service area map with customers and today's crew routes"
        onClick={() => setActive(null)}
      >
        {/* distance rings every 2 miles */}
        {[2, 4, 6, 8, 10].map((rad) => (
          <circle key={rad} cx={px(0)} cy={py(0)} r={rad} fill="none" stroke="#e6e2d6" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 4" />
        ))}

        {/* customers */}
        {customers.map((c) => {
          if (c.acquiredDay > day) return null;
          const churned = c.churnedDay !== null && c.churnedDay <= day;
          const recurring = c.recurringJobTypeId !== null;
          const fill = planColor(c.recurringJobTypeId);
          return (
            <g key={c.id} opacity={churned ? 0.22 : 1}>
              {c.acquiredDay > 0 && !churned && (
                <circle cx={px(c.x)} cy={py(c.y)} r={r * 1.9} fill="none" stroke="#2b5f8a" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              )}
              <circle
                cx={px(c.x)}
                cy={py(c.y)}
                r={r * (0.8 + c.sizeFactor * 0.25)}
                fill={recurring ? fill : '#fbfaf6'}
                stroke={recurring ? 'none' : '#8d968f'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {/* routes */}
        {deployed.map((log) => {
          const color = crewColor(log.crewId);
          const pts: [number, number][] = [[0, 0], ...log.stops.map((s): [number, number] => [s.x, s.y]), [0, 0]];
          return (
            <g key={log.crewId}>
              {pts.slice(1).map((p, i) => {
                const prev = pts[i];
                const stop = log.stops[i];
                const dashed = i === pts.length - 2 || (stop && !stop.completed);
                return (
                  <line
                    key={i}
                    x1={px(prev[0])}
                    y1={py(prev[1])}
                    x2={px(p[0])}
                    y2={py(p[1])}
                    stroke={color}
                    strokeWidth={i === pts.length - 2 ? 1.2 : 2.4}
                    strokeOpacity={i === pts.length - 2 ? 0.55 : 0.95}
                    strokeDasharray={dashed ? '5 4' : undefined}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          );
        })}
        {deployed.map((log) =>
          log.stops.map((s, i) => {
            const color = crewColor(log.crewId);
            const isActive = active?.crewId === log.crewId && active.index === i;
            return (
              <g
                key={`${log.crewId}-${s.jobId}-${i}`}
                tabIndex={0}
                role="button"
                aria-label={`${crewName(log.crewId)} stop ${i + 1}: ${jobTypeName(s.jobTypeId)}${s.completed ? '' : ', not finished'}`}
                className="cursor-pointer outline-none"
                onMouseEnter={() => setActive({ crewId: log.crewId, index: i, stop: s })}
                onMouseLeave={() => setActive((a) => (a && a.crewId === log.crewId && a.index === i ? null : a))}
                onFocus={() => setActive({ crewId: log.crewId, index: i, stop: s })}
                onClick={(e) => {
                  e.stopPropagation();
                  setActive({ crewId: log.crewId, index: i, stop: s });
                }}
              >
                <circle
                  cx={px(s.x)}
                  cy={py(s.y)}
                  r={r * (isActive ? 2.5 : 2.1)}
                  fill={s.completed ? color : '#fff'}
                  stroke={color}
                  strokeWidth={s.completed ? 1 : 2}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={s.completed ? undefined : '3 2'}
                />
                <text
                  x={px(s.x)}
                  y={py(s.y)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={r * 2.1}
                  fontWeight={600}
                  fill={s.completed ? '#fff' : color}
                  style={{ pointerEvents: 'none' }}
                >
                  {i + 1}
                </text>
              </g>
            );
          }),
        )}

        {clock && <CrewMarkers clock={clock} logs={deployed} crewColor={crewColor} px={px} py={py} r={r} />}

        {/* depot */}
        <rect x={px(0) - r * 2} y={py(0) - r * 2} width={r * 4} height={r * 4} fill="#1d2420" />
        <text x={px(0) + r * 3} y={py(0) + r * 1} fontSize={r * 2.4} fontWeight={600} fill="#1d2420">
          Depot
        </text>
      </svg>

      {/* Stop details */}
      <div
        className={cx(
          'pointer-events-none absolute left-2 top-2 max-w-[min(20rem,calc(100%-1rem))] rounded-md border border-line bg-surface/95 px-3 py-2 text-[12.5px] shadow-sm transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
        aria-live="polite"
      >
        {active && (
          <>
            <div className="flex items-center gap-1.5 font-medium text-ink">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: crewColor(active.crewId) }} />
              {crewName(active.crewId)}, stop {active.index + 1}
            </div>
            <div className="mt-0.5 text-muted">{jobTypeName(active.stop.jobTypeId)}</div>
            <div className="num mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <span className="text-muted">Revenue</span>
              <span className="text-ink">{active.stop.completed ? money(active.stop.revenue) : 'Not finished today'}</span>
              <span className="text-muted">Arrive</span>
              <span className="text-ink">{hours(active.stop.arrive)} into shift</span>
              <span className="text-muted">Depart</span>
              <span className="text-ink">{hours(active.stop.depart)} into shift</span>
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted" aria-label="Map legend">
        {planIds.map((id, i) => (
          <li key={id} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PLAN_FILLS[i % PLAN_FILLS.length] }} />
            {planName(id)}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-faint" />
          One-off only
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border border-accent" />
          Acquired during run
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#51675b] opacity-25" />
          Churned
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-5 border-t-2 border-dashed border-muted" />
          Unfinished stop
        </li>
        {clock && (
          <>
            <li className="flex items-center gap-1.5" title="Crew moving between stops">
              <svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="5" fill="#555" stroke="#fff" strokeWidth="1.5" /></svg>
              Travelling
            </li>
            <li className="flex items-center gap-1.5" title="Crew on site">
              <svg width="12" height="12" aria-hidden><rect x="1" y="1" width="10" height="10" fill="#555" stroke="#fff" strokeWidth="1.5" /></svg>
              Working
            </li>
            <li className="flex items-center gap-1.5" title="Crew heading back to the depot">
              <svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="4.5" fill="#fff" stroke="#555" strokeWidth="2" strokeDasharray="3 2" /></svg>
              Returning
            </li>
            <li className="flex items-center gap-1.5" title="Crew back at the depot">
              <svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="2.5" fill="#8d968f" /></svg>
              Idle
            </li>
          </>
        )}
        <li className="num">2-mile rings, {num(customers.length)} customers</li>
      </ul>
    </div>
  );
}
);

/** Crew markers moved by direct attribute writes on every clock tick: no React re-render per frame. */
function CrewMarkers({
  clock,
  logs,
  crewColor,
  px,
  py,
  r,
}: {
  clock: PlaybackClock;
  logs: CrewDayLog[];
  crewColor: (id: Id) => string;
  px: (x: number) => number;
  py: (y: number) => number;
  r: number;
}) {
  const refs = useRef<Record<string, SVGGElement | null>>({});
  const pxRef = useRef(px);
  const pyRef = useRef(py);
  pxRef.current = px;
  pyRef.current = py;

  useEffect(() => {
    const update = (t: number) => {
      for (const log of logs) {
        const g = refs.current[log.crewId];
        if (!g) continue;
        const p = crewStateAt(log, t);
        g.setAttribute('transform', `translate(${pxRef.current(p.x)} ${pyRef.current(p.y)})`);
        if (g.dataset.state !== p.state) {
          g.dataset.state = p.state;
          for (const shape of Array.from(g.children) as SVGElement[]) {
            shape.setAttribute('display', (shape.dataset.for as CrewPlayState).split(',').includes(p.state) ? 'inline' : 'none');
          }
        }
      }
    };
    update(clock.t);
    return clock.subscribe(update);
  }, [clock, logs]);

  const k = r * 2.4;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {logs.map((log) => {
        const c = crewColor(log.crewId);
        return (
          <g key={log.crewId} ref={(el) => { refs.current[log.crewId] = el; }}>
            <circle data-for="traveling" r={k} fill={c} stroke="#fff" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
            <rect data-for="working" x={-k} y={-k} width={k * 2} height={k * 2} fill={c} stroke="#fff" strokeWidth={1.6} vectorEffect="non-scaling-stroke" display="none" />
            <circle data-for="returning" r={k * 0.9} fill="#fff" stroke={c} strokeWidth={2.2} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" display="none" />
            <circle data-for="idle,off" r={k * 0.45} fill="#8d968f" display="none" />
          </g>
        );
      })}
    </g>
  );
}
