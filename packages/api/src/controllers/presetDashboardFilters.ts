import {
  PresetDashboard,
  PresetDashboardFilter,
} from '@hyperdx/common-utils/dist/types';

import * as presetFilters from '@/db/repos/presetDashboardFilters';
import { ObjectId } from '@/models/ids';

export async function getPresetDashboardFilters(
  teamId: string | ObjectId,
  source: string | ObjectId,
  presetDashboard: PresetDashboard,
) {
  return presetFilters.list(String(teamId), String(source), presetDashboard);
}

export const createPresetDashboardFilter = async (
  teamId: string | ObjectId,
  presetDashboardFilter: PresetDashboardFilter,
) => {
  return presetFilters.create(String(teamId), presetDashboardFilter);
};

export const updatePresetDashboardFilter = async (
  teamId: string | ObjectId,
  presetDashboardFilter: PresetDashboardFilter,
) => {
  return presetFilters.update(String(teamId), presetDashboardFilter);
};

export const deletePresetDashboardFilter = async (
  teamId: string | ObjectId,
  presetDashboard: PresetDashboard,
  presetDashboardFilterId: string | ObjectId,
) => {
  return presetFilters.remove(
    String(teamId),
    presetDashboard,
    String(presetDashboardFilterId),
  );
};
