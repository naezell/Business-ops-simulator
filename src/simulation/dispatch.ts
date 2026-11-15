/** Dispatch (simulation-engine §6–7): absences, deployment, routing, work, hours, unserved attribution. */
import type { CrewDayLog, RouteStop, UnservedReason, WeatherState } from './types';
import { STREAM, hashString, rand01 } from './rng';
import { collectionDelay, isBadDebt } from './finance/formulas';
import { isDown } from './assets';
import { crewRate } from './workforce';
import type { CrewS, DayCtx, EmpS, EquipS, OrderS, SimState, VehicleS } from './state';

/** Tolerance on clock-limit comparisons (float noise only). */
export const CLOCK_EPS = 1e-9;
/** Minimum clock hours for a split work segment. */
export const MIN_SPLIT_HOURS = 0.5;

// ───────────── Pure formulas ─────────────

/** Road miles between two points: Euclidean distance × roadFactor. */
export function roadMiles(ax: number, ay: number, bx: number, by: number, roadFactor: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy) * roadFactor;
}

/** Travel time in hours: dist × roadFactor / avgSpeed. */
export function travelTime(ax: number, ay: number, bx: number, by: number, roadFactor: number, avgSpeedMph: number): number {
  return roadMiles(ax, ay, bx, by, roadFactor) / avgSpeedMph;
}

export type FitResult =
  | { kind: 'none' }
  | { kind: 'full'; tIn: number; tBack: number; hours: number }
  | { kind: 'split'; tIn: number; tBack: number; hours: number };

/** §7.1: does an order with remaining standard labor R fit a crew at `clock`? */
export function fitOrder(
  clock: number,
  limit: number,
  tIn: number,
  tBack: number,
  remainingLabor: number,
  rate: number,
  splittable: boolean,
): FitResult {
  if (!(rate > 0)) return { kind: 'none' };
  const D = remainingLabor / rate;
  if (clock + tIn + D + tBack <= limit + CLOCK_EPS) return { kind: 'full', tIn, tBack, hours: D };
  if (splittable) {
    const A = limit - clock - tIn - tBack;
    if (A >= MIN_SPLIT_HOURS - CLOCK_EPS) return { kind: 'split', tIn, tBack, hours: A };
  }
  return { kind: 'none' };
}

// ───────────── Daily dispatch ─────────────

type CrewStatus = 'vehicle' | 'understaffed' | 'fielded';

interface CrewRun {
  crew: CrewS;
  order: number;
  present: EmpS[];
  absent: EmpS[];
  status: CrewStatus;
  vehicle: VehicleS | null;
  deployed: EmpS[];
  overflow: EmpS[];
  kit: EquipS[];
  kitTypes: Set<string>;
  rate: number;
  maxSkill: number;
  n: number;
  /** eligibility per job type index, ignoring weather */
  elig: boolean[];
  /** Orders this crew may work today, in priority order. */
  cands: OrderS[];
  clock: number;
  x: number;
  y: number;
  closed: boolean;
  took: boolean;
  onSiteClock: number;
  travelClock: number;
  miles: number;
  endClock: number;
  closeClock: number;
  closeX: number;
  closeY: number;
  sector: number;
  stops: RouteStop[];
  equipGallons: number;
  revenue: number;
  jobsCompleted: number;
}

export interface DispatchResult {
  logs: CrewDayLog[] | null;
}

