import {
  SavedSearchListApiResponse,
  SavedSearchSchema,
} from '@hyperdx/common-utils/dist/types';
import { groupBy } from 'lodash';
import { z } from 'zod';

import { deleteSavedSearchAlerts } from '@/controllers/alerts';
import { hydrateUsers } from '@/db/repos/users';
import Alert from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';
import { resolveAlertDisplayFields } from '@/utils/alerts';
import logger from '@/utils/logger';

type SavedSearchWithoutId = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;

export async function getSavedSearches(
  teamId: string,
): Promise<SavedSearchListApiResponse[]> {
  const savedSearches = await SavedSearch.find({ team: teamId });
  const alerts = await Alert.find(
    { team: teamId, savedSearch: { $exists: true, $ne: null } },
    { __v: 0 },
  );

  const alertsBySavedSearchId = groupBy(alerts, 'savedSearch');

  const result = savedSearches.map(savedSearch => ({
    ...hydrateUsers([savedSearch.toJSON()], ['createdBy', 'updatedBy'])[0],
    alerts: alertsBySavedSearchId[savedSearch._id.toString()]?.map(alert => ({
      ...hydrateUsers([alert.toJSON()], ['createdBy'])[0],
      ...resolveAlertDisplayFields(alert, { savedSearch }),
    })),
  }));
  // Mongoose's toJSON types keep ObjectId/Date even though their JSON wire values are strings.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return result as unknown as SavedSearchListApiResponse[];
}

export async function getSavedSearch(teamId: string, savedSearchId: string) {
  const doc = await SavedSearch.findOne({ _id: savedSearchId, team: teamId });
  if (!doc) return null;
  const originalToJSON = doc.toJSON.bind(doc);
  doc.toJSON = ((...args: Parameters<typeof doc.toJSON>) =>
    hydrateUsers(
      [originalToJSON(...args)],
      ['createdBy', 'updatedBy'],
    )[0]) as typeof doc.toJSON;
  return doc;
}

export function createSavedSearch(
  teamId: string,
  savedSearch: SavedSearchWithoutId,
  userId?: string,
) {
  return SavedSearch.create({
    ...savedSearch,
    team: teamId,
    createdBy: userId,
    updatedBy: userId,
  });
}

export function updateSavedSearch(
  teamId: string,
  savedSearchId: string,
  savedSearch: SavedSearchWithoutId,
  userId?: string,
) {
  return SavedSearch.findOneAndUpdate(
    { _id: savedSearchId, team: teamId },
    {
      ...savedSearch,
      team: teamId,
      updatedBy: userId,
    },
    { new: true },
  );
}

export async function deleteSavedSearch(teamId: string, savedSearchId: string) {
  const savedSearch = await SavedSearch.findOne({
    _id: savedSearchId,
    team: teamId,
  });
  if (savedSearch == null) {
    return null;
  }
  // Delete dependent alerts before the parent. Without a transaction (which
  // requires a replica set), the deletes are not atomic, so this order picks
  // the least-bad partial-failure mode: if deleteSavedSearchAlerts throws,
  // nothing is deleted and the caller can retry. If the final deleteOne throws
  // after the alerts are gone, the search survives without its alerts —
  // recoverable by re-creating alerts, and strictly better than the reverse
  // order's failure mode (orphaned alerts pointing at a deleted saved search).
  await deleteSavedSearchAlerts(savedSearchId, teamId);
  await SavedSearch.deleteOne({ _id: savedSearchId, team: teamId });
  // Re-sweep after the parent is gone: a concurrent alert-create targeting this
  // saved search could land between the two deletes above and orphan itself.
  // Once the parent no longer exists this second sweep cleans up any such alert
  // (and is a cheap no-op in the common case). Best-effort: the parent is
  // already deleted, so the operation has succeeded from the caller's view — a
  // failure here must not surface as a 500. Log it so the (rare) orphan window
  // is observable and can be swept later, and still return success.
  try {
    await deleteSavedSearchAlerts(savedSearchId, teamId);
  } catch (e) {
    logger.warn(
      { err: e, savedSearchId, team: teamId },
      'Post-delete alert re-sweep failed; a concurrently-created alert may be orphaned for this deleted saved search',
    );
  }
  return savedSearch;
}
