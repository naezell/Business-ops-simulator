import { landscaping } from './landscaping';
import type { IndustryDefinition } from './types';

/** All industry packs available to the application, keyed by industry id. */
export const industries: Record<string, IndustryDefinition> = {
  [landscaping.id]: landscaping,
};

export const defaultIndustryId = 'landscaping';

/** Returns the industry pack for an id. Throws for an unknown id. */
export function getIndustry(id: string): IndustryDefinition {
  const industry = Object.prototype.hasOwnProperty.call(industries, id) ? industries[id] : undefined;
  if (!industry) throw new Error(`Unknown industry id: ${id}`);
  return industry;
}
