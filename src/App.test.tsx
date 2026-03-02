import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '@/App';
import type { HealthResponse } from '@/types/health';

const mockFetchHealth = vi.fn<() => Promise<HealthResponse>>();

vi.mock('@/lib/health', () => ({
  fetchHealth: () => mockFetchHealth(),
}));

describe('App', () => {
  beforeEach(() => {
    mockFetchHealth.mockReset();
  });

  it('shows loading state while health check is in progress', async () => {
    let resolveHealth: ((value: HealthResponse) => void) | undefined;
    mockFetchHealth.mockReturnValue(
      new Promise((resolve) => {
        resolveHealth = resolve;
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByTestId('health-check-btn'));

    expect(screen.getByTestId('health-check-btn')).toBeDisabled();
    expect(screen.getByTestId('health-check-btn')).toHaveTextContent('Checking...');

    resolveHealth?.({ status: 'UP' });

    expect(await screen.findByTestId('health-result')).toHaveTextContent(
      'API status: UP',
    );
  });

  it('shows health status on successful health check', async () => {
    mockFetchHealth.mockResolvedValue({ status: 'UP' });
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByTestId('health-check-btn'));

    expect(screen.getByTestId('health-result')).toHaveTextContent('API status: UP');
  });

  it('shows normalized error message on failed health check', async () => {
    mockFetchHealth.mockRejectedValue(new Error('Backend returned CHANNEL-001'));
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByTestId('health-check-btn'));

    expect(screen.getByTestId('error-message')).toHaveTextContent(
      'Backend returned CHANNEL-001',
    );
  });

  it('replaces previous success state with error state on a failed retry', async () => {
    mockFetchHealth
      .mockResolvedValueOnce({ status: 'UP' })
      .mockRejectedValueOnce(new Error('Retry failed'));
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByTestId('health-check-btn'));
    expect(await screen.findByTestId('health-result')).toHaveTextContent(
      'API status: UP',
    );

    await user.click(screen.getByTestId('health-check-btn'));
    expect(await screen.findByTestId('error-message')).toHaveTextContent(
      'Retry failed',
    );
    expect(screen.queryByTestId('health-result')).not.toBeInTheDocument();
  });
});
