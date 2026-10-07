import { displayTypeSupportsRawSqlAlerts } from '@hyperdx/common-utils/dist/core/utils';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  AlertChartConfig,
  RawSqlSavedChartConfig,
  Tile,
} from '@hyperdx/common-utils/dist/types';
import ms from 'ms';
import { URLSearchParams } from 'url';

import { ClickhouseClient } from '@/clickhouse';
import * as config from '@/config';
import { LOCAL_APP_TEAM } from '@/controllers/team';
import { closeDb, openDb, withTransaction } from '@/db';
import { normalizeId } from '@/db/ids';
import { migrate } from '@/db/migrate';
import * as historiesRepo from '@/db/repos/alertHistories';
import * as alertsRepo from '@/db/repos/alerts';
import * as connectionsRepo from '@/db/repos/connections';
import * as dashboardsRepo from '@/db/repos/dashboards';
import * as savedSearchesRepo from '@/db/repos/savedSearches';
import type { SourceDoc } from '@/db/repos/sources';
import * as sourcesRepo from '@/db/repos/sources';
import type { WebhookLike as IWebhook } from '@/db/repos/webhooks';
import * as webhooksRepo from '@/db/repos/webhooks';
import { pruneExpired } from '@/db/retention';
import {
  AlertSource,
  AlertState,
  type IAlert,
  type IAlertError,
} from '@/models/alert';
import { IAlertHistory, IAlertHistoryAnalytics } from '@/models/alertHistory';
import type { ObjectId } from '@/models/ids';
import {
  AggregatedAlertHistory,
  getConsecutiveWindowHistories,
  getPreviousAlertHistories,
} from '@/tasks/checkAlerts';
import {
  type AlertConnection,
  type AlertDetails,
  type AlertProvider,
  type AlertTask,
  AlertTaskType,
  type SavedSearchLike,
} from '@/tasks/checkAlerts/providers';
import { MappedOmit } from '@/tasks/types';
import { convertMsToGranularityString } from '@/utils/common';
import logger from '@/utils/logger';

type PartialAlertDetails = MappedOmit<AlertDetails, 'previousMap'>;

async function getSavedSearchDetails(
  alert: IAlert,
): Promise<[AlertConnection, PartialAlertDetails] | []> {
  const savedSearchId = alert.savedSearch;
  const savedSearch = savedSearchesRepo.findById(
    String(savedSearchId),
    String(alert.team),
  );

  if (!savedSearch) {
    logger.error({
      message: 'savedSearch not found',
      savedSearchId,
      alertId: alert.id,
    });
    return [];
  }

  const source = sourcesRepo.findById(
    String(savedSearch.source),
    String(alert.team),
  );
  if (!source) return [];
  const connId = source.connection;
  const conn = connectionsRepo.findByIdWithPassword(connId, String(alert.team));
  if (!conn) {
    logger.error({
      message: 'connection not found',
      alertId: alert.id,
      connId,
      savedSearchId,
    });
    return [];
  }

  return [
    conn,
    {
      alert,
      source,
      taskType: AlertTaskType.SAVED_SEARCH,
      savedSearch,
    },
  ];
}

/**
 * Load the optional source a raw-SQL config references for macro metadata
 * ($__sourceTable, metricTables). Write-path validation guarantees the source
 * belongs to the config's connection at save time, but a source can be moved
 * to a different connection afterwards. The query always executes through the
 * config's pinned connection, so metadata from a moved source would silently
 * target the wrong database (when the same table exists there) or fail
 * confusingly. Drop it instead, with a warning: templates that don't use
 * source macros keep evaluating correctly, and templates that do fail with a
 * visible query error recorded on the alert.
 */
