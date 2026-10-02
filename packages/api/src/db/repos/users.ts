/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, security/detect-object-injection -- SQLite rows and fixed hydration paths are constrained by this repository. */
import {
  type OnboardingData,
  type OnboardingTaskId,
} from '@hyperdx/common-utils/dist/types';
import { v4 as uuidv4 } from 'uuid';

import { getDb, withTransaction } from '@/db';
import { isId, newId, normalizeId } from '@/db/ids';
import { docToRow, rowToDoc } from '@/db/mapper';
import {
  hashPassword,
  IncorrectPasswordError,
  IncorrectUsernameError,
  verifyPassword,
} from '@/db/password';

export type UserDoc = {
  _id: string;
  accessKey: string;
  createdAt: Date;
  updatedAt: Date;
  email: string;
  name?: string;
  onboardingData: OnboardingData;
  team?: string;
};

const spec = {
  json: ['onboardingData'],
  dates: ['createdAt', 'updatedAt'],
} as const;
const publicColumns =
  'id,name,email,team,accessKey,onboardingData,createdAt,updatedAt';

function fromRow(row: Record<string, unknown> | undefined): UserDoc | null {
  return row ? (rowToDoc(row, spec) as UserDoc) : null;
}

export function findById(id: string): UserDoc | null {
  return fromRow(
    getDb()
      .prepare(`SELECT ${publicColumns} FROM users WHERE id = ?`)
      .get(normalizeId(id)),
  );
}

export function findByEmail(email: string): UserDoc | null {
  return fromRow(
    getDb()
      .prepare(`SELECT ${publicColumns} FROM users WHERE email = ?`)
      .get(email.toLowerCase()),
  );
}

export function findByAccessKey(accessKey: string): UserDoc | null {
  return fromRow(
    getDb()
      .prepare(`SELECT ${publicColumns} FROM users WHERE accessKey = ?`)
      .get(accessKey),
  );
}

export function listByTeam(team: string): UserDoc[] {
  return (
    getDb()
      .prepare(
        `SELECT ${publicColumns} FROM users WHERE team = ? ORDER BY createdAt`,
      )
      .all(normalizeId(team)) as Record<string, unknown>[]
  ).map(row => fromRow(row)!);
}

export function countUsers(): number {
  return (
    getDb().prepare('SELECT count(*) AS count FROM users').get() as {
      count: number;
    }
  ).count;
}

export function create(input: {
  email: string;
  name?: string;
  team?: string;
  _id?: string;
  accessKey?: string;
  onboardingData?: OnboardingData;
  createdAt?: Date;
  updatedAt?: Date;
  hash?: string;
  salt?: string;
}): UserDoc {
  const timestamp = new Date();
  const row = docToRow(
    {
      _id: input._id ?? newId(),
      name: input.name ?? null,
      email: input.email.toLowerCase(),
      team: input.team ? normalizeId(input.team) : null,
      accessKey: input.accessKey ?? uuidv4(),
      onboardingData: input.onboardingData ?? {
        completedTasks: [],
        isDismissed: false,
      },
      hash: input.hash ?? null,
      salt: input.salt ?? null,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
    },
    spec,
  );
  getDb()
    .prepare(
      `INSERT INTO users
    (id,name,email,team,accessKey,onboardingData,hash,salt,createdAt,updatedAt)
    VALUES (@id,@name,@email,@team,@accessKey,@onboardingData,@hash,@salt,@createdAt,@updatedAt)`,
    )
    .run(row);
  return findById(row.id as string)!;
}

export async function createWithPassword(
  input: Parameters<typeof create>[0],
  password: string,
): Promise<UserDoc> {
  const credentials = await hashPassword(password);
  return create({ ...input, ...credentials });
}

export async function authenticate(
  email: string,
  password: string,
): Promise<{ user: UserDoc | false; error?: Error }> {
  const stored = getDb()
    .prepare('SELECT id,hash,salt FROM users WHERE email = ?')
    .get(email.toLowerCase()) as
    | { id: string; hash: string | null; salt: string | null }
    | undefined;
  if (!stored) return { user: false, error: new IncorrectUsernameError() };
  if (!(await verifyPassword(password, stored)))
    return { user: false, error: new IncorrectPasswordError() };
  return { user: findById(stored.id)!, error: undefined };
}

const updateColumns = new Set([
  'name',
  'email',
  'team',
  'accessKey',
  'onboardingData',
]);
export function update(id: string, changes: Partial<UserDoc>): UserDoc | null {
  return withTransaction(() => {
    const row = docToRow(changes, spec);
    const keys = Object.keys(row).filter(key => updateColumns.has(key));
    if (keys.length) {
      const columns = keys.map(key => `"${key}" = @${key}`).join(', ');
      getDb()
        .prepare(
          `UPDATE users SET ${columns}, updatedAt = @updatedAt WHERE id = @id`,
        )
        .run({
          ...row,
          id: normalizeId(id),
          updatedAt: Date.now(),
        });
    }
    return findById(id);
  });
}

export function addCompletedOnboardingTask(
  id: string,
  taskId: OnboardingTaskId,
): UserDoc | null {
  return withTransaction(() => {
    const user = findById(id);
    if (!user) return null;
    const completedTasks = [
      ...new Set([...user.onboardingData.completedTasks, taskId]),
    ];
    return update(id, {
      onboardingData: { ...user.onboardingData, completedTasks },
    });
  });
}

export function setOnboardingDismissed(
  id: string,
  isDismissed: boolean,
): UserDoc | null {
  return withTransaction(() => {
    const user = findById(id);
    if (!user) return null;
    return update(id, {
      onboardingData: { ...user.onboardingData, isDismissed },
    });
  });
}

export function deleteById(id: string, team?: string): UserDoc | null {
  return withTransaction(() => {
    const user = findById(id);
    if (!user || (team && user.team !== normalizeId(team))) return null;
    getDb().prepare('DELETE FROM users WHERE id = ?').run(normalizeId(id));
    return user;
  });
}

export function hydrateUsers<T extends Record<string, any>>(
  docs: T[],
  paths: string[],
): T[] {
  for (const doc of docs) {
    for (const path of paths) {
      const parts = path.split('.');
      let target: any = doc;
      for (const part of parts.slice(0, -1)) target = target?.[part];
      const key = parts.at(-1)!;
      const id = target?.[key];
      if (id != null && isId(String(id))) {
        const user = findById(String(id));
        target[key] = user
          ? { _id: user._id, email: user.email, name: user.name }
          : null;
      }
    }
  }
  return docs;
}
