import { useCallback, useMemo, useState } from "react";
import { selectHasDraft, useStore } from "@/services/store";
import { timelineEvents } from "@/services/derive";
import { dayLabel, money, num, signed, signedMoney } from "@/services/format";
import { Card, Segmented, StatTile } from "@/components/ui";
import { CompanyDataLabel } from "@/components/CompanyDataLabel";
import { useProjections } from "@/components/hooks";
import { DayScrubber } from "@/components/DayScrubber";
import { CREW_COLORS, ServiceMap } from "@/components/ServiceMap";
import { CrewCards } from "@/components/CrewCards";
import { OpsTimeline } from "@/components/OpsTimeline";
import {
  DayFeed,
  PlaybackControls,
  createPlaybackClock,
} from "@/components/PlaybackControls";

const Stat = StatTile;

export function OperationsPage() {
  const baselineResult = useStore((s) => s.baselineResult);
  const draftResult = useStore((s) => s.draftResult);
  const hasDraft = useStore(selectHasDraft);
  const day = useStore((s) => s.selectedDay);
  const setDay = useStore((s) => s.setSelectedDay);
  const company = useStore((s) => s.company);
  const [which, setWhich] = useState<"baseline" | "draft">("draft");
  const { base, full, nameOf } = useProjections();

  const showDraft = hasDraft && which === "draft";
  const result = showDraft ? draftResult : baselineResult;
  const crewOrder = useMemo(() => full.crews.map((c) => c.id), [full.crews]);
  const crewColor = useCallback(
    (id: string) =>
      CREW_COLORS[Math.max(0, crewOrder.indexOf(id)) % CREW_COLORS.length],
    [crewOrder],
  );
  const crewName = useCallback(
    (id: string) => result.crewStats[id]?.name ?? nameOf(id),
    [result, nameOf],
  );
  const jobTypeName = useCallback(
    (id: string) => company.jobTypes.find((j) => j.id === id)?.name ?? id,
    [company.jobTypes],
  );

  const events = useMemo(
    () => timelineEvents(result, nameOf),
    [result, nameOf],
  );

  const d = Math.min(day, result.days.length - 1);
  const rec = result.days[d];
  const logs = result.crewLogs?.[d] ?? [];
  const baseRec =
    baselineResult.days[Math.min(d, baselineResult.days.length - 1)];
  const planIds = useMemo(
    () =>
      company.jobTypes.filter((j) => j.kind === "recurring").map((j) => j.id),
    [company.jobTypes],
  );
  const shift = (showDraft ? full.policies : base.policies).shiftHours;
  const crewVehicle = (id: string) =>
    (showDraft ? full : base).crews.find((c) => c.id === id)?.vehicleId ?? null;
  const baselineCrewIds = new Set(base.crews.map((c) => c.id));

  const clock = useMemo(createPlaybackClock, []);
  const compare = showDraft;
  return (
    <div className="space-y-4">
      <CompanyDataLabel />
      {hasDraft && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-muted">Showing</span>
          <Segmented
            ariaLabel="Scenario shown"
            size="sm"
            value={which}
            onChange={setWhich}
            options={[
              { value: "baseline", label: "Baseline" },
              { value: "draft", label: "Draft" },
            ]}
          />
          {showDraft && (
            <span className="text-[12.5px] text-muted">
              Differences against the baseline for the same day are shown in the
              day strip.
            </span>
          )}
        </div>
      )}

      <Card bodyClassName="p-4">
        <DayScrubber
          days={result.days}
          startMonth={company.startMonth}
          day={d}
          onDay={setDay}
        />
      </Card>

      <div
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
        aria-label={`Summary for ${dayLabel(company.startMonth, d)}`}
      >
        <Stat
          label="Jobs completed today"
          value={num(rec.ops.jobsCompleted)}
          delta={rec.ops.jobsCompleted - baseRec.ops.jobsCompleted}
          deltaText={
            compare
              ? signed(rec.ops.jobsCompleted - baseRec.ops.jobsCompleted) +
                " vs baseline"
              : undefined
          }
          better="higher"
        />
        <Stat
          label="Backlog (jobs)"
          value={num(rec.backlogJobs)}
          delta={rec.backlogJobs - baseRec.backlogJobs}
          deltaText={
            compare ? signed(rec.backlogJobs - baseRec.backlogJobs) : undefined
          }
          better="lower"
        />
        <Stat
          label="Backlog (labor hours)"
          value={num(rec.backlogLaborHours, 1)}
          delta={rec.backlogLaborHours - baseRec.backlogLaborHours}
          deltaText={
            compare
              ? signed(rec.backlogLaborHours - baseRec.backlogLaborHours, 1) +
                " h"
              : undefined
          }
          better="lower"
        />
        <Stat
          label="Cancelled today"
          value={num(rec.ops.jobsCancelled)}
          delta={rec.ops.jobsCancelled - baseRec.ops.jobsCancelled}
          deltaText={
            compare
              ? signed(rec.ops.jobsCancelled - baseRec.ops.jobsCancelled)
              : undefined
          }
          better="lower"
        />
        <Stat
          label="Revenue today"
          value={money(rec.income.revenue)}
          delta={rec.income.revenue - baseRec.income.revenue}
          deltaText={
            compare
              ? signedMoney(rec.income.revenue - baseRec.income.revenue)
              : undefined
          }
          better="higher"
        />
        <Stat
          label="Cash at end of day"
          value={money(rec.balance.cash)}
          delta={rec.balance.cash - baseRec.balance.cash}
          deltaText={
            compare
              ? signedMoney(rec.balance.cash - baseRec.balance.cash)
              : undefined
          }
          better="higher"
        />
      </div>


      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card
          title="Service area"
          subtitle="Routes for the selected day. Use the clock to watch crews move; select a stop for its details."
        >
          <div className="mb-3 border-b border-line pb-3">
            <PlaybackControls
              clock={clock}
              logs={logs}
              shiftHours={shift}
              resetKey={`${which}:${d}:${result.scenarioId}`}
              crewColor={crewColor}
              crewName={crewName}
            />
          </div>
          {result.customers ? (
            <ServiceMap
              customers={result.customers}
              logs={logs}
              day={d}
              crewColor={crewColor}
              crewName={crewName}
              jobTypeName={jobTypeName}
              planIds={planIds}
              clock={clock}
              planName={jobTypeName}
            />
          ) : (
            <p className="text-[13px] text-muted">
              No customer data in this result.
            </p>
          )}
        </Card>
        <div className="space-y-4">
          <Card
            title="Day feed"
            subtitle="What was recorded on this day, with the cash effect where there is one."
          >
            <DayFeed
              day={d}
              events={result.events}
              logs={logs}
              nameOf={nameOf}
            />
          </Card>
          <Card
            title="Crews"
            subtitle={
              rec.isWorkday
                ? "How each crew spent the day."
                : "Not a workday: crews are idle."
            }
          >
            <CrewCards
              logs={logs}
              day={d}
              shiftHours={shift}
              events={result.events}
              crewColor={crewColor}
              crewName={crewName}
              crewVehicleId={crewVehicle}
              nameOf={nameOf}
              isNewCrew={(id) => showDraft && !baselineCrewIds.has(id)}
            />
          </Card>
        </div>
      </div>

      <Card
        title="Timeline"
        subtitle="Weekly throughput and backlog over the horizon, with events. Click the chart or a marker to jump to that day."
      >
        <OpsTimeline
          result={result}
          startMonth={company.startMonth}
          selectedDay={d}
          events={events}
          onDay={setDay}
        />
      </Card>
    </div>
  );
}
