/// <reference lib="webworker" />
/** Study evaluation worker (implementation-contracts §5): receives EvalJob[], returns RunDigest[]. */
import { createWorkerState, handleStudyMessage, type StudyWorkerIn } from './studyWorkerCore';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const state = createWorkerState();
ctx.onmessage = (event: MessageEvent<StudyWorkerIn>) => {
  const reply = handleStudyMessage(state, event.data);
  if (reply) ctx.postMessage(reply);
};
