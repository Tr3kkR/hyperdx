import {
  SavedSearchListApiResponse,
  SavedSearchSchema,
} from '@hyperdx/common-utils/dist/types';
import { groupBy } from 'lodash';
import { z } from 'zod';

import { withTransaction } from '@/db';
import * as alertsRepo from '@/db/repos/alerts';
import * as savedSearchesRepo from '@/db/repos/savedSearches';
import { hydrateUsers } from '@/db/repos/users';
import { resolveAlertDisplayFields } from '@/utils/alerts';

type SavedSearchWithoutId = Omit<z.infer<typeof SavedSearchSchema>, 'id'>;

export async function getSavedSearches(
  teamId: string,
): Promise<SavedSearchListApiResponse[]> {
  const savedSearches = savedSearchesRepo.list(teamId);
  const alerts = alertsRepo
    .list(teamId)
    .filter(alert => alert.savedSearch != null);

  const alertsBySavedSearchId = groupBy(alerts, 'savedSearch');

  const result = savedSearches.map(savedSearch => ({
    ...hydrateUsers([savedSearch], ['createdBy', 'updatedBy'])[0],
    alerts: alertsBySavedSearchId[savedSearch._id.toString()]?.map(alert => ({
      ...hydrateUsers([alert], ['createdBy'])[0],
      ...resolveAlertDisplayFields(alert, { savedSearch }),
    })),
  }));
  // Mongoose's toJSON types keep ObjectId/Date even though their JSON wire values are strings.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return result as unknown as SavedSearchListApiResponse[];
}

export async function getSavedSearch(teamId: string, savedSearchId: string) {
  const doc = savedSearchesRepo.findById(savedSearchId, teamId);
  if (!doc) return null;
  return hydrateUsers([doc], ['createdBy', 'updatedBy'])[0];
}

export function createSavedSearch(
  teamId: string,
  savedSearch: SavedSearchWithoutId,
  userId?: string,
) {
  return savedSearchesRepo.create(teamId, savedSearch, userId);
}

export function updateSavedSearch(
  teamId: string,
  savedSearchId: string,
  savedSearch: SavedSearchWithoutId,
  userId?: string,
) {
  return savedSearchesRepo.update(savedSearchId, teamId, savedSearch, userId);
}

export async function deleteSavedSearch(teamId: string, savedSearchId: string) {
  const savedSearch = savedSearchesRepo.findById(savedSearchId, teamId);
  if (savedSearch == null) {
    return null;
  }
  // sqlite-port: Mongo's no-transaction delete workaround is replaced by a
  // single children-then-parent transaction.
  withTransaction(() => {
    alertsRepo.removeBySavedSearch(savedSearchId, teamId);
    savedSearchesRepo.remove(savedSearchId, teamId);
  });
  return savedSearch;
}
