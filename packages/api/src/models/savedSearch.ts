import { SavedSearchSchema } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import type { ObjectId } from './ids';

export interface ISavedSearch
  extends Omit<z.infer<typeof SavedSearchSchema>, 'source'> {
  _id: ObjectId;
  team: ObjectId;
  source: ObjectId;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
