/**
 * Seeds this worktree's SQLite store with N alerts, for exercising the alerts
 * page at scale.
 *
 * Half the alerts reference saved searches (up to 2 per search), half reference
 * dashboard tiles (up to 4 tiles per dashboard, at most one alert per tile).
 * Every seeded dashboard and saved search carries a tag (default `seeded`) so
 * the whole batch can be removed again with `--purge`.
 *
 *   yarn seed:alerts --count 2000
 *   yarn seed:alerts --purge
 *
 * The SQLite path defaults to SQLITE_PATH from the dev slot.
 * The dev stack must be up (`yarn dev`) and registered once, since
 * the script attaches everything to the existing team and log source.
 */
import { formatTileAlertDisplayName } from '@hyperdx/common-utils/dist/alerts';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { closeDb, getDb, openDb, withTransaction } from '@/db';
import { migrate } from '@/db/migrate';
import * as alerts from '@/db/repos/alerts';
import * as dashboards from '@/db/repos/dashboards';
import * as savedSearches from '@/db/repos/savedSearches';
import * as sources from '@/db/repos/sources';
import * as teams from '@/db/repos/teams';
import * as webhooks from '@/db/repos/webhooks';
import { AlertSource, AlertState } from '@/models/alert';
import { WebhookService } from '@/models/webhook';

const DEFAULT_COUNT = 1000;
const DEFAULT_TAG = 'seeded';
const MAX_ALERTS_PER_SAVED_SEARCH = 2;
const MAX_TILES_PER_DASHBOARD = 4;
const INSERT_CHUNK_SIZE = 500;

/** Roughly what a real team looks like: mostly quiet, a few firing. */
const STATE_WEIGHTS: [AlertState, number][] = [
  [AlertState.OK, 79],
  [AlertState.ALERT, 12],
  [AlertState.PENDING, 9],
];

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'] as const;

/** Extra tags beyond the seed tag, so the tag filter has something to filter. */
const FLAVOR_TAGS = ['production', 'staging', 'team-alpha', 'team-beta'];

const NOTE_TEXT = [
  'Runbook: check the upstream queue depth first.',
  'Known noisy during deploys — see #incidents.',
  'Owned by the platform team. Escalate after 15m.',
].map(text => `${text}\n\n- [Runbook](https://example.com/runbook)`);

type Args = {
  count: number;
  tag: string;
  sqlitePath: string | null;
  purge: boolean;
  help: boolean;
};

const USAGE = [
  'Usage: yarn seed:alerts [options]',
  '',
  '  -n, --count N       number of alerts to create (default 1000)',
  '      --tag TAG       tag applied to seeded dashboards and saved searches',
  '                      (default "seeded")',
  '      --sqlite PATH  override SQLITE_PATH',
  '      --purge         delete everything carrying --tag instead of seeding',
].join('\n');

