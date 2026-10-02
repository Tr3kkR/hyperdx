import type { PinnedFiltersValue } from '@hyperdx/common-utils/dist/types';

import * as pinnedFilters from '@/db/repos/pinnedFilters';
import type { ObjectId } from '@/models';

/**
 * Get team-level pinned filters for a team+source combination.
 */
export async function getPinnedFilters(
  teamId: string | ObjectId,
  sourceId: string | ObjectId,
) {
  return pinnedFilters.find(String(teamId), String(sourceId));
}

/**
 * Upsert team-level pinned filters for a team+source.
 */
export async function updatePinnedFilters(
  teamId: string | ObjectId,
  sourceId: string | ObjectId,
  data: { fields: string[]; filters: PinnedFiltersValue },
) {
  return pinnedFilters.upsert(String(teamId), String(sourceId), data);
}
