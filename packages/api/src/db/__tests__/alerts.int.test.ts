/* eslint-disable security/detect-non-literal-fs-filename -- Paths belong to this test's mkdtemp directory. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';

import { closeDb, openDb } from '@/db';
import { newId } from '@/db/ids';
import { migrate } from '@/db/migrate';
import * as alerts from '@/db/repos/alerts';
import { AlertSource } from '@/models/alert';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperdx-alerts-'));
const file = path.join(directory, 'metadata.db');
const team = newId();

beforeAll(() => {
  openDb(file);
  migrate();
});
afterAll(() => {
  closeDb();
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
});

test('preserves omitted fields and clears a stale range bound', () => {
  const created = alerts.create(team, {
    threshold: 5,
    thresholdMax: 9,
    thresholdType: AlertThresholdType.BETWEEN,
    interval: '5m',
    channel: { type: null },
    tags: [],
  });
  expect(created.state).toBe('OK');
  expect(created.source).toBe(AlertSource.SAVED_SEARCH);
  expect(created).not.toHaveProperty('scheduleStartAt');
  expect(created.tags).toEqual([]);

  const updated = alerts.update(created.id, team, {
    thresholdType: AlertThresholdType.ABOVE,
  });
  expect(updated?.thresholdMax).toBeUndefined();
  expect(updated?.threshold).toBe(5);
  expect(alerts.findById(created.id, newId())).toBeNull();
});

test('counts webhook references in either channel representation', () => {
  const webhook = newId();
  alerts.create(team, {
    threshold: 1,
    interval: '5m',
    channel: { type: null },
    channels: [{ type: 'webhook', webhookId: webhook }],
  });
  expect(alerts.countReferencingWebhook(team, webhook)).toBe(1);
  expect(alerts.countReferencingWebhook(newId(), webhook)).toBe(0);
});

test('upserts one tile alert and retains its id', () => {
  const dashboard = newId();
  const fields: alerts.AlertFields = {
    threshold: 1,
    interval: '5m',
    channel: { type: null },
  };
  const first = alerts.upsertTileAlert(team, dashboard, 'tile', fields);
  const second = alerts.upsertTileAlert(team, dashboard, 'tile', {
    ...fields,
    threshold: 2,
  });
  expect(second.id).toBe(first.id);
  expect(second.threshold).toBe(2);
  expect(alerts.count(team)).toBe(3);
});

test('pages from null names into byte-wise mixed-case names without repeats', () => {
  const pageTeam = newId();
  const ids = [1, 2, 3, 4, 5].map(n => n.toString(16).padStart(24, '0'));
  const names = [null, null, 'Apple', 'apple', 'zebra'];
  for (let i = 0; i < ids.length; i++) {
    alerts.create(
      pageTeam,
      {
        threshold: 1,
        interval: '5m',
        channel: { type: null },
        displayName: names[i],
      },
      ids[i],
    );
  }
  const first = alerts.page(pageTeam, { limit: 2 });
  expect(first.map(alert => alert.id)).toEqual(ids.slice(0, 2));
  const second = alerts.page(pageTeam, {
    cursor: { name: null, id: first[1].id },
    limit: 2,
  });
  expect(second.map(alert => alert.displayName)).toEqual(['Apple', 'apple']);
  const third = alerts.page(pageTeam, {
    cursor: { name: second[1].displayName!, id: second[1].id },
    limit: 2,
  });
  expect(third.map(alert => alert.displayName)).toEqual(['zebra']);
});
