import {
  TagResourceType,
  TeamClickHouseSettingsUpdate,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import * as config from '@/config';
import { withTransaction } from '@/db';
import * as teams from '@/db/repos/teams';
import type { ObjectId } from '@/models';
import Alert from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';

export function getTeamInviteUrl(token: string) {
  return `${config.FRONTEND_URL}/join-team?token=${token}`;
}

export const LOCAL_APP_TEAM_ID = Buffer.from('_local_team_').toString('hex');
export const LOCAL_APP_TEAM = {
  _id: LOCAL_APP_TEAM_ID,
  id: LOCAL_APP_TEAM_ID,
  name: 'Local App Team',
  // Placeholder keys
  hookId: uuidv4(),
  apiKey: uuidv4(),
  collectorAuthenticationEnforced: false,
  isMetricsSeriesTableEnabled: false,
  toJSON() {
    return this;
  },
};

export async function isTeamExisting() {
  if (config.IS_LOCAL_APP_MODE) {
    return true;
  }

  const teamCount = teams.countTeams();
  return teamCount > 0;
}

export async function createTeam({
  name,
  collectorAuthenticationEnforced = true,
}: {
  name: string;
  collectorAuthenticationEnforced?: boolean;
}) {
  if (config.IS_LOCAL_APP_MODE) throw new Error('Team already exists');
  return withTransaction(() => {
    if (teams.countTeams() > 0) throw new Error('Team already exists');
    return teams.create({ name, collectorAuthenticationEnforced });
  });
}

export function getAllTeams(_fields?: string[]) {
  if (config.IS_LOCAL_APP_MODE) {
    return [LOCAL_APP_TEAM];
  }

  return teams.list();
}

export function getTeam(id: string | ObjectId, fields?: readonly string[]) {
  if (config.IS_LOCAL_APP_MODE) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return LOCAL_APP_TEAM as any;
  }

  // sqlite-port: Team.findOne({}) intentionally ignores the supplied id in a single-team deployment.
  const team = teams.findTheTeam();
  if (!team || !fields) return team;
  return Object.fromEntries(
    Object.entries(team).filter(
      ([key]) => key === 'id' || fields.includes(key),
    ),
  ) as teams.TeamDoc;
}

export function getTeamByApiKey(apiKey: string) {
  if (config.IS_LOCAL_APP_MODE) {
    return LOCAL_APP_TEAM;
  }

  return teams.findByApiKey(apiKey);
}

export function rotateTeamApiKey(teamId: ObjectId) {
  return teams.update(String(teamId), { apiKey: uuidv4() });
}

export function setTeamName(teamId: ObjectId, name: string) {
  return teams.update(String(teamId), { name });
}

export function updateTeamClickhouseSettings(
  teamId: ObjectId,
  settings: TeamClickHouseSettingsUpdate,
) {
  // sqlite-port: Mongoose $set/$unset pairs map to values and nullable columns.
  return teams.update(String(teamId), settings as Partial<teams.TeamDoc>);
}

function getCollectionsWithTags(
  resourceType?: TagResourceType,
): Pick<mongoose.Model<unknown>, 'aggregate'>[] {
  if (resourceType == null) {
    return [Alert, Dashboard, SavedSearch];
  }

  switch (resourceType) {
    case 'alert':
      return [Alert];
    case 'dashboard':
      return [Dashboard];
    case 'savedSearch':
      return [SavedSearch];
    default:
      resourceType satisfies never;
      throw new Error(`${resourceType} is not a valid TagResourceType`);
  }
}

/**
 * Distinct tags applied to the team's entities. Scoped to one kind of entity
 * when `resourceType` is given.
 */
export async function getTags(
  teamId: ObjectId,
  resourceType?: TagResourceType,
) {
  const distinctTagsPipeline: mongoose.PipelineStage[] = [
    // sqlite-port: Mongo aggregation does not cast the SQLite hex team id.
    { $match: { team: new mongoose.Types.ObjectId(String(teamId)) } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags' } },
  ];

  const tagGroups = await Promise.all(
    getCollectionsWithTags(resourceType).map(collection =>
      collection.aggregate<{ _id: string }>(distinctTagsPipeline),
    ),
  );

  return [...new Set(tagGroups.flat().map(t => t._id))];
}