/** Steps 6–7 of the daily loop (workdays only). */
export function dispatchDay(st: SimState, ctx: DayCtx, weather: WeatherState, full: boolean): DispatchResult {
  const day = ctx.day;
  const co = st.company;
  const pol = co.policies;
  const wf = co.workforce;
  const costs = co.costs;
  const L = pol.shiftHours + pol.maxOvertimeHoursPerDay;
  const rainout = weather === 'rainout';
  const partial = weather === 'partial';
  const cutoff = co.weather.partialDayFraction * pol.shiftHours;
  const rf = costs.roadFactor;
  const speed = costs.avgSpeedMph;
  const ops = ctx.ops;
  const inc = ctx.inc;

  // 1. Absences: one draw per active employee per workday.
  for (const e of st.employees) {
    if (!e.active) continue;
    e.absent = rand01(st.seed, STREAM.ABSENCE, e.key, day, 0) < wf.absenceRate;
    if (e.absent) ops.absentShifts += 1;
  }

  // 2–5. Deployment.
  const activeCrews = st.crews.filter((c) => c.active);
  const assignedVehicles = new Set<string>();
  for (const c of activeCrews) if (c.vehicleId !== null) assignedVehicles.add(c.vehicleId);
  const usedV = new Set<VehicleS>();
  const usedE = new Set<EquipS>();
  const runs: CrewRun[] = [];
  for (let ci = 0; ci < activeCrews.length; ci++) {
    const crew = activeCrews[ci];
    const present: EmpS[] = [];
    const absent: EmpS[] = [];
    for (const e of st.employees) {
      if (!e.active || e.crewId !== crew.id) continue;
      (e.absent ? absent : present).push(e);
    }
    const run: CrewRun = {
      crew,
      order: ci,
      present,
      absent,
      status: 'vehicle',
      vehicle: null,
      deployed: [],
      overflow: [],
      kit: [],
      kitTypes: new Set(),
      rate: 0,
      maxSkill: 0,
      n: 0,
      elig: [],
      cands: [],
      clock: 0,
      x: 0,
      y: 0,
      closed: false,
      took: false,
      onSiteClock: 0,
      travelClock: 0,
      miles: 0,
      endClock: 0,
      closeClock: 0,
      closeX: 0,
      closeY: 0,
      sector: 0,
      stops: [],
      equipGallons: 0,
      revenue: 0,
      jobsCompleted: 0,
    };
    runs.push(run);
    // Vehicle.
    let v: VehicleS | null = null;
    if (crew.vehicleId !== null) {
      const own = st.vehicles.find((x) => x.id === crew.vehicleId);
      if (own && !isDown(own.a, day) && !usedV.has(own)) v = own;
    }
    if (!v) {
      for (const x of st.vehicles) {
        if (assignedVehicles.has(x.id) || usedV.has(x) || isDown(x.a, day)) continue;
        v = x;
        break;
      }
    }
    if (!v) {
      run.status = 'vehicle';
      continue;
    }
    // Members.
    const sorted = present.slice().sort((a, b) => b.skill - a.skill); // stable: ties keep config order
    const cap = Math.max(0, Math.floor(v.seats));
    run.deployed = sorted.slice(0, cap);
    run.overflow = sorted.slice(cap);
    if (run.deployed.length === 0) {
      run.status = 'understaffed';
      run.deployed = [];
      run.overflow = [];
      continue;
    }
    run.status = 'fielded';
    run.vehicle = v;
    usedV.add(v);
    // Kit.
    const ownedTypes: string[] = [];
    for (const it of st.equipment) {
      if (it.crewId !== crew.id) continue;
      if (!ownedTypes.includes(it.typeId)) ownedTypes.push(it.typeId);
      if (!isDown(it.a, day) && !usedE.has(it)) {
        run.kit.push(it);
        run.kitTypes.add(it.typeId);
      }
    }
    for (const t of ownedTypes) {
      if (run.kitTypes.has(t)) continue;
      for (const it of st.equipment) {
        if (it.crewId !== null || it.typeId !== t || usedE.has(it) || isDown(it.a, day)) continue;
        run.kit.push(it);
        run.kitTypes.add(t);
        break;
      }
    }
    for (const it of run.kit) usedE.add(it);
    run.n = run.deployed.length;
    run.rate = crewRate(
      run.deployed.map((e) => ({ productivity: e.productivity, tenureDays: day - e.hireDay })),
      wf.rampDays,
      wf.rampStartProductivity,
      wf.crewSizeCoordinationLoss,
    );
    for (const e of run.deployed) if (e.skill > run.maxSkill) run.maxSkill = e.skill;
    run.elig = st.jobTypes.map((jt) => {
      const d = jt.def;
      if (run.rate <= 0) return false;
      if (run.n < d.minCrewSize) return false;
      if (run.maxSkill < d.minSkill) return false;
      for (const t of d.requiredEquipmentTypes) if (!run.kitTypes.has(t)) return false;
      return true;
    });
  }
  const fielded = runs.filter((r) => r.status === 'fielded');

  // Zoned sectors.
  if (pol.routing === 'zoned' && fielded.length > 0) {
    const K = fielded.length;
    fielded.forEach((r, i) => (r.sector = i));
    const pool = st.open.slice().map((o) => ({ o, ang: Math.atan2(o.y, o.x) }));
    pool.sort((a, b) => a.ang - b.ang); // stable: ties keep priority order
    let T = 0;
    for (const p of pool) T += p.o.remaining;
    let cum = 0;
    for (const p of pool) {
      const R = p.o.remaining;
      p.o.sector = T > 0 ? Math.min(K - 1, Math.floor(((cum + R / 2) * K) / T)) : 0;
      cum += R;
    }
  }

  // Routing loop. `evalTIn` returns the inbound time if the order fits this crew now
  // (fully or as a split, §7.1–7.2), else −1. No allocation in the hot path.
  const stopOH = costs.stopOverheadHours;
  // Per-crew candidate lists (eligible, not weather-blocked), in priority order.
  for (const r of fielded) r.cands = st.open.filter((o) => r.elig[o.jt.idx] && !(rainout && o.jt.def.weatherSensitive));
  const evalTIn = (r: CrewRun, o: OrderS): number => {
    if (o.status !== 'open') return -1;
    const d = o.jt.def;
    let tBack = o.tBack;
    if (tBack < 0) tBack = o.tBack = travelTime(o.x, o.y, 0, 0, rf, speed);
    const D = o.remaining / r.rate;
    // Cheap lower bound (tIn ≥ stop overhead) before computing the inbound leg.
    if (r.clock + stopOH + D + tBack > L + CLOCK_EPS && (!d.splittable || L - r.clock - stopOH - tBack < MIN_SPLIT_HOURS - CLOCK_EPS))
      return -1;
    const tIn = travelTime(r.x, r.y, o.x, o.y, rf, speed) + stopOH;
    if (d.weatherSensitive && partial && r.clock + tIn > cutoff + CLOCK_EPS) return -1;
    if (r.clock + tIn + D + tBack <= L + CLOCK_EPS) return tIn;
    if (d.splittable && L - r.clock - tIn - tBack >= MIN_SPLIT_HOURS - CLOCK_EPS) return tIn;
    return -1;
  };
  const fitFor = (r: CrewRun, o: OrderS): FitResult => {
    const tIn = travelTime(r.x, r.y, o.x, o.y, rf, speed) + stopOH;
    return fitOrder(r.clock, L, tIn, o.tBack, o.remaining, r.rate, o.jt.def.splittable);
  };
  /**
   * Nearest fitting order (urgent ones first); sector < 0 = whole pool. Orders farther than the
   * current best (by squared straight-line distance, which orders tIn identically) are skipped
   * before the fit test since they cannot be selected.
   */
  const nearestOf = (r: CrewRun, sector: number): OrderS | null => {
    let best: OrderS | null = null;
    let bestD2 = Infinity;
    let bestU: OrderS | null = null;
    let bestUD2 = Infinity;
    const open = r.cands;
    for (let i = 0; i < open.length; i++) {
      const o = open[i];
      if (sector >= 0 && o.sector !== sector) continue;
      const dx = o.x - r.x;
      const dy = o.y - r.y;
      const d2 = rf > 0 ? dx * dx + dy * dy : 0; // roadFactor 0: every tIn is equal
      const urgent = o.cancelDay - day <= 1;
      if (d2 >= bestD2 && (!urgent || d2 >= bestUD2)) continue;
      if (evalTIn(r, o) < 0) continue;
      if (d2 < bestD2) {
        best = o;
        bestD2 = d2;
      }
      if (urgent && d2 < bestUD2) {
        bestU = o;
        bestUD2 = d2;
      }
    }
    return bestU ?? best;
  };
  const choose = (r: CrewRun): OrderS | null => {
    if (pol.routing === 'fifo') {
      for (const o of r.cands) if (evalTIn(r, o) >= 0) return o;
      return null;
    }
    if (pol.routing === 'zoned') return nearestOf(r, r.sector) ?? nearestOf(r, -1);
    return nearestOf(r, -1);
  };
  const closeCrew = (r: CrewRun) => {
    r.closed = true;
    r.closeClock = r.clock;
    r.closeX = r.x;
    r.closeY = r.y;
    if (!r.took) {
      r.endClock = 0;
      return;
    }
    const back = roadMiles(r.x, r.y, 0, 0, rf);
    const tBack = back / speed;
    r.miles += back;
    r.travelClock += tBack;
    r.clock += tBack;
    r.endClock = r.clock;
    r.x = 0;
    r.y = 0;
  };
  const burden = wf.payrollBurdenRate;
  const fuelPrice = costs.fuelPricePerGallon;
  for (;;) {
    let r: CrewRun | null = null;
    for (const c of fielded) if (!c.closed && (r === null || c.clock < r.clock)) r = c;
    if (r === null) break;
    const o = choose(r);
    if (!o) {
      closeCrew(r);
      continue;
    }
    const f = fitFor(r, o);
    if (f.kind === 'none') throw new Error('internal: selected order does not fit');
    const d = o.jt.def;
    const milesIn = roadMiles(r.x, r.y, o.x, o.y, rf);
    const arrive = r.clock + milesIn / speed;
    r.took = true;
    r.miles += milesIn;
    r.travelClock += f.tIn;
    r.onSiteClock += f.hours;
    r.clock += f.tIn + f.hours;
    r.x = o.x;
    r.y = o.y;
    if (!o.started) {
      o.started = true;
      inc.materials += o.materials;
      o.jt.stats.materials += o.materials;
    }
    const gal = f.hours * d.equipmentFuelGalPerHour;
    r.equipGallons += gal;
    for (const it of r.kit) if (d.requiredEquipmentTypes.includes(it.typeId)) it.hoursToday += f.hours;
    let wageSum = 0;
    for (const e of r.deployed) wageSum += e.wage;
    const js = o.jt.stats;
    js.onSiteHours += r.n * f.hours;
    js.travelHours += r.n * f.tIn;
    js.laborCost += wageSum * (f.hours + f.tIn) * (1 + burden);
    const vMpg = (r.vehicle as VehicleS).mpg;
    js.fuel += (gal + (vMpg > 0 ? milesIn / vMpg : 0)) * fuelPrice;
    let completed = false;
    if (f.kind === 'full') {
      o.remaining = 0;
      o.status = 'completed';
      completed = true;
      completeOrder(st, ctx, o);
      r.revenue += o.price;
      r.jobsCompleted += 1;
    } else {
      o.remaining -= f.hours * r.rate;
    }
    if (full) {
      r.stops.push({
        jobId: o.id,
        customerId: o.cust.id,
        jobTypeId: d.id,
        x: o.x,
        y: o.y,
        arrive,
        depart: r.clock,
        completed,
        revenue: completed ? o.price : 0,
      });
    }
    if (f.kind === 'split') closeCrew(r);
  }

  // Internal debug assertions (simulation-engine §12.5).
  for (const r of fielded) {
    if (r.endClock > L + 1e-6) throw new Error(`internal: crew ${r.crew.id} clock ${r.endClock} exceeds limit ${L}`);
  }

  // 7. Unserved attribution.
  attributeUnserved(st, ctx, runs, fielded, rainout, partial, cutoff);

  // Hours, wages, vehicle and equipment costs.
  const minPaid = pol.minPaidHoursPerShift;
  const idlePay = rainout ? pol.rainoutPaidHours : minPaid;
  const pay = (e: EmpS, paid: number, onSite: number, travel: number, cs: CrewS | null) => {
    e.weekHours += paid;
    inc.directLabor += e.wage * paid;
    ops.paidHours += paid;
    ops.onSiteHours += onSite;
    ops.travelHours += travel;
    ops.idleHours += paid - onSite - travel;
    if (cs) cs.stats.paidHours += paid;
  };
  for (const r of runs) {
    const cs = r.crew.stats;
    if (r.status === 'fielded' && r.took) {
      const worked = r.onSiteClock + r.travelClock;
      const paid = Math.max(worked, minPaid);
      for (const e of r.deployed) pay(e, paid, r.onSiteClock, r.travelClock, r.crew);
      for (const e of r.overflow) pay(e, minPaid, 0, 0, r.crew);
      ops.crewDaysDeployed += 1;
      cs.daysDeployed += 1;
      cs.onSiteHours += r.n * r.onSiteClock;
      cs.travelHours += r.n * r.travelClock;
      cs.jobsCompleted += r.jobsCompleted;
      cs.revenue += r.revenue;
      cs.milesDriven += r.miles;
      ops.milesDriven += r.miles;
      const v = r.vehicle as VehicleS;
      inc.fuel += ((v.mpg > 0 ? r.miles / v.mpg : 0) + r.equipGallons) * costs.fuelPricePerGallon;
      inc.maintenance += r.miles * v.maintPerMile;
    } else {
      for (const e of r.present) pay(e, idlePay, 0, 0, r.crew);
      if (r.status !== 'fielded') {
        ops.crewDaysNotDeployed += 1;
        cs.daysNotDeployed += 1;
      }
    }
  }
  // Equipment hours → maintenance.
  for (const it of st.equipment) {
    if (it.hoursToday > 0) {
      inc.maintenance += it.hoursToday * it.maintPerHour;
      it.hoursToday = 0;
    }
  }
  // Employees without a crew: paid the minimum shift (idle) when present.
  for (const e of st.employees) {
    if (!e.active || e.absent || e.crewId !== null) continue;
    pay(e, minPaid, 0, 0, null);
  }

  if (!full) return { logs: null };
  const logs: CrewDayLog[] = runs.map((r) => {
    const deployed = r.status === 'fielded' && r.took;
    let reason: CrewDayLog['notDeployedReason'];
    if (!deployed) {
      reason = r.status === 'vehicle' ? 'vehicle' : r.status === 'understaffed' ? 'understaffed' : rainout ? 'weather' : 'no-work';
    }
    const log: CrewDayLog = {
      crewId: r.crew.id,
      deployed,
      vehicleId: r.status === 'fielded' ? (r.vehicle as VehicleS).id : null,
      memberIds: (r.status === 'fielded' ? r.deployed : r.present).map((e) => e.id),
      absentIds: r.absent.map((e) => e.id),
      equipmentIds: r.status === 'fielded' ? r.kit.map((e) => e.id) : [],
      stops: r.stops,
      endClock: r.endClock,
      miles: r.miles,
      onSiteHours: deployed ? r.onSiteClock : 0,
      travelHours: deployed ? r.travelClock : 0,
    };
    if (reason) log.notDeployedReason = reason;
    return log;
  });
  return { logs };
}

