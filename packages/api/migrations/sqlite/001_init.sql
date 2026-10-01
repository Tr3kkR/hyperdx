CREATE TABLE teams (
  id TEXT PRIMARY KEY, name TEXT, allowedAuthMethods TEXT,
  hookId TEXT NOT NULL, apiKey TEXT NOT NULL,
  collectorAuthenticationEnforced INTEGER NOT NULL DEFAULT 0,
  isMetricsSeriesTableEnabled INTEGER NOT NULL DEFAULT 0,
  metadataMaxRowsToRead INTEGER, searchRowLimit INTEGER, queryTimeout INTEGER,
  fieldMetadataDisabled INTEGER, parallelizeWhenPossible INTEGER, filterKeysFetchLimit INTEGER,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);

CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL,
  team TEXT, accessKey TEXT NOT NULL,
  onboardingData TEXT NOT NULL DEFAULT '{"completedTasks":[],"isDismissed":false}',
  hash TEXT, salt TEXT,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE UNIQUE INDEX users_email ON users(email);
CREATE UNIQUE INDEX users_accessKey ON users(accessKey);

CREATE TABLE teaminvites (
  id TEXT PRIMARY KEY, teamId TEXT NOT NULL, name TEXT, email TEXT NOT NULL, token TEXT NOT NULL,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE UNIQUE INDEX teaminvites_team_email ON teaminvites(teamId, email);
CREATE INDEX teaminvites_createdAt ON teaminvites(createdAt);

CREATE TABLE connections (
  id TEXT PRIMARY KEY, team TEXT NOT NULL, name TEXT, host TEXT, username TEXT,
  password TEXT, hyperdxSettingPrefix TEXT, isPrometheusEndpoint INTEGER,
  platformProvisioned INTEGER,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX connections_team_id ON connections(team, id);

CREATE TABLE sources (
  id TEXT PRIMARY KEY, team TEXT NOT NULL, connection TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('log','trace','session','metric','promql')),
  name TEXT, section TEXT, disabled INTEGER NOT NULL DEFAULT 0,
  fromDatabaseName TEXT, fromTableName TEXT, timestampValueExpression TEXT,
  querySettings TEXT,
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX sources_team_id ON sources(team, id);

CREATE TABLE dashboards (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, team TEXT,
  tiles TEXT NOT NULL CHECK (json_valid(tiles)),
  tags TEXT NOT NULL DEFAULT '[]', filters TEXT NOT NULL DEFAULT '[]',
  savedQuery TEXT, savedQueryLanguage TEXT, savedFilterValues TEXT, savedDateRange TEXT, containers TEXT,
  createdBy TEXT, updatedBy TEXT, provisioned INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE UNIQUE INDEX dashboards_provisioned_name ON dashboards(name, team) WHERE provisioned = 1;
CREATE INDEX dashboards_team_id ON dashboards(team, id);

CREATE TABLE savedsearches (
  id TEXT PRIMARY KEY, team TEXT NOT NULL, name TEXT, "select" TEXT, "where" TEXT, whereLanguage TEXT,
  orderBy TEXT, source TEXT NOT NULL, tags TEXT, filters TEXT, createdBy TEXT, updatedBy TEXT,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX savedsearches_team_id ON savedsearches(team, id);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY, threshold REAL NOT NULL, thresholdMax REAL, thresholdType TEXT,
  interval TEXT NOT NULL, scheduleOffsetMinutes INTEGER, scheduleStartAt INTEGER,
  channel TEXT, channels TEXT,
  state TEXT NOT NULL DEFAULT 'OK', source TEXT NOT NULL DEFAULT 'saved_search',
  team TEXT, createdBy TEXT, name TEXT, message TEXT, note TEXT, displayName TEXT,
  tags TEXT, savedSearch TEXT, groupBy TEXT, dashboard TEXT, tileId TEXT, chartConfig TEXT,
  numConsecutiveWindows INTEGER,
  silencedBy TEXT, silencedAt INTEGER, silencedUntil INTEGER,
  executionErrors TEXT,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX alerts_team_id ON alerts(team, id);
CREATE INDEX alerts_team_displayName_id ON alerts(team, displayName, id);

CREATE TABLE alerthistories (
  id TEXT PRIMARY KEY, counts INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL,
  alert TEXT, state TEXT NOT NULL, lastValues TEXT NOT NULL DEFAULT '[]',
  "group" TEXT, fired INTEGER, errors TEXT, analytics TEXT);
CREATE INDEX alerthistories_alert_createdAt ON alerthistories(alert, createdAt DESC);
CREATE INDEX alerthistories_alert_group_createdAt ON alerthistories(alert, "group", createdAt DESC);
CREATE INDEX alerthistories_createdAt ON alerthistories(createdAt);

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY, team TEXT, service TEXT NOT NULL, name TEXT NOT NULL, url TEXT, description TEXT,
  queryParams TEXT, headers TEXT, body TEXT,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE UNIQUE INDEX webhooks_team_service_name ON webhooks(team, service, name);
CREATE INDEX webhooks_team_id ON webhooks(team, id);

CREATE TABLE favorites (
  id TEXT PRIMARY KEY, user TEXT NOT NULL, team TEXT NOT NULL,
  resourceType TEXT NOT NULL CHECK (resourceType IN ('dashboard','savedSearch')), resourceId TEXT NOT NULL,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE UNIQUE INDEX favorites_unique ON favorites(team, user, resourceType, resourceId);

CREATE TABLE pinnedfilters (
  id TEXT PRIMARY KEY, team TEXT NOT NULL, source TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]', filters TEXT NOT NULL DEFAULT '{}',
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE UNIQUE INDEX pinnedfilters_team_source ON pinnedfilters(team, source);

CREATE TABLE presetdashboardfilters (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, team TEXT NOT NULL, source TEXT NOT NULL,
  sourceMetricType TEXT, presetDashboard TEXT NOT NULL, type TEXT NOT NULL, expression TEXT NOT NULL,
  "where" TEXT, whereLanguage TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX presetdashboardfilters_team_source ON presetdashboardfilters(team, source);

CREATE TABLE sessions (sid TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX sessions_expiresAt ON sessions(expiresAt);
