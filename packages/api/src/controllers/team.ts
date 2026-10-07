import {
  TagResourceType,
  TeamClickHouseSettingsUpdate,
} from '@hyperdx/common-utils/dist/types';
import { v4 as uuidv4 } from 'uuid';

import * as config from '@/config';
import { getDb, withTransaction } from '@/db';
import * as teams from '@/db/repos/teams';
import type { ObjectId } from '@/models/ids';

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

/**
 * Distinct tags applied to the team's entities. Scoped to one kind of entity
 * when `resourceType` is given.
 */
export async function getTags(
  teamId: ObjectId,
  resourceType?: TagResourceType,
) {
  const tags = new Set<string>();
  if (resourceType == null || resourceType === 'dashboard') {
    // sqlite-port: $unwind/$group over dashboard tags.
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT j.value AS tag FROM dashboards d,
      json_each(d.tags) j WHERE d.team=?`,
      )
      .all(String(teamId)) as { tag: string }[];
    rows.forEach(row => tags.add(row.tag));
  }
  if (resourceType == null || resourceType === 'savedSearch') {
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT j.value AS tag FROM savedsearches s,
      json_each(s.tags) j WHERE s.team=?`,
      )
      .all(String(teamId)) as { tag: string }[];
    rows.forEach(row => tags.add(row.tag));
  }
  if (resourceType == null || resourceType === 'alert') {
    // sqlite-port: Mongo $unwind/$group distinct alert tags.
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT j.value AS tag FROM alerts a,
       json_each(a.tags) j WHERE a.team=?`,
      )
      .all(String(teamId)) as { tag: string }[];
    rows.forEach(row => tags.add(row.tag));
  }
  return [...tags];
}
