import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'bson';
import request, { SuperAgentTest } from 'supertest';

import * as config from '@/config';
import { validateConnectionId } from '@/controllers/connection';
import { getDb } from '@/db';
import type { ConnectionDoc } from '@/db/repos/connections';
import * as sourcesRepo from '@/db/repos/sources';
import type { TeamDoc as ITeam } from '@/db/repos/teams';
import type { UserDoc as IUser } from '@/db/repos/users';
import {
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import { findSourceFixture } from '@/test/sqliteMetadata';
import {
  createConnectionFixture,
  createSourceFixture,
} from '@/test/sqliteMetadata';

describe('External API v2 Sources CRUD', () => {
  const server = getServer();
  let agent: SuperAgentTest;
  let team: ITeam;
  let user: IUser;
  let connection: ConnectionDoc;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;

    connection = await createConnectionFixture({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // Helper for authenticated requests
  const authRequest = (
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
  ) => {
    return agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);
  };

  const BASE_URL = '/api/v2/sources';

  const logSourceBody = () => ({
    kind: SourceKind.Log,
    name: 'Created Log Source',
    from: {
      databaseName: DEFAULT_DATABASE,
      tableName: DEFAULT_LOGS_TABLE,
    },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp, Body',
    connection: connection._id.toString(),
  });

  const traceSourceBody = () => ({
    kind: SourceKind.Trace,
    name: 'Created Trace Source',
    defaultTableSelectExpression: 'Timestamp, SpanName',
    from: {
      databaseName: DEFAULT_DATABASE,
      tableName: 'otel_traces',
    },
    timestampValueExpression: 'Timestamp',
    durationExpression: 'Duration',
    durationPrecision: 3,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    connection: connection._id.toString(),
  });

  const createOtherTeamConnection = (otherTeamId: ObjectId) =>
    createConnectionFixture({
      team: otherTeamId,
      name: 'Other Team Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

  const createOtherTeamSource = async () => {
    const otherTeamId = new ObjectId();
    const otherConnection = await createOtherTeamConnection(otherTeamId);
    return createSourceFixture({
      kind: SourceKind.Log,
      team: otherTeamId,
      name: 'Other Team Source',
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression: '*',
      connection: otherConnection._id,
    });
  };

  describe('GET /api/v2/sources/:id', () => {
    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer())
        .get(`${BASE_URL}/${new ObjectId()}`)
        .expect(401);
    });

    it('should return a source by id', async () => {
      const logSource = await createSourceFixture({
        ...logSourceBody(),
        team: team._id,
      });

      const response = await authRequest(
        'get',
        `${BASE_URL}/${logSource._id}`,
      ).expect(200);

      expect(response.body.data).toMatchObject({
        id: logSource._id.toString(),
        name: 'Created Log Source',
        kind: SourceKind.Log,
      });
    });

    it('should return 404 for a non-existent source', async () => {
      await authRequest('get', `${BASE_URL}/${new ObjectId()}`).expect(404);
    });

    it("should return 404 for another team's source", async () => {
      const otherTeamSource = await createOtherTeamSource();
      await authRequest('get', `${BASE_URL}/${otherTeamSource._id}`).expect(
        404,
      );
    });

    it('should return 400 for an invalid id', async () => {
      await authRequest('get', `${BASE_URL}/not-an-object-id`).expect(400);
    });
  });

  describe('POST /api/v2/sources', () => {
    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer())
        .post(BASE_URL)
        .send(logSourceBody())
        .expect(401);
    });

    it('should create a log source', async () => {
      const response = await authRequest('post', BASE_URL)
        .send(logSourceBody())
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: 'Created Log Source',
        kind: SourceKind.Log,
        connection: connection._id.toString(),
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Timestamp, Body',
      });
      expect(typeof response.body.data.id).toBe('string');

      const persisted = await findSourceFixture(response.body.data.id);
      expect(persisted).not.toBeNull();
      expect(persisted!.team.toString()).toBe(team._id.toString());
    });

    it('should accept external short-form granularities and store internal format', async () => {
      const response = await authRequest('post', BASE_URL)
        .send({
          ...traceSourceBody(),
          materializedViews: [
            {
              databaseName: DEFAULT_DATABASE,
              tableName: 'traces_mv',
              dimensionColumns: 'ServiceName',
              minGranularity: '5m',
              timestampColumn: 'Timestamp',
              aggregatedColumns: [{ mvColumn: 'count', aggFn: 'count' }],
            },
          ],
        })
        .expect(200);

      // Response echoes the external format
      expect(response.body.data.materializedViews[0].minGranularity).toBe('5m');

      // The database stores the internal SQL interval format
      const persisted = await findSourceFixture(response.body.data.id);
      expect(
        persisted && 'materializedViews' in persisted
          ? persisted.materializedViews![0].minGranularity
          : undefined,
      ).toBe('5 minute');
    });

    it('should map metadataMaterializedViews granularity to internal format', async () => {
      const response = await authRequest('post', BASE_URL)
        .send({
          ...logSourceBody(),
          metadataMaterializedViews: {
            keyRollupTable: 'otel_logs_key_rollup_15m',
            kvRollupTable: 'otel_logs_kv_rollup_15m',
            granularity: '15m',
          },
        })
        .expect(200);

      // Response echoes the external format
      expect(response.body.data.metadataMaterializedViews.granularity).toBe(
        '15m',
      );

      // The database stores the internal SQL interval format
      const persisted = await findSourceFixture(response.body.data.id);
      expect(
        persisted && 'metadataMaterializedViews' in persisted
          ? persisted.metadataMaterializedViews!.granularity
          : undefined,
      ).toBe('15 minute');
    });

    it('should create a promql source', async () => {
      const response = await authRequest('post', BASE_URL)
        .send({
          kind: SourceKind.Promql,
          name: 'Prometheus Metrics',
          // Required by the API for all source kinds; unused for promql
          from: { databaseName: 'default', tableName: 'default' },
          timestampValueExpression: 'timestamp',
          connection: connection._id.toString(),
        })
        .expect(200);

      expect(response.body.data).toMatchObject({
        kind: SourceKind.Promql,
        name: 'Prometheus Metrics',
      });

      const persisted = await findSourceFixture(response.body.data.id);
      expect(persisted!.kind).toBe(SourceKind.Promql);
    });

    it('should return 400 when connection is not a valid id', async () => {
      await authRequest('post', BASE_URL)
        .send({ ...logSourceBody(), connection: 'my-connection-name' })
        .expect(400);
    });

    it('should return 400 when connection belongs to another team', async () => {
      const otherConnection = await createOtherTeamConnection(new ObjectId());

      await authRequest('post', BASE_URL)
        .send({
          ...logSourceBody(),
          connection: otherConnection._id.toString(),
        })
        .expect(400);

      expect(sourcesRepo.list(String(team._id))).toHaveLength(0);
    });

    it('should return 400 for an invalid body', async () => {
      await authRequest('post', BASE_URL)
        .send({ kind: SourceKind.Log, name: 'Missing required fields' })
        .expect(400);
    });
  });

  describe('PUT /api/v2/sources/:id', () => {
    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer())
        .put(`${BASE_URL}/${new ObjectId()}`)
        .send(logSourceBody())
        .expect(401);
    });

    it('should update a source', async () => {
      const logSource = await createSourceFixture({
        ...logSourceBody(),
        team: team._id,
      });

      const response = await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ ...logSourceBody(), name: 'Updated Log Source' })
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: logSource._id.toString(),
        name: 'Updated Log Source',
      });

      const persisted = await findSourceFixture(logSource._id);
      expect(persisted!.name).toBe('Updated Log Source');
    });

    it('should return 404 for a non-existent source', async () => {
      await authRequest('put', `${BASE_URL}/${new ObjectId()}`)
        .send(logSourceBody())
        .expect(404);
    });

    it("should return 404 for another team's source", async () => {
      const otherTeamSource = await createOtherTeamSource();

      await authRequest('put', `${BASE_URL}/${otherTeamSource._id}`)
        .send({ ...logSourceBody(), name: 'Hijacked' })
        .expect(404);

      const persisted = await findSourceFixture(otherTeamSource._id);
      expect(persisted!.name).toBe('Other Team Source');
    });

    it('should return 400 for an invalid body', async () => {
      const logSource = await createSourceFixture({
        ...logSourceBody(),
        team: team._id,
      });

      await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ kind: SourceKind.Log, name: 'Missing required fields' })
        .expect(400);
    });

    it('should return 400 when connection is not a valid id', async () => {
      const logSource = await createSourceFixture({
        ...logSourceBody(),
        team: team._id,
      });

      await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ ...logSourceBody(), connection: 'my-connection-name' })
        .expect(400);
    });

    it('should return 400 when connection belongs to another team', async () => {
      const logSource = await createSourceFixture({
        ...logSourceBody(),
        team: team._id,
      });
      const otherConnection = await createOtherTeamConnection(new ObjectId());

      await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({
          ...logSourceBody(),
          connection: otherConnection._id.toString(),
        })
        .expect(400);

      const persisted = await findSourceFixture(logSource._id);
      expect(persisted!.connection.toString()).toBe(connection._id.toString());
    });

    it('should preserve createdAt on a same-kind update', async () => {
      const logSource = await createSourceFixture({
        ...logSourceBody(),
        team: team._id,
      });
      const originalCreatedAt = logSource.createdAt;
      expect(originalCreatedAt).toBeInstanceOf(Date);

      await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ ...logSourceBody(), name: 'Updated Log Source' })
        .expect(200);

      const raw = getDb()
        .prepare('SELECT createdAt FROM sources WHERE id = ?')
        .get(logSource._id) as { createdAt: number };
      expect(new Date(raw.createdAt)).toEqual(originalCreatedAt);
    });

    it("should change a source's kind", async () => {
      const logSource = await createSourceFixture({
        ...logSourceBody(),
        team: team._id,
      });
      const originalCreatedAt = logSource.createdAt;
      expect(originalCreatedAt).toBeInstanceOf(Date);

      const response = await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ ...traceSourceBody(), name: 'Now A Trace Source' })
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: logSource._id.toString(),
        kind: SourceKind.Trace,
        name: 'Now A Trace Source',
      });

      const persisted = await findSourceFixture(logSource._id);
      expect(persisted!.kind).toBe(SourceKind.Trace);

      const raw = getDb()
        .prepare('SELECT createdAt,connection FROM sources WHERE id = ?')
        .get(logSource._id) as { createdAt: number; connection: string };
      expect(new Date(raw.createdAt)).toEqual(originalCreatedAt);
      expect(raw.connection).toBe(connection._id);
    });
  });

  describe('DELETE /api/v2/sources/:id', () => {
    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer())
        .delete(`${BASE_URL}/${new ObjectId()}`)
        .expect(401);
    });

    it('should delete a source', async () => {
      const logSource = await createSourceFixture({
        ...logSourceBody(),
        team: team._id,
      });

      await authRequest('delete', `${BASE_URL}/${logSource._id}`).expect(200);

      expect(await findSourceFixture(logSource._id)).toBeNull();
    });

    it('should return 404 for a non-existent source', async () => {
      await authRequest('delete', `${BASE_URL}/${new ObjectId()}`).expect(404);
    });

    it("should return 404 for another team's source and leave it intact", async () => {
      const otherTeamSource = await createOtherTeamSource();

      await authRequest('delete', `${BASE_URL}/${otherTeamSource._id}`).expect(
        404,
      );

      expect(await findSourceFixture(otherTeamSource._id)).not.toBeNull();
    });
  });

  describe('validateConnectionId', () => {
    it('rejects a non-ObjectId connection with a 400', async () => {
      expect(
        await validateConnectionId('my-connection-name', team._id),
      ).toEqual({
        ok: false,
        status: 400,
        message: 'connection must be a valid connection id',
      });
    });

    it('rejects a missing team with a 403', async () => {
      expect(
        await validateConnectionId(connection._id.toString(), undefined),
      ).toEqual({ ok: false, status: 403, message: 'Forbidden' });
    });

    it('rejects a connection belonging to another team with a 400', async () => {
      const otherConnection = await createOtherTeamConnection(new ObjectId());

      expect(
        await validateConnectionId(otherConnection._id.toString(), team._id),
      ).toEqual({
        ok: false,
        status: 400,
        message: 'connection must be an existing connection id',
      });
    });

    it('accepts a valid connection owned by the team', async () => {
      expect(
        await validateConnectionId(connection._id.toString(), team._id),
      ).toEqual({ ok: true });
    });
  });
});