/** Revenue, lateness, invoice for a completed order. */
function completeOrder(st: SimState, ctx: DayCtx, o: OrderS): void {
  const day = ctx.day;
  const d = o.jt.def;
  ctx.inc.revenue += o.price;
  ctx.ops.jobsCompleted += 1;
  o.jt.stats.jobsCompleted += 1;
  o.jt.stats.revenue += o.price;
  if (day > o.createdDay + d.lateAfterDays) {
    ctx.ops.jobsLate += 1;
    o.cust.failure += 0.5;
  }
  const ar = st.company.finance.ar;
  const key = hashString(o.id);
  const delay = collectionDelay(ar.collectionDaysMean, ar.collectionDaysJitter, rand01(st.seed, STREAM.COLLECTION, key, day, 0));
  const bad = ar.badDebtRate > 0 && isBadDebt(ar.badDebtRate, rand01(st.seed, STREAM.BAD_DEBT, key, day, 0));
  const cd = day + delay;
  let list = st.invoices.get(cd);
  if (!list) {
    list = [];
    st.invoices.set(cd, list);
  }
  list.push({ amount: o.price, bad });
}

function attributeUnserved(
  st: SimState,
  ctx: DayCtx,
  runs: CrewRun[],
  fielded: CrewRun[],
  rainout: boolean,
  partial: boolean,
  cutoff: number,
): void {
  const u = ctx.ops.unservedHoursByReason;
  const costs = st.company.costs;
  const anyVehicleFail = runs.some((r) => r.status === 'vehicle');
  for (const o of st.open) {
    if (o.status !== 'open' || o.createdDay > ctx.day) continue;
    const d = o.jt.def;
    const R = o.remaining;
    let reason: UnservedReason;
    if (d.weatherSensitive && rainout) reason = 'weather';
    else if (d.weatherSensitive && partial && partialBlocked(fielded, o, cutoff, costs)) reason = 'weather';
    else if (runs.length === 0) reason = 'no-crew';
    else if (fielded.length === 0) reason = anyVehicleFail ? 'vehicle' : 'crew-size';
    else if (fielded.every((r) => r.n < d.minCrewSize)) reason = 'crew-size';
    else if (fielded.every((r) => !d.requiredEquipmentTypes.every((t) => r.kitTypes.has(t)))) reason = 'equipment';
    else if (fielded.every((r) => r.maxSkill < d.minSkill)) reason = 'skill';
    else reason = 'capacity';
    u[reason] += R;
  }
}

/**
 * On a partial day a weather-sensitive order is weather-blocked when at least one fielded crew
 * was otherwise eligible and every such crew, at the moment it closed, was already past the
 * start cutoff for this order.
 */
function partialBlocked(
  fielded: CrewRun[],
  o: OrderS,
  cutoff: number,
  costs: { roadFactor: number; avgSpeedMph: number; stopOverheadHours: number },
): boolean {
  let any = false;
  for (const r of fielded) {
    if (!r.elig[o.jt.idx]) continue;
    any = true;
    const tIn = travelTime(r.closeX, r.closeY, o.x, o.y, costs.roadFactor, costs.avgSpeedMph) + costs.stopOverheadHours;
    if (r.closeClock + tIn <= cutoff + CLOCK_EPS) return false;
  }
  return any;
}
