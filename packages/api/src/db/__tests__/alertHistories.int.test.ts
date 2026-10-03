/* eslint-disable security/detect-non-literal-fs-filename -- Paths belong to this test's mkdtemp directory. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AlertErrorType } from '@hyperdx/common-utils/dist/types';

import { closeDb, openDb } from '@/db';
import { newId } from '@/db/ids';
import { migrate } from '@/db/migrate';
import * as histories from '@/db/repos/alertHistories';
import { AlertState } from '@/models/alert';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperdx-histories-'));
const file = path.join(directory, 'metadata.db');
const alert = newId();
const window = new Date('2026-01-01T12:00:00.000Z');

beforeAll(() => {
  openDb(file);
  migrate();
});
afterAll(() => {
  closeDb();
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
});

test('groups rows by evaluation window and finds the latest row per group', () => {
  histories.create({
    alert,
    createdAt: window,
    state: AlertState.OK,
    counts: 1,
    group: 'a',
    lastValues: [{ startTime: window, count: 1 }],
  });
  histories.create({
    alert,
    createdAt: window,
    state: AlertState.ALERT,
    counts: 2,
    group: 'b',
    lastValues: [{ startTime: window, count: 2 }],
  });
  const grouped = histories.groupedWindows({
    alert,
    from: window,
    to: window,
    limit: 1,
  });
  expect(grouped).toHaveLength(1);
  expect(grouped[0].rows).toHaveLength(2);
  expect(grouped[0].rows.map(row => row.counts).sort()).toEqual([1, 2]);
  expect(grouped[0].rows[0].lastValues[0].startTime).toEqual(window);
  expect(
    histories.latestPerAlertGroup(
      [alert],
      new Date(window.getTime() + 1),
      window,
    ),
  ).toHaveLength(2);
  expect(
    histories.groupedWindowsBatch([{ alert, from: window }], 1).get(alert)?.[0]
      .rows,
  ).toHaveLength(2);
});

test('upserts one ERROR row for repeated failures in the same window', () => {
  const first = histories.upsertError(alert, window, [
    {
      timestamp: window,
      type: AlertErrorType.QUERY_ERROR,
      message: 'first',
    },
  ]);
  const second = histories.upsertError(alert, window, [
    {
      timestamp: window,
      type: AlertErrorType.QUERY_ERROR,
      message: 'second',
    },
  ]);
  expect(second._id).toBe(first._id);
  expect(second.errors?.[0].message).toBe('second');
  expect(
    histories.groupedWindows({
      alert,
      from: window,
      to: window,
    })[0].rows,
  ).toHaveLength(3);
  expect(histories.deleteErrors(alert, window)).toBe(1);
});
