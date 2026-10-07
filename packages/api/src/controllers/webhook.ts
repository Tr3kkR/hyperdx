import * as alertsRepo from '@/db/repos/alerts';
import * as webhooksRepo from '@/db/repos/webhooks';
import { WebhookService } from '@/db/repos/webhooks';
import type { ObjectId } from '@/models/ids';
import { validateWebhookUrl } from '@/utils/validators';

export interface WebhookInput {
  name: string;
  service: WebhookService;
  url: string;
  description?: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Create a team-scoped webhook. Shared by the internal API, External API v2, and
 * MCP; callers handle their own duplicate-key errors and secret redaction.
 */
export async function createWebhook(
  team: ObjectId | string,
  { name, service, url, description, queryParams, headers, body }: WebhookInput,
) {
  validateWebhookUrl({ service, url });

  return webhooksRepo.create(team.toString(), {
    name,
    service,
    url,
    description,
    queryParams,
    headers,
    body,
  });
}

export type UpdateWebhookResult =
  | { status: 'ok'; webhook: webhooksRepo.WebhookDoc }
  | { status: 'not_found' }
  | { status: 'conflict' };

/**
 * Update (full replace) a team-scoped webhook. Readable fields (description,
 * body) are set/cleared by presence; write-only fields (headers, queryParams)
 * are preserved when omitted and cleared on empty {} — or cleared outright when
 * the destination (url/service) changes, so stored secrets are never forwarded
 * to a new destination. Shared by External API v2 and MCP.
 */
export async function updateWebhook(
  team: ObjectId | string,
  webhookId: string,
  { name, service, url, description, queryParams, headers, body }: WebhookInput,
): Promise<UpdateWebhookResult> {
  const existing = webhooksRepo.findById(webhookId, team.toString());
  if (existing == null) {
    return { status: 'not_found' };
  }

  validateWebhookUrl({ service, url });

  const destinationChanged =
    url !== existing.url || service !== existing.service;

  const nextHeaders =
    headers === undefined
      ? destinationChanged
        ? undefined
        : existing.headers
      : Object.keys(headers).length
        ? headers
        : undefined;
  const nextQueryParams =
    queryParams === undefined
      ? destinationChanged
        ? undefined
        : existing.queryParams
      : Object.keys(queryParams).length
        ? queryParams
        : undefined;

  // Pin to the snapshotted url/service so a concurrent destination change
  // yields a conflict rather than attaching a secret to the wrong destination.
  const webhook = webhooksRepo.updateIfDestinationMatches(
    webhookId,
    team.toString(),
    existing.url,
    existing.service,
    {
      name,
      service,
      url,
      description,
      headers: nextHeaders,
      queryParams: nextQueryParams,
      body,
    },
  );

  if (webhook == null) {
    const stillExists = webhooksRepo.findById(webhookId, team.toString());
    return stillExists != null
      ? { status: 'conflict' }
      : { status: 'not_found' };
  }

  return { status: 'ok', webhook };
}

export type DeleteWebhookResult =
  | { status: 'ok'; webhook: webhooksRepo.WebhookDoc }
  | { status: 'not_found' }
  | { status: 'referenced'; alertCount: number };

/**
 * Delete a webhook for a team, blocking deletion while alerts still reference it
 * so we never orphan an alert onto a missing destination.
 */
export async function deleteWebhook(
  team: ObjectId | string,
  webhookId: string,
): Promise<DeleteWebhookResult> {
  // Match on webhookId alone (not channel.type) so a legacy/skewed alert that
  // still references this webhook also blocks deletion.
  const alertCount = alertsRepo.countReferencingWebhook(team, webhookId);
  if (alertCount > 0) {
    return { status: 'referenced', alertCount };
  }

  const deleted = webhooksRepo.remove(webhookId, team.toString());
  if (deleted == null) {
    return { status: 'not_found' };
  }

  return { status: 'ok', webhook: deleted };
}
