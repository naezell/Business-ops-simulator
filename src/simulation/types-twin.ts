/**
 * DIGITAL-TWIN ENGINE CONTRACT — merged into `types.ts` by task E3 (implementation-contracts §2).
 *
 * This file now only re-exports the merged types so that `study-types.ts` and other
 * consumers keep compiling. `TwinScenario` and `TwinAction` are aliases of `Scenario`
 * and `Action`. No runtime code.
 */
import type { Action, Scenario } from './types';

export type {
  AssetAging,
  CashFlowAdditions,
  CustomerDynamics,
  CustomerStats,
  DecisionRule,
  FinanceDynamics,
  FloatPolicy,
  IncomeFlowKey,
  IncomeStatementAdditions,
  Observable,
  OpsMetricsAdditions,
  RuleCondition,
  ScaleCustomerBase,
  Shock,
  ShockTarget,
  SimulationResultAdditions,
  TheoreticalWeeklyCapacity,
  TwinOnlyAction,
  TwinSimEvent,
  WorkforceDynamics,
} from './types';

export type TwinScenario = Scenario;
export type TwinAction = Action;