function parseArgs(argv: string[]): Args {
  const args: Args = {
    count: DEFAULT_COUNT,
    tag: DEFAULT_TAG,
    sqlitePath: null,
    purge: false,
    help: false,
  };

  const rest = [...argv];
  for (let arg = rest.shift(); arg != null; arg = rest.shift()) {
    const next = () => {
      const value = rest.shift();
      if (value == null) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case '-n':
      case '--count':
        args.count = Number(next());
        if (!Number.isInteger(args.count) || args.count < 1) {
          throw new Error('--count must be a positive integer');
        }
        break;
      case '--tag':
        args.tag = next();
        break;
      case '--sqlite':
        args.sqlitePath = next();
        break;
      case '--purge':
        args.purge = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function randomInt(minInclusive: number, maxInclusive: number): number {
  return (
    minInclusive + Math.floor(Math.random() * (maxInclusive - minInclusive + 1))
  );
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)];
}

const weightedStates: AlertState[] = STATE_WEIGHTS.flatMap(([state, weight]) =>
  Array.from({ length: weight }, () => state),
);

/** Pairs each plan with the id of the document it was inserted as. */
function* zip<A, B>(as: A[], bs: B[]): Generator<[A, B]> {
  const bIterator = bs[Symbol.iterator]();
  for (const a of as) {
    const b = bIterator.next();
    if (b.done === true) return;
    yield [a, b.value];
  }
}

/** Returns the inserted ids as strings, committing each chunk atomically. */
function insertInChunks<T extends { _id: string }>(
  insertMany: (docs: Record<string, unknown>[]) => T[],
  docs: Record<string, unknown>[],
): string[] {
  const ids: string[] = [];
  for (let i = 0; i < docs.length; i += INSERT_CHUNK_SIZE) {
    const inserted = withTransaction(() =>
      insertMany(docs.slice(i, i + INSERT_CHUNK_SIZE)),
    );
    ids.push(...inserted.map(doc => doc._id));
  }
  return ids;
}

function makeAlertDoc({
  teamId,
  channel,
  index,
  displayName,
  tags,
  savedSearchId,
  dashboardId,
  tileId,
}: {
  teamId: unknown;
  channel: { type: 'webhook'; webhookId: string };
  index: number;
  displayName: string;
  tags: string[];
  savedSearchId?: string;
  dashboardId?: string;
  tileId?: string;
}) {
  return {
    team: teamId,
    source: savedSearchId ? AlertSource.SAVED_SEARCH : AlertSource.TILE,
    // Stored on the alert rather than left to derive from the referenced
    // saved search or dashboard tile, matching what writers persist now.
    displayName,
    tags,
    savedSearch: savedSearchId ?? null,
    groupBy: null,
    dashboard: dashboardId ?? null,
    tileId: tileId ?? null,
    interval: pick(INTERVALS),
    threshold: randomInt(1, 500),
    thresholdType: 'above',
    channel,
    channels: [channel],
    state: pick(weightedStates),
    // Notes make rows taller and collapsible, which is what the virtualized
    // list has to measure rather than assume.
    note: index % 5 === 0 ? pick(NOTE_TEXT) : null,
  };
}

function makeTile(dashboardIndex: number, tileIndex: number, sourceId: string) {
  return {
    id: `seeded-tile-${dashboardIndex}-${tileIndex}`,
    x: (tileIndex % 2) * 6,
    y: Math.floor(tileIndex / 2) * 3,
    w: 6,
    h: 3,
    config: {
      name: `Seeded tile ${tileIndex + 1}`,
      source: sourceId,
      displayType: DisplayType.Line,
      select: [
        {
          aggFn: 'count',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: '',
        },
      ],
      where: '',
      whereLanguage: 'lucene',
      granularity: 'auto',
      implicitColumnExpression: 'Body',
      numberFormat: { output: 'number' },
      filters: [],
    },
  };
}

function seededWebhookName(tag: string): string {
  return `Seeded webhook (${tag})`;
}

async function purge(tag: string) {
  // sqlite-port: Mongo $in/deleteMany on tagged dashboard and search ids.
  const {
    alertsDeleted,
    dashboardsDeleted,
    savedSearchesDeleted,
    webhooksDeleted,
  } = withTransaction(() => {
    const db = getDb();
    const dashboardsDeleted = Number(
      db
        .prepare(
          'SELECT count(*) AS n FROM dashboards WHERE EXISTS (SELECT 1 FROM json_each(dashboards.tags) WHERE value=?)',
        )
        .get(tag)?.n ?? 0,
    );
    const savedSearchesDeleted = Number(
      db
        .prepare(
          'SELECT count(*) AS n FROM savedsearches WHERE EXISTS (SELECT 1 FROM json_each(savedsearches.tags) WHERE value=?)',
        )
        .get(tag)?.n ?? 0,
    );
    const alertsDeleted = Number(
      db
        .prepare(
          `DELETE FROM alerts WHERE dashboard IN (
         SELECT id FROM dashboards WHERE EXISTS (SELECT 1 FROM json_each(dashboards.tags) WHERE value=?))
       OR savedSearch IN (
         SELECT id FROM savedsearches WHERE EXISTS (SELECT 1 FROM json_each(savedsearches.tags) WHERE value=?))`,
        )
        .run(tag, tag).changes,
    );
    db.prepare(
      'DELETE FROM dashboards WHERE EXISTS (SELECT 1 FROM json_each(dashboards.tags) WHERE value=?)',
    ).run(tag);
    db.prepare(
      'DELETE FROM savedsearches WHERE EXISTS (SELECT 1 FROM json_each(savedsearches.tags) WHERE value=?)',
    ).run(tag);
    const webhooksDeleted = Number(
      db
        .prepare('DELETE FROM webhooks WHERE service=? AND name=?')
        .run(WebhookService.Generic, seededWebhookName(tag)).changes,
    );
    return {
      alertsDeleted,
      dashboardsDeleted,
      savedSearchesDeleted,
      webhooksDeleted,
    };
  });

  console.log(
    `Purged ${alertsDeleted} alerts, ${dashboardsDeleted} dashboards, ` +
      `${savedSearchesDeleted} saved searches and ${webhooksDeleted} ` +
      `webhooks tagged "${tag}".`,
  );
}

async function seed(count: number, tag: string) {
  const team = teams.findTheTeam();
  if (team == null) {
    throw new Error(
      'No team found — register an account in the dev app first, then re-run.',
    );
  }
  const teamId = team._id;

  const source = sources.list(teamId).find(row => row.kind === 'log');
  if (source == null) {
    throw new Error(`No log source found for team ${String(teamId)}.`);
  }
  const sourceId = source._id;

  const webhookName = seededWebhookName(tag);
  const webhook =
    webhooks
      .list(teamId, WebhookService.Generic)
      .find(row => row.name === webhookName) ??
    webhooks.create(teamId, {
      service: WebhookService.Generic,
      name: webhookName,
      url: 'https://example.com/seeded-webhook',
    });
  const channel = {
    type: 'webhook' as const,
    webhookId: String(webhook._id),
  };

  const savedSearchAlertTotal = Math.ceil(count / 2);
  const tileAlertTotal = count - savedSearchAlertTotal;
  const stamp = Date.now();
  const tagsFor = (index: number) => [
    tag,
    FLAVOR_TAGS[index % FLAVOR_TAGS.length],
  ];

  // --- Saved searches: up to MAX_ALERTS_PER_SAVED_SEARCH alerts each --------
  const savedSearchPlans: {
    doc: Record<string, unknown>;
    alerts: number;
    name: string;
    tags: string[];
  }[] = [];
  for (let remaining = savedSearchAlertTotal; remaining > 0; ) {
    const alerts = Math.min(
      remaining,
      randomInt(1, MAX_ALERTS_PER_SAVED_SEARCH),
    );
    const index = savedSearchPlans.length;
    const name = `Seeded search ${stamp}-${index}`;
    const tags = tagsFor(index);
    savedSearchPlans.push({
      alerts,
      name,
      tags,
      doc: {
        team: teamId,
        name,
        select: '',
        where: '',
        whereLanguage: 'lucene',
        source: sourceId,
        tags,
      },
    });
    remaining -= alerts;
  }
  const savedSearchIds = insertInChunks(
    chunk =>
      chunk.map(doc =>
        savedSearches.create(teamId, doc as savedSearches.SavedSearchInput),
      ),
    savedSearchPlans.map(plan => plan.doc),
  );

  const alertDocs: Record<string, unknown>[] = [];
  for (const [plan, savedSearchId] of zip(savedSearchPlans, savedSearchIds)) {
    for (let i = 0; i < plan.alerts; i++) {
      alertDocs.push(
        makeAlertDoc({
          teamId,
          channel,
          index: alertDocs.length,
          displayName: plan.name,
          tags: plan.tags,
          savedSearchId,
        }),
      );
    }
  }

  // --- Dashboards: up to MAX_TILES_PER_DASHBOARD tiles, <=1 alert per tile --
  const dashboardPlans: {
    doc: Record<string, unknown>;
    alertedTiles: { id: string; displayName: string }[];
    tags: string[];
  }[] = [];
  for (let remaining = tileAlertTotal; remaining > 0; ) {
    const index = dashboardPlans.length;
    const tileCount = randomInt(1, MAX_TILES_PER_DASHBOARD);
    const tiles = Array.from({ length: tileCount }, (_, tileIndex) =>
      makeTile(index, tileIndex, String(sourceId)),
    );
    // Some tiles are left un-alerted, which is the normal case on a dashboard.
    const alertedCount = Math.min(remaining, randomInt(1, tileCount));
    const name = `Seeded dashboard ${stamp}-${index}`;
    const tags = tagsFor(index);
    dashboardPlans.push({
      alertedTiles: tiles.slice(0, alertedCount).map(tile => ({
        id: tile.id,
        displayName: formatTileAlertDisplayName(name, tile.config.name),
      })),
      tags,
      doc: {
        team: teamId,
        name,
        tiles,
        tags,
        filters: [],
      },
    });
    remaining -= alertedCount;
  }
  const dashboardIds = insertInChunks(
    chunk =>
      chunk.map(doc =>
        dashboards.create(teamId, doc as dashboards.DashboardInput),
      ),
    dashboardPlans.map(plan => plan.doc),
  );

  for (const [plan, dashboardId] of zip(dashboardPlans, dashboardIds)) {
    for (const tile of plan.alertedTiles) {
      alertDocs.push(
        makeAlertDoc({
          teamId,
          channel,
          index: alertDocs.length,
          displayName: tile.displayName,
          tags: plan.tags,
          dashboardId,
          tileId: tile.id,
        }),
      );
    }
  }

  insertInChunks(
    chunk => chunk.map(doc => alerts.create(teamId, doc as alerts.AlertFields)),
    alertDocs,
  );

  const byState = new Map<string, number>();
  for (const alert of alertDocs) {
    const state = String(alert.state);
    byState.set(state, (byState.get(state) ?? 0) + 1);
  }

  console.log(
    [
      `Seeded ${alertDocs.length} alerts for team ${String(teamId)}:`,
      `  ${savedSearchAlertTotal} on ${savedSearchIds.length} saved searches ` +
        `(<=${MAX_ALERTS_PER_SAVED_SEARCH} each)`,
      `  ${tileAlertTotal} on tiles across ${dashboardIds.length} dashboards ` +
        `(<=${MAX_TILES_PER_DASHBOARD} tiles each, <=1 alert per tile)`,
      `  states: ${[...byState]
        .map(([state, n]) => `${state}=${n}`)
        .join(', ')}`,
      `Tagged "${tag}" — remove with: yarn seed:alerts --purge --tag ${tag}`,
    ].join('\n'),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  openDb(args.sqlitePath ?? undefined);
  migrate();
  try {
    if (args.purge) {
      await purge(args.tag);
    } else {
      await seed(args.count, args.tag);
    }
  } finally {
    closeDb();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
