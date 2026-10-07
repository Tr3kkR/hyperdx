import { DashboardSchema } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import type { ObjectId } from './ids';

export interface IDashboard extends z.infer<typeof DashboardSchema> {
  _id: ObjectId;
  team: ObjectId;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  provisioned?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type DashboardDocument = IDashboard;
