import { ObjectId } from 'bson';

import { createTeam } from '@/controllers/team';
import { getDb } from '@/db';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import { backfillAlertDisplayFields } from '@/migrations';
import { AlertSource, AlertThresholdType } from '@/models/alert';
import { createAlertFixture, findAlertFixture } from '@/test/sqliteMetadata';
import { createDashboardFixture } from '@/test/sqliteMetadata';
import {
  createSavedSearchFixture,
  setSavedSearchNameFixture,
} from '@/test/sqliteMetadata';

const baseAlert = {
  threshold: 1,
  thresholdType: AlertThresholdType.ABOVE,
  interval: '5m',
  channel: { type: null },
} as const;

const makeSavedSearch = (
  team: ObjectId | string,
  fields: { name: string; tags?: string[] },
) =>
  createSavedSearchFixture({
    team,
    source: new ObjectId(),
    select: '',
    where: '',
    whereLanguage: 'lucene',
    orderBy: '',
    ...fields,
  });

describe('backfillAlertDisplayFields', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  it('backfills missing alert names and tags from the referenced documents', async () => {
    const team = await createTeam({ name: 'Test team' });
    const savedSearch = await makeSavedSearch(team._id, {
      name: 'Error spikes',
      tags: ['errors', 'prod'],
    });
    const untaggedSearch = await makeSavedSearch(team._id, {
      name: 'Untagged search',
    });
    const dashboard = createDashboardFixture({
      team: team._id,
      name: 'Service health',
      tags: ['infra'],
      tiles: [{ id: 'tile-1', config: { name: 'P95 latency' } }],
    });

    const [
      searchAlert,
      untaggedSearchAlert,
      tileAlert,
      missingTileAlert,
      namedAlert,
      taggedAlert,
      clearedTagsAlert,
      danglingAlert,
      inlineAlert,
    ] = await createAlertFixture([
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: untaggedSearch._id,
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.TILE,
        dashboard: dashboard._id,
        tileId: 'tile-1',
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.TILE,
        dashboard: dashboard._id,
        tileId: 'deleted-tile',
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
        displayName: 'Custom name',
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
        tags: ['keep-me'],
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
        tags: [],
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: new ObjectId(),
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.INLINE,
        chartConfig: { name: 'CPU usage', displayType: 'line' },
      },
    ]);

    await backfillAlertDisplayFields();

    const byId = async (id: ObjectId | string) => findAlertFixture(id);

    expect(await byId(searchAlert._id)).toMatchObject({
      displayName: 'Error spikes',
      tags: ['errors', 'prod'],
    });
    expect(await byId(tileAlert._id)).toMatchObject({
      displayName: 'Service health - P95 latency',
      tags: ['infra'],
    });
    expect((await byId(missingTileAlert._id))?.displayName).toBe(
      'Service health - Tile',
    );
    expect(await byId(namedAlert._id)).toMatchObject({
      displayName: 'Custom name',
      tags: ['errors', 'prod'],
    });
    expect(await byId(taggedAlert._id)).toMatchObject({
      displayName: 'Error spikes',
      tags: ['keep-me'],
    });
    expect(await byId(clearedTagsAlert._id)).toMatchObject({
      displayName: 'Error spikes',
      tags: [],
    });
    expect(await byId(inlineAlert._id)).toMatchObject({
      displayName: 'CPU usage',
      tags: [],
    });
    const untagged = await byId(untaggedSearchAlert._id);
    expect(untagged?.displayName).toBe('Untagged search');
    expect(untagged?.tags).toEqual([]);

    expect((await byId(searchAlert._id))?.updatedAt).toEqual(
      searchAlert.updatedAt,
    );

    const dangling = await byId(danglingAlert._id);
    expect(dangling?.displayName).toBeUndefined();
    expect(dangling?.tags).toBeUndefined();
  });

  it('is idempotent: re-running fills newly missing fields and never touches populated ones', async () => {
    const team = await createTeam({ name: 'Test team' });
    const savedSearch = await makeSavedSearch(team._id, { name: 'First name' });
    const [alert, otherAlert] = await createAlertFixture([
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
      },
      {
        ...baseAlert,
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
      },
    ]);

    await backfillAlertDisplayFields();
    expect((await findAlertFixture(alert._id))?.displayName).toBe('First name');

    setSavedSearchNameFixture(savedSearch._id, 'Second name');
    getDb()
      .prepare('UPDATE alerts SET displayName=NULL WHERE id=?')
      .run(otherAlert.id);

    await backfillAlertDisplayFields();
    expect((await findAlertFixture(alert._id))?.displayName).toBe('First name');
    expect((await findAlertFixture(otherAlert._id))?.displayName).toBe(
      'Second name',
    );
  });
});
