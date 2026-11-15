import type { CrewDayLog, Id, SimEvent } from '@/simulation';
import { NOT_DEPLOYED_TEXT, crewDayView } from '@/services/derive';
import { hours, money, num, plural } from '@/services/format';
import { cx } from './ui';

interface Props {
  logs: CrewDayLog[];
  day: number;
  shiftHours: number;
  events: SimEvent[];
  crewColor: (id: Id) => string;
  crewName: (id: Id) => string;
  /** Crew's normal vehicle id (from the roster), used to explain a "no vehicle" day. */
  crewVehicleId: (id: Id) => Id | null;
  nameOf: (id: Id) => string;
  isNewCrew: (id: Id) => boolean;
}

function repairNote(events: SimEvent[], day: number, vehicleId: Id | null, nameOf: (id: Id) => string): string | null {
  if (!vehicleId) return null;
  for (const e of events) {
    if (e.type === 'vehicle-breakdown' && e.vehicleId === vehicleId && e.day <= day && day < e.day + e.downDays) {
      return `${nameOf(vehicleId)} broke down on day ${num(e.day + 1)} and is in repair for ${plural(e.downDays, 'day')} (${money(e.cost)}).`;
    }
  }
  return null;
}

export function CrewCards({ logs, day, shiftHours, events, crewColor, crewName, crewVehicleId, nameOf, isNewCrew }: Props) {
  if (logs.length === 0) {
    return <p className="rounded-md border border-dashed border-line-strong p-4 text-[13px] text-muted">This company has no crews yet. Add one in the Business view.</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2" aria-label="Crews for the selected day">
      {logs.map((log) => {
        const v = crewDayView(log, shiftHours);
        const color = crewColor(log.crewId);
        const present = log.memberIds;
        const absent = log.absentIds;
        const scale = Math.max(shiftHours, log.endClock, 1) * 1.0;
        const pct = (h: number) => `${Math.min(100, (h / scale) * 100)}%`;
        const note =
          !log.deployed && log.notDeployedReason === 'vehicle'
            ? repairNote(events, day, crewVehicleId(log.crewId), nameOf)
            : null;
        const reason = log.notDeployedReason;
        const problem = !log.deployed && (reason === 'vehicle' || reason === 'understaffed');
        return (
          <li
            key={log.crewId}
            className={cx('rounded-lg border bg-surface p-3', problem ? 'border-[#e6c9c5]' : 'border-line')}
            data-crew={log.crewId}
            data-deployed={log.deployed}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />
                <h3 className="truncate text-[14px] font-semibold text-ink">{crewName(log.crewId)}</h3>
                {isNewCrew(log.crewId) && <span className="rounded bg-accent-soft px-1.5 text-[11px] font-medium text-accent">Draft</span>}
              </div>
              <span
                className={cx(
                  'shrink-0 rounded px-1.5 py-px text-[11.5px] font-medium',
                  log.deployed ? 'bg-good-soft text-good' : problem ? 'bg-bad-soft text-bad' : 'bg-[#ece9e0] text-muted',
                )}
              >
                {log.deployed ? 'Deployed' : 'Not deployed'}
              </span>
            </div>

            {!log.deployed && (
              <div className={cx('mt-2 rounded-md px-2.5 py-2 text-[12.5px] leading-snug', problem ? 'bg-bad-soft text-bad' : 'bg-sunken text-muted')}>
                <div className="font-medium">{reason ? NOT_DEPLOYED_TEXT[reason] : 'Not deployed'}</div>
                {note && <div className="mt-0.5">{note}</div>}
                {reason === 'understaffed' && absent.length > 0 && <div className="mt-0.5">Absent: {absent.map(nameOf).join(', ')}.</div>}
              </div>
            )}

            {log.deployed && (
              <>
                <div className="mt-2 text-[12.5px] leading-snug text-muted">
                  <span className="text-ink">{present.map(nameOf).join(', ') || 'Nobody'}</span>
                  {absent.length > 0 && <span className="text-bad"> · Absent: {absent.map(nameOf).join(', ')}</span>}
                </div>
                <div className="mt-0.5 text-[12.5px] text-muted">
                  {log.vehicleId ? nameOf(log.vehicleId) : 'No vehicle'} · {plural(log.equipmentIds.length, 'tool')}
                </div>

                <div className="mt-3">
                  <div className="relative h-3 overflow-hidden rounded-sm bg-[#efede5]" role="img" aria-label={`Hours: on site ${hours(v.onSiteHours)}, travel ${hours(v.travelHours)}, idle ${hours(v.idleHours)}`}>
                    <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: pct(v.onSiteHours) }} />
                    <div className="absolute inset-y-0 bg-[#d3a95a]" style={{ left: pct(v.onSiteHours), width: pct(v.travelHours) }} />
                    {v.overtimeHours > 0 && (
                      <div className="absolute inset-y-0 bg-bad/70" style={{ left: pct(shiftHours), width: pct(v.overtimeHours) }} />
                    )}
                    <div className="absolute inset-y-0 w-px bg-ink" style={{ left: pct(shiftHours) }} title="End of scheduled shift" />
                  </div>
                  <div className="num mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
                    <span>
                      <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent align-baseline" />
                      On site {hours(v.onSiteHours)}
                    </span>
                    <span>
                      <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#d3a95a] align-baseline" />
                      Travel {hours(v.travelHours)}
                    </span>
                    <span>
                      <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#efede5] align-baseline ring-1 ring-line-strong" />
                      Idle {hours(v.idleHours)}
                    </span>
                    {v.overtimeHours > 0 && <span className="font-medium text-bad">Overtime {hours(v.overtimeHours)}</span>}
                  </div>
                </div>

                <div className="num mt-2 flex items-baseline justify-between border-t border-line pt-2 text-[12.5px]">
                  <span className="text-muted">
                    {plural(log.stops.length, 'stop')}
                    {v.stopsPartial > 0 && <span className="text-warn"> ({v.stopsPartial} unfinished)</span>}
                    {log.stops.length > 0 && <span> · {num(log.miles, 1)} mi</span>}
                  </span>
                  <span className="text-[14px] font-semibold text-ink">{money(v.revenue)}</span>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
