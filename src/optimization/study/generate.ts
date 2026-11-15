/**
 * Candidate generation for the study (optimization-design §5): the optimizer-v1 single actions
 * plus the digital-twin families (replacement, floating, staffing moves, wages, customer drops,
 * programmed rules). Generated from company data and baseline facts only; nothing is hard-coded
 * to an industry.
 */
import { runSimulation } from '../../simulation';
import type { CrewStats, CustomerStats, DecisionRule, Id, PlannedAction, Scenario } from '../../simulation';
import { crewMembers, generateCandidates, type CandidateDef } from '../candidates';
import { fmtUsd } from '../explain';
import { mean } from '../evaluate';
import type { OptimizerCatalog } from '../types';
import type { RunDigest } from '../study-types';
import { scenarioFor } from './backend';
import type { StratDef, StudyContext } from './context';

/** Assets older than this share of their useful life are replacement candidates. */
export const REPLACE_AGE_SHARE = 0.6;
/** Wage multipliers tried when pay affects quits. */
export const WAGE_FACTORS = [1.05, 1.1];
/** Share of customers (worst by contribution per on-site hour) in the second drop candidate. */
export const DROP_WORST_SHARE = 0.05;
/** Months whose lead seasonality is below this are "slow" for the marketing rule. */
export const SLOW_SEASON = 0.8;

/** Facts from the baseline used by generation, refinement and validation. */
export interface BaselineFacts {
  jobsCompleted: Record<Id, number>;
  demand: Record<Id, number>;
  /** From one full-detail baseline run on the first seed. */
  crewStats: Record<Id, CrewStats>;
  customerStats: Record<Id, CustomerStats>;
  /** Calendar months of the full-detail run: first day and cancelled jobs. */
  months: { startDay: number; jobsCancelled: number }[];
}

/** Baseline facts: job-type means over the baseline digests, crews and customers from one full-detail run (1 budget unit). */
export function baselineFacts(ctx: StudyContext, base: RunDigest[]): BaselineFacts {
  const jobsCompleted: Record<Id, number> = {};
  const demand: Record<Id, number> = {};
  for (const jt of ctx.company.jobTypes) {
    jobsCompleted[jt.id] = mean(base.map((r) => r.jobTypes[jt.id]?.jobsCompleted ?? 0));
    demand[jt.id] = mean(base.map((r) => (r.jobTypes[jt.id]?.jobsCompleted ?? 0) + (r.jobTypes[jt.id]?.jobsCancelled ?? 0)));
  }
  const full = runSimulation(scenarioFor(ctx.base, {}, ctx.seeds[0]), { detail: 'full' });
  ctx.budget.charge(1);
  ctx.simulationsRun += 1;
  return {
    jobsCompleted,
    demand,
    crewStats: full.crewStats,
    customerStats: full.customerStats ?? {},
    months: full.months.map((m) => ({ startDay: m.startDay, jobsCancelled: m.ops.jobsCancelled })),
  };
}

function fromV1(c: CandidateDef): StratDef {
  return {
    id: c.id,
    label: c.label,
    category: c.category,
    members: [{ candidateId: c.id, label: c.label, category: c.category, day: 0 }],
    conflictKeys: [c.conflictKey],
    actions: c.actions,
    rules: [],
  };
}

function single(id: Id, label: string, category: StratDef['category'], conflictKey: string, actions: PlannedAction[], rules: DecisionRule[] = []): StratDef {
  return { id, label, category, members: [{ candidateId: id, label, category, day: 0 }], conflictKeys: [conflictKey], actions, rules };
}

function stripId<T extends { id: Id }>(x: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = x;
  return rest;
}

