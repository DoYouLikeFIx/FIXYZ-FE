import { api } from '@/lib/axios';
import type { HealthResponse } from '@/types/health';

export const fetchHealth = async (): Promise<HealthResponse> => {
  const { data } = await api.get<HealthResponse>('/actuator/health');
  return data;
};
