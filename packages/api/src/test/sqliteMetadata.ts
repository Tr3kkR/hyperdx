import type { TSourceNoId } from '@hyperdx/common-utils/dist/types';

import { getDb } from '@/db';
import { newId } from '@/db/ids';
import * as connections from '@/db/repos/connections';
import * as dashboards from '@/db/repos/dashboards';
import * as savedSearches from '@/db/repos/savedSearches';
import * as sources from '@/db/repos/sources';
import * as webhooks from '@/db/repos/webhooks';

// Test setup inserts rows directly so route tests can exercise reads without
// coupling their fixtures to the endpoint that writes the same table.
export function createConnectionFixture(input: {
  team: { toString(): string };
  [key: string]: unknown;
}) {
  const { team, ...row } = input;
  const created = connections.create(
    String(team),
    row as Partial<connections.ConnectionDoc>,
  );
  return connections.findByIdWithPassword(created.id, String(team))!;
}

export function createSourceFixture(input: {
  team: { toString(): string };
  [key: string]: unknown;
}) {
  const { team, ...row } = input;
  return sources.create(String(team), {
    ...row,
    connection: String(row.connection),
    ...(row._id == null ? {} : { _id: String(row._id) }),
  } as TSourceNoId);
}

export function findSourceFixture(id: { toString(): string }) {
  return sources.findById(String(id));
}

export function findConnectionFixture(
  id: { toString(): string },
  withPassword = false,
) {
  const row = getDb()
    .prepare('SELECT team FROM connections WHERE id = ?')
    .get(String(id)) as { team: string } | undefined;
  return row ? connections.findById(String(id), row.team, withPassword) : null;
}

export function deleteSourceFixture(id: { toString(): string }) {
  getDb().prepare('DELETE FROM sources WHERE id = ?').run(String(id));
}

export function deleteConnectionFixture(id: { toString(): string }) {
  getDb().prepare('DELETE FROM connections WHERE id = ?').run(String(id));
}

export function setSourceKindFixture(id: { toString(): string }, kind: string) {
  // sqlite-port: raw Source.collection.updateOne bypassed discriminator validation.
  getDb()
    .prepare('UPDATE sources SET kind = ? WHERE id = ?')
    .run(kind, String(id));
}

export function setSourceConnectionFixture(
  id: { toString(): string },
  connection: { toString(): string },
) {
  getDb()
    .prepare('UPDATE sources SET connection = ? WHERE id = ?')
    .run(String(connection), String(id));
}

export function setSourceTableFilterFixture(
  id: { toString(): string },
  expression: string,
) {
  // sqlite-port: LogSource.updateOne changed a discriminator-specific field.
  getDb()
    .prepare(
      "UPDATE sources SET config = json_set(config, '$.tableFilterExpression', ?) WHERE id = ?",
    )
    .run(expression, String(id));
}

export function createSavedSearchFixture(input: {
  team: { toString(): string };
  source: { toString(): string };
  [key: string]: unknown;
}) {
  const { team, source, ...row } = input;
  return savedSearches.create(String(team), {
    ...row,
    source: String(source),
    ...(row._id == null ? {} : { _id: String(row._id) }),
    ...(row.createdBy == null ? {} : { createdBy: String(row.createdBy) }),
    ...(row.updatedBy == null ? {} : { updatedBy: String(row.updatedBy) }),
  } as savedSearches.SavedSearchInput);
}

export function findSavedSearchFixture(id: { toString(): string }) {
  const row = getDb()
    .prepare('SELECT team FROM savedsearches WHERE id = ?')
    .get(String(id)) as { team: string } | undefined;
  return row ? savedSearches.findById(String(id), row.team) : null;
}

export function setSavedSearchNameFixture(
  id: { toString(): string },
  name: string,
) {
  getDb()
    .prepare('UPDATE savedsearches SET name = ? WHERE id = ?')
    .run(name, String(id));
}

export function setSavedSearchUpdatedByFixture(
  id: { toString(): string },
  userId: { toString(): string },
) {
  getDb()
    .prepare('UPDATE savedsearches SET updatedBy = ? WHERE id = ?')
    .run(String(userId), String(id));
}

export function deleteSavedSearchFixture(id: { toString(): string }) {
  getDb().prepare('DELETE FROM savedsearches WHERE id = ?').run(String(id));
}

export function createWebhookFixture(input: {
  team: { toString(): string };
  [key: string]: unknown;
}) {
  const { team, _id, ...fields } = input;
  return webhooks.create(
    String(team),
    fields as webhooks.WebhookFields,
    _id == null ? undefined : String(_id),
  );
}

