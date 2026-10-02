import * as favorites from '@/db/repos/favorites';

export function getFavorites(userId: string, teamId: string) {
  return favorites.list(userId, teamId);
}

export function addFavorite(
  userId: string,
  teamId: string,
  resourceType: favorites.FavoriteDoc['resourceType'],
  resourceId: string,
) {
  return favorites.upsert(userId, teamId, resourceType, resourceId);
}

export function removeFavorite(
  userId: string,
  teamId: string,
  resourceType: favorites.FavoriteDoc['resourceType'],
  resourceId: string,
) {
  return favorites.remove(userId, teamId, resourceType, resourceId);
}
