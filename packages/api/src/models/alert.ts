import {
  AlertChartConfig,
  AlertErrorType,
  AlertThresholdType,
} from '@hyperdx/common-utils/dist/types';
export { AlertThresholdType } from '@hyperdx/common-utils/dist/types';

import type { ObjectId } from './ids';

export enum AlertState {
  ALERT = 'ALERT',
  DISABLED = 'DISABLED',
  /**
   * Only used on AlertHistory records (never on the alert itself): marks an
   * evaluation window whose evaluation or notification failed. ERROR history
   * rows are excluded from alert scheduling/backfill computations so the
   * failed window is still retried.
   */
  ERROR = 'ERROR',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  OK = 'OK',
  PENDING = 'PENDING',
}

export interface IAlertError {
  timestamp: Date;
  type: AlertErrorType;
  message: string;
}

// follow 'ms' pkg formats
export type AlertInterval =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '6h'
  | '12h'
  | '1d';

export type AlertChannel =
  | {
      type: 'webhook';
      webhookId: string;
    }
  | {
      type: null;
    };

/**
 * Resolve an alert's notification channels regardless of document vintage:
 * documents written before multi-channel support only have the singular
 * `channel`. Writers keep `channel` mirrored to `channels[0]`.
 */
export const getAlertChannels = (alert: {
  channel?: AlertChannel | null;
  channels?: AlertChannel[] | null;
}): AlertChannel[] => {
  if (alert.channels != null && alert.channels.length > 0) {
    return alert.channels;
  }
  if (alert.channel != null && alert.channel.type != null) {
    return [alert.channel];
  }
  return [];
};

export enum AlertSource {
  SAVED_SEARCH = 'saved_search',
  TILE = 'tile',
  /** Detached alert whose chart config lives inline on the alert (no saved search/tile). */
  INLINE = 'inline',
}

export interface IAlert {
  id: string;
  channel: AlertChannel;
  channels?: AlertChannel[];
  interval: AlertInterval;
  scheduleOffsetMinutes?: number;
  scheduleStartAt?: Date | null;
  source?: AlertSource;
  state: AlertState;
  team: ObjectId;
  threshold: number;
  /** The upper bound for BETWEEN and NOT BETWEEN threshold types */
  thresholdMax?: number;
  thresholdType: AlertThresholdType;
  createdBy?: ObjectId;

  // Message template (handlebars)
  name?: string | null;
  message?: string | null;

  // Freeform note (supports markdown)
  note?: string | null;

  // User-facing name shown in the alerts list and notification titles (when not overridden by name template).
  // Unset means "derive from the referenced saved search / dashboard tile".
  displayName?: string | null;
  // Unset (not []) means "derive from the referenced entity".
  tags?: string[] | null;

  // SavedSearch alerts
  groupBy?: string | null;
  savedSearch?: ObjectId | null;

  // Tile alerts
  dashboard?: ObjectId | null;
  tileId?: string | null;

  // Inline alerts: the persisted chart config (same shape as a dashboard
  // tile's config, minus the embedded alert field)
  chartConfig?: AlertChartConfig | null;

  // Silenced
  silenced?: {
    by?: ObjectId;
    at: Date;
    until: Date;
  };

  // Multi-window alerting: fire only after N violations in M consecutive windows
  numConsecutiveWindows?: number | null;

  // Errors recorded during the most recent execution
  executionErrors?: IAlertError[];
  createdAt: Date;
  updatedAt: Date;
}

export type AlertDocument = IAlert & {
  _id: ObjectId;
};
