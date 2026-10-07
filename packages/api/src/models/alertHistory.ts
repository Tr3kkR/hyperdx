import { AlertNotificationTargetTiming } from '@hyperdx/common-utils/dist/types';

import { AlertState, IAlertError } from '@/models/alert';

import type { ObjectId } from './ids';

/**
 * Diagnostics for the evaluation that wrote a history record.
 * Evaluation-level: identical on every row one evaluation writes (including
 * per-group rows).
 */
export interface IAlertHistoryAnalytics {
  /**
   * ClickHouse query duration for the evaluation (ms). On query-failure
   * ERROR records, the time until the query failed — for QUERY_TIMEOUT this
   * is approximately the configured evaluation timeout.
   */
  queryDurationMs?: number;
  /** Wall time delivering the evaluation's notifications (ms) — dispatch only, including retries. */
  webhookDurationMs?: number;
  /**
   * Earlier buckets backfilled in this run after missed ticks
   * (expected buckets − 1). 0 in steady state.
   */
  backfilledBuckets?: number;
  /** Per-target breakdown, slowest first. See AlertHistoryAnalyticsSchema for why these do not sum to the total. */
  notificationTargets?: AlertNotificationTargetTiming[];
}

export interface IAlertHistory {
  alert: ObjectId;
  counts: number;
  createdAt: Date;
  state: AlertState;
  lastValues: { startTime: Date; count: number }[];
  group?: string; // For group-by alerts, stores the group identifier
  fired?: boolean;
  /**
   * Errors recorded for this evaluation window. Present on ERROR-state rows
   * (query/processing failures where no normal history is written) and on
   * the ERROR row created alongside normal rows when notifications fail.
   */
  errors?: IAlertError[];
  /** Diagnostics for the evaluation that wrote this record. */
  analytics?: IAlertHistoryAnalytics;
}