export function createDashboardFixture(input: {
  team: { toString(): string };
  [key: string]: unknown;
}) {
  const { team, ...fields } = input;
  return dashboards.create(String(team), {
    ...fields,
    ...(fields._id == null ? {} : { _id: String(fields._id) }),
    ...(fields.createdBy == null
      ? {}
      : { createdBy: String(fields.createdBy) }),
    ...(fields.updatedBy == null
      ? {}
      : { updatedBy: String(fields.updatedBy) }),
  } as dashboards.DashboardInput);
}

export function findDashboardFixture(id: { toString(): string }) {
  return dashboards.findByIdAnyTeam(String(id));
}

export function countAllDashboardFixtures() {
  return (
    getDb().prepare('SELECT count(*) AS n FROM dashboards').get() as {
      n: number;
    }
  ).n;
}

export function setDashboardUpdatedByFixture(
  id: { toString(): string },
  userId: { toString(): string },
) {
  getDb()
    .prepare('UPDATE dashboards SET updatedBy=? WHERE id=?')
    .run(String(userId), String(id));
}

export function setDashboardTileFixture(
  id: { toString(): string },
  fields: Record<string, unknown>,
) {
  // sqlite-port: Dashboard.updateOne $set on Mixed tiles bypassed route validation.
  const row = getDb()
    .prepare('SELECT tiles FROM dashboards WHERE id=?')
    .get(String(id)) as { tiles: string };
  const tiles = JSON.parse(row.tiles) as Record<string, unknown>[];
  for (const [path, value] of Object.entries(fields)) {
    const parts = path.split('.');
    const tile = tiles[Number(parts[1])];
    const target =
      parts[2] === 'config' ? (tile.config as Record<string, unknown>) : tile;
    target[parts[parts.length - 1]] = value;
  }
  getDb()
    .prepare('UPDATE dashboards SET tiles=? WHERE id=?')
    .run(JSON.stringify(tiles), String(id));
}

export function removeDashboardTileFixture(
  id: { toString(): string },
  tileId: string,
) {
  // sqlite-port: Dashboard.findByIdAndUpdate $pull removed a matching tile.
  const row = getDb()
    .prepare('SELECT tiles FROM dashboards WHERE id=?')
    .get(String(id)) as { tiles: string };
  const tiles = JSON.parse(row.tiles) as { id: string }[];
  getDb()
    .prepare('UPDATE dashboards SET tiles=? WHERE id=?')
    .run(JSON.stringify(tiles.filter(tile => tile.id !== tileId)), String(id));
}

export function upsertWebhookFixture(input: {
  team: { toString(): string };
  name: string;
  service: webhooks.WebhookService;
  [key: string]: unknown;
}) {
  const team = String(input.team);
  const old = webhooks.findByName(team, input.service, input.name);
  if (old) {
    const { team: _team, _id: _id, ...fields } = input;
    return webhooks.updateIfDestinationMatches(
      old.id,
      team,
      old.url,
      old.service,
      fields as webhooks.WebhookFields,
    )!;
  }
  return createWebhookFixture(input);
}

export function findWebhookFixture(id: { toString(): string }) {
  const row = getDb()
    .prepare('SELECT team FROM webhooks WHERE id = ?')
    .get(String(id)) as { team: string } | undefined;
  return row ? webhooks.findById(String(id), row.team) : null;
}

export function countWebhookFixtures() {
  return (
    getDb().prepare('SELECT count(*) AS n FROM webhooks').get() as { n: number }
  ).n;
}

export function listWebhookFixtures() {
  const teams = getDb().prepare('SELECT DISTINCT team FROM webhooks').all() as {
    team: string;
  }[];
  return teams.flatMap(({ team }) => webhooks.list(team));
}

export function setWebhookUrlFixture(id: { toString(): string }, url: string) {
  getDb().prepare('UPDATE webhooks SET url=? WHERE id=?').run(url, String(id));
}

export function deleteWebhookFixture(id: { toString(): string }) {
  getDb().prepare('DELETE FROM webhooks WHERE id=?').run(String(id));
}

export function createMalformedWebhookFixture(
  team: { toString(): string },
  service: string,
) {
  // sqlite-port: collection.insertOne bypassed the Mongoose service enum.
  getDb()
    .prepare(
      'INSERT INTO webhooks (id,team,name,service,createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
    )
    .run(
      newId(),
      String(team),
      'Broken Webhook',
      service,
      Date.now(),
      Date.now(),
    );
}
