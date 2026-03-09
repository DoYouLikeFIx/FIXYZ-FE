import { api } from '@/lib/axios';
import { fetchHealth } from '@/lib/health';

vi.mock('@/lib/axios', () => ({
  api: {
    get: vi.fn(),
  },
}));

const mockedApiGet = vi.mocked(api.get);

describe('fetchHealth', () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });

  it('calls the backend health endpoint and returns response data', async () => {
    mockedApiGet.mockResolvedValue({ data: { status: 'UP' } } as never);

    const result = await fetchHealth();

    expect(mockedApiGet).toHaveBeenCalledWith('/actuator/health');
    expect(result).toEqual({ status: 'UP' });
  });

  it('propagates service errors to the caller', async () => {
    mockedApiGet.mockRejectedValue(new Error('health endpoint unavailable'));

    await expect(fetchHealth()).rejects.toThrow('health endpoint unavailable');
  });
});
