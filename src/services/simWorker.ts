/// <reference lib="webworker" />
/**
 * Module Web Worker that runs the optimizer off the main thread.
 *
 * Protocol (one optimization per worker; the client creates a worker per request):
 *   in:  { type: 'optimize', request: OptimizationRequest }
 *   out: { type: 'progress', progress } … then { type: 'result', result } or { type: 'error', message, name }
 *
 * The worker supplies the clock for `elapsedMs`; the optimizer itself never reads time.
 */
import { optimize } from '../optimization';
import type { OptimizationProgress, OptimizationRequest, OptimizationResult } from '../optimization';

export type WorkerRequest = { type: 'optimize'; request: OptimizationRequest };
export type WorkerResponse =
  | { type: 'progress'; progress: OptimizationProgress }
  | { type: 'result'; result: OptimizationResult }
  | { type: 'error'; message: string; name: string };

/** Minimum time between progress messages, in ms (the final state is always sent with the result). */
const PROGRESS_INTERVAL_MS = 100;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'optimize') return;
  const clock = () => performance.now();
  let lastSent = -Infinity;
  let lastPhase = '';
  try {
    const result = optimize(
      msg.request,
      (progress) => {
        const now = clock();
        if (progress.phase !== lastPhase || now - lastSent >= PROGRESS_INTERVAL_MS) {
          lastPhase = progress.phase;
          lastSent = now;
          ctx.postMessage({ type: 'progress', progress } satisfies WorkerResponse);
        }
      },
      clock,
    );
    ctx.postMessage({ type: 'result', result } satisfies WorkerResponse);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    ctx.postMessage({ type: 'error', message: e.message, name: e.name } satisfies WorkerResponse);
  }
};