async function getRawSqlSourceMetadata(
  alert: IAlert,
  chartConfig: RawSqlSavedChartConfig,
): Promise<SourceDoc | undefined> {
  if (!chartConfig.source) {
    return undefined;
  }
  const sourceDoc = sourcesRepo.findById(
    chartConfig.source,
    String(alert.team),
  );
  if (!sourceDoc) {
    return undefined;
  }
  // sqlite-port: ObjectId.equals on Mongo refs becomes normalized hex
  // comparison, including uppercase representations.
  if (
    normalizeId(String(sourceDoc.connection)) !==
    normalizeId(chartConfig.connection)
  ) {
    logger.warn({
      message:
        'raw sql alert source has moved to a different connection; ignoring its metadata',
      alertId: alert.id,
      sourceId: chartConfig.source,
      sourceConnectionId: String(sourceDoc.connection),
      configConnectionId: chartConfig.connection,
    });
    return undefined;
  }
  return sourceDoc;
}

async function getTileDetails(
  alert: IAlert,
): Promise<[AlertConnection, PartialAlertDetails] | []> {
  const dashboardId = alert.dashboard;
  const tileId = alert.tileId;

  const dashboard = dashboardsRepo.findById(
    String(dashboardId),
    String(alert.team),
  );
  if (!dashboard) {
    logger.error({
      message: 'dashboard not found',
      dashboardId,
      alertId: alert.id,
    });
    return [];
  }

  const tile = dashboard.tiles?.find((t: Tile) => t.id === tileId);
  if (!tile) {
    logger.error({
      message: 'tile matching alert not found',
      tileId,
      dashboardId: dashboard._id,
      alertId: alert.id,
    });
    return [];
  }

  if (isRawSqlSavedChartConfig(tile.config)) {
    if (!displayTypeSupportsRawSqlAlerts(tile.config.displayType)) {
      logger.warn({
        tileId,
        dashboardId: dashboard._id,
        alertId: alert.id,
        message:
          'skipping alert with raw sql chart config, only line/bar display types are supported',
      });
      return [];
    }

    // Raw SQL tiles store connection ID directly on the config
    const connection = connectionsRepo.findByIdWithPassword(
      tile.config.connection,
      String(alert.team),
    );

    if (!connection) {
      logger.error({
        message: 'connection not found for raw sql tile',
        connectionId: tile.config.connection,
        tileId,
        dashboardId: dashboard._id,
        alertId: alert.id,
      });
      return [];
    }

    // Optionally look up source for filter/macro metadata
    const source = await getRawSqlSourceMetadata(alert, tile.config);

    return [
      connection,
      {
        alert,
        source,
        taskType: AlertTaskType.TILE,
        tile,
        dashboard,
      },
    ];
  }

  const source = sourcesRepo.findById(tile.config.source!, String(alert.team));
  if (!source) {
    logger.error({
      message: 'source not found',
      sourceId: tile.config.source,
      tileId,
      dashboardId: dashboard._id,
      alertId: alert.id,
    });
    return [];
  }

  const connection = connectionsRepo.findByIdWithPassword(
    source.connection,
    String(alert.team),
  );
  if (!connection) {
    logger.error({
      message: 'connection not found',
      alertId: alert.id,
      tileId,
      dashboardId: dashboard._id,
      sourceId: source.id,
    });
    return [];
  }

  return [
    connection,
    {
      alert,
      source,
      taskType: AlertTaskType.TILE,
      tile,
      dashboard,
    },
  ];
}

async function getInlineAlertDetails(
  alert: IAlert,
): Promise<[AlertConnection, PartialAlertDetails] | []> {
  const chartConfig = alert.chartConfig;
  if (chartConfig == null) {
    logger.error({
      message: 'inline alert has no chartConfig',
      alertId: alert.id,
    });
    return [];
  }

  if (isRawSqlSavedChartConfig(chartConfig)) {
    if (!displayTypeSupportsRawSqlAlerts(chartConfig.displayType)) {
      logger.warn({
        alertId: alert.id,
        message:
          'skipping inline alert with raw sql chart config, only line/bar/number display types are supported',
      });
      return [];
    }

    // Raw SQL configs store the connection ID directly
    const connection = connectionsRepo.findByIdWithPassword(
      chartConfig.connection,
      String(alert.team),
    );

    if (!connection) {
      logger.error({
        message: 'connection not found for raw sql inline alert',
        connectionId: chartConfig.connection,
        alertId: alert.id,
      });
      return [];
    }

    // Optionally look up source for filter/macro metadata
    const source = await getRawSqlSourceMetadata(alert, chartConfig);

    return [
      connection,
      {
        alert,
        source,
        taskType: AlertTaskType.INLINE,
        chartConfig,
      },
    ];
  }

  const source = sourcesRepo.findById(chartConfig.source!, String(alert.team));
  if (!source) {
    logger.error({
      message: 'source not found',
      sourceId: chartConfig.source,
      alertId: alert.id,
    });
    return [];
  }

  const connection = connectionsRepo.findByIdWithPassword(
    source.connection,
    String(alert.team),
  );
  if (!connection) {
    logger.error({
      message: 'connection not found',
      alertId: alert.id,
      sourceId: source.id,
    });
    return [];
  }

  return [
    connection,
    {
      alert,
      source,
      taskType: AlertTaskType.INLINE,
      chartConfig,
    },
  ];
}

