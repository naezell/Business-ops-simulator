/**
 * Playback reconstruction (IC §9). Expected values are worked out by hand in the comments.
 */
import { describe, expect, it } from 'vitest';
import type { CrewDayLog, RouteStop, SimEvent } from '../../src/simulation';
import { clockLabel, crewStateAt, dayEndClock, dayFeed } from '../../src/services/playback';

const depot = { x: 0, y: 0 };
const stop = (x: number, y: number, arrive: number, depart: number): RouteStop => ({
  jobId: `j${x}`, customerId: `c${x}`, jobTypeId: 'mow', x, y, arrive, depart, completed: true, revenue: 100,
});
const log = (over: Partial<CrewDayLog>): CrewDayLog => ({
  crewId: 'crew-1', deployed: true, vehicleId: 'v1', memberIds: [], absentIds: [], equipmentIds: [],
  stops: [], endClock: 0, miles: 0, onSiteHours: 0, travelHours: 0, ...over,
});

// Depot (0,0) -> A (4,0) arrive 1, depart 2 -> B (4,3) arrive 3, depart 4 -> depot, endClock 6.
const day = log({ stops: [stop(4, 0, 1, 2), stop(4, 3, 3, 4)], endClock: 6 });

describe('crewStateAt', () => {
  it('first leg interpolates over [0, arrive]: t=0.5 is halfway to (4,0) = (2,0)', () => {
    const p = crewStateAt(day, 0.5, depot);
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.state).toBe('traveling');
    expect(p.stopIndex).toBe(0);
  });
  it('is on site between arrive and depart', () => {
    // t=1.5 in [1,2) -> at (4,0) working at stop 0
    expect(crewStateAt(day, 1.5, depot)).toEqual({ x: 4, y: 0, state: 'working', stopIndex: 0 });
    expect(crewStateAt(day, 1, depot).state).toBe('working');
  });
  it('second leg runs over [depart 2, arrive 3]: t=2.5 is halfway from (4,0) to (4,3) = (4,1.5)', () => {
    const p = crewStateAt(day, 2.5, depot);
    expect(p.x).toBeCloseTo(4, 9);
    expect(p.y).toBeCloseTo(1.5, 9);
    expect(p.state).toBe('traveling');
    expect(p.stopIndex).toBe(1);
  });
  it('return leg runs over [last depart 4, endClock 6]: t=5 is the midpoint of (4,3) and (0,0) = (2,1.5)', () => {
    const p = crewStateAt(day, 5, depot);
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.y).toBeCloseTo(1.5, 9);
    expect(p.state).toBe('returning');
  });
  it('is idle at the depot from endClock on', () => {
    expect(crewStateAt(day, 6, depot)).toEqual({ x: 0, y: 0, state: 'idle' });
    expect(crewStateAt(day, 9, depot).state).toBe('idle');
  });
  it('a crew that was not deployed is off at the depot at any time', () => {
    const off = log({ deployed: false, notDeployedReason: 'weather' });
    expect(crewStateAt(off, 3, depot)).toEqual({ x: 0, y: 0, state: 'off' });
  });
  it('a deployed crew with no stops is idle at the depot', () => {
    expect(crewStateAt(log({ endClock: 0 }), 2, depot)).toEqual({ x: 0, y: 0, state: 'idle' });
  });
  it('at t=0 the crew is at the depot', () => {
    const p = crewStateAt(day, 0, depot);
    expect([p.x, p.y]).toEqual([0, 0]);
  });
  it('uses the supplied depot', () => {
    // depot (10,10) to stop (14,10), arrive 2, t=1 -> halfway (12,10)
    const p = crewStateAt(log({ stops: [stop(14, 10, 2, 3)], endClock: 4 }), 1, { x: 10, y: 10 });
    expect(p.x).toBeCloseTo(12, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });
});

describe('dayEndClock', () => {
  it('is the latest endClock of deployed crews', () => {
    expect(dayEndClock([day, log({ stops: [], endClock: 3 }), log({ deployed: false, endClock: 99 })])).toBe(6);
  });
  it('uses the fallback when nothing ran', () => {
    expect(dayEndClock([log({ deployed: false })], 8)).toBe(8);
  });
});

describe('clockLabel', () => {
  it('adds hours to a 07:00 start', () => {
    expect(clockLabel(0)).toBe('07:00');
    expect(clockLabel(1.5)).toBe('08:30');
    expect(clockLabel(10.25)).toBe('17:15');
  });
  it('honours a different shift start and wraps at midnight', () => {
    expect(clockLabel(2, 6)).toBe('08:00');
    expect(clockLabel(18, 7)).toBe('01:00');
  });
});

describe('dayFeed', () => {
  const events = [
    { day: 3, type: 'vehicle-breakdown', vehicleId: 'v1', downDays: 2, cost: 450 },
    { day: 3, type: 'employee-quit', employeeId: 'e1' },
    { day: 4, type: 'employee-quit', employeeId: 'e2' },
    { day: 3, type: 'cash-shortfall', amount: 120 },
    { day: 3, type: 'action-rejected', action: { type: 'set-price' }, reason: 'no cash' },
    { day: 3, type: 'shock-started', shockId: 'storm' },
    { day: 3, type: 'rule-fired', ruleId: 'r1', amount: -75 },
  ] as unknown as SimEvent[];
  const names: Record<string, string> = { v1: 'Truck 1', e1: 'Sam', e2: 'Lee', a1: 'Ana', 'crew-1': 'Crew 1' };
  const nameOf = (id: string) => names[id] ?? id;

  it('lists only the selected day with money effects (costs negative)', () => {
    const f = dayFeed(3, events, [log({ absentIds: ['a1'] })], nameOf);
    expect(f.map((i) => i.kind)).toEqual(['absence', 'breakdown', 'quit', 'shortfall', 'rejected', 'shock-start', 'rule']);
    expect(f[0].text).toBe('Ana absent (Crew 1)');
    expect(f[1]).toEqual({ kind: 'breakdown', text: 'Truck 1 broke down (2 days down)', money: -450 });
    expect(f[3].money).toBe(-120);
    expect(f[4].text).toBe('Decision rejected: Change prices (no cash)');
    expect(f[5].text).toBe('Shock started: storm');
    expect(f[6].money).toBe(-75);
  });
  it('is empty on a quiet day', () => {
    expect(dayFeed(0, events, [], nameOf)).toEqual([]);
  });
});
