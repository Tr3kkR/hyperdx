import { WebhookService } from '@hyperdx/common-utils/dist/types';

import type { ObjectId } from './ids';

export { WebhookService };

export interface IWebhook {
  _id: ObjectId;
  createdAt: Date;
  name: string;
  service: WebhookService;
  team: ObjectId;
  updatedAt: Date;
  url?: string;
  description?: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}
