import type { OnboardingTaskId } from '@hyperdx/common-utils/dist/types';
import { isPersistableUserId as isPersistableUserIdHex } from '@hyperdx/common-utils/dist/types';
import { v4 as uuidv4 } from 'uuid';

import { getDb, withTransaction } from '@/db';
import { normalizeId } from '@/db/ids';
import * as users from '@/db/repos/users';
import type { ObjectId } from '@/models/ids';
import logger from '@/utils/logger';
export function findUserByAccessKey(accessKey: string) {
  return users.findByAccessKey(accessKey);
}

/**
 * Rotates a user's personal access key, immediately revoking the previous one.
 *
 * There is exactly one key per user and no grace period: findUserByAccessKey
 * above is hit uncached on every bearer request (see validateUserAccessKey), so
 * requests presenting the old key start 401ing the instant this returns.
 */
export function rotateUserAccessKey(userId: string | ObjectId) {
  return users.update(String(userId), { accessKey: uuidv4() });
}

export function findUserById(id: string) {
  return users.findById(id);
}

export function findUserByEmail(email: string) {
  // Case-insensitive email search - lowercase the email since User model stores emails in lowercase
  return users.findByEmail(email);
}

export function findUsersByTeam(team: string | ObjectId) {
  return users.listByTeam(String(team));
}

// Type-guard wrapper over the shared 24-hex check; rejects the synthetic
// `_local_user_` id injected in IS_LOCAL_APP_MODE (see isPersistableUserIdHex).
function isPersistableUserId(
  userId: string | ObjectId | undefined | null,
): userId is string | ObjectId {
  return userId != null && isPersistableUserIdHex(String(userId));
}

// Returns null for a non-persistable user so the route reports unchanged
// default state rather than a write that silently matched nothing.
export function completeOnboardingTask(
  userId: string | ObjectId,
  taskId: OnboardingTaskId,
) {
  if (!isPersistableUserId(userId)) {
    return null;
  }
  // sqlite-port: $addToSet is a transactional read-modify-write in the user repository.
  return users.addCompletedOnboardingTask(String(userId), taskId);
}

export function setOnboardingDismissed(
  userId: string | ObjectId,
  isDismissed: boolean,
) {
  if (!isPersistableUserId(userId)) {
    return null;
  }
  return users.setOnboardingDismissed(String(userId), isDismissed);
}

// Fire-and-forget recording from an unrelated write path (alert/dashboard save,
// MCP tool call): must never fail or delay the triggering operation, so errors
// are swallowed. The $ne skips the write once already recorded — these fire on
// every save / tool call, so it avoids write amplification on hot paths.
export function recordOnboardingTaskCompletion(
  userId: string | ObjectId | undefined | null,
  taskId: OnboardingTaskId,
) {
  if (!isPersistableUserId(userId)) {
    return;
  }
  try {
    users.addCompletedOnboardingTask(String(userId), taskId);
  } catch (err) {
    logger.warn(
      { error: err, userId: userId.toString(), taskId },
      'Failed to record onboarding task completion',
    );
  }
}

export async function deleteTeamMember(
  teamId: string | ObjectId,
  userIdToDelete: string,
  userIdRequestingDelete: string | ObjectId,
) {
  return withTransaction(() => {
    // sqlite-port: Mongo updateMany before findOneAndDelete is one transaction.
    getDb()
      .prepare('UPDATE alerts SET createdBy=? WHERE createdBy=? AND team=?')
      .run(
        normalizeId(String(userIdRequestingDelete)),
        normalizeId(userIdToDelete),
        normalizeId(String(teamId)),
      );
    return users.deleteById(userIdToDelete, String(teamId));
  });
}
