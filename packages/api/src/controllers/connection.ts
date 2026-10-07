import { isId } from '@/db/ids';
import * as connections from '@/db/repos/connections';
import type { ObjectId } from '@/models/ids';
import { objectIdSchema } from '@/utils/zod';

export type ConnectionValidation =
  | { ok: true }
  | { ok: false; status: 400 | 403; message: string };

export async function validateConnectionId(
  connection: unknown,
  teamId: string | ObjectId | undefined,
): Promise<ConnectionValidation> {
  const parsed = objectIdSchema.safeParse(connection);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      message: 'connection must be a valid connection id',
    };
  }
  if (teamId == null) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }
  const connectionExists = isId(String(parsed.data))
    ? connections.findById(String(parsed.data), String(teamId))
    : null;
  if (connectionExists == null) {
    return {
      ok: false,
      status: 400,
      message: 'connection must be an existing connection id',
    };
  }
  return { ok: true };
}

// Returns all connections across all teams. Only intended for instance-level
// operations (e.g. startup auto-provisioning); user-facing routes must use
// the team-scoped variants below.
export function getConnections() {
  // Never return password back to the user
  return connections.list();
}

export function getConnectionsByTeam(team: string) {
  return connections.list(team);
}

export function getConnectionById(
  team: string,
  connectionId: string,
  selectPassword = false,
) {
  return selectPassword
    ? connections.findByIdWithPassword(connectionId, team)
    : connections.findById(connectionId, team);
}

export function createConnection(
  team: string,
  connection: Partial<connections.ConnectionDoc>,
) {
  return connections.create(team, connection);
}

export function updateConnection(
  team: string,
  connectionId: string,
  connection: Partial<connections.ConnectionDoc>,
  unsetFields: string[] = [],
) {
  return connections.update(connectionId, team, connection, unsetFields);
}

export function deleteConnection(team: string, connectionId: string) {
  return connections.remove(connectionId, team);
}