async function loadAlert(
  alert: IAlert,
  groupedTasks: Map<string, AlertTask>,
  previousAlerts: Map<string, AggregatedAlertHistory>,
  recentHistoryMap: Map<string, AggregatedAlertHistory[]>,
  now: Date,
) {
  if (!alert.source) {
    throw new Error('alert does not have a source');
  }

  if (config.IS_LOCAL_APP_MODE) {
    alert.team = LOCAL_APP_TEAM.id;
  }

  let conn: AlertConnection | undefined;
  let details: PartialAlertDetails | undefined;
  switch (alert.source) {
    case AlertSource.SAVED_SEARCH:
      [conn, details] = await getSavedSearchDetails(alert);
      break;

    case AlertSource.TILE:
      [conn, details] = await getTileDetails(alert);
      break;

    case AlertSource.INLINE:
      [conn, details] = await getInlineAlertDetails(alert);
      break;

    default:
      throw new Error(`unsupported source: ${alert.source}`);
  }

  if (!details) {
    throw new Error('failed to fetch alert details');
  }

  if (!conn) {
    throw new Error('failed to fetch alert connection');
  }

  if (!groupedTasks.has(conn.id)) {
    groupedTasks.set(conn.id, { alerts: [], conn, now });
  }
  const v = groupedTasks.get(conn.id);
  if (!v) {
    throw new Error(`provider did not set key ${conn.id} before appending`);
  }
  v.alerts.push({
    ...details,
    previousMap: previousAlerts,
    recentHistoryMap,
  });
}

export default class DefaultAlertProvider implements AlertProvider {
  async init() {
    openDb();
    migrate();
    pruneExpired();
  }

  async asyncDispose() {
    closeDb();
  }

  async getAlertTasks(): Promise<AlertTask[]> {
    const groupedTasks = new Map<string, AlertTask>();
    const alerts = alertsRepo.list();

    const now = new Date();
    const alertIds = alerts.map(({ id }) => id);
    const [previousAlerts, recentHistoryMap] = await Promise.all([
      getPreviousAlertHistories(alertIds, now),
      getConsecutiveWindowHistories(alerts, now),
    ]);

    for (const alert of alerts) {
      try {
        await loadAlert(
          alert,
          groupedTasks,
          previousAlerts,
          recentHistoryMap,
          now,
        );
      } catch (e) {
        logger.error({
          message: `failed to load alert: ${e}`,
          alertId: alert.id,
          team: alert.team,
          channel: alert.channel,
          provider: 'default',
        });
      }
    }

    // Flatten out our groupings for execution
    return Array.from(groupedTasks.values());
  }

