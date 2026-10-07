import {
  SourceKind,
  TSource,
  type TSourceNoId,
  UseTextIndex,
} from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'bson';
import express from 'express';
import request from 'supertest';

import { LOCAL_APP_TEAM_ID } from '@/controllers/team';
import { getDb } from '@/db';
import * as connectionsRepo from '@/db/repos/connections';
import * as sourcesRepo from '@/db/repos/sources';
import {
  getLoggedInAgent as getFixtureLoggedInAgent,
  getServer,
} from '@/fixtures';
import { appErrorHandler } from '@/middleware/error';
import sourcesRouter from '@/routers/api/sources';

const MOCK_SOURCE: Omit<Extract<TSource, { kind: 'log' }>, 'id'> = {
  kind: SourceKind.Log,
  name: 'Test Source',
  connection: new ObjectId().toString(),
  from: {
    databaseName: 'test_db',
    tableName: 'test_table',
  },
  timestampValueExpression: 'timestamp',
  defaultTableSelectExpression: 'body',
};

const MOCK_METRIC_SOURCE: Omit<Extract<TSource, { kind: 'metric' }>, 'id'> = {
  kind: SourceKind.Metric,
  name: 'Test Metric Source',
  connection: new ObjectId().toString(),
  from: {
    databaseName: 'test_db',
    tableName: '',
  },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: {
    gauge: 'otel_metrics_gauge',
    histogram: 'otel_metrics_histogram',
    sum: 'otel_metrics_sum',
    summary: 'otel_metrics_summary',
    'exponential histogram': 'otel_metrics_exponential_histogram',
  },
};

const createTestConnection = (team: ObjectId, id: string) =>
  connectionsRepo.create(String(team), {
    _id: id,
    name: 'Test Connection',
    host: 'http://localhost:8123',
    username: 'default',
    password: 'password',
  });

const createSourceFixture = (input: {
  team: string | ObjectId;
  [key: string]: unknown;
}) => {
  const { team, ...source } = input;
  return sourcesRepo.create(String(team), source as TSourceNoId);
};

const findSourceFixture = (id: string | ObjectId) =>
  sourcesRepo.findById(String(id));

const getLoggedInAgent = async (server: ReturnType<typeof getServer>) => {
  const result = await getFixtureLoggedInAgent(server);

  await Promise.all([
    createTestConnection(result.team._id, MOCK_SOURCE.connection),
    createTestConnection(result.team._id, MOCK_METRIC_SOURCE.connection),
  ]);

  return result;
};