export function generateStudyCandidates(scenario: Scenario, catalog: OptimizerCatalog, facts: BaselineFacts, maxMissedJobRate: number): StratDef[] {
  const co = scenario.company;
  const out: StratDef[] = generateCandidates(co, catalog, { jobsCompleted: facts.jobsCompleted, demand: facts.demand }).map(fromV1);
  const crewName = (id: Id) => co.crews.find((c) => c.id === id)?.name ?? id;

  // Fleet / equipment: replace old assets with the catalog item of the same kind.
  const truck = catalog.vehicleCatalog[0];
  for (const v of co.vehicles) {
    if (!truck || v.asset.financing.kind === 'lease') continue;
    if (!(v.asset.ageYears >= REPLACE_AGE_SHARE * v.asset.usefulLifeYears)) continue;
    for (const method of ['loan', 'lease'] as const) {
      out.push(
        single(
          `replace:${v.id}:${truck.id}:${method}`,
          `Replace ${v.name} with a ${truck.name.toLowerCase()} (${method === 'loan' ? 'bought with a loan' : 'leased'})`,
          'fleet',
          `asset:${v.id}`,
          [{ day: 0, action: { type: 'replace-asset', assetId: v.id, spec: stripId(truck), method } }],
        ),
      );
    }
  }
  for (const e of co.equipment) {
    if (e.asset.financing.kind === 'lease' || !(e.asset.ageYears >= REPLACE_AGE_SHARE * e.asset.usefulLifeYears)) continue;
    const item = catalog.equipmentCatalog.find((x) => x.equipmentTypeId === e.equipmentTypeId);
    if (!item) continue;
    for (const method of ['loan', 'lease'] as const) {
      out.push(
        single(
          `replace:${e.id}:${item.id}:${method}`,
          `Replace ${e.name} with a ${item.name.toLowerCase()} (${method === 'loan' ? 'bought with a loan' : 'leased'})`,
          'equipment',
          `asset:${e.id}`,
          [{ day: 0, action: { type: 'replace-asset', assetId: e.id, spec: stripId(item), method } }],
        ),
      );
    }
  }

  // Scheduling: floating idle workers.
  if (!co.policies.floatIdleWorkers) {
    out.push(
      single('policy:floatIdleWorkers:true', 'Let idle workers fill in on other crews', 'scheduling', 'policy:floatIdleWorkers', [
        { day: 0, action: { type: 'set-policy', patch: { floatIdleWorkers: true } } },
      ]),
    );
  }

  // Staffing: move one person from the idlest crew to the busiest one.
  const crews = co.crews.map((c) => {
    const s = facts.crewStats[c.id];
    const paid = s?.paidHours ?? 0;
    const busy = paid > 0 ? (s.onSiteHours + s.travelHours) / paid : 0;
    return { id: c.id, busy, members: crewMembers(co, c.id) };
  });
  const idlest = [...crews].filter((c) => c.members.length >= 2).sort((a, b) => a.busy - b.busy || (a.id < b.id ? -1 : 1))[0];
  const busiest = [...crews].sort((a, b) => b.busy - a.busy || (a.id < b.id ? -1 : 1))[0];
  if (idlest && busiest && idlest.id !== busiest.id) {
    const e = [...idlest.members].sort((a, b) => a.skill - b.skill || a.productivity - b.productivity)[0];
    out.push(
      single(`move:${e.id}:${busiest.id}`, `Move ${e.name} from ${crewName(idlest.id)} to ${crewName(busiest.id)}`, 'staffing', `crew:${busiest.id}:staff`, [
        { day: 0, action: { type: 'move-employee', employeeId: e.id, crewId: busiest.id } },
      ]),
    );
  }
  // Staffing: pay rises (only when pay affects quits).
  if ((co.workforce.wageQuitElasticity ?? 0) > 0) {
    for (const f of WAGE_FACTORS) {
      out.push(
        single(`wage:all:${f}`, `Raise all wages by ${Math.round((f - 1) * 100)}%`, 'staffing', 'wage:all', [
          { day: 0, action: { type: 'set-wage', employeeId: 'all', multiplier: f } },
        ]),
      );
    }
  }

  // Service mix: customers that lose money.
  const cs = Object.values(facts.customerStats).filter((c) => co.customers.some((x) => x.id === c.customerId));
  const negative = cs.filter((c) => c.contribution < 0).map((c) => c.customerId).sort();
  if (negative.length > 0) {
    out.push(
      single(`drop:negative:${negative.length}`, `Stop serving the ${negative.length} customers whose work loses money`, 'service-mix', 'customers:drop', [
        { day: 0, action: { type: 'drop-customers', customerIds: negative } },
      ]),
    );
  }
  const perHour = cs.filter((c) => c.onSiteHours > 0).sort((a, b) => a.contribution / a.onSiteHours - b.contribution / b.onSiteHours || (a.customerId < b.customerId ? -1 : 1));
  const nWorst = Math.floor(DROP_WORST_SHARE * co.customers.length);
  if (nWorst >= 1 && perHour.length >= nWorst) {
    const ids = perHour.slice(0, nWorst).map((c) => c.customerId).sort();
    if (ids.join() !== negative.join()) {
      out.push(
        single(`drop:worst:${nWorst}`, `Stop serving the ${nWorst} customers with the lowest contribution per on-site hour`, 'service-mix', 'customers:drop', [
          { day: 0, action: { type: 'drop-customers', customerIds: ids } },
        ]),
      );
    }
  }

  // Rules.
  if (truck && co.vehicles.length > 0) {
    const annualDep = (truck.purchasePrice - truck.salvageValue) / truck.usefulLifeYears;
    out.push(
      single(
        'rule:auto-replace',
        `Replace a truck when its upkeep over a year exceeds ${fmtUsd(annualDep)} (a new truck's yearly depreciation)`,
        'fleet',
        'rule:auto-replace',
        [],
        [
          {
            id: 'auto-replace',
            name: 'Replace a truck when upkeep is excessive',
            forEach: 'vehicle',
            when: [{ observable: 'asset-upkeep-365d', scope: { assetId: '$each' }, op: '>', value: annualDep }],
            then: [{ type: 'replace-asset', assetId: '$each', spec: stripId(truck), method: 'loan' }],
            cooldownDays: 365,
            maxFirings: 1,
          },
        ],
      ),
    );
  }
  const hire = catalog.hireTemplates[0];
  if (hire && busiest) {
    const sizes = co.crews.map((c) => crewMembers(co, c.id).length).filter((n) => n > 0);
    const crewWeek = co.policies.shiftHours * co.policies.workDaysPerWeek * (sizes.length > 0 ? mean(sizes) : 1);
    out.push(
      single(
        'rule:backlog-hire',
        `Hire into ${crewName(busiest.id)} when the backlog exceeds a crew-week and jobs are being missed`,
        'staffing',
        'rule:backlog-hire',
        [],
        [
          {
            id: 'backlog-hire',
            name: 'Hire when the backlog stays high',
            when: [
              { observable: 'backlog-hours', op: '>', value: crewWeek },
              { observable: 'missed-rate-28d', op: '>', value: maxMissedJobRate },
            ],
            then: [{ type: 'hire-employee', crewId: busiest.id, hire: { name: hire.name ?? hire.title, hourlyWage: hire.hourlyWage, skill: hire.skill, productivity: hire.productivity } }],
            cooldownDays: 60,
            maxFirings: 2,
          },
        ],
      ),
    );
  }
  const spend = co.market.marketingMonthlySpend;
  const season = co.market.leadSeasonality;
  if (spend > 0 && season.some((s) => s < SLOW_SEASON) && season.some((s) => s >= SLOW_SEASON)) {
    const rules: DecisionRule[] = [];
    for (let m = 0; m < 12; m++) {
      const slow = season[m] < SLOW_SEASON;
      const prevSlow = season[(m + 11) % 12] < SLOW_SEASON;
      if (slow === prevSlow) continue;
      rules.push({
        id: `slow-season-${m}`,
        name: slow ? 'Halve marketing in slow months' : 'Restore marketing after the slow months',
        when: [{ observable: 'month', op: '==', value: m }],
        then: [{ type: 'set-marketing-spend', monthlySpend: slow ? spend * 0.5 : spend }],
        cooldownDays: 32,
        maxFirings: 1000,
      });
    }
    // A run that starts inside a slow stretch halves spend from day 0.
    if (season[co.startMonth] < SLOW_SEASON) {
      rules.unshift({
        id: 'slow-season-start',
        name: 'Halve marketing in slow months',
        when: [{ observable: 'day', op: '==', value: 0 }],
        then: [{ type: 'set-marketing-spend', monthlySpend: spend * 0.5 }],
        cooldownDays: 0,
        maxFirings: 1,
      });
    }
    out.push(single('rule:slow-season-marketing', 'Halve marketing in slow months and restore it afterwards', 'marketing', 'rule:slow-season-marketing', [], rules));
  }
  return out;
}

/** Combines definitions into one strategy (members sorted by id so equal sets have equal ids). */
export function combine(defs: StratDef[]): StratDef {
  if (defs.length === 1) return defs[0];
  const sorted = [...defs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    id: 'plan:' + sorted.map((d) => d.id).join('+'),
    label: sorted.map((d) => d.label).join(' + '),
    category: sorted[0].category,
    members: sorted.flatMap((d) => d.members),
    conflictKeys: sorted.flatMap((d) => d.conflictKeys),
    actions: sorted.flatMap((d) => d.actions),
    rules: sorted.flatMap((d) => d.rules),
  };
}

/** True if two strategies share a conflict key (price:all conflicts with every price:*). */
export function defsConflict(a: StratDef, b: StratDef): boolean {
  for (const x of a.conflictKeys)
    for (const y of b.conflictKeys) {
      if (x === y) return true;
      if (x.startsWith('price:') && y.startsWith('price:') && (x === 'price:all' || y === 'price:all')) return true;
    }
  return a.members.some((m) => b.members.some((n) => n.candidateId === m.candidateId));
}