  buildLogSearchLink({
    endTime,
    savedSearch,
    startTime,
  }: {
    endTime: Date;
    savedSearch: SavedSearchLike;
    startTime: Date;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/search/${savedSearch.id}`);
    const queryParams = new URLSearchParams({
      from: startTime.getTime().toString(),
      to: endTime.getTime().toString(),
      isLive: 'false',
    });
    url.search = queryParams.toString();
    return url.toString();
  }

  buildChartLink({
    dashboardId,
    endTime,
    granularity,
    startTime,
    tileId,
  }: {
    dashboardId: string;
    endTime: Date;
    granularity: string;
    startTime: Date;
    tileId?: string;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/dashboards/${dashboardId}`);
    // extend both start and end time by 7x granularity
    const from = (startTime.getTime() - ms(granularity) * 7).toString();
    const to = (endTime.getTime() + ms(granularity) * 7).toString();
    const queryParams = new URLSearchParams({
      from,
      granularity: convertMsToGranularityString(ms(granularity)),
      to,
    });
    if (tileId) {
      queryParams.set('highlightedTileId', tileId);
    }
    url.search = queryParams.toString();
    return url.toString();
  }

  buildChartExplorerLink({
    chartConfig,
    endTime,
    granularity,
    startTime,
  }: {
    chartConfig: AlertChartConfig;
    endTime: Date;
    granularity: string;
    startTime: Date;
  }): string {
    const url = new URL(`${config.FRONTEND_URL}/chart`);
    // Extend both start and end time by 7x granularity, matching the
    // dashboard link so the alerting window has surrounding context. The
    // chart explorer reads `config` (JSON) and `from`/`to` (epoch ms).
    const from = (startTime.getTime() - ms(granularity) * 7).toString();
    const to = (endTime.getTime() + ms(granularity) * 7).toString();
    const queryParams = new URLSearchParams({
      config: JSON.stringify(chartConfig),
      from,
      to,
    });
    url.search = queryParams.toString();
    return url.toString();
  }

  async updateAlertState(
    alertId: string,
    histories: IAlertHistory[],
    errors: IAlertError[],
    evaluatedDateRange?: [Date, Date],
  ) {
    const finalState = histories.some(h => h.state === AlertState.ALERT)
      ? AlertState.ALERT
      : histories.some(h => h.state === AlertState.PENDING)
        ? AlertState.PENDING
        : AlertState.OK;
    const evaluationWindowStart = histories[0]?.createdAt;
    // sqlite-port: Mongo's partial Promise.allSettled history writes and
    // separate state update become one atomic evaluation transaction.
    withTransaction(() => {
      historiesRepo.createMany(histories);
      const alert = alertsRepo.findById(alertId);
      if (!alert) throw new Error(`Alert ${alertId} not found`);
      alertsRepo.update(alertId, alert.team, {
        state: finalState,
        executionErrors: errors,
      });
      if (evaluationWindowStart != null && histories.length > 0) {
        historiesRepo.deleteErrors(
          alertId,
          evaluationWindowStart,
          evaluatedDateRange?.[0],
        );
        if (errors.length > 0) {
          historiesRepo.upsertError(
            alertId,
            evaluationWindowStart,
            errors,
            histories[0]?.analytics,
          );
        }
      }
    });
  }

  async recordAlertErrors(
    alertId: string,
    errors: IAlertError[],
    evaluationWindowStart?: Date,
    analytics?: IAlertHistoryAnalytics,
  ) {
    withTransaction(() => {
      const alert = alertsRepo.findById(alertId);
      if (!alert) throw new Error(`Alert ${alertId} not found`);
      alertsRepo.update(alertId, alert.team, { executionErrors: errors });
      if (evaluationWindowStart != null) {
        historiesRepo.upsertError(
          alertId,
          evaluationWindowStart,
          errors,
          analytics,
        );
      }
    });
  }

  async getWebhooks(teamId: string | ObjectId) {
    const webhooks = webhooksRepo.list(String(teamId));
    return new Map<string, IWebhook>(webhooks.map(w => [w.id, w]));
  }

  async getClickHouseClient(
    { host, username, password, id }: AlertConnection,
    requestTimeout?: number,
  ): Promise<ClickhouseClient> {
    if (!password && password !== '') {
      logger.info({
        message: `connection password not found`,
        connectionId: id,
        provider: 'default',
      });
    }

    return new ClickhouseClient({
      host,
      username,
      password,
      application: `hyperdx-alerts ${config.CODE_VERSION}`,
      requestTimeout: requestTimeout ?? 30_000,
    });
  }
}