describe('sources router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET / - returns all sources for a team', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create test source
    await createSourceFixture({
      ...MOCK_SOURCE,
      team: new ObjectId(team._id),
    });

    const response = await agent.get('/sources').expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      kind: MOCK_SOURCE.kind,
      name: MOCK_SOURCE.name,
      from: MOCK_SOURCE.from,
      timestampValueExpression: MOCK_SOURCE.timestampValueExpression,
    });
  });

  it('GET / - returns empty array when no sources exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const response = await agent.get('/sources').expect(200);

    expect(response.body).toEqual([]);
  });

  it('POST / - creates a new source', async () => {
    const { agent } = await getLoggedInAgent(server);

    const response = await agent.post('/sources').send(MOCK_SOURCE).expect(200);

    expect(response.body).toMatchObject({
      kind: MOCK_SOURCE.kind,
      name: MOCK_SOURCE.name,
      from: MOCK_SOURCE.from,
      timestampValueExpression: MOCK_SOURCE.timestampValueExpression,
    });

    // Verify source was created in database
    const sources = await sourcesRepo.list();
    expect(sources).toHaveLength(1);
  });

  describe('connection validation', () => {
    it('POST / - returns 400 for a malformed connection id', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, connection: 'not-an-object-id' })
        .expect(400);
    });

    it('POST / - returns 400 for a nonexistent connection id', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/sources')
        .send({
          ...MOCK_SOURCE,
          connection: new ObjectId().toString(),
        })
        .expect(400);
    });

    it('POST / - returns 400 for another team connection', async () => {
      const { agent } = await getLoggedInAgent(server);
      const otherConnection = await createTestConnection(
        new ObjectId(),
        new ObjectId().toString(),
      );

      await agent
        .post('/sources')
        .send({
          ...MOCK_SOURCE,
          connection: otherConnection._id.toString(),
        })
        .expect(400);
    });

    it('PUT /:id - rejects an inaccessible connection without changing the source', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
      });
      const otherConnection = await createTestConnection(
        new ObjectId(),
        new ObjectId().toString(),
      );

      await agent
        .put(`/sources/${source._id}`)
        .send({
          ...MOCK_SOURCE,
          id: source._id.toString(),
          connection: otherConnection._id.toString(),
        })
        .expect(400);

      const unchanged = await findSourceFixture(source._id);
      expect(unchanged?.name).toBe(MOCK_SOURCE.name);
      expect(unchanged?.connection.toString()).toBe(MOCK_SOURCE.connection);
    });

    it('PUT /:id - returns 400 for a nonexistent connection id', async () => {
      const { agent, team } = await getLoggedInAgent(server);
      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
      });

      await agent
        .put(`/sources/${source._id}`)
        .send({
          ...MOCK_SOURCE,
          id: source._id.toString(),
          connection: new ObjectId().toString(),
        })
        .expect(400);
    });
  });

  it('POST / - returns 400 when request body is invalid', async () => {
    const { agent } = await getLoggedInAgent(server);

    // Missing required fields
    await agent
      .post('/sources')
      .send({
        kind: SourceKind.Log,
        name: 'Test Source',
      })
      .expect(400);
  });

  describe('querySettings validation', () => {
    it('POST / - accepts and persists valid querySettings', async () => {
      const { agent } = await getLoggedInAgent(server);

      const querySettings = [
        { setting: 'max_execution_time', value: '60' },
        { setting: 'max_memory_usage', value: '10000000000' },
      ];

      const response = await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, querySettings })
        .expect(200);

      expect(response.body.querySettings).toEqual(querySettings);

      const sources = await sourcesRepo.list();
      expect(sources).toHaveLength(1);
      expect(sources[0]?.querySettings).toEqual(querySettings);
    });

    it('POST / - accepts querySettings at the limit of 10 items', async () => {
      const { agent } = await getLoggedInAgent(server);

      const querySettings = Array.from({ length: 10 }, (_, i) => ({
        setting: `setting_${i}`,
        value: `value_${i}`,
      }));

      const response = await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, querySettings })
        .expect(200);

      expect(response.body.querySettings).toHaveLength(10);

      const sources = await sourcesRepo.list();
      expect(sources[0]?.querySettings).toHaveLength(10);
    });

    it('POST / - rejects querySettings exceeding the limit of 10', async () => {
      const { agent } = await getLoggedInAgent(server);

      const querySettings = Array.from({ length: 11 }, (_, i) => ({
        setting: `setting_${i}`,
        value: `value_${i}`,
      }));

      const response = await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, querySettings });

      expect(response.status).toBe(400);
      const sources = await sourcesRepo.list();
      expect(sources).toHaveLength(0);
    });

    it('POST / - returns 400 when querySettings item has empty setting or value', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/sources')
        .send({
          ...MOCK_SOURCE,
          querySettings: [{ setting: '', value: 'x' }],
        })
        .expect(400);

      await agent
        .post('/sources')
        .send({
          ...MOCK_SOURCE,
          querySettings: [{ setting: 'x', value: '' }],
        })
        .expect(400);
    });

    it('PUT /:id - accepts and persists valid querySettings', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
      });

      const querySettings = [{ setting: 'max_execution_time', value: '120' }];

      await agent
        .put(`/sources/${source._id}`)
        .send({
          ...MOCK_SOURCE,
          id: source._id.toString(),
          querySettings,
        })
        .expect(200);

      const updated = await findSourceFixture(source._id);
      expect(updated?.querySettings).toEqual(querySettings);
    });

    it('PUT /:id - rejects querySettings exceeding the limit of 10', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
      });

      const querySettings = Array.from({ length: 11 }, (_, i) => ({
        setting: `setting_${i}`,
        value: `value_${i}`,
      }));

      const response = await agent.put(`/sources/${source._id}`).send({
        ...MOCK_SOURCE,
        id: source._id.toString(),
        querySettings,
      });

      expect(response.status).toBe(400);
      const updated = await findSourceFixture(source._id);
      expect(updated?.querySettings).toEqual([]); // defaults to [] when source created
    });
  });

  it('PUT /:id - updates an existing source', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create test source
    const source = await createSourceFixture({
      ...MOCK_SOURCE,
      team: new ObjectId(team._id),
    });

    const updatedSource = {
      ...MOCK_SOURCE,
      id: source._id.toString(),
      name: 'Updated Name',
    };

    await agent.put(`/sources/${source._id}`).send(updatedSource).expect(200);

    // Verify source was updated
    const updatedSourceFromDB = await findSourceFixture(source._id);
    expect(updatedSourceFromDB?.name).toBe('Updated Name');
  });

  it('PUT /:id - returns 404 when source does not exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const nonExistentId = new ObjectId().toString();

    await agent
      .put(`/sources/${nonExistentId}`)
      .send({
        ...MOCK_SOURCE,
        id: nonExistentId,
      })
      .expect(404);
  });

  it('PUT /:id - cleans up type-specific properties when changing source kind', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create a metric source with metricTables property
    const metricSource = await createSourceFixture({
      kind: SourceKind.Metric,
      name: 'Test Metric Source',
      connection: MOCK_METRIC_SOURCE.connection,
      from: {
        databaseName: 'test_db',
        tableName: 'otel_metrics',
      },
      timestampValueExpression: 'TimeUnix',
      resourceAttributesExpression: 'ResourceAttributes',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        sum: 'otel_metrics_sum',
      },
      team: new ObjectId(team._id),
    });

    // Verify the metric source has metricTables
    const createdSource = await findSourceFixture(metricSource._id);
    expect(createdSource).toHaveProperty('metricTables');

    // Update the source to a trace source
    const traceSource = {
      id: metricSource._id.toString(),
      kind: SourceKind.Trace,
      name: 'Test Trace Source',
      connection: metricSource.connection,
      from: {
        databaseName: 'test_db',
        tableName: 'otel_traces',
      },
      timestampValueExpression: 'Timestamp',
      durationExpression: 'Duration',
      durationPrecision: 9,
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      parentSpanIdExpression: 'ParentSpanId',
      spanNameExpression: 'SpanName',
      spanKindExpression: 'SpanKind',
      defaultTableSelectExpression: 'Timestamp, ServiceName',
    };

    await agent
      .put(`/sources/${metricSource._id}`)
      .send(traceSource)
      .expect(200);

    // Verify the trace source does NOT have metricTables property
    const updatedSource = await findSourceFixture(metricSource._id);
    if (updatedSource?.kind !== SourceKind.Trace) {
      expect(updatedSource?.kind).toBe(SourceKind.Trace);
      throw new Error('Source did not update to trace');
    }
    expect(updatedSource.kind).toBe(SourceKind.Trace);
    expect(updatedSource).not.toHaveProperty('metricTables');
    expect(updatedSource.durationExpression).toBe('Duration');
  });

  it('PUT /:id - preserves metricTables when source remains Metric, removes when changed to another type', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create a metric source with metricTables property
    const metricSource = await createSourceFixture({
      kind: SourceKind.Metric,
      name: 'Test Metric Source',
      connection: MOCK_METRIC_SOURCE.connection,
      from: {
        databaseName: 'test_db',
        tableName: 'otel_metrics',
      },
      timestampValueExpression: 'TimeUnix',
      resourceAttributesExpression: 'ResourceAttributes',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        sum: 'otel_metrics_sum',
      },
      team: new ObjectId(team._id),
    });

    // Step 1: Update the metric source (but keep it as Metric)
    const updatedMetricSource = {
      id: metricSource._id.toString(),
      kind: SourceKind.Metric,
      name: 'Updated Metric Source',
      connection: metricSource.connection,
      from: metricSource.from,
      timestampValueExpression: 'TimeUnix',
      resourceAttributesExpression: 'ResourceAttributes',
      metricTables: {
        gauge: 'otel_metrics_gauge_v2',
        sum: 'otel_metrics_sum_v2',
      },
    };

    await agent
      .put(`/sources/${metricSource._id}`)
      .send(updatedMetricSource)
      .expect(200);

    let updatedSource = await findSourceFixture(metricSource._id);

    // Verify the metric source still has metricTables with updated values
    if (updatedSource?.kind !== SourceKind.Metric) {
      expect(updatedSource?.kind).toBe(SourceKind.Metric);
      throw new Error('Source is not a metric');
    }
    expect(updatedSource.metricTables).toMatchObject({
      gauge: 'otel_metrics_gauge_v2',
      sum: 'otel_metrics_sum_v2',
    });

    // Step 2: Change the source to a Log type
    const logSource = {
      id: metricSource._id.toString(),
      kind: SourceKind.Log,
      name: 'Test Log Source',
      connection: metricSource.connection,
      from: {
        databaseName: 'test_db',
        tableName: 'otel_logs',
      },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression: 'Body',
      severityTextExpression: 'SeverityText',
    };

    await agent.put(`/sources/${metricSource._id}`).send(logSource).expect(200);

    updatedSource = await findSourceFixture(metricSource._id);

    // Verify the source is now a Log and metricTables is removed
    if (updatedSource?.kind !== SourceKind.Log) {
      expect(updatedSource?.kind).toBe(SourceKind.Log);
      throw new Error('Source did not update to log');
    }
    expect(updatedSource).not.toHaveProperty('metricTables');
    expect(updatedSource.severityTextExpression).toBe('SeverityText');
  });

  // Regression guard: a field present in the Zod schema but missing from the
  // Mongoose discriminator is silently dropped on write, with no error. Only a
  // round-trip through the database catches that.
  describe('serviceVersionExpression', () => {
    const VERSION_EXPR = "ResourceAttributes['container.image.tag']";

    /** The single persisted source, narrowed to a kind that carries the field. */
    const persisted = async (kind: SourceKind.Log | SourceKind.Trace) => {
      const [source] = await sourcesRepo.list();
      if (source?.kind !== kind) {
        throw new Error(`Expected a ${kind} source, got ${source?.kind}`);
      }
      return source;
    };

    it('POST / - persists the expression on a log source', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, serviceVersionExpression: VERSION_EXPR })
        .expect(200);

      expect((await persisted(SourceKind.Log)).serviceVersionExpression).toBe(
        VERSION_EXPR,
      );
    });

    it('POST / - persists the expression on a trace source', async () => {
      const { agent } = await getLoggedInAgent(server);

      const traceSource: Omit<Extract<TSource, { kind: 'trace' }>, 'id'> = {
        kind: SourceKind.Trace,
        name: 'Test Trace Source',
        // The suite provisions a real Connection for this id; POST now 400s on
        // one that doesn't exist for the team.
        connection: MOCK_SOURCE.connection,
        from: { databaseName: 'test_db', tableName: 'otel_traces' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Timestamp, SpanName',
        durationExpression: 'Duration',
        durationPrecision: 9,
        traceIdExpression: 'TraceId',
        spanIdExpression: 'SpanId',
        parentSpanIdExpression: 'ParentSpanId',
        spanNameExpression: 'SpanName',
        spanKindExpression: 'SpanKind',
        serviceVersionExpression: VERSION_EXPR,
      };

      await agent.post('/sources').send(traceSource).expect(200);

      expect((await persisted(SourceKind.Trace)).serviceVersionExpression).toBe(
        VERSION_EXPR,
      );
    });

    it('GET / - returns the expression', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, serviceVersionExpression: VERSION_EXPR })
        .expect(200);

      const response = await agent.get('/sources').expect(200);

      expect(response.body[0]).toMatchObject({
        serviceVersionExpression: VERSION_EXPR,
      });
    });

    it('PUT /:id - updates the expression, and clears it when omitted', async () => {
      const { agent } = await getLoggedInAgent(server);
      const created = await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, serviceVersionExpression: VERSION_EXPR })
        .expect(200);
      const id = created.body.id;

      await agent
        .put(`/sources/${id}`)
        .send({ ...MOCK_SOURCE, id, serviceVersionExpression: 'Version' })
        .expect(200);
      expect((await persisted(SourceKind.Log)).serviceVersionExpression).toBe(
        'Version',
      );

      await agent
        .put(`/sources/${id}`)
        .send({ ...MOCK_SOURCE, id })
        .expect(200);
      expect(
        (await persisted(SourceKind.Log)).serviceVersionExpression,
      ).toBeUndefined();
    });

    it('POST / - is optional', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent.post('/sources').send(MOCK_SOURCE).expect(200);

      expect(
        (await persisted(SourceKind.Log)).serviceVersionExpression,
      ).toBeUndefined();
    });
  });

  describe('seriesTable', () => {
    it('POST / - creates a metric source with seriesTable and it round-trips', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/sources')
        .send({
          ...MOCK_METRIC_SOURCE,
          seriesTable: 'otel_metrics_series',
        })
        .expect(200);

      expect(response.body.seriesTable).toBe('otel_metrics_series');

      const sources = await sourcesRepo.list();
      expect(sources).toHaveLength(1);
      const persisted = sources[0];
      if (persisted?.kind !== SourceKind.Metric) {
        expect(persisted?.kind).toBe(SourceKind.Metric);
        throw new Error('Source is not a metric');
      }
      expect(persisted.seriesTable).toBe('otel_metrics_series');
    });

    it('PUT /:id - updates seriesTable', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const metricSource = await createSourceFixture({
        ...MOCK_METRIC_SOURCE,
        team: new ObjectId(team._id),
      });

      await agent
        .put(`/sources/${metricSource._id}`)
        .send({
          id: metricSource._id.toString(),
          ...MOCK_METRIC_SOURCE,
          seriesTable: 'otel_metrics_series',
        })
        .expect(200);

      const updatedSource = await findSourceFixture(metricSource._id);
      if (updatedSource?.kind !== SourceKind.Metric) {
        expect(updatedSource?.kind).toBe(SourceKind.Metric);
        throw new Error('Source is not a metric');
      }
      expect(updatedSource.seriesTable).toBe('otel_metrics_series');
    });

    it('PUT /:id - removes seriesTable when omitted from the update payload', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const metricSource = await createSourceFixture({
        ...MOCK_METRIC_SOURCE,
        seriesTable: 'otel_metrics_series',
        team: new ObjectId(team._id),
      });

      const createdSource = await findSourceFixture(metricSource._id);
      if (createdSource?.kind !== SourceKind.Metric) {
        expect(createdSource?.kind).toBe(SourceKind.Metric);
        throw new Error('Source is not a metric');
      }
      expect(createdSource.seriesTable).toBe('otel_metrics_series');

      await agent
        .put(`/sources/${metricSource._id}`)
        .send({
          id: metricSource._id.toString(),
          ...MOCK_METRIC_SOURCE,
        })
        .expect(200);

      const updatedSource = await findSourceFixture(metricSource._id);
      if (updatedSource?.kind !== SourceKind.Metric) {
        expect(updatedSource?.kind).toBe(SourceKind.Metric);
        throw new Error('Source is not a metric');
      }
      expect(updatedSource).not.toHaveProperty('seriesTable');
    });

    it('a metric source created without seriesTable has no seriesTable field (undefined for existing sources)', async () => {
      const { team } = await getLoggedInAgent(server);

      const metricSource = await createSourceFixture({
        ...MOCK_METRIC_SOURCE,
        team: new ObjectId(team._id),
      });

      const createdSource = await findSourceFixture(metricSource._id);
      if (createdSource?.kind !== SourceKind.Metric) {
        expect(createdSource?.kind).toBe(SourceKind.Metric);
        throw new Error('Source is not a metric');
      }
      expect(createdSource).not.toHaveProperty('seriesTable');
    });
  });

  describe('minAutoGranularity', () => {
    it('POST / - creates a metric source with minAutoGranularity and it round-trips', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/sources')
        .send({
          ...MOCK_METRIC_SOURCE,
          minAutoGranularity: '1 minute',
        })
        .expect(200);

      expect(response.body.minAutoGranularity).toBe('1 minute');

      const sources = await sourcesRepo.list();
      expect(sources).toHaveLength(1);
      const persisted = sources[0];
      if (persisted?.kind !== SourceKind.Metric) {
        expect(persisted?.kind).toBe(SourceKind.Metric);
        throw new Error('Source is not a metric');
      }
      expect(persisted.minAutoGranularity).toBe('1 minute');
    });

    it("POST / - the form's \"No minimum\" value ('') persists as unset, not as an empty string", async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/sources')
        .send({
          ...MOCK_METRIC_SOURCE,
          minAutoGranularity: '',
        })
        .expect(200);

      expect(response.body).not.toHaveProperty('minAutoGranularity');

      const sources = await sourcesRepo.list();
      expect(sources).toHaveLength(1);
      const persisted = sources[0];
      if (persisted?.kind !== SourceKind.Metric) {
        expect(persisted?.kind).toBe(SourceKind.Metric);
        throw new Error('Source is not a metric');
      }
      expect(persisted).not.toHaveProperty('minAutoGranularity');
    });

    it('PUT /:id - removes minAutoGranularity when omitted from the update payload', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const metricSource = await createSourceFixture({
        ...MOCK_METRIC_SOURCE,
        minAutoGranularity: '1 minute',
        team: new ObjectId(team._id),
      });

      await agent
        .put(`/sources/${metricSource._id}`)
        .send({
          id: metricSource._id.toString(),
          ...MOCK_METRIC_SOURCE,
        })
        .expect(200);

      const updatedSource = await findSourceFixture(metricSource._id);
      if (updatedSource?.kind !== SourceKind.Metric) {
        expect(updatedSource?.kind).toBe(SourceKind.Metric);
        throw new Error('Source is not a metric');
      }
      expect(updatedSource).not.toHaveProperty('minAutoGranularity');
    });
  });

  it('DELETE /:id - deletes a source', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    // Create test source
    const source = await createSourceFixture({
      ...MOCK_SOURCE,
      team: new ObjectId(team._id),
    });

    await agent.delete(`/sources/${source._id}`).expect(200);

    // Verify source was deleted
    const deletedSource = await findSourceFixture(source._id);
    expect(deletedSource).toBeNull();
  });

  it('DELETE /:id - returns 200 when source does not exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const nonExistentId = new ObjectId().toString();

    // This will succeed even if the ID doesn't exist, consistent with the implementation
    await agent.delete(`/sources/${nonExistentId}`).expect(200);
  });

  describe('local app mode (string team id)', () => {
    // In Local App Mode (IS_LOCAL_APP_MODE) the auth middleware injects a
    // plain string team id ("_local_team_") onto req.user instead of a
    // Mongoose ObjectId. Regression test for HDX-4713 where the POST/PUT
    // handlers called teamId.toJSON() — a method that only exists on
    // ObjectId, not on strings — producing an HTTP 500
    // "TypeError: teamId.toJSON is not a function".

    // Build a minimal Express app that mirrors how api-app.ts mounts the
    // sources router, but with a middleware that emulates the Local App Mode
    // branch of isUserAuthenticated (string team id).
    const getLocalAppModeApp = () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.user = {
          _id: '_local_user_',
          email: 'local-user@hyperdx.io',
          team: LOCAL_APP_TEAM_ID,
        } as unknown as Express.User;
        next();
      });
      app.use('/sources', sourcesRouter);
      app.use(appErrorHandler);
      return app;
    };

    it('POST / - creates a source when team id is a string', async () => {
      const app = getLocalAppModeApp();
      await createTestConnection(
        new ObjectId(LOCAL_APP_TEAM_ID),
        MOCK_SOURCE.connection,
      );

      const response = await request(app)
        .post('/sources')
        .send(MOCK_SOURCE)
        .expect(200);

      expect(response.body).toMatchObject({
        kind: MOCK_SOURCE.kind,
        name: MOCK_SOURCE.name,
      });

      const sources = await sourcesRepo.list(LOCAL_APP_TEAM_ID);
      expect(sources).toHaveLength(1);
    });

    it('PUT /:id - updates a source when team id is a string', async () => {
      const app = getLocalAppModeApp();
      await createTestConnection(
        new ObjectId(LOCAL_APP_TEAM_ID),
        MOCK_SOURCE.connection,
      );

      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: LOCAL_APP_TEAM_ID,
      });

      await request(app)
        .put(`/sources/${source._id}`)
        .send({
          ...MOCK_SOURCE,
          id: source._id.toString(),
          name: 'Updated In Local App Mode',
        })
        .expect(200);

      const updated = await findSourceFixture(source._id);
      expect(updated?.name).toBe('Updated In Local App Mode');
    });
  });

  describe('metadataMaterializedViews field', () => {
    // Regression test for a bug where clearing the Metadata Materialized
    // Views in the source form did not persist. The UI sets the field to
    // undefined, JSON serialization drops it from the PUT payload, and the
    // previous findOneAndUpdate-based controller silently preserved the
    // old value because partial updates don't unset absent fields.
    it('PUT /:id - removes metadataMaterializedViews when omitted from the payload', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
        metadataMaterializedViews: {
          keyRollupTable: 'test_table_key_rollup_15m',
          kvRollupTable: 'test_table_kv_rollup_15m',
          granularity: '15 minute',
        },
      });

      const created = await findSourceFixture(source._id);
      if (created?.kind !== SourceKind.Log) {
        throw new Error(`expected Log source, got ${created?.kind}`);
      }
      expect(created.metadataMaterializedViews).toMatchObject({
        keyRollupTable: 'test_table_key_rollup_15m',
        kvRollupTable: 'test_table_kv_rollup_15m',
        granularity: '15 minute',
      });

      await agent
        .put(`/sources/${source._id}`)
        .send({
          ...MOCK_SOURCE,
          id: source._id.toString(),
        })
        .expect(200);

      const updated = await findSourceFixture(source._id);
      if (updated?.kind !== SourceKind.Log) {
        throw new Error(`expected Log source, got ${updated?.kind}`);
      }
      expect(updated.metadataMaterializedViews).toBeUndefined();
    });

    it('PUT /:id - updates metadataMaterializedViews when included in the payload', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
        metadataMaterializedViews: {
          keyRollupTable: 'old_key_rollup',
          kvRollupTable: 'old_kv_rollup',
          granularity: '15 minute',
        },
      });

      await agent
        .put(`/sources/${source._id}`)
        .send({
          ...MOCK_SOURCE,
          id: source._id.toString(),
          metadataMaterializedViews: {
            keyRollupTable: 'new_key_rollup',
            kvRollupTable: 'new_kv_rollup',
            granularity: '1 hour',
          },
        })
        .expect(200);

      const updated = await findSourceFixture(source._id);
      if (updated?.kind !== SourceKind.Log) {
        throw new Error(`expected Log source, got ${updated?.kind}`);
      }
      expect(updated.metadataMaterializedViews).toMatchObject({
        keyRollupTable: 'new_key_rollup',
        kvRollupTable: 'new_kv_rollup',
        granularity: '1 hour',
      });
    });

    it('GET / - is stable across requests for a source stored without a nested _id', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
        metadataMaterializedViews: {
          keyRollupTable: 'test_table_key_rollup_15m',
          kvRollupTable: 'test_table_kv_rollup_15m',
          granularity: '15 minute',
        },
      });

      const first = await agent.get('/sources').expect(200);
      const second = await agent.get('/sources').expect(200);

      expect(first.body[0].metadataMaterializedViews).toEqual({
        keyRollupTable: 'test_table_key_rollup_15m',
        kvRollupTable: 'test_table_kv_rollup_15m',
        granularity: '15 minute',
      });
      expect(second.body).toEqual(first.body);
      expect(second.headers.etag).toBe(first.headers.etag);
    });

    it('does not persist a nested _id', async () => {
      const { team } = await getLoggedInAgent(server);

      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
        metadataMaterializedViews: {
          keyRollupTable: 'test_table_key_rollup_15m',
          kvRollupTable: 'test_table_kv_rollup_15m',
          granularity: '15 minute',
        },
      });

      const stored = getDb()
        .prepare('SELECT config FROM sources WHERE id = ?')
        .get(source._id) as { config: string };
      expect(
        JSON.parse(stored.config).metadataMaterializedViews,
      ).not.toHaveProperty('_id');
    });

    it('GET / - is stable across requests after a source kind change', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
      });

      await agent
        .put(`/sources/${source._id}`)
        .send({
          id: source._id.toString(),
          kind: SourceKind.Trace,
          name: 'Test Trace Source',
          connection: MOCK_SOURCE.connection,
          from: { databaseName: 'test_db', tableName: 'otel_traces' },
          timestampValueExpression: 'Timestamp',
          defaultTableSelectExpression: 'Timestamp, ServiceName',
          durationExpression: 'Duration',
          durationPrecision: 9,
          traceIdExpression: 'TraceId',
          spanIdExpression: 'SpanId',
          parentSpanIdExpression: 'ParentSpanId',
          spanNameExpression: 'SpanName',
          spanKindExpression: 'SpanKind',
          metadataMaterializedViews: {
            keyRollupTable: 'test_table_key_rollup_15m',
            kvRollupTable: 'test_table_kv_rollup_15m',
            granularity: '15 minute',
          },
        })
        .expect(200);

      const first = await agent.get('/sources').expect(200);
      const second = await agent.get('/sources').expect(200);

      expect(second.body).toEqual(first.body);
      expect(second.headers.etag).toBe(first.headers.etag);
    });
  });

  describe('useTextIndexForImplicitColumn field', () => {
    it('POST / - persists useTextIndexForImplicitColumn on a Log source and returns it', async () => {
      const { agent } = await getLoggedInAgent(server);

      const response = await agent
        .post('/sources')
        .send({
          ...MOCK_SOURCE,
          useTextIndexForImplicitColumn: UseTextIndex.Enabled,
        })
        .expect(200);

      expect(response.body.useTextIndexForImplicitColumn).toBe(
        UseTextIndex.Enabled,
      );

      const sources = await sourcesRepo.list();
      expect(sources).toHaveLength(1);
      const stored = sources[0];
      if (stored?.kind !== SourceKind.Log) {
        throw new Error(`expected Log source, got ${stored?.kind}`);
      }
      expect(stored.useTextIndexForImplicitColumn).toBe(UseTextIndex.Enabled);
    });

    it('POST / - persists useTextIndexForImplicitColumn on a Trace source and returns it', async () => {
      const { agent } = await getLoggedInAgent(server);

      const traceSource: Omit<Extract<TSource, { kind: 'trace' }>, 'id'> = {
        kind: SourceKind.Trace,
        name: 'Trace with text index pref',
        connection: MOCK_SOURCE.connection,
        from: { databaseName: 'test_db', tableName: 'otel_traces' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: '*',
        durationExpression: 'Duration',
        durationPrecision: 9,
        traceIdExpression: 'TraceId',
        spanIdExpression: 'SpanId',
        parentSpanIdExpression: 'ParentSpanId',
        spanNameExpression: 'SpanName',
        spanKindExpression: 'SpanKind',
        useTextIndexForImplicitColumn: UseTextIndex.Disabled,
      };

      const response = await agent
        .post('/sources')
        .send(traceSource)
        .expect(200);

      expect(response.body.useTextIndexForImplicitColumn).toBe(
        UseTextIndex.Disabled,
      );

      const stored = await findSourceFixture(response.body.id);
      if (stored?.kind !== SourceKind.Trace) {
        throw new Error(`expected Trace source, got ${stored?.kind}`);
      }
      expect(stored.useTextIndexForImplicitColumn).toBe(UseTextIndex.Disabled);
    });

    it('PUT /:id - updates useTextIndexForImplicitColumn on an existing Log source', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      const source = await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
        useTextIndexForImplicitColumn: UseTextIndex.Auto,
      });

      await agent
        .put(`/sources/${source._id}`)
        .send({
          ...MOCK_SOURCE,
          id: source._id.toString(),
          useTextIndexForImplicitColumn: UseTextIndex.Enabled,
        })
        .expect(200);

      const updated = await findSourceFixture(source._id);
      if (updated?.kind !== SourceKind.Log) {
        throw new Error(`expected Log source, got ${updated?.kind}`);
      }
      expect(updated.useTextIndexForImplicitColumn).toBe(UseTextIndex.Enabled);
    });

    it('GET / - returns useTextIndexForImplicitColumn when set', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      await createSourceFixture({
        ...MOCK_SOURCE,
        team: new ObjectId(team._id),
        useTextIndexForImplicitColumn: UseTextIndex.Disabled,
      });

      const response = await agent.get('/sources').expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].useTextIndexForImplicitColumn).toBe(
        UseTextIndex.Disabled,
      );
    });

    it('GET / - omits useTextIndexForImplicitColumn when not set', async () => {
      const { agent, team } = await getLoggedInAgent(server);

      await createSourceFixture({ ...MOCK_SOURCE, team: team._id });

      const response = await agent.get('/sources').expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].useTextIndexForImplicitColumn).toBeUndefined();
    });

    it('POST / - rejects an invalid useTextIndexForImplicitColumn value', async () => {
      const { agent } = await getLoggedInAgent(server);

      await agent
        .post('/sources')
        .send({ ...MOCK_SOURCE, useTextIndexForImplicitColumn: 'maybe' })
        .expect(400);

      const sources = await sourcesRepo.list();
      expect(sources).toHaveLength(0);
    });
  });
});
