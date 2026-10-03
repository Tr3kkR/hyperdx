import { getDb, withTransaction } from '@/db';
import * as alertsRepo from '@/db/repos/alerts';
import * as dashboardsRepo from '@/db/repos/dashboards';
import * as savedSearchesRepo from '@/db/repos/savedSearches';
import { deriveAlertDisplayFields } from '@/utils/alerts';
import logger from '@/utils/logger';

const BACKFILL_BATCH_SIZE = 500;

type Candidate = {
  id: string;
  team: string;
  source: string | null;
  savedSearch: string | null;
  dashboard: string | null;
  tileId: string | null;
  chartConfig: string | null;
};

export async function backfillAlertDisplayFields() {
  // sqlite-port: Mongo {$or: [{displayName: {$in:[null,'']}}, {tags:null}]}.
  const ids = getDb()
    .prepare(
      `SELECT id FROM alerts WHERE displayName IS NULL OR displayName='' OR tags IS NULL`,
    )
    .all() as { id: string }[];
  let updatedCount = 0;

  for (let i = 0; i < ids.length; i += BACKFILL_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BACKFILL_BATCH_SIZE).map(row => row.id);
    withTransaction(() => {
      const batch = getDb()
        .prepare(
          `SELECT id,team,source,savedSearch,dashboard,tileId,chartConfig
         FROM alerts WHERE id IN (${batchIds.map(() => '?').join(',')})`,
        )
        .all(...batchIds) as Candidate[];

      for (const row of batch) {
        const alert = alertsRepo.findById(row.id, row.team);
        if (!alert) continue;
        const savedSearch =
          row.savedSearch == null
            ? null
            : savedSearchesRepo.findById(row.savedSearch, row.team);
        const dashboard =
          row.dashboard == null
            ? null
            : dashboardsRepo.findById(row.dashboard, row.team);
        const derived = deriveAlertDisplayFields(alert, {
          savedSearch: savedSearch ?? undefined,
          dashboard: dashboard ?? undefined,
        });
        const unchanged = [
          row.id,
          row.source,
          row.savedSearch,
          row.dashboard,
          row.tileId,
          row.chartConfig,
        ];
        if (
          (!alert.displayName || alert.displayName === '') &&
          derived.displayName != null
        ) {
          // sqlite-port: Mongo bulkWrite CAS with timestamps:false. Compare
          // the source refs and entire chartConfig; leave updatedAt untouched.
          updatedCount += Number(
            getDb()
              .prepare(
                `UPDATE alerts SET displayName=? WHERE id=?
             AND source IS ? AND savedSearch IS ? AND dashboard IS ?
             AND tileId IS ? AND chartConfig IS ?
             AND (displayName IS NULL OR displayName='')`,
              )
              .run(derived.displayName, ...unchanged).changes,
          );
        }
        if (alert.tags == null && derived.tags != null) {
          updatedCount += Number(
            getDb()
              .prepare(
                `UPDATE alerts SET tags=? WHERE id=?
             AND source IS ? AND savedSearch IS ? AND dashboard IS ?
             AND tileId IS ? AND chartConfig IS ? AND tags IS NULL`,
              )
              .run(JSON.stringify(derived.tags), ...unchanged).changes,
          );
        }
      }
    });
  }

  logger.info(
    { scannedCount: ids.length, updatedCount },
    'Backfilled alert display names and tags',
  );
}

export async function runStartupMigrations() {
  try {
    await backfillAlertDisplayFields();
  } catch (e) {
    logger.error({ err: e }, 'Error backfilling alert display names and tags');
  }
}
